import { describe, it, expect } from 'vitest';
import {
  getLanguageByExtension,
  isSupportedExtension,
  SUPPORTED_LANGUAGES,
} from '../../../src/indexer/languages.ts';

describe('SUPPORTED_LANGUAGES', () => {
  it('includes all 13 expected languages', () => {
    const expected = [
      'typescript', 'javascript', 'python', 'go', 'rust',
      'php', 'java', 'csharp', 'cpp', 'c', 'ruby', 'bash', 'vue',
    ];
    for (const lang of expected) {
      expect(SUPPORTED_LANGUAGES).toHaveProperty(lang);
    }
  });

  it('every language has a non-empty query string', () => {
    for (const [name, config] of Object.entries(SUPPORTED_LANGUAGES)) {
      expect(config.query, `${name} missing query`).toBeTruthy();
      expect(config.extensions.length, `${name} missing extensions`).toBeGreaterThan(0);
    }
  });
});

describe('getLanguageByExtension', () => {
  it('maps .ts to typescript', () => {
    const config = getLanguageByExtension('.ts');
    expect(config?.name).toBe('typescript');
  });

  it('maps .tsx to tsx', () => {
    const config = getLanguageByExtension('.tsx');
    expect(config?.name).toBe('tsx');
  });

  it('maps .py to python', () => {
    expect(getLanguageByExtension('.py')?.name).toBe('python');
  });

  it('maps .go to go', () => {
    expect(getLanguageByExtension('.go')?.name).toBe('go');
  });

  it('maps .rs to rust', () => {
    expect(getLanguageByExtension('.rs')?.name).toBe('rust');
  });

  it('maps .java to java', () => {
    expect(getLanguageByExtension('.java')?.name).toBe('java');
  });

  it('maps .cs to csharp', () => {
    expect(getLanguageByExtension('.cs')?.name).toBe('csharp');
  });

  it('maps .cpp to cpp', () => {
    expect(getLanguageByExtension('.cpp')?.name).toBe('cpp');
  });

  it('maps .c to c', () => {
    expect(getLanguageByExtension('.c')?.name).toBe('c');
  });

  it('maps .rb to ruby', () => {
    expect(getLanguageByExtension('.rb')?.name).toBe('ruby');
  });

  it('maps .sh to bash', () => {
    expect(getLanguageByExtension('.sh')?.name).toBe('bash');
  });

  it('returns undefined for unknown extension', () => {
    expect(getLanguageByExtension('.xyz')).toBeUndefined();
  });
});

describe('isSupportedExtension', () => {
  it('returns true for supported extensions', () => {
    expect(isSupportedExtension('.ts')).toBe(true);
    expect(isSupportedExtension('.py')).toBe(true);
    expect(isSupportedExtension('.java')).toBe(true);
  });

  it('returns false for unsupported extensions', () => {
    expect(isSupportedExtension('.xyz')).toBe(false);
    expect(isSupportedExtension('.md')).toBe(false);
    expect(isSupportedExtension('')).toBe(false);
  });
});
