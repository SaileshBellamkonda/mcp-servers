# OWASP-Aware Node.js Security Review

Reference: [OWASP Node.js Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html)

---

## Security Code Review Checklist

### A01 — Broken Access Control

- [ ] Authorization checks happen server-side, never client-side only
- [ ] Least-privilege principle: each user/role accesses only what it needs
- [ ] User-supplied IDs are validated against ownership (IDOR prevention)
- [ ] No directory traversal: reject `..` in path segments; use `path.resolve()` + check it stays within allowed root
- [ ] Unused API routes are removed, not just hidden

```ts
// BAD — path traversal
const filePath = path.join('/uploads', req.params.name);

// GOOD — constrain to allowed directory
const base = path.resolve('/uploads');
const filePath = path.resolve(base, req.params.name);
if (!filePath.startsWith(base + path.sep)) {
  throw new Error('Access denied');
}
```

### A02 — Cryptographic Failures

- [ ] No secrets in source code, `.env` committed to VCS, or logs
- [ ] Use `node:crypto` or a maintained library — not hand-rolled crypto
- [ ] Passwords hashed with `bcrypt` / `argon2` — never `md5`, `sha1`, or `sha256` alone
- [ ] TLS enforced; `Strict-Transport-Security` header set
- [ ] Sensitive data not stored longer than necessary

```ts
// BAD — hardcoded secret
const apiKey = 'abc123secret';

// GOOD — from environment, validated at startup
const apiKey = process.env.API_KEY;
if (!apiKey) throw new Error('API_KEY is required');
```

### A03 — Injection

#### Command Injection
```ts
// BAD — eval / exec with user input
import { exec } from 'node:child_process';
exec(`ls ${userInput}`);            // shell injection

// GOOD — use execFile (no shell) or avoid entirely
import { execFile } from 'node:child_process';
execFile('ls', [safeArg], callback);  // args passed as array, no shell
```

#### SQL / NoSQL Injection
```ts
// BAD — string concatenation
db.query(`SELECT * FROM users WHERE id = ${userId}`);

// GOOD — parameterized queries
db.query('SELECT * FROM users WHERE id = $1', [userId]);
```

#### Prototype Pollution
```ts
// BAD — merging untrusted objects
Object.assign(target, JSON.parse(userInput));

// GOOD — sanitize before merge, or use null-prototype objects
const parsed = JSON.parse(userInput) as Record<string, unknown>;
if ('__proto__' in parsed || 'constructor' in parsed) throw new Error('Invalid input');

// Or create with null prototype to prevent pollution
const safe = Object.create(null) as Record<string, unknown>;
```

### A04 — Insecure Design

- [ ] Error messages returned to clients do not include stack traces, file paths, or DB errors
- [ ] Rate limiting applied to authentication and sensitive endpoints
- [ ] Request body size limits set (prevent DoS via large payloads)

```ts
// Express — set body size limits
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Never expose internal errors
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);                          // log internally
  res.status(500).json({ error: 'Internal server error' });  // generic to client
});
```

### A05 — Security Misconfiguration

- [ ] `helmet` middleware applied (sets security headers)
- [ ] `X-Powered-By` header removed
- [ ] CORS configured to specific allowed origins — not `*` for authenticated routes
- [ ] Cookies have `httpOnly`, `secure`, `sameSite` flags
- [ ] Debug/verbose logging disabled in production
- [ ] `NODE_ENV=production` set in production deployments

```ts
import helmet from 'helmet';
app.use(helmet());   // Wraps: CSP, HSTS, X-Frame-Options, X-Content-Type-Options, etc.

// Cookies
res.cookie('session', token, {
  httpOnly: true,
  secure: true,      // HTTPS only
  sameSite: 'strict',
});

// CORS — be explicit
import cors from 'cors';
app.use(cors({
  origin: ['https://app.example.com'],
  credentials: true,
}));
```

### A06 — Vulnerable and Outdated Components

- [ ] `pnpm audit` (or `npm audit`) run and passing without high/critical findings
- [ ] Dependencies updated regularly; automate with Dependabot or Renovate
- [ ] Lock file (`pnpm-lock.yaml`) committed to VCS

```bash
pnpm audit                  # check for vulnerabilities
pnpm audit --fix            # auto-upgrade where possible
pnpm outdated               # list outdated packages
```

Use Node.js Permission Model (v20+ stable, v23.5+):
```bash
node --permission --allow-fs-read=./data/ app.js
```

### A07 — Identification and Authentication Failures

- [ ] Brute-force protection on login routes (rate limiting + account lockout)
- [ ] JWTs validated: signature, expiry, issuer — never `{ algorithms: ['none'] }`
- [ ] Refresh token rotation implemented
- [ ] Sessions invalidated on logout

```ts
// Rate limiting with express-rate-limit
import rateLimit from 'express-rate-limit';
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 10,                     // 10 attempts
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts — please try again later.',
});
app.post('/auth/login', loginLimiter, loginHandler);
```

### A08 — Software and Data Integrity Failures

- [ ] `pnpm-lock.yaml` committed (pinned versions)
- [ ] `packageManager` field set in `package.json` (Corepack enforcement)
- [ ] CI verifies lockfile integrity (`pnpm install --frozen-lockfile`)
- [ ] File uploads validated for type and content, not just extension

```bash
# CI install — fail if lockfile would change
pnpm install --frozen-lockfile
```

### A09 — Security Logging and Monitoring Failures

- [ ] Authentication events (success, failure, logout) logged with timestamp + IP
- [ ] Logs do not contain passwords, tokens, or PII
- [ ] `uncaughtException` and `unhandledRejection` handled and logged before exit
- [ ] Structured logging used (Pino / Winston) — not `console.log` in production

```ts
import pino from 'pino';
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// Handle unhandled rejections
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
  process.exit(1);   // exit — app is in unknown state
});

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception');
  process.exit(1);
});
```

### A10 — Server-Side Request Forgery (SSRF)

- [ ] URL inputs validated against an allowlist of hosts/schemes
- [ ] No user-supplied URLs passed directly to `fetch` / `http.request`
- [ ] Internal network addresses (`localhost`, `169.254.x.x`, `10.x.x.x`) blocked

```ts
// BAD
const res = await fetch(req.body.url);

// GOOD — validate against allowlist
const ALLOWED_HOSTS = new Set(['api.trusted.com', 'cdn.trusted.com']);
const url = new URL(req.body.url);
if (!ALLOWED_HOSTS.has(url.hostname)) throw new Error('Host not allowed');
const res = await fetch(url.toString());
```

---

## Additional Node.js-Specific Risks

### ReDoS (Regular Expression Denial of Service)

Avoid catastrophic backtracking in regexes applied to user input:

```ts
// RISKY — nested quantifiers on overlapping groups
const bad = /^(a+)+$/;

// SAFE — simple, linear patterns
const good = /^[a-z]{1,100}$/;

// Enforce a timeout approach for complex regexes
// Or use the 're2' package which guarantees linear time
import RE2 from 're2';
const safe = new RE2('^(a+)+$');
```

Use [vuln-regex-detector](https://github.com/davisjam/vuln-regex-detector) or `eslint-plugin-regexp` to catch risky patterns.

### Event Loop Blocking

```ts
// BAD — synchronous crypto/fs/JSON on large data in request handler
app.get('/hash', (req, res) => {
  const hash = crypto.pbkdf2Sync(req.body.password, salt, 100000, 64, 'sha512');
  res.send(hash);
});

// GOOD — use async variants
app.get('/hash', async (req, res) => {
  const hash = await crypto.subtle.digest('SHA-512', data);  // async
  res.send(Buffer.from(hash));
});
```

### Dangerous Functions

| Function | Risk | Alternative |
|----------|------|-------------|
| `eval(userInput)` | Remote code execution | Never use with user data |
| `new Function(userInput)` | Remote code execution | Never use with user data |
| `child_process.exec(cmd)` | Shell injection | Use `execFile` with arg array |
| `fs.readFileSync(userPath)` | Path traversal | Validate + resolve path first |
| `JSON.parse(untrusted)` | Prototype pollution | Sanitize keys after parsing |
| `vm.runInNewContext(code)` | Sandbox escape possible | Avoid; use separate process |

---

## ESLint Security Plugins

Add to `eslint.config.mjs` for automated security linting:

```bash
pnpm add -D eslint-plugin-security eslint-plugin-no-unsanitized
```

```js
// eslint.config.mjs
import security from 'eslint-plugin-security';
import noUnsanitized from 'eslint-plugin-no-unsanitized';

export default defineConfig(
  // ... other config
  security.configs.recommended,
  {
    plugins: { 'no-unsanitized': noUnsanitized },
    rules: {
      'no-unsanitized/method': 'error',
      'no-unsanitized/property': 'error',
    },
  },
);
```

### `eslint-plugin-security` key rules

| Rule | Catches |
|------|---------|
| `security/detect-eval-with-expression` | `eval()` with non-literal |
| `security/detect-child-process` | `child_process` usage |
| `security/detect-non-literal-fs-filename` | Dynamic file paths |
| `security/detect-non-literal-regexp` | Dynamic RegExp construction |
| `security/detect-object-injection` | Bracket-notation property access with variable key |
| `security/detect-possible-timing-attacks` | `==` for secrets (use `timingSafeEqual`) |

---

## Security Testing with Vitest

```ts
// Test that sensitive data is not leaked in errors
it('does not expose internal paths in error response', async () => {
  const res = await app.inject({ method: 'GET', url: '/nonexistent' });
  expect(res.statusCode).toBe(404);
  expect(res.body).not.toContain('/home/');
  expect(res.body).not.toContain('node_modules');
  expect(res.body).not.toContain('Error:');
});

// Test input validation
it('rejects oversized input', async () => {
  const large = 'x'.repeat(100_001);
  const res = await app.inject({
    method: 'POST',
    url: '/api/data',
    payload: { value: large },
  });
  expect(res.statusCode).toBe(413);
});

// Test authorization boundary
it('rejects access to other user data', async () => {
  const res = await request(app)
    .get('/api/users/999/profile')
    .set('Authorization', `Bearer ${tokenForUser1}`);
  expect(res.status).toBe(403);
});
```

---

## Secrets Management

- Use environment variables — never commit secrets to VCS
- Validate all required secrets at startup (fail fast)
- Use a secrets manager (HashiCorp Vault, AWS Secrets Manager, Azure Key Vault) in production
- Rotate secrets regularly; use short-lived tokens where possible

```ts
// Validate all required env vars at startup
const requiredEnv = ['DATABASE_URL', 'JWT_SECRET', 'API_KEY'] as const;
for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}
```
