import { spawn } from 'node:child_process';
import { URL } from 'node:url';

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error('Connection URI contains an invalid percent-encoding.');
  }
}

export function connectionEnvironment(connectionString: string, requireSsl = true): NodeJS.ProcessEnv {
  let connection: URL;
  try {
    connection = new URL(connectionString);
  } catch {
    throw new Error('A valid PostgreSQL connection URI is required.');
  }

  if (!['postgres:', 'postgresql:'].includes(connection.protocol)) {
    throw new Error('Connection URI must use the postgres or postgresql scheme.');
  }
  if (connection.hash) {
    throw new Error('Connection URI contains an unescaped fragment; URL-encode special characters in credentials.');
  }

  const database = decode(connection.pathname.replace(/^\/+/, ''));
  const username = decode(connection.username);
  const password = decode(connection.password);
  const sslMode = connection.searchParams.get('sslmode');
  if (!connection.hostname || !database || !username || !password) {
    throw new Error('Connection URI must include host, database, username and password.');
  }
  if (requireSsl && !['require', 'verify-ca', 'verify-full'].includes(sslMode ?? '')) {
    throw new Error('Connection URI must explicitly set sslmode=require (or a stricter mode).');
  }

  return {
    ...process.env,
    PGHOST: connection.hostname,
    PGPORT: connection.port || '5432',
    PGDATABASE: database,
    PGUSER: username,
    PGPASSWORD: password,
    PGSSLMODE: sslMode ?? 'prefer',
    PGCONNECT_TIMEOUT: process.env.PGCONNECT_TIMEOUT || '15',
    PGAPPNAME: 'pallet-db-maintenance',
  };
}

function redactOutput(text: string): string {
  return text
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[connection URI redacted]')
    .replace(/(password\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]');
}

export function runPgTool(
  executable: 'pg_dump' | 'pg_restore' | 'psql',
  args: string[],
  connectionString: string,
  requireSsl = true,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(executable, args, {
        env: connectionEnvironment(connectionString, requireSsl),
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      });
    } catch {
      reject(new Error(`Unable to start ${executable}; verify PostgreSQL client tools are installed and on PATH.`));
      return;
    }

    const stderr: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', () => {
      reject(new Error(`Unable to start ${executable}; verify PostgreSQL client tools are installed and on PATH.`));
    });
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const details = redactOutput(Buffer.concat(stderr).toString('utf8').trim());
      reject(new Error(
        `${executable} failed${signal ? ` (${signal})` : ` with exit code ${code}`}` +
        (details ? `: ${details}` : '.'),
      ));
    });
  });
}

export function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set.`);
  }
  return value;
}

export function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'An unknown error occurred.';
  return redactOutput(error.message);
}
