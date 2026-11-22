#!/usr/bin/env node
/**
 * Generate `src/infrastructure/database/database.types.ts` from the local
 * migration files, without Docker, `supabase start` or any remote project.
 *
 * A throwaway PostgreSQL 17 cluster is created under the approved temp root,
 * bound only to 127.0.0.1 on an ephemeral port. The Supabase stub SQL and
 * migrations 001-009 are applied through psql stdin, then the installed
 * Supabase CLI generates types from that throwaway database. The cluster is
 * always stopped and removed afterwards.
 */

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const STUB_SQL = path.join(ROOT, "src", "infrastructure", "database", "supabase-stub.sql");
const OUTPUT_FILE = path.join(ROOT, "src", "infrastructure", "database", "database.types.ts");
const PREFERRED_TEMP_ROOT = "C:\\Users\\Jabc\\AppData\\Local\\Temp\\opencode";
const IS_WINDOWS = process.platform === "win32";
const EXE = IS_WINDOWS ? ".exe" : "";

function executable(dir, base) {
  return path.join(dir, `${base}${EXE}`);
}

/** Run a child process, capturing UTF-8 output; SQL is delivered on stdin. */
function run(command, args, options = {}) {
  const { timeoutMs = 60_000, input, cwd = ROOT, shell = false } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      env: { ...process.env, PGCLIENTENCODING: "UTF8" },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out after ${timeoutMs}ms: ${command}`));
    }, timeoutMs);
    if (child.stdout === null || child.stderr === null) {
      clearTimeout(timer);
      child.kill();
      reject(new Error(`spawn did not open stdio pipes: ${command}`));
      return;
    }
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      // pg_ctl can leave a descendant holding the pipes open after exit.
      const finalize = () => resolve({ code: code ?? -1, stdout, stderr });
      const grace = setTimeout(finalize, 300);
      child.once("close", () => {
        clearTimeout(grace);
        finalize();
      });
    });
    if (input !== undefined) {
      child.stdin?.on("error", () => undefined);
      child.stdin?.end(input);
    }
  });
}

/** Locate a PostgreSQL 17 bin directory, preferring PGBIN then installed versions then PATH. */
async function findPostgres17Tools() {
  const dirs = [];
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

  const seen = new Set();
  for (const dir of dirs) {
    const normalised = path.resolve(dir);
    if (seen.has(normalised)) continue;
    seen.add(normalised);
    const tools = {
      initdb: executable(dir, "initdb"),
      pg_ctl: executable(dir, "pg_ctl"),
      psql: executable(dir, "psql"),
    };
    if (!existsSync(tools.initdb) || !existsSync(tools.pg_ctl) || !existsSync(tools.psql)) {
      continue;
    }
    const version = await run(tools.initdb, ["--version"]);
    const major = version.stdout.match(/\(PostgreSQL\) (\d+)\./)?.[1];
    if (version.code === 0 && major === "17") return tools;
  }
  throw new Error(
    "PostgreSQL 17 initdb/pg_ctl/psql not found. Set PGBIN to a PostgreSQL 17 bin directory.",
  );
}

function freePort() {
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

function selectMigrations() {
  const all = readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{3}_.*\.sql$/.test(name))
    .sort();
  if (all.length < 9) {
    throw new Error(
      `Expected at least nine sorted migrations in ${MIGRATIONS_DIR}, found ${all.length}.`,
    );
  }
  const selected = all.slice(0, 9);
  selected.forEach((name, index) => {
    const expected = String(index + 1).padStart(3, "0");
    if (!name.startsWith(`${expected}_`)) {
      throw new Error(`Expected migration ${expected}_* in ${MIGRATIONS_DIR}, found ${name}.`);
    }
  });
  return selected;
}

async function main() {
  const tools = await findPostgres17Tools();
  const migrations = selectMigrations();
  const stub = readFileSync(STUB_SQL, "utf8");
  const supabaseCli = path.join(
    ROOT,
    "node_modules",
    ".bin",
    IS_WINDOWS ? "supabase.cmd" : "supabase",
  );
  if (!existsSync(supabaseCli)) {
    throw new Error(`Supabase CLI not found at ${supabaseCli}. Install dependencies locally first.`);
  }

  const tempRoot = existsSync(PREFERRED_TEMP_ROOT)
    ? PREFERRED_TEMP_ROOT
    : path.join(tmpdir(), "opencode");
  mkdirSync(tempRoot, { recursive: true });
  const dataDir = mkdtempSync(path.join(tempRoot, "dbtypes-pg-"));
  const logFile = path.join(dataDir, "server.log");
  let cleanup = async () => {};

  try {
    cleanup = async () => {
      try {
        await run(tools.pg_ctl, ["-D", dataDir, "-m", "immediate", "-w", "-t", "20", "stop"], {
          timeoutMs: 30_000,
        });
      } catch {
        // Cluster never started or is already gone.
      }
      try {
        rmSync(dataDir, { recursive: true, force: true });
      } catch {
        // Best effort cleanup.
      }
    };

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
      throw new Error(
        `pg_ctl start failed (exit ${start.code}):\n${start.stdout}\n${start.stderr}\n${log}`,
      );
    }
    console.log(`Temporary PostgreSQL 17 cluster listening on 127.0.0.1:${port}`);

    const applySql = async (sql, label) => {
      const result = await run(
        tools.psql,
        [
          "-h", "127.0.0.1",
          "-p", String(port),
          "-U", "postgres",
          "-d", "postgres",
          "-w",
          "-1",
          "-v", "ON_ERROR_STOP=1",
        ],
        { timeoutMs: 60_000, input: sql },
      );
      if (result.code !== 0) {
        throw new Error(`Applying ${label} failed (exit ${result.code}):\n${result.stdout}\n${result.stderr}`);
      }
    };

    await applySql(stub, "Supabase stub SQL");
    for (const name of migrations) {
      await applySql(readFileSync(path.join(MIGRATIONS_DIR, name), "utf8"), name);
    }
    console.log(`Applied Supabase stub and ${migrations.length} migrations: ${migrations.join(", ")}`);

    const cliArgs = [
      "gen", "types", "typescript",
      "--schema", "public",
      "--query-timeout", "60s",
      "--log-level", "error",
      `--remote=postgresql://postgres@127.0.0.1:${port}/postgres`,
    ];
    // Node cannot spawn a Windows .cmd shim directly (EINVAL); shell:true lets
    // cmd.exe resolve the shim, which in turn runs the installed Supabase CLI.
    const generated = IS_WINDOWS
      ? await run(`"${supabaseCli}" ${cliArgs.join(" ")}`, [], {
          timeoutMs: 120_000,
          shell: true,
        })
      : await run(supabaseCli, cliArgs, { timeoutMs: 120_000 });
    if (generated.code !== 0) {
      throw new Error(
        `Supabase type generation failed (exit ${generated.code}):\n${generated.stdout}\n${generated.stderr}`,
      );
    }
    if (!generated.stdout.includes("export type Database")) {
      throw new Error(
        `Generated output does not contain "export type Database":\n${generated.stdout}\n${generated.stderr}`,
      );
    }

    writeFileSync(OUTPUT_FILE, generated.stdout, "utf8");
    const lines = generated.stdout.split("\n").length - 1;
    console.log(`Wrote ${path.relative(ROOT, OUTPUT_FILE)} (${lines} lines) from generated stdout.`);
    if (generated.stderr.trim()) {
      console.log(`Supabase CLI stderr:\n${generated.stderr.trim()}`);
    }
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(`Database type generation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
