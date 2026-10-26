import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Emits the public entry points' declarations in memory, exactly as the build's `tsc -b` would. */
function emitDeclarations(): Map<string, string> {
  const configPath = path.join(packageRoot, 'tsconfig.build.json');
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, packageRoot);
  const program = ts.createProgram({
    rootNames: parsed.fileNames.filter((f) => /[\\/]src[\\/](embedded|standalone)\.ts$/.test(f)),
    options: { ...parsed.options, customConditions: ['@mcp-servers/source'], composite: false, incremental: false, tsBuildInfoFile: undefined, declarationMap: false, noEmit: false },
  });
  const out = new Map<string, string>();
  program.emit(undefined, (fileName, text) => { out.set(path.basename(fileName), text); }, undefined, true);
  return out;
}

describe('published declarations', () => {
  it('do not reference the private @mcp-servers/* packages', () => {
    const files = emitDeclarations();
    expect([...files.keys()].sort()).toEqual(expect.arrayContaining(['embedded.d.ts', 'standalone.d.ts']));
    for (const [name, text] of files) {
      expect(text, name).not.toContain('@mcp-servers/');
    }
  });
});
