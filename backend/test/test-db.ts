import 'dotenv/config';

/**
 * e2e tests run against their own database so they can truncate freely without
 * destroying seeded demo data. Derived from DATABASE_URL by swapping the
 * database name, unless TEST_DATABASE_URL is set explicitly.
 */
export function resolveTestDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;

  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      'Neither TEST_DATABASE_URL nor DATABASE_URL is set — cannot run e2e tests.',
    );
  }

  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, '')}_test`;
  return url.toString();
}

/** Same server, but pointed at the default `postgres` maintenance database. */
export function maintenanceUrlFor(testUrl: string): {
  adminUrl: string;
  databaseName: string;
} {
  const url = new URL(testUrl);
  const databaseName = url.pathname.replace(/^\//, '');
  url.pathname = '/postgres';
  url.search = '';
  return { adminUrl: url.toString(), databaseName };
}
