import { resolveTestDatabaseUrl } from './test-db';

// Runs in every jest worker before the test framework loads, so that anything
// reading DATABASE_URL (PrismaService included) talks to the e2e database.
process.env.DATABASE_URL = resolveTestDatabaseUrl();

// Auth config the app requires at boot. Defaulted here so the suite runs from
// a bare checkout without anyone having to populate .env first.
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_ACCESS_TTL ??= '15m';
process.env.REFRESH_TOKEN_TTL_DAYS ??= '7';

// Forced, not defaulted (`??=`), for the same reason DATABASE_URL above is:
// a real value in .env would otherwise win and break the suite. supertest
// speaks plain HTTP, so a Secure cookie is set but never sent back and every
// authenticated request 401s — which reads as ~100 authorization failures
// rather than as one misconfigured environment variable.
//
// Once .env holds production values (COOKIE_SECURE=true, COOKIE_SAMESITE=none
// for a cross-site deploy), that is exactly what happens. SameSite=None also
// implies Secure, so it has to be pinned here too.
process.env.COOKIE_SECURE = 'false';
process.env.COOKIE_SAMESITE = 'lax';

// Forced off for the same reason. Registration mails a confirmation link, and
// the suite registers five users per file — pointed at a host that does not
// resolve from here (compose's `mailpit`), each one is a multi-second DNS
// timeout, which is slow enough to starve the Postgres pool and fail unrelated
// tests. Empty means MailerService logs instead of connecting.
process.env.SMTP_HOST = '';

// Forced on so the suite can give each test its own client identity via
// X-Forwarded-For. ThrottleGuard buckets on req.ip, and every supertest request
// otherwise arrives from 127.0.0.1 — one shared bucket, so the first spec to
// spend a limit would fail every later one. Production defaults this to 0; see
// trustProxyHops() for why both settings are dangerous in opposite directions.
process.env.TRUST_PROXY = '1';
