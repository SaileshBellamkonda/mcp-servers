import { describe, it, expect } from 'vitest';
import { DEFAULT_TOOLSET, isToolEnabled, loadRuntimeOptionsFromEnv, parseToolset } from '../../../src/core/toolset.js';
import { ConfigError } from '../../../src/core/types.js';

describe('parseToolset', () => {
  it('defaults to standard', () => {
    expect(DEFAULT_TOOLSET).toBe('standard');
    expect(parseToolset(undefined)).toBe('standard');
    expect(parseToolset('')).toBe('standard');
    expect(parseToolset('  ')).toBe('standard');
  });

  it('accepts the three names, trimmed and case-insensitive', () => {
    expect(parseToolset('search')).toBe('search');
    expect(parseToolset(' Standard ')).toBe('standard');
    expect(parseToolset('ALL')).toBe('all');
  });

  it('rejects anything else with a message that names the setting and the valid values', () => {
    expect(() => parseToolset('everything')).toThrow(ConfigError);
    expect(() => parseToolset('everything')).toThrow(/CODERAG_TOOLSET.*search.*standard.*all/s);
    expect(() => parseToolset(3, 'mcpServers.coderag.toolset')).toThrow(/mcpServers\.coderag\.toolset/);
  });
});

describe('isToolEnabled', () => {
  const admin = ['index_markdown', 'index_code', 'reindex_document', 'delete_document', 'sync_documents', 'add_frontmatter', 'update_frontmatter', 'list_documents', 'search_relations', 'get_index_status'];

  it('search exposes only search', () => {
    expect(isToolEnabled('search', 'search')).toBe(true);
    for (const name of admin) expect(isToolEnabled('search', name), name).toBe(false);
  });

  it('standard adds the relation search, the index status and the refresh tool, nothing that writes files or deletes entries', () => {
    const enabled = ['search', ...admin].filter((name) => isToolEnabled('standard', name));
    expect(enabled.sort()).toEqual(['get_index_status', 'search', 'search_relations', 'sync_documents']);
  });

  it('all exposes every tool', () => {
    for (const name of ['search', ...admin]) expect(isToolEnabled('all', name), name).toBe(true);
  });
});

describe('loadRuntimeOptionsFromEnv', () => {
  it('watches by default and uses the standard toolset', () => {
    expect(loadRuntimeOptionsFromEnv({})).toEqual({ watch: true, toolset: 'standard' });
  });

  it.each(['0', 'false', 'no', 'off', ' FALSE '])('CODERAG_WATCH=%j disables the watcher', (value) => {
    expect(loadRuntimeOptionsFromEnv({ CODERAG_WATCH: value }).watch).toBe(false);
  });

  it.each(['1', 'true', 'yes', 'on'])('CODERAG_WATCH=%j keeps it on', (value) => {
    expect(loadRuntimeOptionsFromEnv({ CODERAG_WATCH: value }).watch).toBe(true);
  });

  it('keeps the default for an unrecognised CODERAG_WATCH', () => {
    expect(loadRuntimeOptionsFromEnv({ CODERAG_WATCH: 'maybe' }).watch).toBe(true);
  });

  it('reads CODERAG_TOOLSET', () => {
    expect(loadRuntimeOptionsFromEnv({ CODERAG_TOOLSET: 'all' }).toolset).toBe('all');
    expect(() => loadRuntimeOptionsFromEnv({ CODERAG_TOOLSET: 'x' })).toThrow(/CODERAG_TOOLSET/);
  });
});
