/**
 * Helpers for reading configuration from environment variables.
 *
 * All helpers treat `undefined` and blank values as "not set" and fall back to
 * the supplied default, so `FOO=` behaves like an unset variable.
 */

const MAX_PORT = 65535;

/**
 * Parse a TCP port. Accepts an integer from 0 to 65535 (0 asks the OS for an
 * ephemeral port). Throws on anything else instead of returning `NaN`.
 */
export function parsePort(value: string | undefined, defaultPort: number): number {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === '') return defaultPort;
  const port = /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  if (!Number.isInteger(port) || port > MAX_PORT) {
    throw new Error(`Invalid port ${JSON.stringify(value)}: expected an integer between 0 and ${String(MAX_PORT)}`);
  }
  return port;
}

/**
 * Parse a semicolon-separated list. Entries are trimmed and empty entries are
 * dropped; when nothing usable remains the default (a copy) is returned.
 */
export function parseList(value: string | undefined, defaultValue: readonly string[] = []): string[] {
  const entries = (value ?? '')
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  return entries.length > 0 ? entries : [...defaultValue];
}

const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'off']);

/**
 * Parse a boolean flag (`true|1|yes|on` / `false|0|no|off`, case-insensitive).
 * Unset, blank or unrecognised values yield the default.
 */
export function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  const normalised = value?.trim().toLowerCase();
  if (normalised === undefined) return defaultValue;
  if (TRUE_VALUES.has(normalised)) return true;
  if (FALSE_VALUES.has(normalised)) return false;
  return defaultValue;
}
