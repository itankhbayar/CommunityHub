import { execFileSync } from 'node:child_process';
import { Client } from 'pg';
import { maintenanceUrlFor, resolveTestDatabaseUrl } from './test-db';

/**
 * Creates the e2e database if it does not exist, then brings it up to date with
 * the committed migrations. Runs once before the whole e2e suite.
 */
export default async function globalSetup(): Promise<void> {
  const testUrl = resolveTestDatabaseUrl();
  const { adminUrl, databaseName } = maintenanceUrlFor(testUrl);

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const { rowCount } = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [databaseName],
    );
    if (rowCount === 0) {
      // identifier can't be parameterized; it comes from our own env, not user input
      await admin.query(`CREATE DATABASE "${databaseName}"`);
    }
  } finally {
    await admin.end();
  }

  // Invoke the CLI's JS entrypoint with the current node binary rather than
  // `npx`: Node refuses to spawn .cmd shims without a shell on Windows.
  const prismaCli = require.resolve('prisma/build/index.js');

  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'inherit',
  });
}
