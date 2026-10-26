import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CodeChunk, SymbolType } from '../core/types.js';
import { getLanguageByExtension, SUPPORTED_LANGUAGES } from './languages.js';

/**
 * Version of what `CodeParser` stores per symbol (signature rules, symbol selection). Bump it when the output for an
 * unchanged file would differ: the next startup sync then re-parses every indexed code file.
 * 2: signatures come from the tree-sitter `body` field instead of the first `=>` or `{` in the text.
 * 3: `.tsx` files are parsed with the tsx grammar (language `tsx`) instead of the TypeScript grammar.
 */
export const CODE_PARSER_VERSION = 3;

let defaultRequire: NodeJS.Require | undefined;

export interface CodeParserOptions {
  /** Directory whose `node_modules` holds tree-sitter and the grammars (bundled builds); default: this package's own resolution. */
  nativeModulesDir?: string | undefined;
}

// `import.meta.url` is only read when no `nativeModulesDir` is given, so a CommonJS bundle (where it is
// undefined) loads fine as long as it passes one.
function requireFor(nativeModulesDir: string | undefined): NodeJS.Require {
  if (nativeModulesDir !== undefined) return createRequire(path.join(nativeModulesDir, 'index.js'));
  return (defaultRequire ??= createRequire(import.meta.url));
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
  childForFieldName(fieldName: string): TSNode | null;
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
      const signature = extractSignature(symbolNode, source);
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

const MAX_SIGNATURE_CHARS = 200;

function tidySignature(text: string): string {
  const collapsed = text
    .replace(/\s+/g, ' ')
    .replace(/\( /g, '(')
    .replace(/,? \)/g, ')')
    .trim();
  if (collapsed.length <= MAX_SIGNATURE_CHARS) return collapsed;
  return `${collapsed.slice(0, MAX_SIGNATURE_CHARS - 1).trimEnd()}…`;
}

/** The `=>` token of an arrow function assigned to a variable declared by `node` (`const f = (a) => ...`). */
function findArrowToken(node: TSNode): TSNode | null {
  for (let i = 0; i < node.childCount; i++) {
    const declarator = node.child(i);
    if (declarator?.type !== 'variable_declarator') continue;
    const value = declarator.childForFieldName('value');
    if (value?.type !== 'arrow_function') continue;
    for (let j = 0; j < value.childCount; j++) {
      const token = value.child(j);
      if (token?.type === '=>') return token;
    }
  }
  return null;
}

/** First child that is not a decorator: signatures start at the declaration keyword, not at `@Decorator(...)`. */
function firstNonDecoratorStart(node: TSNode): number {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.type !== 'decorator') return child.startIndex;
  }
  return node.startIndex;
}

/**
 * The declaration text from the symbol node's start up to its `body` field child (arrow functions assigned to a
 * variable: up to their own `=>`), whitespace collapsed and capped at 200 characters. A node without a body
 * (struct declarations in Go, abstract methods) falls back to its first line.
 */
function extractSignature(node: TSNode, source: string): string {
  const arrow = findArrowToken(node);
  if (arrow) return tidySignature(source.slice(node.startIndex, arrow.endIndex));
  const body = node.childForFieldName('body');
  if (body && body.startIndex > node.startIndex) {
    return tidySignature(source.slice(firstNonDecoratorStart(node), body.startIndex));
  }
  return tidySignature(source.slice(node.startIndex, node.endIndex).split('\n')[0] ?? '');
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
