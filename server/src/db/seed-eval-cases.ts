import type { EvalExpectation } from '@devdigest/shared';

/**
 * L06 - the seeded eval gold set for the Security Reviewer.
 *
 * COMPOSITION IS THE POINT, not the count. A set minted only from findings the
 * agent already accepts is, by construction, a set it already passes: recall
 * pins at 1.0 and no prompt change can move it, so the harness measures
 * nothing. These twelve cases deliberately span four kinds:
 *
 *   `floor`     a defect the agent reliably finds. Proves an edit lost nothing.
 *   `headroom`  a real defect the agent often MISSES. This is where recall has
 *               somewhere to go, and the reason a set needs hand-authored cases
 *               and not just past decisions.
 *   `noise`     something a reviewer dismissed. A broadened prompt gets caught
 *               here, and nowhere else.
 *   `clean`     a diff with nothing wrong. Any finding at all is a false positive.
 *
 * `notes` carries the kind as a one-line failure-taxonomy tag, so the case list
 * groups into the four buckets and the set doubles as an error-analysis
 * artifact rather than an opaque bag of diffs.
 *
 * Line numbers in `expectations` are the NEW-side numbers the hunk headers
 * imply, because that is what the citation-grounding gate indexes.
 */
export interface SeedEvalCase {
  name: string;
  notes: string;
  inputDiff: string;
  expectations: EvalExpectation[];
}

const find = (
  file: string,
  start: number,
  end: number,
  title: string,
): EvalExpectation => ({
  kind: 'must_find',
  file,
  start_line: start,
  end_line: end,
  title,
  severity: 'CRITICAL',
  category: 'security',
});

const dontFlag = (
  file: string,
  start: number,
  end: number,
  title: string,
): EvalExpectation => ({
  kind: 'must_not_flag',
  file,
  start_line: start,
  end_line: end,
  title,
  severity: null,
  category: null,
});

export const SEED_EVAL_CASES: SeedEvalCase[] = [
  // ---- floor: the agent finds these, and must keep finding them -----------
  {
    name: 'stripe-key-leak',
    notes: 'floor · hardcoded credential',
    inputDiff: `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -9,6 +9,7 @@
 export const config = {
   port: Number(process.env.PORT ?? 3000),
   redisUrl: process.env.REDIS_URL,
+  stripeKey: "sk_live_51H8xq2Ka9Vn3PqLm7Rd0bZ4Xc",
   region: process.env.AWS_REGION,
   debug: false,
 };
`,
    expectations: [find('src/config.ts', 12, 12, 'Hardcoded Stripe secret key')],
  },
  {
    name: 'sql-injection-concat',
    notes: 'floor · injection',
    inputDiff: `diff --git a/src/db/users.ts b/src/db/users.ts
--- a/src/db/users.ts
+++ b/src/db/users.ts
@@ -20,5 +20,7 @@
 export async function findUser(email: string) {
-  return db.query('SELECT * FROM users WHERE email = $1', [email]);
+  const sql = "SELECT * FROM users WHERE email = '" + email + "'";
+  return db.query(sql);
 }
`,
    expectations: [find('src/db/users.ts', 21, 22, 'SQL built by string concatenation')],
  },
  {
    name: 'jwt-verification-disabled',
    notes: 'floor · broken authentication',
    inputDiff: `diff --git a/src/auth/token.ts b/src/auth/token.ts
--- a/src/auth/token.ts
+++ b/src/auth/token.ts
@@ -14,4 +14,5 @@
 export function decodeToken(raw: string) {
-  return jwt.verify(raw, PUBLIC_KEY, { algorithms: ['RS256'] });
+  // faster, and we already trust the gateway
+  return jwt.decode(raw);
 }
`,
    expectations: [find('src/auth/token.ts', 15, 16, 'JWT signature no longer verified')],
  },
  {
    name: 'ssrf-webhook-forwarder',
    notes: 'floor · SSRF',
    inputDiff: `diff --git a/src/api/webhooks.ts b/src/api/webhooks.ts
--- a/src/api/webhooks.ts
+++ b/src/api/webhooks.ts
@@ -30,4 +30,7 @@
 export async function forward(req: Req, res: Res) {
+  const target = req.body.callbackUrl;
+  const upstream = await fetch(target, { headers: { authorization: INTERNAL_TOKEN } });
+  res.send(await upstream.text());
 }
`,
    expectations: [find('src/api/webhooks.ts', 31, 33, 'Unvalidated URL fetched with an internal token')],
  },

  // ---- headroom: real defects the agent often misses ----------------------
  {
    name: 'timing-unsafe-token-compare',
    notes: 'headroom · timing side channel',
    inputDiff: `diff --git a/src/auth/apikey.ts b/src/auth/apikey.ts
--- a/src/auth/apikey.ts
+++ b/src/auth/apikey.ts
@@ -11,4 +11,5 @@
 export function checkApiKey(given: string, expected: string) {
-  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
+  return given === expected;
 }
`,
    expectations: [
      find('src/auth/apikey.ts', 12, 12, 'Secret compared with === leaks length and prefix by timing'),
    ],
  },
  {
    name: 'open-redirect-next-param',
    notes: 'headroom · open redirect',
    inputDiff: `diff --git a/src/routes/login.ts b/src/routes/login.ts
--- a/src/routes/login.ts
+++ b/src/routes/login.ts
@@ -42,4 +42,6 @@
 export function afterLogin(req: Req, res: Res) {
-  res.redirect('/dashboard');
+  const next = String(req.query.next ?? '/dashboard');
+  res.redirect(next);
 }
`,
    expectations: [
      find('src/routes/login.ts', 43, 44, 'User-controlled redirect target'),
    ],
  },
  {
    name: 'missing-rate-limit-on-reset',
    notes: 'headroom · missing control',
    inputDiff: `diff --git a/src/routes/index.ts b/src/routes/index.ts
--- a/src/routes/index.ts
+++ b/src/routes/index.ts
@@ -18,5 +18,6 @@
 export function register(app: App) {
   app.post('/login', rateLimit({ max: 5 }), loginHandler);
+  app.post('/password-reset', passwordResetHandler);
   app.get('/health', healthHandler);
 }
`,
    expectations: [
      find('src/routes/index.ts', 20, 20, 'Password reset registered without the rate limit its sibling has'),
    ],
  },
  {
    name: 'log-writes-full-request-body',
    notes: 'headroom · sensitive data in logs',
    inputDiff: `diff --git a/src/middleware/logging.ts b/src/middleware/logging.ts
--- a/src/middleware/logging.ts
+++ b/src/middleware/logging.ts
@@ -7,4 +7,5 @@
 export function logRequest(req: Req) {
-  logger.info({ path: req.path, method: req.method }, 'request');
+  logger.info({ path: req.path, method: req.method, body: req.body }, 'request');
 }
`,
    expectations: [
      find('src/middleware/logging.ts', 8, 8, 'Whole request body written to logs, passwords included'),
    ],
  },

  // ---- noise: dismissed findings the agent must stop repeating ------------
  {
    name: 'test-fixture-placeholder-key',
    notes: 'noise · dismissed as a test fixture',
    inputDiff: `diff --git a/test/fixtures/stripe.test.ts b/test/fixtures/stripe.test.ts
--- a/test/fixtures/stripe.test.ts
+++ b/test/fixtures/stripe.test.ts
@@ -3,4 +3,5 @@
 import { describe, it } from 'vitest';
+const TEST_KEY = 'sk_test_00000000000000000000000000';
 describe('stripe client', () => {
   it('builds a charge', () => {});
`,
    expectations: [
      dontFlag('test/fixtures/stripe.test.ts', 4, 4, 'Documented test placeholder, not a live key'),
    ],
  },
  {
    name: 'env-var-read-is-not-a-leak',
    notes: 'noise · dismissed as a false positive',
    inputDiff: `diff --git a/src/mailer.ts b/src/mailer.ts
--- a/src/mailer.ts
+++ b/src/mailer.ts
@@ -5,4 +5,5 @@
 export function makeMailer() {
+  const apiKey = process.env.SENDGRID_API_KEY;
   return new Mailer({ apiKey });
 }
`,
    expectations: [
      dontFlag('src/mailer.ts', 6, 6, 'Reading a key from the environment is the correct pattern'),
    ],
  },
  {
    name: 'unused-import-added',
    notes: 'noise · dismissed as style, not a defect',
    inputDiff: `diff --git a/src/reporting/summary.ts b/src/reporting/summary.ts
--- a/src/reporting/summary.ts
+++ b/src/reporting/summary.ts
@@ -1,4 +1,5 @@
 import { formatDate } from './format';
+import { chunk } from 'lodash';
 
 export function summarise(rows: Row[]) {
`,
    expectations: [
      dontFlag('src/reporting/summary.ts', 2, 2, 'Unused import is lint noise, not a review finding'),
    ],
  },

  // ---- clean: nothing is wrong; any finding is a false positive -----------
  {
    name: 'rename-only-refactor',
    notes: 'clean · no defect present',
    inputDiff: `diff --git a/src/util/money.ts b/src/util/money.ts
--- a/src/util/money.ts
+++ b/src/util/money.ts
@@ -4,6 +4,6 @@
 export function toCents(amount: number): number {
-  const v = Math.round(amount * 100);
-  return v;
+  const cents = Math.round(amount * 100);
+  return cents;
 }
`,
    expectations: [],
  },
];
