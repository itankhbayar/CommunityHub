import 'dotenv/config';

/** `db` is the compose service name; the rest are the host-side equivalents. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'db']);

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

  // Deriving from DATABASE_URL is a convenience for the local compose setup.
  // Once DATABASE_URL points at hosted Postgres it becomes a live hazard:
  // global-setup issues CREATE DATABASE against that server's maintenance
  // database, and the suite truncates freely between tests. Refuse anything
  // that is not plainly local — an explicit TEST_DATABASE_URL is required to
  // aim the suite at a remote host, so it can never happen by default.
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(
      `Refusing to derive a test database from DATABASE_URL: host "${url.hostname}" is not local. ` +
        `e2e tests create and truncate databases. Set TEST_DATABASE_URL explicitly if this is intended.`,
    );
  }

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
