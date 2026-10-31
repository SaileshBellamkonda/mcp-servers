import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM script without declarations
import * as packaging from '../../../../scripts/package-extension.mjs';

const api = packaging as {
  parseArgs(argv: string[], defaults?: { host: string }): { target: string; out: string | undefined };
  vsceOptions(options: { target: string; out: string | undefined }, cwd: string): Record<string, unknown>;
};

describe('package-extension arguments', () => {
  it('defaults the target to the host platform and the output to vsce\'s default', () => {
    expect(api.parseArgs([], { host: 'linux-x64' })).toEqual({ target: 'linux-x64', out: undefined });
  });

  it('takes --target and --out', () => {
    expect(api.parseArgs(['--target', 'darwin-arm64', '--out', '/tmp/x'], { host: 'linux-x64' })).toEqual({ target: 'darwin-arm64', out: '/tmp/x' });
  });

  it('rejects unknown targets and flags', () => {
    expect(() => api.parseArgs(['--target', 'win32-arm64'])).toThrow(/Unsupported target/);
    expect(() => api.parseArgs(['--bogus'])).toThrow(/Unknown argument/);
    expect(() => api.parseArgs(['--out'])).toThrow(/needs a value/);
  });

  it('packages without resolving dependencies, for one target, without the licence prompt', () => {
    expect(api.vsceOptions({ target: 'linux-x64', out: undefined }, '/ext')).toEqual({
      cwd: '/ext', target: 'linux-x64', dependencies: false, skipLicense: true,
    });
    expect(api.vsceOptions({ target: 'win32-x64', out: '/o/x.vsix' }, '/ext')).toEqual({
      cwd: '/ext', target: 'win32-x64', dependencies: false, skipLicense: true, packagePath: '/o/x.vsix',
    });
  });
});
