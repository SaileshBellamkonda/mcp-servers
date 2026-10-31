import { afterEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/server';
import { McpLogger } from '../../src/logger.ts';

function fakeServer(impl?: () => Promise<void>) {
  const sendLoggingMessage = vi.fn(impl ?? (() => Promise.resolve()));
  return { server: { sendLoggingMessage } as unknown as McpServer, sendLoggingMessage };
}

describe('McpLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes the entry to the sink and forwards the message to the MCP client', () => {
    const { server, sendLoggingMessage } = fakeServer();
    const sink = vi.fn();
    new McpLogger(server, 'unit', sink).log('info', 'hello');

    expect(sink).toHaveBeenCalledWith('info', 'unit', 'hello');
    expect(sendLoggingMessage).toHaveBeenCalledWith({ level: 'info', logger: 'unit', data: 'hello' });
  });

  it('hands the original value to the sink and to the client', () => {
    const { server, sendLoggingMessage } = fakeServer();
    const sink = vi.fn();
    new McpLogger(server, 'unit', sink).log('warning', { a: 1 });

    expect(sink).toHaveBeenCalledWith('warning', 'unit', { a: 1 });
    expect(sendLoggingMessage).toHaveBeenCalledWith({ level: 'warning', logger: 'unit', data: { a: 1 } });
  });

  it('never writes to stderr, with or without a sink', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { server } = fakeServer();
    new McpLogger(server, 'unit').error('quiet');
    new McpLogger(server, 'unit', vi.fn()).error('quiet');

    expect(stderr).not.toHaveBeenCalled();
  });

  it.each(['debug', 'info', 'notice', 'warning', 'error', 'critical'] as const)(
    'exposes a %s convenience method',
    (level) => {
      const { server, sendLoggingMessage } = fakeServer();
      const sink = vi.fn();
      new McpLogger(server, 'unit', sink)[level]('msg');

      expect(sendLoggingMessage).toHaveBeenCalledWith({ level, logger: 'unit', data: 'msg' });
      expect(sink).toHaveBeenCalledWith(level, 'unit', 'msg');
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
