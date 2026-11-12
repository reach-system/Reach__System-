import { resolve } from 'node:path';
import { runPgTool, requiredEnvironment, safeErrorMessage } from './db-cli';

async function main(): Promise<void> {
  const directUrl = requiredEnvironment('DIRECT_URL');
  const sqlPath = resolve(__dirname, 'reset-sequences.sql');
  await runPgTool('psql', ['--no-psqlrc', '--set=ON_ERROR_STOP=1', `--file=${sqlPath}`], directUrl);
  console.log('PostgreSQL sequences and invoice/quotation counters were reset.');
}

main().catch((error: unknown) => {
  console.error(`Sequence reset failed: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
});
