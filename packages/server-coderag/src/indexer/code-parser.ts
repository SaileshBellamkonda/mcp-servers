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
 * 4: a class, struct, interface or impl is stored as a skeleton (header and member list) instead of its whole body.
 */
export const CODE_PARSER_VERSION = 4;

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
  isNamed: boolean;
  previousSibling: TSNode | null;
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

interface Symbol {
  node: TSNode;
  name: string;
  type: SymbolType;
  signature: string;
}

function rangeKey(node: TSNode): string {
  return `${String(node.startIndex)}-${String(node.endIndex)}`;
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
    const symbols: Symbol[] = [];
    const seen = new Set<string>();

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

      const key = rangeKey(symbolNode);
      if (seen.has(key)) continue;
      seen.add(key);
      symbols.push({ node: symbolNode, name: symbolName, type: symbolType, signature: extractSignature(symbolNode, source) });
    }

    const byRange = new Map(symbols.map((symbol) => [rangeKey(symbol.node), symbol]));
    const skeletons = SKELETON_LANGUAGES.has(lang);

    return symbols.map((symbol, position) => {
      const node = symbol.node;
      const skeleton = skeletons && CONTAINER_TYPES.has(symbol.type) ? buildSkeleton(symbol, lang, source, byRange) : null;
      return {
        content: skeleton ?? source.slice(node.startIndex, node.endIndex),
        position,
        symbolName: symbol.name,
        symbolType: symbol.type,
        language: lang,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        parentSymbol: findParentSymbol(node, source, lang),
        signature: symbol.signature,
      };
    });
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

// ─── Container skeletons ─────────────────────────────────────────────────────

/** Languages whose class-like symbols are indexed as a skeleton (header and member list) instead of the whole body. */
const SKELETON_LANGUAGES = new Set(['typescript', 'tsx', 'javascript', 'python', 'go', 'rust', 'java', 'csharp', 'cpp']);
const CONTAINER_TYPES = new Set<SymbolType>(['class', 'struct', 'interface']);
const MAX_SKELETON_MEMBERS = 60;
/** Upper bound for the text of one skeleton chunk. */
const MAX_SKELETON_CHARS = 2000;
const MAX_MEMBER_LINE_CHARS = 100;
const MAX_DOC_CHARS = 160;
/** Characters kept free for the `+N more members` line. */
const MORE_LINE_RESERVE = 24;

const COMMENT_TYPES = new Set(['comment', 'line_comment', 'block_comment']);
/** Nodes between a doc comment and the declaration it documents (Rust attributes, Python decorators). */
const BETWEEN_DOC_AND_DECLARATION = new Set(['attribute_item', 'decorator']);
/** Nodes wrapped around a declaration; a doc comment sits above the wrapper. */
const DECLARATION_WRAPPERS = new Set(['export_statement', 'decorated_definition', 'template_declaration']);
/** Direct children of a class body that are not members. */
const NOT_MEMBERS = new Set(['attribute_item', 'inner_attribute_item', 'access_specifier', 'pass_statement', 'decorator', 'ERROR']);
/** A signature that already starts with its declaration keyword needs no kind label. */
const DECLARATION_KEYWORD =
  /^(?:(?:pub(?:\([^)]*\))?|async|static|public|private|protected|internal|export|default|abstract|final|unsafe|const|extern|override|virtual|inline|sealed|partial)\s+)*(?:def|fn|func|function|class|struct|interface|trait|enum|impl|type)\b/;

function clipTo(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** The node whose named children are the members of a container symbol, or null when it has none. */
function memberContainer(node: TSNode, name: string): TSNode | null {
  if (node.type !== 'type_declaration') return node.childForFieldName('body');
  // Go: `type Name struct { ... }` / `type Name interface { ... }`
  for (let i = 0; i < node.childCount; i++) {
    const spec = node.child(i);
    if (spec?.type !== 'type_spec' || spec.childForFieldName('name')?.text !== name) continue;
    const type = spec.childForFieldName('type');
    if (type?.type === 'interface_type') return type;
    for (let j = 0; type && j < type.childCount; j++) {
      const list = type.child(j);
      if (list?.type === 'field_declaration_list') return list;
    }
  }
  return null;
}

function isDocstring(node: TSNode): boolean {
  return node.type === 'expression_statement' && node.childCount === 1 && node.child(0)?.type === 'string';
}

function memberLine(child: TSNode, source: string, byRange: Map<string, Symbol>): string | null {
  const wrapped = child.childForFieldName('definition');
  const symbol = byRange.get(rangeKey(child)) ?? (wrapped ? byRange.get(rangeKey(wrapped)) : undefined);
  if (symbol) {
    return DECLARATION_KEYWORD.test(symbol.signature) ? symbol.signature : `${symbol.type} ${symbol.signature}`;
  }
  // An enum variant's `body` field is its tuple or struct payload, which belongs to the line.
  const declaration = child.type === 'enum_variant' ? tidySignature(source.slice(child.startIndex, child.endIndex).split('\n')[0] ?? '') : extractSignature(child, source);
  const text = declaration.replace(/\s*[;,{]+\s*$/, '');
  return text === '' ? null : text;
}

function memberLines(container: TSNode, source: string, byRange: Map<string, Symbol>): string[] {
  const lines: string[] = [];
  for (let i = 0; i < container.childCount; i++) {
    const child = container.child(i);
    if (!child?.isNamed || COMMENT_TYPES.has(child.type) || NOT_MEMBERS.has(child.type) || isDocstring(child)) continue;
    const line = memberLine(child, source, byRange);
    if (line !== null) lines.push(clipTo(line, MAX_MEMBER_LINE_CHARS));
  }
  return lines;
}

function firstParagraph(rawLines: readonly string[]): string {
  const kept: string[] = [];
  for (const raw of rawLines) {
    const line = raw.trim();
    if (line === '' ? kept.length > 0 : line.startsWith('@')) break;
    if (line !== '') kept.push(line);
  }
  return clipTo(kept.join(' '), MAX_DOC_CHARS);
}

/** Last line a node occupies; a node that ends with its newline (Rust line comments) ends on the line before. */
function lastRow(node: TSNode): number {
  return node.endPosition.column === 0 && node.endPosition.row > node.startPosition.row ? node.endPosition.row - 1 : node.endPosition.row;
}

/** The first paragraph of the comment block that ends on the line directly above the declaration, or ''. */
function leadingComment(node: TSNode, source: string): string {
  let target = node;
  while (target.parent && DECLARATION_WRAPPERS.has(target.parent.type)) target = target.parent;
  let row = target.startPosition.row;
  let prev = target.previousSibling;
  while (prev && BETWEEN_DOC_AND_DECLARATION.has(prev.type)) {
    row = prev.startPosition.row;
    prev = prev.previousSibling;
  }
  const lines: string[] = [];
  while (prev && COMMENT_TYPES.has(prev.type) && lastRow(prev) === row - 1) {
    // A comment that trails another statement on its own line does not document what follows.
    if (prev.previousSibling && lastRow(prev.previousSibling) === prev.startPosition.row) break;
    lines.unshift(
      ...source
        .slice(prev.startIndex, prev.endIndex)
        .split('\n')
        .map((l) => l.replace(/^\s*(?:\/\*+|\/\/[/!]?|\*(?!\/)|#+)\s?/, '').replace(/\s*\*+\/\s*$/, '')),
    );
    row = prev.startPosition.row;
    prev = prev.previousSibling;
  }
  return firstParagraph(lines);
}

/** First line of a Python class docstring, without quotes. */
function pythonDocstring(body: TSNode, source: string): string {
  for (let i = 0; i < body.childCount; i++) {
    const child = body.child(i);
    if (!child?.isNamed || COMMENT_TYPES.has(child.type)) continue;
    if (!isDocstring(child)) return '';
    const raw = source.slice(child.startIndex, child.endIndex).replace(/^[rRuUbBfF]*("""|'''|"|')/, '').replace(/("""|'''|"|')$/, '');
    return firstParagraph(raw.split('\n'));
  }
  return '';
}

/**
 * Compact stand-in for a class, struct, interface or impl: the doc comment above it (first paragraph), its signature
 * and one line per member (`kind signature`, or the first line of a field), at most 60 members and 2000 characters,
 * ending with `+N more members` when some were left out. Member bodies are not included: methods are indexed as
 * chunks of their own. Null when there is nothing to list, so a member-less symbol keeps its text.
 */
function buildSkeleton(symbol: Symbol, lang: string, source: string, byRange: Map<string, Symbol>): string | null {
  const container = memberContainer(symbol.node, symbol.name);
  if (!container) return null;
  const members = memberLines(container, source, byRange);
  const doc = lang === 'python' ? pythonDocstring(container, source) : leadingComment(symbol.node, source);
  if (members.length === 0 && doc === '') return null;

  const lines: string[] = [];
  if (doc !== '') lines.push(`${lang === 'python' ? '#' : '//'} ${doc}`);
  lines.push(symbol.signature);
  let used = lines.join('\n').length;
  let shown = 0;
  for (const member of members) {
    const line = `  ${member}`;
    if (shown >= MAX_SKELETON_MEMBERS || used + 1 + line.length > MAX_SKELETON_CHARS - MORE_LINE_RESERVE) break;
    lines.push(line);
    used += 1 + line.length;
    shown++;
  }
  if (shown < members.length) lines.push(`  +${String(members.length - shown)} more members`);
  return lines.join('\n');
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
