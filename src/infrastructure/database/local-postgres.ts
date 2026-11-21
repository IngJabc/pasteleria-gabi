/**
 * Test-only helper: a disposable local PostgreSQL cluster with a stub of the
 * Supabase-managed environment (API roles, `auth` schema + `auth.uid()`,
 * `storage` schema, default grants).
 *
 * It exists so the real migration files under `supabase/migrations/` can be
 * applied and behaviorally tested without any remote project, credentials or
 * Docker: it drives the locally installed PostgreSQL binaries
 * (`initdb` / `pg_ctl` / `psql`) in a throwaway data directory and tears the
 * cluster down afterwards.
 *
 * Nothing here runs against a remote database — only `127.0.0.1` on an
 * ephemeral port.
 *
 * The suite is skipped entirely (describe.skipIf) when no local PostgreSQL
 * binaries are found, so `npm test` keeps working on machines without them.
 * Set `PGBIN` to point at a specific `bin` directory.
 */

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const IS_WINDOWS = process.platform === "win32";
const EXE = IS_WINDOWS ? ".exe" : "";

export interface PostgresTools {
  initdb: string;
  pg_ctl: string;
  psql: string;
}

export interface PsqlResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface LocalPostgres {
  readonly port: number;
  /** Run one psql invocation (SQL delivered on stdin) with ON_ERROR_STOP unless disabled. */
  psql(sql: string, options?: { onErrorStop?: boolean }): Promise<PsqlResult>;
  /** Apply a SQL file in a single transaction, failing hard on any error. */
  applyFile(file: string): Promise<void>;
  /** Apply an inline SQL script (e.g. the Supabase stub) in one transaction. */
  applyScript(sql: string): Promise<void>;
  /** Stop the server and remove the data directory. Safe to call twice. */
  stop(): Promise<void>;
}

/**
 * Minimal stand-in for the Supabase-managed environment, mirroring what the
 * migrations assume: API roles (with `service_role` bypassing RLS), an `auth`
 * schema whose `auth.uid()` reads the JWT claim Supabase sets, the `storage`
 * tables/policies M1 writes to, and Supabase's default table/sequence grants
 * for the API roles (RLS remains the row-level boundary).
 */
export const SUPABASE_STUB_SQL = `
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text
);
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant usage on schema auth to public;
grant execute on function auth.uid() to public;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;
alter table storage.objects force row level security;
grant usage on schema storage to public;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;

create schema if not exists extensions;
grant usage on schema extensions to public;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated, service_role;

-- Supabase projects always provide this managed publication. Mirror it locally
-- so migration 008 is applied against a faithful baseline.
create publication supabase_realtime;
`;

function executable(dir: string, base: string): string {
  return path.join(dir, `${base}${EXE}`);
}

/** Locate a usable local PostgreSQL `bin` directory, or null if there is none. */
export function findPostgresTools(): PostgresTools | null {
  const dirs: string[] = [];
  if (process.env.PGBIN) dirs.push(process.env.PGBIN);
  if (IS_WINDOWS) {
    for (const base of ["C:\\Program Files", "C:\\Program Files (x86)"]) {
      const root = path.join(base, "PostgreSQL");
      if (!existsSync(root)) continue;
      for (const entry of readdirSync(root).sort().reverse()) {
        dirs.push(path.join(root, entry, "bin"));
      }
    }
  }
  for (const entry of (process.env.PATH ?? "").split(path.delimiter)) {
    if (entry) dirs.push(entry);
  }

  for (const dir of dirs) {
    const initdb = executable(dir, "initdb");
    const pg_ctl = executable(dir, "pg_ctl");
    const psql = executable(dir, "psql");
    if (existsSync(initdb) && existsSync(pg_ctl) && existsSync(psql)) {
      return { initdb, pg_ctl, psql };
    }
  }
  return null;
}

function run(
  command: string,
  args: string[],
  options: { timeoutMs?: number; input?: string } = {},
): Promise<PsqlResult> {
  const { timeoutMs = 60_000, input } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      // SQL is delivered on stdin (raw UTF-8) instead of argv: on Windows,
      // argv goes through the ANSI codepage and non-ASCII characters would be
      // mangled before the server sees them.
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      env: { ...process.env, PGCLIENTENCODING: "UTF8" },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out after ${timeoutMs}ms: ${command}`));
    }, timeoutMs);
    // stdio above always requests pipes for both streams; fail loudly if the
    // platform did not honour that instead of capturing nothing.
    if (child.stdout === null || child.stderr === null) {
      clearTimeout(timer);
      child.kill();
      reject(new Error(`spawn did not open stdio pipes: ${command}`));
      return;
    }
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      // Resolve on `exit` raced against `close`: `close` waits for the stdio
      // streams to end, but a descendant (the postmaster spawned by pg_ctl)
      // can inherit those pipe handles and hold them open indefinitely.
      const finalize = (): void => resolve({ code: code ?? -1, stdout, stderr });
      const grace = setTimeout(finalize, 300);
      child.once("close", () => {
        clearTimeout(grace);
        finalize();
      });
    });
    if (input !== undefined) {
      // EPIPE is expected when ON_ERROR_STOP ends the script early.
      child.stdin?.on("error", () => undefined);
      child.stdin?.end(input);
    }
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("Could not reserve a local port")));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Initialise and start a throwaway cluster on an ephemeral loopback port.
 * Throws with the captured output if any step fails; partial state is cleaned
 * up before rethrowing.
 */
export async function startLocalPostgres(tools: PostgresTools): Promise<LocalPostgres> {
  const base = path.join(tmpdir(), "opencode");
  mkdirSync(base, { recursive: true });
  const dataDir = mkdtempSync(path.join(base, "m2-pg-"));
  const logFile = path.join(dataDir, "server.log");

  const cleanup = async (): Promise<void> => {
    try {
      await run(tools.pg_ctl, ["-D", dataDir, "-m", "immediate", "-w", "-t", "20", "stop"], {
        timeoutMs: 30_000,
      });
    } catch {
      // Server never started (or already gone).
    }
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // Best effort: never fail the suite on cleanup.
    }
  };

  try {
    const init = await run(
      tools.initdb,
      ["-D", dataDir, "-U", "postgres", "-A", "trust", "-E", "UTF8", "--no-locale"],
      { timeoutMs: 180_000 },
    );
    if (init.code !== 0) {
      throw new Error(`initdb failed (exit ${init.code}):\n${init.stdout}\n${init.stderr}`);
    }

    const port = await freePort();
    const start = await run(
      tools.pg_ctl,
      [
        "-D",
        dataDir,
        "-o",
        `-p ${port} -c listen_addresses=127.0.0.1 -c fsync=off`,
        "-l",
        logFile,
        "-w",
        "-t",
        "60",
        "start",
      ],
      { timeoutMs: 90_000 },
    );
    if (start.code !== 0) {
      const log = existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
      throw new Error(`pg_ctl start failed (exit ${start.code}):\n${start.stdout}\n${start.stderr}\n${log}`);
    }

    let stopped = false;
    const psql = (sql: string, options?: { onErrorStop?: boolean }): Promise<PsqlResult> => {
      const onErrorStop = options?.onErrorStop === false ? "0" : "1";
      return run(
        tools.psql,
        [
          "-h", "127.0.0.1",
          "-p", String(port),
          "-U", "postgres",
          "-d", "postgres",
          "-w",
          "-q",
          "-t",
          "-A",
          "-F", "|",
          "-v", `ON_ERROR_STOP=${onErrorStop}`,
        ],
        { timeoutMs: 30_000, input: sql },
      );
    };

    const runFile = (file: string): Promise<PsqlResult> =>
      run(tools.psql, [
        "-h", "127.0.0.1",
        "-p", String(port),
        "-U", "postgres",
        "-d", "postgres",
        "-w",
        "-1",
        "-v", "ON_ERROR_STOP=1",
        "-f", file,
      ], { timeoutMs: 60_000 });

    return {
      port,
      psql,
      async applyFile(file: string): Promise<void> {
        const result = await runFile(file);
        if (result.code !== 0) {
          throw new Error(`Applying ${file} failed (exit ${result.code}):\n${result.stdout}\n${result.stderr}`);
        }
      },
      async applyScript(sql: string): Promise<void> {
        const result = await run(tools.psql, [
          "-h", "127.0.0.1",
          "-p", String(port),
          "-U", "postgres",
          "-d", "postgres",
          "-w",
          "-1",
          "-v", "ON_ERROR_STOP=1",
        ], { timeoutMs: 60_000, input: sql });
        if (result.code !== 0) {
          throw new Error(`Applying inline SQL failed (exit ${result.code}):\n${result.stdout}\n${result.stderr}`);
        }
      },
      async stop(): Promise<void> {
        if (stopped) return;
        stopped = true;
        await cleanup();
      },
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
