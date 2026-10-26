/**
 * Text preparation for the FTS5 keyword index and the queries run against it.
 *
 * The tokenizer (unicode61 + porter) lowercases and splits on punctuation, but keeps a camelCase identifier such as
 * `chunkMarkdown` as one token, so a search for "chunk markdown" never found it. Two mirrored steps fix that:
 *  - index side: `expandIdentifiers` appends the lowercase words of every compound identifier to the indexed text
 *    (the original token stays), so both `chunkMarkdown` and `chunk` / `markdown` are findable;
 *  - query side: `buildFtsQueries` splits the user's words the same way, drops stop words, adds prefix matching and
 *    escapes everything (each term is a double-quoted string made of letters, digits and `_` only).
 */

/** Version of the FTS layout and text preparation; stored in `db_meta` so an older index is rebuilt on startup. */
export const FTS_VERSION = 2;

/** Maximum terms taken from a query, to keep the generated MATCH expression small. */
const MAX_QUERY_TERMS = 16;
/** The last term matches as a prefix when it has at least this many characters (`valid` finds `validation`). */
const PREFIX_MIN_LENGTH = 2;

/** Identifier characters: letters, digits and `_` (FTS5 gets `tokenchars '_'`, so `snake_case` is one token). */
const TOKEN = /[\p{L}\p{N}_]+/gu;
/** Word pieces of a camelCase / PascalCase run: `HTMLParser` -> `HTML`, `Parser`; digits stay with their letters. */
const CAMEL_PIECE = /\p{Lu}+(?=\p{Lu}\p{Ll})|\p{Lu}?[\p{Ll}\p{N}]+|\p{Lu}+/gu;

/** Lowercase words of one identifier, split at `_`, at lower-to-upper transitions and before an acronym's last capital. */
export function splitIdentifier(token: string): string[] {
  const words: string[] = [];
  for (const segment of token.split('_')) {
    for (const piece of segment.match(CAMEL_PIECE) ?? []) words.push(piece.toLowerCase());
  }
  return words;
}

/**
 * The text with the words of its compound identifiers (camelCase, PascalCase, snake_case) appended on a new line,
 * each word once. Text without a compound identifier is returned unchanged.
 */
export function expandIdentifiers(text: string): string {
  const extra = new Set<string>();
  for (const token of text.match(TOKEN) ?? []) {
    const words = splitIdentifier(token);
    if (words.length > 1 || (words.length === 1 && words[0] !== token)) {
      for (const word of words) extra.add(word);
    }
  }
  return extra.size === 0 ? text : `${text}\n${[...extra].join(' ')}`;
}

const STOP_WORDS = new Set(
  (
    'a an and are as at be been but by can could did do does for from had has have how i if in into is it its of on or ' +
    'so than that the their them then there these they this those to was we were what when where which who whom why ' +
    'will with would you your not no'
  ).split(' '),
);

export interface FtsQueries {
  /** Every term must match (FTS5 implicit AND). */
  strict: string;
  /** Any term may match; BM25 then ranks documents with more (and rarer) terms first. */
  loose: string;
}

function quote(term: string, prefix: boolean): string {
  return `"${term}"${prefix ? '*' : ''}`;
}

/**
 * MATCH expressions for a user query, or null when it has no searchable word.
 *
 * Each word is lowercased and compound identifiers are split into their parts; plain stop words are dropped (unless
 * nothing else is left). The last term also matches as a prefix, as when typing ahead; the others match whole words
 * (the tokenizer stems both sides, so `embeddings` still finds `embedding`).
 *  - `strict`: every word must match. A compound word matches through all of its parts or through the unsplit token
 *    (`(("path"* "guard"*) OR "pathguard")`); the unsplit token is rarer, so documents that contain the identifier
 *    itself score higher.
 *  - `loose`: any term may match (the parts plus the unsplit tokens, joined by OR); BM25 then ranks documents with
 *    more and rarer terms first.
 * Terms are double-quoted letters, digits and `_`, so no user input can form FTS5 syntax (operators, `NEAR`, column
 * filters, or `*` anywhere but our own prefix marker).
 */
export function buildFtsQueries(query: string): FtsQueries | null {
  const tokens = query.match(TOKEN) ?? [];
  interface Word { parts: string[]; whole: string | null }
  const collect = (dropStopWords: boolean): Word[] => {
    const words: Word[] = [];
    const seen = new Set<string>();
    for (const token of tokens) {
      const parts = splitIdentifier(token);
      if (parts.length === 0) continue;
      const compound = parts.length > 1;
      if (!compound && dropStopWords && STOP_WORDS.has(parts[0] ?? '')) continue;
      const key = token.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      words.push({ parts, whole: compound ? key : null });
    }
    return words;
  };
  let words = collect(true);
  if (words.length === 0) words = collect(false);
  if (words.length === 0) return null;

  // Cap the number of part terms, then mark the last one (and every long enough one) as a prefix.
  let budget = MAX_QUERY_TERMS;
  const kept: Word[] = [];
  for (const word of words) {
    if (budget <= 0) break;
    const parts = word.parts.slice(0, budget);
    budget -= parts.length;
    kept.push({ parts, whole: word.whole });
  }
  const total = kept.reduce((n, w) => n + w.parts.length, 0);
  let index = 0;
  const strictGroups: string[] = [];
  const looseTerms: string[] = [];
  const wholes: string[] = [];
  for (const word of kept) {
    const rendered = word.parts.map((part) => {
      index++;
      return quote(part, index === total && part.length >= PREFIX_MIN_LENGTH);
    });
    looseTerms.push(...rendered);
    if (word.whole === null) {
      strictGroups.push(...rendered);
    } else {
      strictGroups.push(`((${rendered.join(' ')}) OR ${quote(word.whole, false)})`);
      wholes.push(quote(word.whole, false));
    }
  }
  return { strict: strictGroups.join(' AND '), loose: [...looseTerms, ...wholes].join(' OR ') };
}

/**
 * Lowercase spellings under which a query could name a symbol: each word with `_` removed, and all words joined
 * (`extract Signature` -> `extractsignature`). Compare with a symbol name lowercased and stripped of `_`.
 */
export function symbolNameCandidates(query: string): Set<string> {
  const tokens = (query.match(TOKEN) ?? []).map((token) => token.toLowerCase().replaceAll('_', '')).filter((t) => t !== '');
  const candidates = new Set(tokens);
  if (tokens.length > 1) candidates.add(tokens.join(''));
  return candidates;
}

export interface FtsSource {
  /** Stored document path; its last three segments are indexed, so file and folder names are searchable. */
  filename: string;
  content: string;
  symbolName?: string | undefined;
  parentSymbol?: string | undefined;
  signature?: string | undefined;
  /** Frontmatter title of a document. */
  title?: string | undefined;
  headingPath?: readonly string[] | undefined;
  /** First paragraph of the comment above a function or method; searchable, never shown. */
  doc?: string | undefined;
}

/** The four columns of `fts_chunks`, in `FTS_COLUMNS` order of schema.ts. */
export interface FtsRow {
  symbolName: string;
  signature: string;
  context: string;
  content: string;
}

const PATH_SEGMENTS_INDEXED = 3;

/** Column texts for one chunk, each expanded with the words of its compound identifiers. */
export function buildFtsRow(source: FtsSource): FtsRow {
  const path = source.filename.split(/[\\/]+/).filter((segment) => segment !== '').slice(-PATH_SEGMENTS_INDEXED);
  const context = [...path, source.parentSymbol ?? '', source.title ?? '', ...(source.headingPath ?? []), source.doc ?? ''].filter((part) => part !== '');
  return {
    symbolName: expandIdentifiers(source.symbolName ?? ''),
    signature: expandIdentifiers(source.signature ?? ''),
    context: expandIdentifiers(context.join(' ')),
    content: expandIdentifiers(source.content),
  };
}
