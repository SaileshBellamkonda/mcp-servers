import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/server';
import { McpLogger } from '../../src/logger.js';

function fakeServer(impl?: () => Promise<void>) {
  const sendLoggingMessage = vi.fn(impl ?? (() => Promise.resolve()));
  return { server: { sendLoggingMessage } as unknown as McpServer, sendLoggingMessage };
}

describe('McpLogger', () => {
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes a tagged line to stderr and forwards the message to the MCP client', () => {
    const { server, sendLoggingMessage } = fakeServer();
    new McpLogger(server, 'unit').log('info', 'hello');

    expect(stderr).toHaveBeenCalledWith('[INFO] [unit] hello\n');
    expect(sendLoggingMessage).toHaveBeenCalledWith({ level: 'info', logger: 'unit', data: 'hello' });
  });

  it('serialises non-string data as JSON on stderr but forwards the original value', () => {
    const { server, sendLoggingMessage } = fakeServer();
    new McpLogger(server, 'unit').log('warning', { a: 1 });

    expect(stderr).toHaveBeenCalledWith('[WARNING] [unit] {"a":1}\n');
    expect(sendLoggingMessage).toHaveBeenCalledWith({ level: 'warning', logger: 'unit', data: { a: 1 } });
  });

  it.each(['debug', 'info', 'notice', 'warning', 'error', 'critical'] as const)(
    'exposes a %s convenience method',
    (level) => {
      const { server, sendLoggingMessage } = fakeServer();
      new McpLogger(server, 'unit')[level]('msg');

      expect(sendLoggingMessage).toHaveBeenCalledWith({ level, logger: 'unit', data: 'msg' });
      expect(stderr).toHaveBeenCalledWith(`[${level.toUpperCase()}] [unit] msg\n`);
    },
  );

  it('swallows rejections from the MCP client (not connected yet) without throwing', async () => {
    const { server, sendLoggingMessage } = fakeServer(() => Promise.reject(new Error('not connected')));
    const logger = new McpLogger(server, 'unit');

    expect(() => { logger.error('boom'); }).not.toThrow();
    await Promise.resolve();
    expect(sendLoggingMessage).toHaveBeenCalledTimes(1);
  });
});
