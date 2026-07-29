import { resolveTestDatabaseUrl } from './test-db';

// Runs in every jest worker before the test framework loads, so that anything
// reading DATABASE_URL (PrismaService included) talks to the e2e database.
process.env.DATABASE_URL = resolveTestDatabaseUrl();

// Auth config the app requires at boot. Defaulted here so the suite runs from
// a bare checkout without anyone having to populate .env first.
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_ACCESS_TTL ??= '15m';
process.env.REFRESH_TOKEN_TTL_DAYS ??= '7';
process.env.COOKIE_SECURE ??= 'false';
