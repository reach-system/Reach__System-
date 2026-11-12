import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, appendFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { runPgTool, requiredEnvironment, safeErrorMessage } from './db-cli';

const repositoryRoot = resolve(__dirname, '..', '..');
const backupPattern = /^pallet-postgres-(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})\.dump$/;

function isWithin(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function isoWeek(dateText: string): string {
  const [year, month, day] = dateText.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const weekYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${weekYear}-${String(week).padStart(2, '0')}`;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return number;
}

function applyRetention(directory: string, dailyKeep: number, weeklyKeep: number): void {
  const backups = readdirSync(directory)
    .map((name) => {
      const match = backupPattern.exec(name);
      return match ? { name, date: match[1], time: match[2] } : null;
    })
    .filter((backup): backup is { name: string; date: string; time: string } => backup !== null)
    .sort((left, right) => `${right.date}_${right.time}`.localeCompare(`${left.date}_${left.time}`));

  const kept = new Set(backups.slice(0, dailyKeep).map((backup) => backup.name));
  const weeksKept = new Set(backups.filter((backup) => kept.has(backup.name)).map((backup) => isoWeek(backup.date)));
  let olderWeeksKept = 0;
  for (const backup of backups.slice(dailyKeep)) {
    const week = isoWeek(backup.date);
    if (!weeksKept.has(week) && olderWeeksKept < weeklyKeep) {
      kept.add(backup.name);
      weeksKept.add(week);
      olderWeeksKept++;
    }
  }

  for (const backup of backups) {
    if (!kept.has(backup.name)) unlinkSync(join(directory, backup.name));
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.BACKUP_DATABASE_URL?.trim() || requiredEnvironment('DIRECT_URL');
  const directory = resolve(requiredEnvironment('BACKUP_DIR'));
  if (isWithin(repositoryRoot, directory)) {
    throw new Error('BACKUP_DIR must be outside the repository so database dumps cannot be committed accidentally.');
  }

  const dailyKeep = positiveInteger(process.env.BACKUP_DAILY_KEEP, 7, 'BACKUP_DAILY_KEEP');
  const weeklyKeep = positiveInteger(process.env.BACKUP_WEEKLY_KEEP, 4, 'BACKUP_WEEKLY_KEEP');
  mkdirSync(directory, { recursive: true });

  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toISOString().slice(11, 19).replace(/:/g, '-');
  const backupPath = join(directory, `pallet-postgres-${date}_${time}.dump`);
  const logPath = resolve(process.env.BACKUP_LOG || join(directory, 'backup.log'));
  const log = (message: string) => appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, 'utf8');

  try {
    await runPgTool('pg_dump', [
      '--format=custom',
      '--compress=6',
      '--no-owner',
      '--no-acl',
      `--file=${backupPath}`,
    ], connectionString);
    if (!existsSync(backupPath) || statSync(backupPath).size === 0) {
      throw new Error('pg_dump completed without creating a non-empty archive.');
    }
    applyRetention(directory, dailyKeep, weeklyKeep);
    const message = `Backup succeeded: ${backupPath}`;
    log(message);
    console.log(message);
  } catch (error) {
    if (existsSync(backupPath)) unlinkSync(backupPath);
    const message = `Backup failed: ${safeErrorMessage(error)}`;
    log(message);
    console.error(message);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(`Backup failed: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
});
