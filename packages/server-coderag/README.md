# CodeRAG MCP Server

Search over your code and Markdown/MDX documents for MCP clients: semantic (vector), keyword (FTS5 BM25) or hybrid.
Embeddings come from any OpenAI-compatible `/embeddings` endpoint (Ollama, OpenAI, ...); everything else runs locally in
one SQLite file. Part of the [mcp-servers](../../README.md) monorepo.

- **A small default tool surface:** by default only `search`, `search_relations`, `get_index_status` and
  `sync_documents` are offered; the other 7 tools (11 in total) are opt-in, see [Tools](#tools).
- **Code relations:** who calls a function, what a file imports, what extends a class, from the syntax trees of
  TypeScript, JavaScript, Python, Go, Rust, Java and C# code, see [Relations](#relations).
- **An index that follows your files:** incremental re-scan at every start, a file watcher and a refresh of changed
  files after each search, see [Freshness](#freshness).
- **Two modes from one code base:** standalone (stdio or Streamable HTTP) and embedded in the
  [VS Code extension](../vscode-extension/README.md) (HTTP on `127.0.0.1`, bearer token required).
- **Confined file access:** every tool that reads or writes a path is limited to a set of root directories, with
  symlinks resolved (see [Security](#security)).

## Requirements

- Node.js **22.16 or later** (`engines.node` is `>=22.16`). The server uses the built-in `node:sqlite` module with FTS5
  (missing before Node 22.16) and loads the `sqlite-vec` extension into it. On Node 22 the runtime prints an
  `ExperimentalWarning: SQLite is an experimental feature` line to stderr; it is harmless.
- An OpenAI-compatible embeddings endpoint.
- Prebuilt native packages: tree-sitter and its grammars (N-API) and `sqlite-vec`. `sqlite-vec` has no build for
  Windows arm64 or Alpine/musl, where the server cannot run.

## Usage

Build from the repository root (`pnpm install && pnpm build`), then run the bundle in `dist/`. After installing the
package its `bin` is `coderag-mcp-server`. Start it in the project to index: relative include patterns and the default
root are resolved against the current working directory.

### Standalone, stdio (default)

```bash
CODERAG_EMBEDDING_URL="http://localhost:11434/v1" \
CODERAG_EMBEDDING_MODEL="nomic-embed-text" \
CODERAG_DB_PATH="/path/to/coderag.db" \
node /path/to/mcp-servers/packages/server-coderag/dist/standalone.js
```

### Standalone, HTTP

Add `MCP_TRANSPORT=http` and a token (at least 32 characters):

```bash
export MCP_AUTH_TOKEN="<at least 32 characters>"
MCP_TRANSPORT=http node dist/standalone.js   # with the CODERAG_* variables above
```

The endpoint is `http://127.0.0.1:3100/mcp`; clients send `Authorization: Bearer <token>`. See
[HTTP security](../../README.md#http-security-model).

After start-up the server scans in the background (once per process): files whose modification time matches the index
cost one `stat`, changed and new files are re-indexed and entries of deleted files are removed. The include directories
are watched for changes unless `CODERAG_WATCH=0`. See [Freshness](#freshness).

[`mcp.example.json`](mcp.example.json) in this package has Ollama, OpenAI and full-configuration client entries.

### Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `CODERAG_EMBEDDING_URL` | required | Base URL of the embeddings API; `/embeddings` is appended |
| `CODERAG_EMBEDDING_MODEL` | required | Embedding model name |
| `CODERAG_DB_PATH` | required | Path of the SQLite database file |
| `CODERAG_EMBEDDING_API_KEY` | unset | Sent as `Authorization: Bearer <key>` to the embeddings endpoint; omit for Ollama. With a key, the URL must be `https:` or `http:` to localhost |
| `CODERAG_EMBEDDING_DIM` | `768` | Vector dimensions; must match the model. Only used for a new database, see [Storage](#storage) |
| `CODERAG_CHUNK_SIZE` | `500` | Target size of a text chunk in characters (not related to the vec0 `chunk_size` below) |
| `CODERAG_TOP_K` | `5` | Default number of search results |
| `CODERAG_USE_GITIGNORE` | `true` | Skip files matched by `.gitignore` |
| `CODERAG_DOCS_INCLUDE` | `**/*.{md,mdx}` | `;`-separated glob patterns of documents to index |
| `CODERAG_DOCS_EXCLUDE` | none | `;`-separated glob patterns to leave out |
| `CODERAG_CODE_INCLUDE` | the supported languages | `;`-separated glob patterns of source files to index |
| `CODERAG_CODE_EXCLUDE` | none | `;`-separated glob patterns to leave out |
| `CODERAG_ALLOWED_ROOTS` | none | `;`-separated extra directories the file tools may use (see [Security](#security)) |
| `CODERAG_WATCH` | `true` | Watch the include directories and re-index changed files; `0`, `false`, `no` or `off` disables it |
| `CODERAG_TOOLSET` | `standard` | Which tools to offer: `search`, `standard` or `all`, see [Tools](#tools) |
| `MCP_TRANSPORT` | `stdio` | `http` selects the HTTP transport |
| `MCP_HTTP_HOST` | `127.0.0.1` | Interface to bind. A non-loopback value requires `MCP_AUTH_TOKEN` |
| `MCP_HTTP_PORT` | `3100` | TCP port (`0` picks a free port) |
| `MCP_AUTH_TOKEN` | unset | Bearer token, at least 32 characters |

Built-in excludes (`.git`, `node_modules`, `dist`, `build`, `out`, `target`, `vendor`, `coverage`, editor folders and
similar) always apply. Code is parsed with tree-sitter for TypeScript/TSX, JavaScript/JSX, Python, Go, Rust, PHP, Java,
C#, C++, C, Ruby, shell and Vue.

### Embedded mode (VS Code extension)

```typescript
import { activateCodeRagServer, probeCodeRagSupport } from '@mcp-servers/server-coderag/embedded';

const support = probeCodeRagSupport({ nativeModulesDir });   // { ok: true } or { ok: false, reason }
if (support.ok) {
  const instance = await activateCodeRagServer({
    vsCodeConfig,        // object with get(key): the extension's `coderag` settings plus `dbPath`
    workspaceFolders,    // all indexed; they also confine the file tools
    port: 3100,
    authToken,           // required, >= 32 characters
    nativeModulesDir,    // directory whose node_modules holds tree-sitter, the grammars and sqlite-vec
    apiKey,              // optional, e.g. from SecretStorage
    watch: true,         // optional, default false here: watch the workspace folders (the extension passes its setting)
    toolset: 'standard', // optional: 'search' | 'standard' (default) | 'all'
  });
  // instance: { port, host, close() }
}
```

`activateCodeRagServer` always binds `127.0.0.1`. `probeCodeRagSupport` never throws; it checks Node.js, `node:sqlite`
(with extension loading and FTS5), sqlite-vec and tree-sitter.

## Tools

Every tool definition is sent to the model in every session, so the server offers only a few by default. Choose the
set with `CODERAG_TOOLSET` (embedded: the `toolset` option, the extension setting `mcpServers.coderag.toolset`):

| Toolset | Tools | Tool definitions (tokens*) |
|---|---|---|
| `search` | `search` | 536 |
| `standard` (default) | `search`, `search_relations`, `get_index_status`, `sync_documents` | 983 |
| `all` | all 11 tools | 2105 |

\* The serialised `tools/list` result divided by 4 (the characters / 4 estimate used elsewhere in this README).

`standard` is what an agent needs: find code, follow its calls, imports and inheritance, see whether the index is healthy,
and force a rescan. `sync_documents` without a directory rescans the configured documents and source files; the index
otherwise follows your files by itself. `search_relations` costs about 265 tokens of tool definition per session
(`standard` was 718 tokens before it was added) and replaces several searches and file reads when you ask who calls a
function. **Behaviour change:** earlier versions offered all tools. Set `CODERAG_TOOLSET=all` to get them back:

- Search: `search` (modes `semantic` default, `keyword`, `hybrid`), `search_relations` (`standard`: calls, imports and
  inheritance of a symbol or file, see [Relations](#relations)). `search` returns compact text, see
  [Search output](#search-output)
- Indexing: `index_markdown`, `index_code`, `reindex_document`, `sync_documents` (`standard`), `delete_document` (removes
  the index entry only, never the file)
- Inspection: `list_documents`, `get_index_status` (`standard`)
- Frontmatter: `add_frontmatter`, `update_frontmatter`

## Freshness

- **At start:** both documents and code are scanned incrementally. A file is re-read, parsed and embedded only when its
  modification time (compared to the millisecond) differs from the indexed one; entries of deleted files are removed. The
  scan hands control back to the event loop every 5 files.
- **While running:** the include directories are watched (`CODERAG_WATCH`, default on) and changed files are re-indexed
  after a short delay. The watcher honours the include/exclude globs, `.gitignore` and the allowed roots. Watching a very
  large tree uses one OS watch per directory; if your system limit is too low, set `CODERAG_WATCH=0`.
- **At search:** the files of the returned hits are checked with one `stat` each. Hits of files that no longer exist are
  left out; hits of files changed since they were indexed are kept and marked `(stale)` at the end of the header line
  (detailed format: `"stale": true`), because their line numbers may have moved. Such files are re-indexed (or removed) in
  the background, so the response never waits for the embedder and the next search is current. When leaving out deleted
  files makes a page short, one more retrieval with a larger limit fills it (a single extra pass, never a loop).

## Search output

`search` answers in compact text by default, because every token of a result stays in the client's context for the rest
of the session. Each hit is a header line, then indented lines: for code the signature and up to 5 lines of the body
after it, for documents up to 3 lines under the heading path.

```
src/indexer/indexer.ts:115-137 method Indexer.indexFile (0.81)
  async indexFile(filePath: string): Promise<void>
  const readPath = this.pathGuard?.assertAllowedReal(filePath) ?? filePath;
  this.log('info', `Indexing markdown: ${filePath}`);
docs/DESIGN.md:12-30 Design > Search modes (0.74)
  Semantic search embeds the query ...
+3 more results; narrow the query or pass offset=2
```

- Paths are relative to the first allowed root (the working directory or first workspace folder); a path under another
  root starts with that root's folder name. The score is rounded to 2 decimals (hybrid scores are small reciprocal-rank
  values, so use their order, not their size).
- A class (struct, interface) hit is left out when one of its own members is also a hit.
- `max_tokens` (default 1500, estimated as characters / 4) caps the output. The first hit is always returned; if more
  were left out, the last line says how many and which `offset` continues. `offset` skips hits for paging.
- `response_format: "detailed"` returns the previous JSON (`results`, `count`, `mode`) with whole chunks, absolute
  paths and metadata; it ignores `max_tokens` and does not drop classes.
- Signatures are the declaration text up to the start of the body.
- A class, struct, interface, impl or trait is indexed as a skeleton, not as its whole body: the doc comment above it, its
  signature and one line per member (`kind signature`, or a field's first line), at most 60 members and 2000 characters,
  ending with `+N more members`. Methods and functions keep their own full chunks, so search returns either the skeleton
  (for a query about the class) or the method (for a query about its behaviour), never both. Skeletons are built for
  TypeScript, JavaScript, Python, Go, Rust, Java, C# and C++; other languages index the whole class as before.
- After an upgrade that changes what is stored per symbol (signatures, skeletons), the next start re-parses and
  re-embeds all indexed code files once (the version is stored in the database).

## Relations

`search_relations` answers "who calls this function", "what does this function call", "what does this file import",
"who imports this file" and "what extends this class" from relations the indexer records while it parses code with
tree-sitter. The same syntax tree that yields the symbols yields the relations, so there is no second parse.

```
search_relations({ symbol: 'deleteDocument', direction: 'in' })

calls  src/indexer/indexer.ts:128 Indexer.indexFile -> VectorDB.deleteDocument [src/vectordb/db.ts:227] (0.90)
calls  src/indexer/sync.ts:45 syncDocuments -> VectorDB.deleteDocument [same] (0.90)
calls  src/indexer/sync.ts:138 pruneExcluded -> VectorDB.deleteDocument [same] (0.90)
...
```

- **Parameters:** `symbol` (a name, `Class.method`, or a file path such as `src/a.ts`), `relation_type` (`calls`,
  `imports`, `inherits`; default all, for a file path `imports`), `direction` (`in`: callers, importers, subclasses;
  `out`: callees, imports, base types; default `both`), `max_tokens` (default 1000), `offset`, and `response_format:
  "detailed"` for JSON. A name is matched case-sensitively first and case-insensitively only when that finds nothing.
  Paths are relative to the first allowed root, like `search`; one line per relation, `kind  from-path:line Source ->
  target [target-path:line] (confidence)`. A target that was not resolved shows the name as written; a resolved target
  that an earlier line of the answer already named is shortened to `[same]`. With both directions the answer has an
  `outgoing:` and an `incoming:` part. If more lines than `max_tokens` allows match, the last line says how many were
  left out and which `offset` continues.
- **What is recorded:** `calls` (call expressions and constructor calls, attributed to the function, method or class
  body that contains them; a call is recorded once per symbol), `imports` (one record per import statement with the
  module as written and the imported names, belonging to the first symbol of the file; `require()` and dynamic
  `import()` count), `inherits` (`extends`, `implements`, interface `extends`, Python base classes, Rust
  `impl Trait for Type` and trait bounds, embedded Go structs and interfaces, C# base lists).
- **Languages:** TypeScript, TSX, JavaScript, Python, Go, Rust, Java and C#. Other languages are indexed as before and
  have no relations.
- **Approximate by design.** Targets are found by name, not by type: `a.run()` is a call to `run`. The confidence says
  how the target was found: `1.00` an import that resolved to an indexed file (relative paths, Python relative and
  dotted modules, Go module paths, Rust `crate::`/`self::` paths, Java and C# names that mirror the folders), `0.90` the
  name matches exactly one indexed symbol (a definition in the same file wins, then one in an imported file; overloads
  and a class with its constructors count as one symbol; a symbol that belongs to the class or module written before the
  call, as in `GsonTypes.getRawType(x)` or `flask.views.View`, wins over others; a function nested in another function is
  only visible inside it), `0.50` several symbols have the name (one row, no target), `0.30` no indexed symbol has it
  (library calls, packages). Calls to very common names (`map`, `push`, `get`, `log`, `toString`, `clone`, ...) are
  almost always library calls: they get a target (0.90) only from a symbol of the same file or one that an import names,
  otherwise they are shown at 0.50 without a target when some indexed symbol has the name (and hidden when none has).
  One-letter names are not recorded. A call to the enclosing method's own name (`super.run()`, a wrapper
  that delegates) is taken to be that method. Module-level statements (and the callbacks of a test file's `it`) belong to
  no symbol, so their calls are not recorded. A symbol keeps at most 50 distinct calls, 20 base types and an import list
  of 200; the output says how many calls were left out.
- **Freshness:** a file's relations are rebuilt with its chunks whenever it is indexed, and the edges of other files
  that pointed at its symbols (or imported it) are resolved again for the changed names only, after a scan, a watcher or
  background refresh, and before a relation query.
- **First start after an upgrade:** an index written before relations existed has none. The next start parses the
  indexed code files once more and fills the relations only: chunks, vectors and the keyword index are not touched and
  nothing is sent to the embedder (`db_meta.relations_version`). A file that changed since it was indexed is left to the
  normal scan. On the pinned snapshot of this repository (58 files, 381 symbols) this takes 1.0 s; 1,550 relation rows
  are stored (1,008 visible, 542 hidden calls to common names that nothing resolved) and add about 9 % to the database
  file (2.57 MB to 2.79 MB).
- **Quality:** `pnpm --filter @mcp-servers/server-coderag run eval:relations` asks 35 labelled questions about the pinned
  snapshot (who calls X, what does X call, what does a file import, who imports a file, who extends X; expected answers
  from grep). Calls: precision 1.000, recall 1.000 (23 questions, including common names such as `log` and `close`); imports and
  inheritance: 1.000 and 1.000. A hand check of 20 random call edges found all 20 calls where recorded and all 14 resolved
  targets right. The snapshot is TypeScript only and has few name clashes, so expect lower numbers on code with many
  same-named methods; the other languages are covered by extraction tests on real grammars. An answer averages 183
  estimated tokens (largest 527).

## Security

- **Path confinement:** `index_markdown`, `index_code`, `reindex_document`, `delete_document`, `sync_documents`,
  `add_frontmatter` and `update_frontmatter` only accept paths inside the allowed roots: the working directory
  (standalone) or the workspace folders (embedded), the static base directory of every include glob, and the directories
  in `CODERAG_ALLOWED_ROOTS`. Symlinks are resolved before the comparison, and during indexing files that resolve
  outside the roots through a symlink are skipped. A refused path produces an error that names the path and
  `CODERAG_ALLOWED_ROOTS`. A race between the check and the file operation (a link swapped in between) is not fully
  excluded.
- **Frontmatter tools** only edit `.md`, `.markdown` and `.mdx` files and never evaluate `---js` frontmatter.
- **Data leaves the machine:** the text of every indexed file and every search query is sent to
  `CODERAG_EMBEDDING_URL`. Point it at an endpoint you trust. The API key is only sent to that URL and is redacted from
  error messages; upstream error bodies are truncated.
- **HTTP:** loopback bind by default, bearer token required for any other host and always in embedded mode; see the
  [root README](../../README.md#http-security-model).

## Storage

One SQLite file at `CODERAG_DB_PATH`, opened with Node's built-in `node:sqlite` (there is no `better-sqlite3`
dependency). Vectors live in a `vec0` virtual table from the `sqlite-vec` extension, keyword search in an FTS5 table.

- The vec0 `chunk_size` is 256 for databases created by this version (the default of 1024 blocks the event loop for
  seconds during bulk inserts); an existing database keeps the chunk size it was created with.
- An existing database keeps its stored embedding dimensions. A different `CODERAG_EMBEDDING_DIM` only logs a warning
  and the stored value stays in use; to change the dimensions, use a new database file.
- Brute-force vector search time grows linearly with the number of chunks.
- Keyword search is identifier-aware: camelCase, PascalCase and snake_case names are indexed whole and as words, queries
  are split the same way (stop words dropped, the last word matches as a prefix), all-words matches rank first and
  partial matches follow, so a query is not empty just because one word is missing. A database written by an older
  version has its FTS table rebuilt once on the next start (`db_meta.fts_version`); vectors are not touched and nothing
  is re-embedded.

## Development

From the repository root:

```bash
pnpm --filter @mcp-servers/server-coderag run build          # esbuild bundle + declarations
pnpm --filter @mcp-servers/server-coderag run test
pnpm --filter @mcp-servers/server-coderag run test:coverage  # thresholds: 85 % lines, functions, branches, statements
pnpm --filter @mcp-servers/server-coderag run typecheck
pnpm --filter @mcp-servers/server-coderag run dev            # standalone entry from source (tsx)
pnpm lint                                                    # ESLint for the whole repository
pnpm --filter @mcp-servers/server-coderag run bench          # search response size benchmark (see below)
pnpm --filter @mcp-servers/server-coderag run eval           # retrieval eval: recall@5, recall@10, MRR
pnpm --filter @mcp-servers/server-coderag run eval:relations # relation eval: precision and recall of search_relations
pnpm --filter @mcp-servers/server-coderag run bench:repo -- --repo <dir> --lang <language> --queries scripts/bench-data/<language>.json
```

`bench` needs no network: it indexes a pinned git snapshot of this repository (`BENCH_REF`, default `bdb73d5`) with a
deterministic hash-based embedder and runs 12 fixed queries through the real `search` handler in hybrid, keyword and
semantic mode. It prints per-query characters, estimated tokens (chars / 4) and result counts, plus mean and p90 per mode.

`eval` scores 52 labelled queries (`scripts/lib/retrieval-queries.ts`: natural language, identifiers, camelCase
fragments, snake/kebab names, concepts, docs) against the same snapshot for keyword, semantic and hybrid search. Its
semantic leg is a hashed bag of words, so the hybrid row only shows what the keyword leg contributes; real semantic
quality needs a real embedder. `tests/unit/vectordb/retrieval-eval.test.ts` fails when the keyword numbers drop.

`bench:repo` indexes a checkout of any repository (read only, nothing in it is run) with the same hashed embedder and
prints files, parse problems, chunks, symbols, relation rows, index time, database size and peak memory, then scores the
labelled queries of a query file (`scripts/bench-data/<language>.json`: repository URL, commit, include globs,
queries with expected files and symbols, and edges established by grep) and the size of the `search` answers.
`--sample-out <file>` writes a seeded sample of call, import and inheritance rows with their source lines for checking by
hand. The six query files refer to public repositories (Flask, cobra, ripgrep, gson, Newtonsoft.Json, got) by URL and
commit only; clone them yourself with `git fetch --depth 1`.

The build inlines the private `@mcp-servers/common` and `@mcp-servers/http-host` packages; third-party dependencies,
including the native modules, stay external.

## License

MIT
