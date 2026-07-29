import { resolveTestDatabaseUrl } from './test-db';

// Runs in every jest worker before the test framework loads, so that anything
// reading DATABASE_URL (PrismaService included) talks to the e2e database.
process.env.DATABASE_URL = resolveTestDatabaseUrl();
