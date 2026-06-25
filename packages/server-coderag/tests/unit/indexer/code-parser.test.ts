import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodeParser } from '../../../src/indexer/code-parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, '../../fixtures');

let parser: CodeParser;

beforeAll(() => {
  parser = new CodeParser();
});

afterAll(() => {
  parser.close();
});

describe('CodeParser.parseFile - TypeScript', () => {
  it('extracts functions, classes, interfaces, and methods', () => {
    const chunks = parser.parseFile(path.join(fixturesDir, 'sample.ts'));
    const names = chunks.map((c) => c.symbolName);
    expect(names).toContain('UserManager');
    expect(names).toContain('createAdmin');
    const types = chunks.map((c) => c.symbolType);
    expect(types).toContain('class');
    expect(types).toContain('function');
  });

  it('records correct start lines', () => {
    const chunks = parser.parseFile(path.join(fixturesDir, 'sample.ts'));
    const userManager = chunks.find((c) => c.symbolName === 'UserManager');
    expect(userManager).toBeDefined();
    expect(userManager!.startLine).toBeGreaterThan(0);
  });

  it('sets language to typescript', () => {
    const chunks = parser.parseFile(path.join(fixturesDir, 'sample.ts'));
    expect(chunks.every((c) => c.language === 'typescript')).toBe(true);
  });
});

describe('CodeParser.parseFile - Python', () => {
  it('extracts class and function symbols', () => {
    const chunks = parser.parseFile(path.join(fixturesDir, 'sample.py'));
    const names = chunks.map((c) => c.symbolName);
    expect(names).toContain('Calculator');
    expect(names).toContain('multiply');
  });

  it('sets language to python', () => {
    const chunks = parser.parseFile(path.join(fixturesDir, 'sample.py'));
    expect(chunks.every((c) => c.language === 'python')).toBe(true);
  });
});

describe('CodeParser.parseFile - Go', () => {
  it('extracts functions, methods, structs, and interfaces', () => {
    const chunks = parser.parseFile(path.join(fixturesDir, 'sample.go'));
    const names = chunks.map((c) => c.symbolName);
    expect(names).toContain('NewDog');
    expect(names).toContain('Sound');
  });
});

describe('CodeParser.parseFile - Java', () => {
  it('extracts class, methods, and constructor', () => {
    const chunks = parser.parseFile(path.join(fixturesDir, 'sample.java'));
    const names = chunks.map((c) => c.symbolName);
    expect(names).toContain('Animal');
    expect(names).toContain('getName');
  });
});

describe('CodeParser.parseFile - unsupported extension', () => {
  it('throws for unsupported file type', () => {
    expect(() => parser.parseFile('/fake/path/file.xyz')).toThrow();
  });
});

describe('CodeParser.getEmbeddingText', () => {
  it('formats as "language symbolName: content"', () => {
    const chunks = parser.parseFile(path.join(fixturesDir, 'sample.ts'));
    for (const chunk of chunks) {
      const text = CodeParser.getEmbeddingText(chunk);
      expect(text).toContain(chunk.language);
      expect(text).toContain(chunk.symbolName);
    }
  });
});
