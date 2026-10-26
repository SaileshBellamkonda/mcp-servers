# CodeRAG MCP Server

Search over your code and Markdown/MDX documents for MCP clients: semantic (vector), keyword (FTS5 BM25) or hybrid.
Embeddings come from any OpenAI-compatible `/embeddings` endpoint (Ollama, OpenAI, ...); everything else runs locally in
one SQLite file. Part of the [mcp-servers](../../README.md) monorepo.

- **11 tools** for searching, indexing, syncing and editing document frontmatter.
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

After start-up the server indexes in the background (once per process): it scans everything when the database is empty
or the include/exclude rules changed, and otherwise removes entries of deleted files. `CODERAG_WATCH=true` additionally
watches the include directories for changes.

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
| `CODERAG_WATCH` | `false` | Watch the include directories and re-index changed files |
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
  });
  // instance: { port, host, close() }
}
```

`activateCodeRagServer` always binds `127.0.0.1`. `probeCodeRagSupport` never throws; it checks Node.js, `node:sqlite`
(with extension loading and FTS5), sqlite-vec and tree-sitter.

## Tools

- Search: `search` (modes `semantic` default, `keyword`, `hybrid`), `search_relations`. `search` returns compact text,
  see [Search output](#search-output)
- Indexing: `index_markdown`, `index_code`, `reindex_document`, `sync_documents`, `delete_document` (removes the index
  entry only, never the file)
- Inspection: `list_documents`, `get_index_status`
- Frontmatter: `add_frontmatter`, `update_frontmatter`

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
- Signatures are the declaration text up to the start of the body. After an upgrade that changes how signatures are
  built, the next start re-parses all indexed code files once (the version is stored in the database).

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
```

`bench` needs no network: it indexes a pinned git snapshot of this repository (`BENCH_REF`, default `bdb73d5`) with a
deterministic hash-based embedder and runs 12 fixed queries through the real `search` handler in hybrid, keyword and
semantic mode. It prints per-query characters, estimated tokens (chars / 4) and result counts, plus mean and p90 per mode.

The build inlines the private `@mcp-servers/common` and `@mcp-servers/http-host` packages; third-party dependencies,
including the native modules, stay external.

## License

MIT
