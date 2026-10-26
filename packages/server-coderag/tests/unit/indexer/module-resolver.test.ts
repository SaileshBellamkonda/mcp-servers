import { describe, it, expect } from 'vitest';
import { CodeFileIndex, moduleStems } from '../../../src/indexer/module-resolver.js';

const index = (files: string[]): CodeFileIndex => new CodeFileIndex(files);

describe('CodeFileIndex: TypeScript and JavaScript', () => {
  const files = ['/p/src/a.ts', '/p/src/b.ts', '/p/src/util/index.ts', '/p/src/view.tsx', '/p/src/old.js', '/p/lib/c.ts'];
  const idx = index(files);

  it('resolves relative specifiers with a .js extension to the TypeScript source', () => {
    expect(idx.resolveImport('typescript', './b.js', [], '/p/src/a.ts')).toBe('/p/src/b.ts');
    expect(idx.resolveImport('typescript', './b', [], '/p/src/a.ts')).toBe('/p/src/b.ts');
    expect(idx.resolveImport('typescript', '../lib/c.js', [], '/p/src/a.ts')).toBe('/p/lib/c.ts');
  });

  it('resolves tsx, js and directory index files', () => {
    expect(idx.resolveImport('typescript', './view', [], '/p/src/a.ts')).toBe('/p/src/view.tsx');
    expect(idx.resolveImport('javascript', './old.js', [], '/p/src/a.ts')).toBe('/p/src/old.js');
    expect(idx.resolveImport('typescript', './util', [], '/p/src/a.ts')).toBe('/p/src/util/index.ts');
  });

  it('does not resolve packages or files that are not indexed', () => {
    expect(idx.resolveImport('typescript', 'zod', [], '/p/src/a.ts')).toBeNull();
    expect(idx.resolveImport('typescript', './missing', [], '/p/src/a.ts')).toBeNull();
    expect(idx.resolveImport('typescript', 'node:fs', [], '/p/src/a.ts')).toBeNull();
  });

  it('follows files that are added and removed', () => {
    const live = index([]);
    expect(live.resolveImport('typescript', './b', [], '/p/src/a.ts')).toBeNull();
    live.add('/p/src/b.ts');
    expect(live.resolveImport('typescript', './b', [], '/p/src/a.ts')).toBe('/p/src/b.ts');
    live.remove('/p/src/b.ts');
    expect(live.resolveImport('typescript', './b', [], '/p/src/a.ts')).toBeNull();
  });

  it('accepts Windows separators in the indexed paths', () => {
    const win = index(['C:\\p\\src\\b.ts']);
    expect(win.resolveImport('typescript', './b', [], 'C:\\p\\src\\a.ts')).toBe('C:\\p\\src\\b.ts');
  });
});

describe('CodeFileIndex: Python', () => {
  const idx = index(['/p/pkg/__init__.py', '/p/pkg/mod.py', '/p/pkg/sub/__init__.py', '/p/pkg/sub/leaf.py', '/p/other/mod.py', '/p/app.py']);

  it('resolves relative imports by dots', () => {
    expect(idx.resolveImport('python', '.mod', [], '/p/pkg/sub/leaf.py')).toBeNull();
    expect(idx.resolveImport('python', '..mod', [], '/p/pkg/sub/leaf.py')).toBe('/p/pkg/mod.py');
    expect(idx.resolveImport('python', '.leaf', [], '/p/pkg/sub/__init__.py')).toBe('/p/pkg/sub/leaf.py');
    expect(idx.resolveImport('python', '.sub', [], '/p/pkg/mod.py')).toBe('/p/pkg/sub/__init__.py');
    expect(idx.resolveImport('python', '.', [], '/p/pkg/mod.py')).toBe('/p/pkg/__init__.py');
  });

  it('resolves absolute dotted modules by path suffix, preferring the closest file', () => {
    expect(idx.resolveImport('python', 'pkg.sub.leaf', [], '/p/app.py')).toBe('/p/pkg/sub/leaf.py');
    expect(idx.resolveImport('python', 'pkg.sub', [], '/p/app.py')).toBe('/p/pkg/sub/__init__.py');
    expect(idx.resolveImport('python', 'mod', [], '/p/other/x.py')).toBe('/p/other/mod.py');
    expect(idx.resolveImport('python', 'os', [], '/p/app.py')).toBeNull();
  });
});

describe('CodeFileIndex: Go', () => {
  const idx = index(['/r/pkg/util/a.go', '/r/pkg/util/b.go', '/r/cmd/main.go']);

  it('resolves module-path imports to the directory of the package', () => {
    expect(idx.resolveImport('go', 'github.com/me/repo/pkg/util', [], '/r/cmd/main.go')).toBe('/r/pkg/util');
  });

  it('does not resolve the standard library', () => {
    expect(idx.resolveImport('go', 'fmt', [], '/r/cmd/main.go')).toBeNull();
    expect(idx.resolveImport('go', 'net/http', [], '/r/cmd/main.go')).toBeNull();
  });
});

describe('CodeFileIndex: Rust', () => {
  const idx = index(['/c/src/lib.rs', '/c/src/a/mod.rs', '/c/src/a/b.rs', '/c/src/util.rs', '/d/src/util.rs']);

  it('resolves crate paths, dropping trailing type names until a file matches', () => {
    expect(idx.resolveImport('rust', 'crate::a::b', ['Name'], '/c/src/lib.rs')).toBe('/c/src/a/b.rs');
    expect(idx.resolveImport('rust', 'crate::a::b::Name', [], '/c/src/lib.rs')).toBe('/c/src/a/b.rs');
    expect(idx.resolveImport('rust', 'crate::a', ['X'], '/c/src/lib.rs')).toBe('/c/src/a/mod.rs');
  });

  it('prefers the file closest to the importing file', () => {
    expect(idx.resolveImport('rust', 'crate::util', ['f'], '/c/src/lib.rs')).toBe('/c/src/util.rs');
    expect(idx.resolveImport('rust', 'crate::util', ['f'], '/d/src/main.rs')).toBe('/d/src/util.rs');
    expect(idx.resolveImport('rust', 'self::util', [], '/c/src/lib.rs')).toBe('/c/src/util.rs');
  });

  it('does not resolve external crates', () => {
    expect(idx.resolveImport('rust', 'std', ['io'], '/c/src/lib.rs')).toBeNull();
    expect(idx.resolveImport('rust', 'serde::de', ['Deserialize'], '/c/src/lib.rs')).toBeNull();
  });
});

describe('CodeFileIndex: Java and C#', () => {
  it('resolves Java imports to the class file and wildcards to the package directory', () => {
    const idx = index(['/j/src/com/foo/Bar.java', '/j/src/com/foo/Util.java', '/j/src/com/baz/X.java']);
    expect(idx.resolveImport('java', 'com.foo.Bar', [], '/j/src/com/Main.java')).toBe('/j/src/com/foo/Bar.java');
    expect(idx.resolveImport('java', 'com.foo.Util', ['helper'], '/j/src/com/Main.java')).toBe('/j/src/com/foo/Util.java');
    expect(idx.resolveImport('java', 'com.baz', ['*'], '/j/src/com/Main.java')).toBe('/j/src/com/baz');
    expect(idx.resolveImport('java', 'com.foo.Util.Inner', [], '/j/src/com/Main.java')).toBe('/j/src/com/foo/Util.java');
    expect(idx.resolveImport('java', 'java.util.List', [], '/j/src/com/Main.java')).toBeNull();
  });

  it('resolves C# namespaces that mirror the folder layout', () => {
    const idx = index(['/s/MyApp/Services/Mail.cs', '/s/MyApp/Models/User.cs']);
    expect(idx.resolveImport('csharp', 'MyApp.Services', [], '/s/MyApp/Program.cs')).toBe('/s/MyApp/Services');
    expect(idx.resolveImport('csharp', 'System.Linq', [], '/s/MyApp/Program.cs')).toBeNull();
  });
});

describe('moduleStems', () => {
  it('lists the names under which other files import a file', () => {
    expect(moduleStems('/p/src/b.ts')).toEqual(['b', 'src']);
    expect(moduleStems('/p/src/util/index.ts')).toEqual(['index', 'util']);
    expect(moduleStems('/p/pkg/__init__.py')).toEqual(['__init__', 'pkg']);
    expect(moduleStems('/c/src/a/mod.rs')).toEqual(['mod', 'a']);
  });
});
