import { describe, expect, it } from 'vitest';
import { SseParser } from '../../src/testing/index.ts';

describe('SseParser', () => {
  it('parses events with id, event and data fields', () => {
    const events = new SseParser().push('id: 7\nevent: message\ndata: {"a":1}\n\n');
    expect(events).toEqual([{ id: '7', event: 'message', data: '{"a":1}' }]);
  });

  it('handles chunks split mid-event and CRLF line endings', () => {
    const parser = new SseParser();
    expect(parser.push('data: hel')).toEqual([]);
    expect(parser.push('lo\r\n\r\ndata: second\r\n\r\n')).toEqual([
      { id: undefined, event: undefined, data: 'hello' },
      { id: undefined, event: undefined, data: 'second' },
    ]);
  });

  it('joins multi-line data, ignores comments and fields without a value', () => {
    const events = new SseParser().push(': keep-alive\ndata: one\ndata\ndata: two\n\n');
    expect(events).toEqual([{ id: undefined, event: undefined, data: 'one\n\ntwo' }]);
  });

  it('drops events that carry no data (priming events)', () => {
    expect(new SseParser().push('id: 1\ndata:\n\nid: 2\n\n: comment\n\n')).toEqual([]);
  });
});
