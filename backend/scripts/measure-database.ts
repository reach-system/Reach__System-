import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { PrismaClient } from '@prisma/client';
import { requiredEnvironment, safeErrorMessage } from './db-cli';

const repositoryRoot = resolve(__dirname, '..', '..');
const freePlanLimitBytes = 500 * 1024 * 1024;

function isWithin(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

async function main(): Promise<void> {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  const historyPath = resolve(
    process.env.DB_SIZE_HISTORY_PATH || `${homedir()}/.pallet-db-size.csv`,
  );
  if (isWithin(repositoryRoot, historyPath)) {
    throw new Error('DB_SIZE_HISTORY_PATH must be outside the repository.');
  }

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    await prisma.$connect();

    const latencies: number[] = [];
    for (let index = 0; index < 25; index++) {
      const started = performance.now();
      await prisma.$queryRaw`SELECT 1`;
      latencies.push(performance.now() - started);
    }

    const sizeRows = await prisma.$queryRaw<Array<{ database_bytes: bigint | number }>>`
      SELECT pg_database_size(current_database()) AS database_bytes
    `;
    const databaseBytes = Number(sizeRows[0]?.database_bytes);
    if (!Number.isFinite(databaseBytes)) throw new Error('Could not read PostgreSQL database size.');

    const tableRows = await prisma.$queryRaw<Array<{
      table_name: string;
      total_bytes: bigint | number;
      live_rows: bigint | number;
    }>>`
      SELECT
        relation.relname AS table_name,
        pg_total_relation_size(relation.oid) AS total_bytes,
        GREATEST(statistics.n_live_tup, 0) AS live_rows
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      LEFT JOIN pg_stat_user_tables AS statistics
        ON statistics.relid = relation.oid
      WHERE namespace.nspname = 'public'
        AND relation.relkind IN ('r', 'm')
      ORDER BY pg_total_relation_size(relation.oid) DESC
      LIMIT 15
    `;

    const now = new Date();
    mkdirSync(dirname(historyPath), { recursive: true });
    if (!existsSync(historyPath)) appendFileSync(historyPath, 'timestamp,database_bytes\n', 'utf8');
    const previous = readFileSync(historyPath, 'utf8')
      .split(/\r?\n/)
      .slice(1)
      .filter(Boolean)
      .map((line) => {
        const [timestamp, bytes] = line.split(',');
        return { timestamp: new Date(timestamp), bytes: Number(bytes) };
      })
      .filter((row) => Number.isFinite(row.timestamp.getTime()) && Number.isFinite(row.bytes));
    appendFileSync(historyPath, `${now.toISOString()},${databaseBytes}\n`, 'utf8');

    const days = previous.length
      ? (now.getTime() - previous[0].timestamp.getTime()) / 86400000
      : 0;
    const growthPerDay = days > 0
      ? (databaseBytes - previous[0].bytes) / days
      : undefined;
    const remainingBytes = freePlanLimitBytes - databaseBytes;
    const remainingDays = growthPerDay && growthPerDay > 0
      ? remainingBytes / growthPerDay
      : undefined;

    const sortedLatencies = [...latencies].sort((left, right) => left - right);
    console.log(
      `SELECT 1 latency (25 samples): min=${sortedLatencies[0].toFixed(1)}ms ` +
      `median=${percentile(latencies, 0.5).toFixed(1)}ms p95=${percentile(latencies, 0.95).toFixed(1)}ms`,
    );
    console.log(`Database size: ${(databaseBytes / (1024 * 1024)).toFixed(2)} MiB`);
    console.log(`Free-plan 500 MiB remaining: ${(remainingBytes / (1024 * 1024)).toFixed(2)} MiB`);
    if (growthPerDay !== undefined) {
      console.log(`Observed size growth: ${(growthPerDay / (1024 * 1024)).toFixed(2)} MiB/day`);
      console.log(
        remainingDays !== undefined
          ? `Linear estimate to 500 MiB: ${remainingDays.toFixed(1)} days (historical trend only)`
          : 'No positive growth rate observed; no exhaustion estimate is available.',
      );
    } else {
      console.log('Growth estimate unavailable: run this script again after at least one day.');
    }
    console.log('Largest public tables:');
    for (const row of tableRows) {
      console.log(
        `  ${row.table_name}: ${(Number(row.total_bytes) / (1024 * 1024)).toFixed(2)} MiB, ` +
        `estimated live rows=${Number(row.live_rows)}`,
      );
    }
    console.log(`Size history: ${historyPath}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(`Database measurement failed: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
});
