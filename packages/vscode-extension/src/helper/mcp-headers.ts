// Entry of dist/mcp-headers.js: prints the Authorization header JSON for a Claude Code `headersHelper`.
// Exit code 0 with the JSON on stdout, or 1 with a message (never the token) on stderr.
import { readFileSync } from 'node:fs';
import { computeHeaders } from './headers';

const result = computeHeaders(process.argv.slice(2), process.env, (file) => readFileSync(file, 'utf8'));
if (result.ok) {
  process.stdout.write(result.stdout);
} else {
  process.stderr.write(`mcp-headers: ${result.message}\n`);
  process.exitCode = 1;
}
