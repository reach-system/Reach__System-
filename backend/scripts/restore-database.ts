import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { runPgTool, requiredEnvironment, safeErrorMessage } from './db-cli';

async function main(): Promise<void> {
  const archive = resolve(requiredEnvironment('RESTORE_ARCHIVE'));
  const targetUrl = requiredEnvironment('RESTORE_TARGET_URL');
  if (!existsSync(archive) || statSync(archive).size === 0) {
    throw new Error('RESTORE_ARCHIVE must point to an existing, non-empty custom-format pg_dump archive.');
  }

  const target = new PrismaClient({ datasources: { db: { url: targetUrl } } });
  try {
    await target.$connect();
    const publicTables = await target.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `;
    if (publicTables.length > 0) {
      throw new Error('Restore target is not a fresh database; refusing to overwrite or merge existing tables.');
    }

    await runPgTool('pg_restore', [
      '--no-owner',
      '--no-acl',
      '--exit-on-error',
      '--single-transaction',
      archive,
    ], targetUrl);
    console.log('Restore completed on an empty target. Run reset-sequences.ts and verify-migration.ts before use.');
  } finally {
    await target.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(`Database restore failed: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
});
