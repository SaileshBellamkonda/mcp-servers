import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CodeChunk, SymbolType } from '../core/types.js';
import { getLanguageByExtension, SUPPORTED_LANGUAGES } from './languages.js';

const defaultRequire = createRequire(import.meta.url);

export interface CodeParserOptions {
  /** Directory whose `node_modules` holds tree-sitter and the grammars (bundled builds); default: this package's own resolution. */
  nativeModulesDir?: string | undefined;
}

function requireFor(nativeModulesDir: string | undefined): NodeJS.Require {
  return nativeModulesDir === undefined ? defaultRequire : createRequire(path.join(nativeModulesDir, 'index.js'));
}

// Minimal type declarations for tree-sitter's Node.js API (v0.21.x)
interface TSNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  startIndex: number;
  endIndex: number;
  parent: TSNode | null;
  childCount: number;
  child(index: number): TSNode | null;
}

interface TSCapture {
  name: string;
  node: TSNode;
}

interface TSMatch {
  pattern: number;
  captures: TSCapture[];
}

interface TSQuery {
  matches(node: TSNode): TSMatch[];
}

interface TSTree {
  rootNode: TSNode;
}

type TSLanguage = object;

interface TSParser {
  setLanguage(lang: TSLanguage): void;
  parse(source: string): TSTree;
}

interface TSParserConstructor {
  new (): TSParser;
  Query: new (lang: TSLanguage, source: string) => TSQuery;
}

type CaptureType = 'function' | 'method' | 'class' | 'struct' | 'interface';

const CAPTURE_TO_SYMBOL_TYPE: Record<CaptureType, SymbolType> = {
  function: 'function',
  method: 'method',
  class: 'class',
  struct: 'struct',
  interface: 'interface',
};

// Loads a grammar package's native binding directly via `node-gyp-build`
// instead of `require('tree-sitter-<lang>')`. Some tree-sitter grammar
// packages (e.g. tree-sitter-c-sharp) publish an ESM entry point with a
// top-level await while resolving the native binding, which Node's CJS
// `require()` cannot resolve synchronously ("require() cannot be used on
// an ESM graph with top-level await"). Going straight to the native
// binding sidesteps that regardless of how a package's JS wrapper is
// authored, including if other grammars migrate to the same style later.
function loadNativeBinding(require: NodeJS.Require, packageName: string): Record<string, TSLanguage> {
  const pkgRoot = path.dirname(require.resolve(`${packageName}/package.json`));
  const nodeGypBuild = require(require.resolve('node-gyp-build', { paths: [pkgRoot] })) as (
    dir: string
  ) => Record<string, TSLanguage>;
  return nodeGypBuild(pkgRoot);
}

// Picks one named grammar out of a multi-grammar native binding.
function pickGrammar(require: NodeJS.Require, packageName: string, exportName: string): TSLanguage {
  const language = loadNativeBinding(require, packageName)[exportName];
  if (!language) {
    throw new Error(`Grammar "${exportName}" not found in ${packageName}`);
  }
  return language;
}

function loadGrammar(require: NodeJS.Require, grammarKey: string): TSLanguage {
  // tree-sitter-typescript's native binding exports { typescript, tsx }
  if (grammarKey === 'typescript') {
    return pickGrammar(require, 'tree-sitter-typescript', 'typescript');
  }
  if (grammarKey === 'tsx') {
    return pickGrammar(require, 'tree-sitter-typescript', 'tsx');
  }
  // tree-sitter-php's native binding exports { php, php_only } - use php
  if (grammarKey === 'php') {
    return pickGrammar(require, 'tree-sitter-php', 'php');
  }
  const packageName = grammarKey === 'c_sharp' ? 'tree-sitter-c-sharp' : `tree-sitter-${grammarKey}`;
  return loadNativeBinding(require, packageName);
}

export class CodeParser {
  private readonly ParserClass: TSParserConstructor;
  private readonly parsers = new Map<string, TSParser>();
  private readonly queries = new Map<string, TSQuery>();
  private readonly languages = new Map<string, TSLanguage>();

  constructor(options: CodeParserOptions = {}) {
    const require = requireFor(options.nativeModulesDir);
    this.ParserClass = require('tree-sitter') as TSParserConstructor;
    this.initLanguages(require);
  }

  private initLanguages(require: NodeJS.Require): void {
    for (const [key, config] of Object.entries(SUPPORTED_LANGUAGES)) {
      if (key === 'vue') continue; // Vue uses special handling
      try {
        const lang = loadGrammar(require, config.grammarKey);
        const parser = new this.ParserClass();
        parser.setLanguage(lang);
        const query = new this.ParserClass.Query(lang, config.query);
        this.languages.set(key, lang);
        this.parsers.set(key, parser);
        this.queries.set(key, query);
      } catch (err) {
        // Skip languages that failed to load (missing grammar package)
        process.stderr.write(`[WARN] Failed to load tree-sitter grammar for ${key}: ${String(err)}\n`);
      }
    }
  }

  close(): void {
    // tree-sitter Node.js parsers don't need explicit cleanup in v0.21.x
  }

  /** `readFrom` is the path actually opened (the guard-resolved real path); the language still comes from `filePath`. */
  parseFile(filePath: string, readFrom: string = filePath): CodeChunk[] {
    const ext = path.extname(filePath).toLowerCase();
    const langConfig = getLanguageByExtension(ext);
    if (!langConfig) {
      throw new Error(`Unsupported file type: ${ext}`);
    }

    const langKey = langConfig.name;
    const parser = this.parsers.get(langKey);
    const query = this.queries.get(langKey);

    if (!parser || !query) {
      throw new Error(`Grammar not loaded for language: ${langKey}`);
    }

    const source = readFileSync(readFrom, 'utf8');
    const tree = parser.parse(source);
    return this.extractSymbols(tree.rootNode, source, langKey, query);
  }

  private extractSymbols(root: TSNode, source: string, lang: string, query: TSQuery): CodeChunk[] {
    const matches = query.matches(root);
    const chunks: CodeChunk[] = [];
    const seen = new Set<string>();
    let position = 0;

    for (const match of matches) {
      let symbolName = '';
      let symbolNode: TSNode | null = null;
      let symbolType: SymbolType = 'function';

      for (const capture of match.captures) {
        if (capture.name === 'name') {
          symbolName = capture.node.text;
        } else {
          const capType = capture.name as CaptureType;
          if (capType in CAPTURE_TO_SYMBOL_TYPE) {
            symbolNode = capture.node;
            symbolType = CAPTURE_TO_SYMBOL_TYPE[capType];
          }
        }
      }

      if (!symbolNode || !symbolName) continue;

      const key = `${String(symbolNode.startIndex)}-${String(symbolNode.endIndex)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const content = source.slice(symbolNode.startIndex, symbolNode.endIndex);
      const startLine = symbolNode.startPosition.row + 1;
      const endLine = symbolNode.endPosition.row + 1;
      const signature = extractSignature(content, lang);
      const parentSymbol = findParentSymbol(symbolNode, source, lang);

      chunks.push({
        content,
        position: position++,
        symbolName,
        symbolType,
        language: lang,
        startLine,
        endLine,
        parentSymbol,
        signature,
      });
    }

    return chunks;
  }

  static getEmbeddingText(chunk: CodeChunk): string {
    return `${chunk.language} ${chunk.symbolName}: ${chunk.content}`;
  }
}

function extractSignature(content: string, lang: string): string {
  const braceIdx = content.indexOf('{');
  switch (lang) {
    case 'python': {
      const colonIdx = content.indexOf(':');
      if (colonIdx === -1) return content.split('\n')[0]?.trim() ?? content;
      return content.slice(0, colonIdx).trim().replace(/\s+/g, ' ');
    }
    case 'typescript':
    case 'javascript':
      if (content.includes('=>')) {
        const arrowIdx = content.indexOf('=>');
        return content.slice(0, arrowIdx + 2).trim().replace(/\s+/g, ' ');
      }
      if (braceIdx === -1) return content.split('\n')[0]?.trim() ?? content;
      return content.slice(0, braceIdx).trim().replace(/\s+/g, ' ');
    default:
      if (braceIdx === -1) return content.split('\n')[0]?.trim() ?? content;
      return content.slice(0, braceIdx).trim().replace(/\s+/g, ' ');
  }
}

function findParentSymbol(node: TSNode, source: string, _lang: string): string {
  let current = node.parent;
  while (current) {
    const type = current.type;
    const isClass =
      type === 'class_declaration' ||
      type === 'class_definition' ||
      type === 'class_specifier' ||
      type === 'impl_item';
    if (isClass) {
      // find name child
      for (let i = 0; i < current.childCount; i++) {
        const child = current.child(i);
        if (
          child &&
          (child.type === 'identifier' || child.type === 'type_identifier' || child.type === 'constant')
        ) {
          return source.slice(child.startIndex, child.endIndex);
        }
      }
    }
    current = current.parent;
  }
  return '';
}
