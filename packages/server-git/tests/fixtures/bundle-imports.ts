/**
 * Module specifiers a bundle loads at run time: static `import`/`export ... from`, `import("x")` and `require("x")`.
 * Comments that start a line are dropped (bundlers keep JSDoc examples such as `require('micromatch')`), and a
 * `require`/`import` call must not directly follow an identifier character, a dot or a quote, so code generators
 * embedded as template strings are not mistaken for imports.
 */
export function importedSpecifiers(code: string): string[] {
  const source = code.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '');
  const found = new Set<string>();
  const patterns = [
    /^(?:import|export)\b[^;]*?\bfrom\s*(["'])([^"']+)\1/gm,
    /^import\s*(["'])([^"']+)\1/gm,
    /(?<![\w$.`"'])import\s*\(\s*(["'])([^"']+)\1\s*\)/g,
    /(?<![\w$.`"'])require\s*\(\s*(["'])([^"']+)\1\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.add(match[2] as string);
  }
  return [...found].sort();
}
