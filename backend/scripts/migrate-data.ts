import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { runPgTool, requiredEnvironment, safeErrorMessage } from './db-cli';

const prismaFor = (url: string) =>
  new PrismaClient({ datasources: { db: { url } } });

async function sha256(filePath: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}

async function ensureTargetReady(prisma: PrismaClient): Promise<void> {
  const migrationTable = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = '_prisma_migrations'
    ) AS "exists"
  `;
  if (!migrationTable[0]?.exists) {
    throw new Error('Target schema is not migrated. Run prisma migrate deploy against the disposable target first.');
  }

  const appliedMigrations = await prisma.$queryRaw<Array<{ count: bigint | number }>>`
    SELECT COUNT(*) AS "count"
    FROM public."_prisma_migrations"
    WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
  `;
  if (Number(appliedMigrations[0]?.count ?? 0) === 0) {
    throw new Error('Target has no completed Prisma migrations; refusing to restore.');
  }

  const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name <> '_prisma_migrations'
    ORDER BY table_name
  `;
  for (const { table_name: tableName } of tables) {
    const safeName = tableName.replace(/"/g, '""');
    const count = await prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(
      `SELECT COUNT(*) AS "count" FROM public."${safeName}"`,
    );
    if (Number(count[0]?.count ?? 0) !== 0) {
      throw new Error(`Target table "${tableName}" is not empty; refusing to restore or overwrite data.`);
    }
  }
}

async function main(): Promise<void> {
  const sourceUrl = requiredEnvironment('SOURCE_DATABASE_URL');
  const targetUrl = requiredEnvironment('DIRECT_URL');
  const dumpPath = resolve(requiredEnvironment('MIGRATION_DUMP_PATH'));

  if (!existsSync(dumpPath)) {
    mkdirSync(dirname(dumpPath), { recursive: true });
    await runPgTool('pg_dump', [
      '--format=custom',
      '--data-only',
      '--no-owner',
      '--no-acl',
      '--exclude-table-data=public._prisma_migrations',
      `--file=${dumpPath}`,
    ], sourceUrl, false);
  }

  const dumpHash = await sha256(dumpPath);
  const target = prismaFor(targetUrl);
  try {
    await target.$connect();
    await target.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS "_pallet_migration"');
    await target.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "_pallet_migration"."data_imports" (
        "dump_sha256" TEXT PRIMARY KEY,
        "completed_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const priorImports = await target.$queryRaw<Array<{ dump_sha256: string }>>`
      SELECT dump_sha256
      FROM "_pallet_migration"."data_imports"
      LIMIT 2
    `;
    if (priorImports.some((row) => row.dump_sha256 === dumpHash)) {
      console.log('This archive was already imported successfully; no restore was run.');
      return;
    }
    if (priorImports.length > 0) {
      throw new Error('A different archive is already recorded for this target; use a new disposable target.');
    }

    await ensureTargetReady(target);
    await runPgTool('pg_restore', [
      '--data-only',
      '--no-owner',
      '--no-acl',
      '--exit-on-error',
      '--single-transaction',
      dumpPath,
    ], targetUrl);

    await target.$executeRaw`
      INSERT INTO "_pallet_migration"."data_imports" ("dump_sha256")
      VALUES (${dumpHash})
    `;
    console.log('Data import completed. Run reset-sequences.ts and verify-migration.ts before use.');
  } finally {
    await target.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(`Data migration failed: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
});
