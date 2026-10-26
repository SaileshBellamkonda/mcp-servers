import type { TSNode } from './code-parser.js';

/**
 * Relations between symbols, read from the syntax tree of one file.
 *
 * - `imports`: one record per import statement (module specifier and imported names). The records belong to the first
 *   chunk of the file, because an import has no symbol of its own.
 * - `inherits`: base classes, implemented interfaces, Rust `impl Trait for Type` and trait bounds, embedded Go structs
 *   and interfaces. They belong to the class-like chunk that declares them.
 * - `calls`: call expressions, attributed to the innermost chunk that contains them (a method, a function, or a class
 *   body for field initialisers). Calls outside every chunk (module-level statements) are not recorded.
 *
 * Targets are names, not resolved symbols: the extractor sees one file. A call to a very common name (built-ins,
 * collection and string methods, logging) is a noise filter for names that resolve to nothing: it is kept as usual when
 * the file itself defines a symbol of that name, and otherwise marked `weak`, so the index shows it only if some indexed
 * symbol has that name. Each (chunk, type, name) is recorded once, and a chunk keeps at most `RELATION_CAPS` records
 * per type; what was left out is counted in `truncated` (weak calls are capped separately and not counted there).
 */
export type RelationKind = 'imports' | 'inherits' | 'calls';

export interface RawRelation {
  type: RelationKind;
  /** `position` of the chunk the relation belongs to. */
  sourcePosition: number;
  /** Callee, base type or (imports) the module specifier as written. */
  targetName: string;
  /** 1-based line of the call, base type or import statement. */
  line: number;
  /** Imports only: imported names (`*` for a namespace or wildcard import; a default import is listed by its local name). */
  names?: string[] | undefined;
  /**
   * A call to a very common name (`map`, `log`, `format`) that no symbol of this file defines. It is only worth keeping
   * if the index has a symbol of that name, so it stays hidden until one resolves it.
   */
  weak?: boolean | undefined;
  /**
   * The name written before the callee or base type: `GsonTypes` in `GsonTypes.getRawType(x)`, `views` in
   * `flask.views.View`, `y` in `x.y.z()`. Not set for `this`, `self`, `super`, calls and plain names. The resolver
   * prefers a symbol of that class or module when there is one.
   */
  qualifier?: string | undefined;
}

export interface RelationTruncation {
  sourcePosition: number;
  type: RelationKind;
  dropped: number;
}

export interface ExtractedRelations {
  relations: RawRelation[];
  truncated: RelationTruncation[];
}

/**
 * Version of the relation extraction. Bump it when the relations of an unchanged file would differ: the next startup
 * parses the indexed code files again and rewrites their relations only (chunks and vectors are not touched, nothing is
 * embedded again).
 */
export const RELATIONS_VERSION = 10;

export const NO_RELATIONS: ExtractedRelations = { relations: [], truncated: [] };

/** Records kept per source chunk and type; imports are all in one chunk, hence the larger number. */
export const RELATION_CAPS: Record<RelationKind, number> = { calls: 50, inherits: 20, imports: 200 };

/** A symbol node of the file and the `position` of its chunk. */
export interface ChunkNode {
  node: TSNode;
  position: number;
  name: string;
}

const COMMON_COMMON = [
  'toString', 'valueOf', 'equals', 'hashCode', 'format', 'join', 'split', 'trim', 'replace', 'contains', 'get', 'set', 'has',
  'add', 'remove', 'delete', 'clear', 'push', 'pop', 'map', 'filter', 'keys', 'values', 'size', 'length', 'append', 'insert',
];

const STOPLISTS: Record<string, ReadonlySet<string>> = {
  javascript: new Set([
    ...COMMON_COMMON, 'log', 'error', 'warn', 'info', 'debug', 'shift', 'unshift', 'slice', 'splice', 'reduce', 'forEach', 'find',
    'findIndex', 'some', 'every', 'includes', 'indexOf', 'concat', 'entries', 'then', 'catch', 'finally', 'toLowerCase',
    'toUpperCase', 'replaceAll', 'startsWith', 'endsWith', 'test', 'exec', 'match', 'parse', 'stringify', 'assign', 'from',
    'isArray', 'resolve', 'reject', 'all', 'now', 'floor', 'ceil', 'round', 'min', 'max', 'abs', 'require', 'String', 'Number',
    'Boolean', 'Array', 'Object', 'Error', 'Promise', 'Map', 'Set', 'Date', 'Symbol', 'RegExp', 'parseInt', 'parseFloat', 'isNaN',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'describe', 'it', 'expect', 'beforeEach', 'afterEach',
    'beforeAll', 'afterAll', 'fn', 'on', 'off', 'emit', 'write', 'end', 'call', 'apply', 'bind', 'next', 'sort', 'reverse',
    'fill', 'flat', 'flatMap', 'at', 'padStart', 'padEnd', 'charAt', 'substring', 'localeCompare', 'toFixed', 'unref', 'close',
    'resolve', 'basename', 'dirname', 'extname', 'relative', 'isAbsolute', 'existsSync', 'readFileSync', 'writeFileSync',
  ]),
  python: new Set([
    ...COMMON_COMMON, 'print', 'len', 'range', 'str', 'int', 'float', 'bool', 'list', 'dict', 'set', 'tuple', 'isinstance',
    'issubclass', 'getattr', 'setattr', 'hasattr', 'open', 'super', 'type', 'enumerate', 'zip', 'sorted', 'reversed', 'min',
    'max', 'sum', 'abs', 'any', 'all', 'extend', 'items', 'update', 'strip', 'startswith', 'endswith', 'lower', 'upper', 'sort',
    'copy', 'repr', 'id', 'iter', 'next', 'ValueError', 'TypeError', 'Exception', 'KeyError', 'RuntimeError', 'NotImplementedError',
    'format_exc', 'getLogger', 'debug', 'info', 'warning', 'error', 'exception', 'exists', 'dumps', 'loads', 'read', 'write',
  ]),
  go: new Set([
    ...COMMON_COMMON, 'len', 'cap', 'make', 'new', 'append', 'copy', 'delete', 'panic', 'recover', 'print', 'println', 'close',
    'string', 'int', 'int32', 'int64', 'uint', 'uint32', 'uint64', 'float32', 'float64', 'byte', 'rune', 'error', 'Errorf', 'Println',
    'Printf', 'Sprintf', 'Fprintf', 'Print', 'Fatal', 'Fatalf', 'Error', 'String', 'Close', 'Lock', 'Unlock', 'RLock', 'RUnlock',
    'Add', 'Done', 'Wait', 'Wrap', 'Wrapf', 'Is', 'As', 'Now', 'Since', 'Sleep', 'Join', 'Split', 'Contains', 'TrimSpace', 'Run',
  ]),
  rust: new Set([
    ...COMMON_COMMON, 'new', 'clone', 'unwrap', 'expect', 'to_string', 'into', 'from', 'as_str', 'len', 'is_empty', 'iter', 'collect',
    'unwrap_or', 'unwrap_or_else', 'unwrap_or_default', 'ok', 'err', 'Some', 'Ok', 'Err', 'Box', 'Default', 'default', 'to_owned',
    'as_ref', 'as_mut', 'borrow', 'borrow_mut', 'lock', 'with_capacity', 'and_then', 'ok_or', 'ok_or_else', 'map_err', 'cloned',
    'is_some', 'is_none', 'is_ok', 'is_err', 'take', 'extend', 'entry', 'or_insert', 'or_default', 'drop', 'to_vec', 'to_lowercase',
    'to_uppercase', 'chars', 'bytes', 'lines', 'trim', 'starts_with', 'ends_with', 'parse', 'into_iter', 'enumerate', 'zip', 'rev',
    'fmt', 'write', 'write_str', 'push_str', 'sort', 'sort_by', 'min', 'max', 'abs', 'as_bytes', 'as_slice', 'first', 'last',
  ]),
  java: new Set([
    ...COMMON_COMMON, 'println', 'print', 'printf', 'put', 'containsKey', 'isEmpty', 'stream', 'collect', 'forEach', 'of', 'asList',
    'getClass', 'substring', 'charAt', 'equalsIgnoreCase', 'startsWith', 'endsWith', 'parseInt', 'requireNonNull', 'valueOf', 'name',
    'ordinal', 'orElse', 'ifPresent', 'isPresent', 'getMessage', 'printStackTrace', 'currentTimeMillis', 'nanoTime', 'toList',
    'sort', 'copyOf', 'emptyList', 'singletonList', 'addAll', 'iterator', 'hasNext', 'next', 'close', 'lock', 'unlock',
  ]),
  csharp: new Set([
    ...COMMON_COMMON, 'WriteLine', 'Write', 'ToString', 'Equals', 'GetHashCode', 'Add', 'Remove', 'Contains', 'Count', 'Any', 'Where',
    'Select', 'ToList', 'ToArray', 'FirstOrDefault', 'First', 'Length', 'Format', 'Join', 'IsNullOrEmpty', 'IsNullOrWhiteSpace',
    'Trim', 'Split', 'Substring', 'StartsWith', 'EndsWith', 'Dispose', 'nameof', 'typeof', 'ContinueWith', 'Append', 'Insert',
    'TryGetValue', 'ContainsKey', 'GetType', 'Parse', 'TryParse', 'Run', 'Delay', 'WhenAll', 'ConfigureAwait', 'Invoke',
    'OrderBy', 'GroupBy', 'Sum', 'Max', 'Min', 'Cast', 'OfType', 'Clear', 'Replace', 'Close', 'Start', 'Stop', 'Wait',
  ]),
};
STOPLISTS['typescript'] = STOPLISTS['javascript'] ?? new Set();
STOPLISTS['tsx'] = STOPLISTS['javascript'] ?? new Set();

/** Languages for which relations are extracted. */
export const RELATION_LANGUAGES: ReadonlySet<string> = new Set(['typescript', 'tsx', 'javascript', 'python', 'go', 'rust', 'java', 'csharp']);

const IDENTIFIER = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;
const SKIPPED_NODES = new Set(['comment', 'line_comment', 'block_comment', 'string', 'string_literal', 'interpreted_string_literal', 'raw_string_literal', 'string_content']);
const PLAIN_NAMES = new Set(['identifier', 'type_identifier', 'property_identifier', 'field_identifier', 'package_identifier', 'constant']);

/** How to reach the simple name inside a qualified or generic name node. */
const NAME_VIA_FIELD: Record<string, string> = {
  member_expression: 'property',
  scoped_identifier: 'name',
  qualified_type: 'name',
  qualified_name: 'name',
  attribute: 'attribute',
  selector_expression: 'field',
  field_expression: 'field',
  member_access_expression: 'name',
  field_access: 'field',
  member_binding_expression: 'name',
  generic_function: 'function',
};
/** Qualified names without fields: the simple name is the last named child. */
const NAME_IS_LAST_CHILD = new Set(['nested_type_identifier', 'scoped_type_identifier', 'conditional_access_expression']);
/** Wrappers whose first named child holds the name. */
const NAME_IS_FIRST_CHILD = new Set(['generic_type', 'generic_name', 'pointer_type', 'reference_type', 'parenthesized_expression', 'type_arguments_wrapper']);

function namedChildren(node: TSNode): TSNode[] {
  const out: TSNode[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.isNamed) out.push(child);
  }
  return out;
}

/** Simple name of an identifier, a qualified name (`a.b.C` gives `C`) or a generic type (`List<T>` gives `List`). */
function nameOf(node: TSNode | null, depth = 0): string | null {
  if (!node || depth > 6) return null;
  if (PLAIN_NAMES.has(node.type)) return node.text;
  const field = NAME_VIA_FIELD[node.type];
  if (field !== undefined) return nameOf(node.childForFieldName(field), depth + 1);
  if (node.type === 'generic_type') return nameOf(node.childForFieldName('name') ?? node.childForFieldName('type') ?? namedChildren(node)[0] ?? null, depth + 1);
  if (NAME_IS_LAST_CHILD.has(node.type)) return nameOf(namedChildren(node).at(-1) ?? null, depth + 1);
  if (NAME_IS_FIRST_CHILD.has(node.type)) return nameOf(namedChildren(node)[0] ?? null, depth + 1);
  return null;
}

const NO_PARAMETERS: ReadonlySet<string> = new Set();

/** Nodes that declare parameters (function declarations and expressions, methods, closures, lambdas). */
const FUNCTION_NODES = new Set([
  'function_declaration', 'function_expression', 'generator_function', 'generator_function_declaration', 'arrow_function', 'method_definition',
  'function_definition', 'lambda', 'function_item', 'closure_expression', 'func_literal', 'method_declaration', 'constructor_declaration',
  'lambda_expression', 'local_function_statement', 'anonymous_method_expression',
]);

function firstIdentifier(node: TSNode | null, depth = 0): string | null {
  if (!node || depth > 4) return null;
  if (node.type === 'identifier') return node.text;
  for (const child of namedChildren(node)) {
    const found = firstIdentifier(child, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

/** Names bound by the parameters of a function-like node. */
function parameterNames(fn: TSNode): string[] {
  const params = fn.childForFieldName('parameters') ?? fn.childForFieldName('parameter');
  if (!params) return [];
  if (params.type === 'identifier') return [params.text];
  const names: string[] = [];
  for (const param of namedChildren(params)) {
    if (param.type === 'identifier') {
      names.push(param.text);
      continue;
    }
    const target = param.childForFieldName('pattern') ?? param.childForFieldName('name');
    if (target) {
      const name = firstIdentifier(target);
      if (name !== null) names.push(name);
      continue;
    }
    // Go `a, b func()` and Python `*args`, `callback: Callable`: the names are identifier children.
    for (const child of namedChildren(param)) if (child.type === 'identifier') names.push(child.text);
  }
  return names;
}

/** True for `name(...)`: the callee is a bare identifier, not `x.name(...)`, `T::name(...)` or `x?.name(...)`. */
function isPlainCallee(node: TSNode): boolean {
  if (node.type !== 'identifier') return false;
  return !(node.parent?.type === 'method_invocation' && node.parent.childForFieldName('object'));
}

const SELF_NAMES = new Set(['this', 'self', 'Self', 'super', 'base', 'cls']);

/** The name before a qualified callee or base type (see `RawRelation.qualifier`), or undefined. */
function qualifierOf(node: TSNode): string | undefined {
  let object: TSNode | null = null;
  switch (node.type) {
    case 'member_expression':
    case 'attribute':
      object = node.childForFieldName('object');
      break;
    case 'selector_expression':
      object = node.childForFieldName('operand');
      break;
    case 'field_expression':
      object = node.childForFieldName('value');
      break;
    case 'scoped_identifier':
    case 'scoped_type_identifier':
      object = node.childForFieldName('path');
      break;
    case 'member_access_expression':
      object = node.childForFieldName('expression');
      break;
    case 'qualified_name':
      object = node.childForFieldName('qualifier');
      break;
    case 'identifier':
      // Java: the `name` of `Type.method(...)` sits next to its `object`.
      if (node.parent?.type === 'method_invocation' && node.parent.childForFieldName('name')?.startIndex === node.startIndex) object = node.parent.childForFieldName('object');
      break;
    default:
  }
  const name = object ? nameOf(object) : null;
  return name === null || SELF_NAMES.has(name) ? undefined : name;
}

function stripQuotes(text: string): string {
  return text.length >= 2 ? text.slice(1, -1) : text;
}

function lineOf(node: TSNode): number {
  return node.startPosition.row + 1;
}

/** A call is reported on the line of the called name: the callee expression ends there, while a chain starts lines earlier. */
function callLineOf(callee: TSNode): number {
  return callee.endPosition.row + 1;
}

type Emit = (type: RelationKind, name: string | null, node: TSNode, position: number | undefined, names?: string[]) => void;

type Visitor = (node: TSNode, position: number | undefined, emit: Emit, isChunk: (n: TSNode) => boolean) => void;

// ─── TypeScript / JavaScript ─────────────────────────────────────────────────

function importedNamesJs(clause: TSNode | null): string[] {
  const names: string[] = [];
  for (const child of clause ? namedChildren(clause) : []) {
    if (child.type === 'identifier') names.push(child.text);
    else if (child.type === 'namespace_import') names.push('*');
    else if (child.type === 'named_imports') {
      for (const spec of namedChildren(child)) {
        const name = spec.childForFieldName('name')?.text;
        if (name) names.push(name);
      }
    }
  }
  return names;
}

function reExportedNames(node: TSNode): string[] {
  const names: string[] = [];
  for (const child of namedChildren(node)) {
    if (child.type === 'namespace_export') names.push('*');
    if (child.type !== 'export_clause') continue;
    for (const spec of namedChildren(child)) {
      const name = spec.childForFieldName('name')?.text;
      if (name) names.push(name);
    }
  }
  for (let i = 0; i < node.childCount; i++) if (node.child(i)?.type === '*') names.push('*');
  return names;
}

function firstStringArgument(call: TSNode): string | null {
  const args = call.childForFieldName('arguments');
  const first = args ? namedChildren(args)[0] : undefined;
  return first?.type === 'string' ? stripQuotes(first.text) : null;
}

function heritageNames(heritage: TSNode, emit: Emit, position: number | undefined): void {
  for (const clause of namedChildren(heritage)) {
    if (clause.type === 'extends_clause' || clause.type === 'implements_clause') {
      for (const type of namedChildren(clause)) if (type.type !== 'type_arguments') emit('inherits', nameOf(type), type, position);
    } else if (clause.type !== 'type_arguments') {
      emit('inherits', nameOf(clause), clause, position); // JavaScript: `class A extends B`
    }
  }
}

const visitTs: Visitor = (node, position, emit, isChunk) => {
  switch (node.type) {
    case 'import_statement': {
      const source = node.childForFieldName('source');
      if (source) emit('imports', stripQuotes(source.text), node, 0, importedNamesJs(namedChildren(node).find((c) => c.type === 'import_clause') ?? null));
      return;
    }
    case 'export_statement': {
      const source = node.childForFieldName('source');
      if (source) emit('imports', stripQuotes(source.text), node, 0, reExportedNames(node));
      return;
    }
    case 'call_expression': {
      const fn = node.childForFieldName('function');
      if (fn?.type === 'import' || (fn?.type === 'identifier' && fn.text === 'require')) {
        const module = firstStringArgument(node);
        if (module !== null) emit('imports', module, node, 0, []);
        return;
      }
      emit('calls', nameOf(fn), fn ?? node, position);
      return;
    }
    case 'new_expression':
      emit('calls', nameOf(node.childForFieldName('constructor')), node.childForFieldName('constructor') ?? node, position);
      return;
    case 'class_heritage':
      if (node.parent && isChunk(node.parent)) heritageNames(node, emit, position);
      return;
    case 'extends_type_clause':
      if (node.parent && isChunk(node.parent)) for (const type of namedChildren(node)) if (type.type !== 'type_arguments') emit('inherits', nameOf(type), type, position);
      return;
    default:
  }
};

// ─── Python ──────────────────────────────────────────────────────────────────

function pythonModule(node: TSNode): string {
  return node.type === 'aliased_import' ? (node.childForFieldName('name')?.text ?? '') : node.text;
}

const visitPython: Visitor = (node, position, emit, isChunk) => {
  switch (node.type) {
    case 'import_statement':
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.isNamed && (child.type === 'dotted_name' || child.type === 'aliased_import')) emit('imports', pythonModule(child), node, 0, []);
      }
      return;
    case 'import_from_statement': {
      const module = node.childForFieldName('module_name');
      if (!module) return;
      const names: string[] = [];
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child?.isNamed || child.startIndex === module.startIndex) continue;
        if (child.type === 'wildcard_import') names.push('*');
        else if (child.type === 'dotted_name' || child.type === 'aliased_import') names.push(pythonModule(child));
      }
      if (/^\.+$/.test(module.text)) {
        // `from . import x`: each name is a sibling module.
        for (const name of names) emit('imports', `${module.text}${name}`, node, 0, []);
      } else {
        emit('imports', module.text, node, 0, names);
      }
      return;
    }
    case 'call':
      emit('calls', nameOf(node.childForFieldName('function')), node.childForFieldName('function') ?? node, position);
      return;
    case 'class_definition': {
      if (!isChunk(node)) return;
      const bases = node.childForFieldName('superclasses');
      for (const base of bases ? namedChildren(bases) : []) if (base.type !== 'keyword_argument') emit('inherits', nameOf(base), base, position);
      return;
    }
    default:
  }
};

// ─── Go ──────────────────────────────────────────────────────────────────────

const visitGo: Visitor = (node, position, emit, isChunk) => {
  switch (node.type) {
    case 'import_spec': {
      const spec = node.childForFieldName('path');
      if (spec) emit('imports', stripQuotes(spec.text), node, 0, []);
      return;
    }
    case 'call_expression':
      emit('calls', nameOf(node.childForFieldName('function')), node.childForFieldName('function') ?? node, position);
      return;
    case 'field_declaration': {
      // An embedded struct field has a type and no name.
      if (node.childForFieldName('name') || node.parent?.type !== 'field_declaration_list' || node.parent.parent?.type !== 'struct_type') return;
      if (position !== undefined && ownerIsChunk(node, isChunk)) emit('inherits', nameOf(node.childForFieldName('type')), node, position);
      return;
    }
    case 'type_elem': {
      const parts = namedChildren(node);
      if (parts.length === 1 && position !== undefined && ownerIsChunk(node, isChunk)) emit('inherits', nameOf(parts[0] ?? null), node, position);
      return;
    }
    default:
  }
};

/** True when the nearest enclosing `type_declaration` is a chunk of its own (a struct or interface symbol). */
function ownerIsChunk(node: TSNode, isChunk: (n: TSNode) => boolean): boolean {
  for (let current = node.parent; current; current = current.parent) if (current.type === 'type_declaration') return isChunk(current);
  return false;
}

// ─── Rust ────────────────────────────────────────────────────────────────────

function pathSegments(node: TSNode | null): string[] {
  if (!node) return [];
  if (node.type === 'scoped_identifier') return [...pathSegments(node.childForFieldName('path')), node.childForFieldName('name')?.text ?? ''];
  return [node.text];
}

interface UsePath {
  segments: string[];
  wildcard: boolean;
}

function flattenUse(node: TSNode | null, prefix: string[]): UsePath[] {
  if (!node) return [];
  switch (node.type) {
    case 'scoped_use_list':
      return flattenUse(node.childForFieldName('list'), [...prefix, ...pathSegments(node.childForFieldName('path'))]);
    case 'use_list':
      return namedChildren(node).flatMap((child) => flattenUse(child, prefix));
    case 'use_as_clause':
      return flattenUse(node.childForFieldName('path'), prefix);
    case 'use_wildcard': {
      const inner = namedChildren(node)[0] ?? null;
      return [{ segments: [...prefix, ...(inner ? pathSegments(inner) : [])], wildcard: true }];
    }
    default:
      return [{ segments: [...prefix, ...pathSegments(node)], wildcard: false }];
  }
}

const visitRust: Visitor = (node, position, emit, isChunk) => {
  switch (node.type) {
    case 'use_declaration': {
      for (const use of flattenUse(node.childForFieldName('argument'), [])) {
        const segments = use.segments.at(-1) === 'self' ? use.segments.slice(0, -1) : use.segments;
        if (use.wildcard) emit('imports', segments.join('::'), node, 0, ['*']);
        else if (segments.length > 1) emit('imports', segments.slice(0, -1).join('::'), node, 0, [segments.at(-1) ?? '']);
        else if (segments.length === 1) emit('imports', segments[0] ?? '', node, 0, []);
      }
      return;
    }
    case 'mod_item': {
      const name = node.childForFieldName('name')?.text;
      if (name && !node.childForFieldName('body')) emit('imports', `self::${name}`, node, 0, []);
      return;
    }
    case 'call_expression':
      emit('calls', nameOf(node.childForFieldName('function')), node.childForFieldName('function') ?? node, position);
      return;
    case 'impl_item': {
      const trait = node.childForFieldName('trait');
      if (trait && isChunk(node)) emit('inherits', nameOf(trait), trait, position);
      return;
    }
    case 'trait_item': {
      const bounds = node.childForFieldName('bounds');
      if (isChunk(node)) for (const bound of bounds ? namedChildren(bounds) : []) emit('inherits', nameOf(bound), bound, position);
      return;
    }
    default:
  }
};

// ─── Java ────────────────────────────────────────────────────────────────────

const visitJava: Visitor = (node, position, emit, isChunk) => {
  switch (node.type) {
    case 'import_declaration': {
      const path = namedChildren(node).find((c) => c.type === 'scoped_identifier' || c.type === 'identifier');
      if (!path) return;
      const isStatic = namedChildren(node).length > 0 && node.text.startsWith('import static');
      const wildcard = namedChildren(node).some((c) => c.type === 'asterisk');
      if (wildcard) emit('imports', path.text, node, 0, ['*']);
      else if (isStatic && path.type === 'scoped_identifier') emit('imports', path.childForFieldName('scope')?.text ?? path.text, node, 0, [path.childForFieldName('name')?.text ?? '']);
      else emit('imports', path.text, node, 0, []);
      return;
    }
    case 'method_invocation':
      emit('calls', node.childForFieldName('name')?.text ?? null, node.childForFieldName('name') ?? node, position);
      return;
    case 'object_creation_expression':
      emit('calls', nameOf(node.childForFieldName('type')), node.childForFieldName('type') ?? node, position);
      return;
    case 'class_declaration':
    case 'interface_declaration':
    case 'record_declaration':
    case 'enum_declaration': {
      if (!isChunk(node)) return;
      for (const clause of namedChildren(node)) {
        if (clause.type !== 'superclass' && clause.type !== 'super_interfaces' && clause.type !== 'extends_interfaces') continue;
        const direct = namedChildren(clause);
        const types = direct.length === 1 && direct[0]?.type === 'type_list' ? namedChildren(direct[0]) : direct;
        for (const type of types) emit('inherits', nameOf(type), type, position);
      }
      return;
    }
    default:
  }
};

// ─── C# ──────────────────────────────────────────────────────────────────────

const CSHARP_TYPE_DECLARATIONS = new Set(['class_declaration', 'interface_declaration', 'struct_declaration', 'record_declaration']);

const visitCsharp: Visitor = (node, position, emit, isChunk) => {
  switch (node.type) {
    case 'using_directive': {
      const parts = namedChildren(node);
      const target = parts.at(-1);
      if (target && (target.type === 'identifier' || target.type === 'qualified_name')) emit('imports', target.text, node, 0, []);
      return;
    }
    case 'invocation_expression':
      emit('calls', nameOf(node.childForFieldName('function')), node.childForFieldName('function') ?? node, position);
      return;
    case 'object_creation_expression':
      emit('calls', nameOf(node.childForFieldName('type')), node.childForFieldName('type') ?? node, position);
      return;
    default:
      if (!CSHARP_TYPE_DECLARATIONS.has(node.type) || !isChunk(node)) return;
      for (const clause of namedChildren(node)) {
        if (clause.type !== 'base_list') continue;
        for (const base of namedChildren(clause)) emit('inherits', nameOf(base), base, position);
      }
  }
};

const VISITORS: Record<string, Visitor> = {
  typescript: visitTs,
  tsx: visitTs,
  javascript: visitTs,
  python: visitPython,
  go: visitGo,
  rust: visitRust,
  java: visitJava,
  csharp: visitCsharp,
};

/**
 * Reads the relations of one parsed file. `chunks` are the symbol nodes the chunks were made from; a relation belongs to
 * the innermost chunk around it. Returns nothing for a language without a visitor or a file without chunks.
 */
export function extractRelations(root: TSNode, lang: string, chunks: readonly ChunkNode[]): ExtractedRelations {
  const visitor = VISITORS[lang];
  if (!visitor || chunks.length === 0) return NO_RELATIONS;
  const stoplist = STOPLISTS[lang] ?? new Set<string>();
  const definedHere = new Set(chunks.map((c) => c.name));

  const byStart = new Map<number, ChunkNode[]>();
  for (const chunk of chunks) {
    const list = byStart.get(chunk.node.startIndex);
    if (list) list.push(chunk);
    else byStart.set(chunk.node.startIndex, [chunk]);
  }
  const chunkOf = (node: TSNode): ChunkNode | undefined => byStart.get(node.startIndex)?.find((c) => c.node.endIndex === node.endIndex);
  const isChunk = (node: TSNode): boolean => chunkOf(node) !== undefined;

  const relations: RawRelation[] = [];
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  const dropped = new Map<string, RelationTruncation>();
  const importIndex = new Map<string, RawRelation>();

  // Names of the parameters of the functions around the node being visited.
  let scopeParams: ReadonlySet<string> = NO_PARAMETERS;

  const emit: Emit = (type, name, node, position, names) => {
    if (name === null || position === undefined) return;
    // `callback(x)`, `done()`, `handler()`: a call of a parameter is a call of whatever the caller passed in.
    if (type === 'calls' && scopeParams.has(name) && isPlainCallee(node)) return;
    if (type === 'imports') {
      if (name === '') return;
      const existing = importIndex.get(name);
      if (existing) {
        for (const n of names ?? []) if (!(existing.names ?? []).includes(n)) existing.names?.push(n);
        return;
      }
    } else if (!IDENTIFIER.test(name)) {
      return;
    }
    if (type === 'calls' && name.length < 2) return;
    const weak = type === 'calls' && stoplist.has(name) && !definedHere.has(name);

    const key = `${type}\u0000${String(position)}\u0000${name}`;
    if (seen.has(key)) return;
    seen.add(key);

    const countKey = `${weak ? 'weak' : type}\u0000${String(position)}`;
    const count = counts.get(countKey) ?? 0;
    if (count >= RELATION_CAPS[type]) {
      if (weak) return;
      const entry = dropped.get(countKey) ?? { sourcePosition: position, type, dropped: 0 };
      entry.dropped++;
      dropped.set(countKey, entry);
      return;
    }
    counts.set(countKey, count + 1);
    const qualifier = type === 'imports' ? undefined : qualifierOf(node);
    const relation: RawRelation = {
      type,
      sourcePosition: position,
      targetName: name,
      line: type === 'calls' ? callLineOf(node) : lineOf(node),
      ...(type === 'imports' ? { names: [...(names ?? [])] } : {}),
      ...(weak ? { weak: true } : {}),
      ...(qualifier === undefined ? {} : { qualifier }),
    };
    relations.push(relation);
    if (type === 'imports') importIndex.set(name, relation);
  };

  const stack: { node: TSNode; position: number | undefined; params: ReadonlySet<string> }[] = [{ node: root, position: undefined, params: NO_PARAMETERS }];
  for (let frame = stack.pop(); frame; frame = stack.pop()) {
    const { node } = frame;
    const position = chunkOf(node)?.position ?? frame.position;
    const own = FUNCTION_NODES.has(node.type) ? parameterNames(node) : [];
    const params = own.length === 0 ? frame.params : new Set([...frame.params, ...own]);
    scopeParams = params;
    visitor(node, position, emit, isChunk);
    for (let i = node.childCount - 1; i >= 0; i--) {
      const child = node.child(i);
      if (child?.isNamed && !SKIPPED_NODES.has(child.type)) stack.push({ node: child, position, params });
    }
  }

  // Imports belong to the first chunk of the file.
  const first = chunks.reduce((min, c) => Math.min(min, c.position), Number.POSITIVE_INFINITY);
  const toFirst = <T extends { type: RelationKind; sourcePosition: number }>(r: T): T => (r.type === 'imports' ? { ...r, sourcePosition: first } : r);
  return { relations: relations.map(toFirst), truncated: [...dropped.values()].map(toFirst) };
}
