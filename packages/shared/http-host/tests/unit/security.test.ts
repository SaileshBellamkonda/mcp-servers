import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { HttpSecurityError, MIN_TOKEN_LENGTH, assertSafeBinding, bearerAuth, requireToken, resolveHttpSecurity, tokensEqual } from '../../src/index.ts';

const TOKEN = `tok-${'x'.repeat(40)}`;

describe('tokensEqual', () => {
  it('accepts identical tokens', () => {
    expect(tokensEqual(TOKEN, TOKEN)).toBe(true);
  });

  it('rejects different tokens of the same length', () => {
    expect(tokensEqual(TOKEN, `${TOKEN.slice(0, -1)}y`)).toBe(false);
  });

  it('rejects tokens of different length, including prefixes', () => {
    expect(tokensEqual(TOKEN.slice(0, 10), TOKEN)).toBe(false);
    expect(tokensEqual(TOKEN, `${TOKEN}extra`)).toBe(false);
    expect(tokensEqual('', TOKEN)).toBe(false);
  });
});

describe('resolveHttpSecurity', () => {
  it('defaults to the loopback address without a token', () => {
    expect(resolveHttpSecurity({})).toEqual({ host: '127.0.0.1', token: undefined });
  });

  it('accepts a custom loopback host without a token', () => {
    expect(resolveHttpSecurity({ MCP_HTTP_HOST: 'localhost' })).toEqual({ host: 'localhost', token: undefined });
  });

  it('treats an empty token as unset', () => {
    expect(resolveHttpSecurity({ MCP_AUTH_TOKEN: '' }).token).toBeUndefined();
    expect(resolveHttpSecurity({ MCP_HTTP_HOST: '', MCP_AUTH_TOKEN: '' }).host).toBe('127.0.0.1');
  });

  it('rejects a whitespace-only token instead of silently running unauthenticated', () => {
    for (const blank of [' ', '   ', ' '.repeat(40), '\t\n ']) {
      expect(() => resolveHttpSecurity({ MCP_AUTH_TOKEN: blank }), JSON.stringify(blank)).toThrow(HttpSecurityError);
    }
    expect(() => resolveHttpSecurity({ MCP_AUTH_TOKEN: ' '.repeat(40) })).toThrow(/whitespace/);
  });

  it('trims surrounding whitespace around a valid token', () => {
    expect(resolveHttpSecurity({ MCP_AUTH_TOKEN: `  ${TOKEN}\n` }).token).toBe(TOKEN);
  });

  it('rejects a token shorter than 32 characters without echoing it', () => {
    const short = 'short-secret-value';
    let message = '';
    try {
      resolveHttpSecurity({ MCP_AUTH_TOKEN: short });
    } catch (err) {
      expect(err).toBeInstanceOf(HttpSecurityError);
      message = (err as Error).message;
    }
    expect(message).toMatch(/at least 32/);
    expect(message).not.toContain(short);
  });

  it('refuses a non-loopback host without a token', () => {
    expect(() => resolveHttpSecurity({ MCP_HTTP_HOST: '0.0.0.0' })).toThrow(HttpSecurityError);
    expect(() => resolveHttpSecurity({ MCP_HTTP_HOST: '0.0.0.0' })).toThrow('refusing to bind 0.0.0.0 without MCP_AUTH_TOKEN');
  });

  it('allows a non-loopback host with a valid token', () => {
    expect(resolveHttpSecurity({ MCP_HTTP_HOST: '0.0.0.0', MCP_AUTH_TOKEN: TOKEN })).toEqual({ host: '0.0.0.0', token: TOKEN });
  });
});

describe('assertSafeBinding', () => {
  it('allows loopback with or without a token', () => {
    expect(() => { assertSafeBinding({ host: '127.0.0.1', token: undefined }); }).not.toThrow();
    expect(() => { assertSafeBinding({ host: '::1', token: TOKEN }); }).not.toThrow();
  });

  it('rejects non-loopback hosts without a token', () => {
    expect(() => { assertSafeBinding({ host: '192.168.1.5', token: undefined }); }).toThrow(HttpSecurityError);
    expect(() => { assertSafeBinding({ host: '::', token: '' }); }).toThrow(HttpSecurityError);
  });

  it('rejects a short token on any host and never echoes it', () => {
    let message = '';
    try {
      assertSafeBinding({ host: '127.0.0.1', token: 'tooshort' });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/at least 32/);
    expect(message).not.toContain('tooshort');
  });
});

describe('token shape', () => {
  const blank = ' '.repeat(MIN_TOKEN_LENGTH);
  const withNewline = `${'a'.repeat(20)}\n${'b'.repeat(20)}`;
  const withNul = `${'a'.repeat(20)}\0${'b'.repeat(20)}`;
  const withTab = `${'a'.repeat(20)}\t${'b'.repeat(20)}`;
  const withDel = `${'a'.repeat(20)}\x7f${'b'.repeat(20)}`;

  it('rejects a token of 32 spaces everywhere, without echoing it', () => {
    expect(() => { assertSafeBinding({ host: '127.0.0.1', token: blank }); }).toThrow(/whitespace/);
    expect(() => requireToken(blank)).toThrow(/whitespace/);
    expect(() => resolveHttpSecurity({ MCP_AUTH_TOKEN: blank })).toThrow(HttpSecurityError);
  });

  it.each([['newline', withNewline], ['NUL', withNul], ['tab', withTab], ['DEL', withDel]])(
    'rejects a token containing a %s control character, without echoing it',
    (_label, token) => {
      for (const attempt of [
        () => { assertSafeBinding({ host: '127.0.0.1', token }); },
        () => requireToken(token),
        () => resolveHttpSecurity({ MCP_AUTH_TOKEN: token }),
      ]) {
        let message = '';
        try { attempt(); } catch (err) { expect(err).toBeInstanceOf(HttpSecurityError); message = (err as Error).message; }
        expect(message).toMatch(/control character/);
        expect(message).not.toContain('aaaaaaaa');
      }
    },
  );

  it('does not trim or otherwise alter a valid token with inner spaces', () => {
    const spaced = `${'a'.repeat(20)} ${'b'.repeat(20)}`;
    expect(requireToken(spaced)).toBe(spaced);
    expect(() => { assertSafeBinding({ host: '127.0.0.1', token: spaced }); }).not.toThrow();
  });
});

describe('bearerAuth middleware', () => {
  function appWith(token: string | undefined): Hono {
    const app = new Hono();
    app.use('*', bearerAuth(token));
    app.get('/ok', (c) => c.text('ok'));
    return app;
  }

  it('is a no-op when no token is configured', async () => {
    const res = await appWith(undefined).request('/ok');
    expect(res.status).toBe(200);
  });

  it('answers 401 with WWW-Authenticate and a body that reveals nothing', async () => {
    const res = await appWith(TOKEN).request('/ok', { headers: { Authorization: 'Bearer wrong' } });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
    const body = await res.text();
    expect(body).not.toContain('wrong');
    expect(body).not.toContain(TOKEN);
  });

  it('protects unknown paths too', async () => {
    const res = await appWith(TOKEN).request('/nope');
    expect(res.status).toBe(401);
  });

  it.each([
    ['Bearer', `Bearer ${TOKEN}`],
    ['bearer', `bearer ${TOKEN}`],
    ['BEARER', `BEARER ${TOKEN}`],
  ])('accepts the scheme spelled %s', async (_label, header) => {
    const res = await appWith(TOKEN).request('/ok', { headers: { Authorization: header } });
    expect(res.status).toBe(200);
  });

  it.each([
    ['Basic scheme', `Basic ${TOKEN}`],
    ['no scheme', TOKEN],
    ['two spaces', `Bearer  ${TOKEN}`],
    ['empty bearer', 'Bearer '],
    ['scheme only', 'Bearer'],
  ])('rejects %s', async (_label, header) => {
    const res = await appWith(TOKEN).request('/ok', { headers: { Authorization: header } });
    expect(res.status).toBe(401);
  });
});

describe('requireToken', () => {
  it('returns a valid token unchanged', () => {
    expect(requireToken(TOKEN)).toBe(TOKEN);
  });

  it('rejects a missing or empty token', () => {
    expect(() => requireToken(undefined)).toThrow(HttpSecurityError);
    expect(() => requireToken('')).toThrow(/token is required/);
  });

  it('rejects a token that is too short without echoing it', () => {
    const short = 'abc123';
    let message = '';
    try { requireToken(short); } catch (err) { message = (err as Error).message; }
    expect(message).toMatch(/at least 32/);
    expect(message).not.toContain(short);
  });
});
