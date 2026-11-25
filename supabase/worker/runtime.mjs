/**
 * Unified Render Web Service runtime for Pastelería background workers.
 *
 * Runs BCV exchange-rate sync and OQ-16 receipt-SLA notifications in the same
 * Node.js process with a single HTTP server and /healthz endpoint.
 *
 * Design constraints:
 * - One Render Web Service / one process / one port / one /healthz endpoint.
 * - Workers start independently; a failure in one must not prevent the other.
 * - Each worker keeps its own schedule, lifecycle, and business semantics.
 * - Health requests never trigger worker cycles.
 * - Shutdown is idempotent and coordinates HTTP server + both workers.
 * - No detached child processes, no shell background execution.
 *
 * Render Free limitation: the service may sleep after inactivity. Missed fixed
 * schedule slots/cycles are intentionally not replayed after restart.
 */

import { createClient } from "@supabase/supabase-js";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CARACAS_TIME_ZONE,
  DEFAULT_FETCH_TIMEOUT_MS as BCV_DEFAULT_FETCH_TIMEOUT_MS,
  DEFAULT_SHUTDOWN_TIMEOUT_MS as BCV_DEFAULT_SHUTDOWN_TIMEOUT_MS,
  SCHEDULE_SLOTS as BCV_SCHEDULE_SLOTS,
  WORKER_NAME as BCV_WORKER_NAME,
  createBcvSyncWorker,
  createLogger as createBcvLogger,
  sanitizeErrorDetail,
} from "./bcv-rate-worker.mjs";

import {
  DEFAULT_POLL_MS as SLA_DEFAULT_POLL_MS,
  DEFAULT_SHUTDOWN_TIMEOUT_MS as SLA_DEFAULT_SHUTDOWN_TIMEOUT_MS,
  WORKER_NAME as SLA_WORKER_NAME,
  createLogger as createSlaLogger,
  createSlaWorker,
} from "./sla-worker.mjs";

export const RUNTIME_NAME = "pasteleria-worker-runtime";
export const DEFAULT_HEALTH_HOST = "0.0.0.0";

function positiveInt(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizePort(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error("PORT must be a valid TCP port");
  }
  return parsed;
}

export function createRuntimeLogger({
  now = () => new Date(),
  write = (line) => console.log(line),
} = {}) {
  function emit(level, event, fields) {
    write(
      JSON.stringify({
        timestamp: now().toISOString(),
        level,
        worker: RUNTIME_NAME,
        event,
        ...(fields ?? {}),
      }),
    );
  }
  return {
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
  };
}

/** Safe startup validation. Error messages name missing vars, never values. */
export function validateRuntimeEnv(env = process.env) {
  const missing = [];
  if (!env.NEXT_PUBLIC_SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}`,
    );
  }

  const port = normalizePort(env.PORT);
  const slaPollMs = positiveInt(env.SLA_POLL_MS, SLA_DEFAULT_POLL_MS);
  const slaShutdownTimeoutMs = positiveInt(
    env.SLA_SHUTDOWN_TIMEOUT_MS,
    SLA_DEFAULT_SHUTDOWN_TIMEOUT_MS,
  );
  const bcvFetchTimeoutMs = positiveInt(
    env.BCV_SYNC_FETCH_TIMEOUT_MS,
    BCV_DEFAULT_FETCH_TIMEOUT_MS,
  );
  const bcvShutdownTimeoutMs = positiveInt(
    env.BCV_SYNC_SHUTDOWN_TIMEOUT_MS,
    BCV_DEFAULT_SHUTDOWN_TIMEOUT_MS,
  );

  return {
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    port,
    host: DEFAULT_HEALTH_HOST,
    slaPollMs,
    slaShutdownTimeoutMs,
    bcvFetchTimeoutMs,
    bcvShutdownTimeoutMs,
  };
}

export function createRuntimeHealthSnapshot({
  startedAt,
  now = () => new Date(),
  workers = {},
}) {
  return {
    // Backward-compatible fields preserved for existing BCV /healthz monitors.
    status: "ok",
    service: BCV_WORKER_NAME,
    uptime_seconds: Math.max(
      0,
      Math.floor((now().getTime() - startedAt.getTime()) / 1000),
    ),
    // Additive, non-sensitive runtime details.
    runtime: RUNTIME_NAME,
    workers,
  };
}

export function startRuntimeHealthServer({
  port = 0,
  host = DEFAULT_HEALTH_HOST,
  startedAt = new Date(),
  now = () => new Date(),
  getWorkers = () => ({}),
} = {}) {
  const server = http.createServer((req, res) => {
    const method = req.method === "HEAD" ? "HEAD" : req.method;
    let pathname = "/";
    try {
      pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    } catch {
      pathname = req.url ?? "/";
    }

    if (
      (method === "GET" || method === "HEAD") &&
      (pathname === "/healthz" || pathname === "/healthz/")
    ) {
      const body = JSON.stringify(
        createRuntimeHealthSnapshot({
          startedAt,
          now,
          workers: getWorkers(),
        }),
      );
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Length": Buffer.byteLength(body),
      });
      res.end(method === "HEAD" ? undefined : body);
      return;
    }

    const notFound = JSON.stringify({ status: "not_found" });
    res.writeHead(404, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Length": Buffer.byteLength(notFound),
    });
    res.end(method === "HEAD" ? undefined : notFound);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      resolve({
        port: typeof address === "object" && address ? address.port : port,
        host,
        close: () =>
          new Promise((resolveClose, rejectClose) => {
            server.close((error) => {
              if (error) rejectClose(error);
              else resolveClose();
            });
          }),
      });
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Supervise a worker factory so unexpected exit/failure does not take down the
 * other worker. The supervised worker can be stopped idempotently.
 */
export function superviseWorker({
  name,
  create,
  logger = createRuntimeLogger(),
  restartDelayMs = 1000,
  beforeRestart = () => delay(restartDelayMs),
} = {}) {
  let stopping = false;
  let started = false;
  let current = null;
  let currentDone = Promise.resolve();
  let restartCount = 0;

  const state = {
    name,
    status: "created",
    restartCount: 0,
    lastError: null,
  };

  async function runLoop() {
    while (!stopping) {
      let instance;
      let startupFailed = true;
      try {
        instance = create();
        current = instance;
        state.status = "starting";
        state.lastError = null;

        // `start()` may resolve immediately (BCV) or return the worker's
        // long-running loop (SLA). Never await that returned promise as a
        // startup gate; watch `done` for lifetime completion and only react to
        // a rejected start promise as a startup failure.
        let rejectStartFailure;
        const startFailure = new Promise((_, reject) => {
          rejectStartFailure = reject;
        });
        const startResult = instance.start();
        startupFailed = false;
        if (startResult && typeof startResult.then === "function") {
          void startResult.catch((error) => {
            if (stopping || current !== instance) return;
            startupFailed = true;
            state.lastError = sanitizeErrorDetail(
              error instanceof Error ? error.message : String(error),
            );
            rejectStartFailure(error);
          });
        }
        state.status = "running";

        await Promise.race([instance.done, startFailure]);
      } catch (error) {
        state.status = startupFailed ? "start_failed" : "failed";
        if (!startupFailed) {
          state.lastError = sanitizeErrorDetail(
            error instanceof Error ? error.message : String(error),
          );
        }
        logger.error(startupFailed ? "worker_start_failed" : "worker_failed", {
          supervised_worker: name,
          error: state.lastError,
          restart_count: restartCount,
        });

        if (instance && current === instance && instance.stop) {
          try {
            await instance.stop("supervisor_failure");
          } catch (stopError) {
            logger.error("worker_failure_stop_error", {
              supervised_worker: name,
              error: sanitizeErrorDetail(
                stopError instanceof Error ? stopError.message : String(stopError),
              ),
            });
          }
        }
        if (stopping) break;
        restartCount += 1;
        state.restartCount = restartCount;
        await beforeRestart({ name, restartCount, error });
        continue;
      } finally {
        if (current === instance) current = null;
      }

      if (stopping) {
        state.status = "stopped";
        break;
      }
      state.status = "exited";
      logger.warn("worker_exited_unexpectedly", {
        supervised_worker: name,
        restart_count: restartCount,
      });
      restartCount += 1;
      state.restartCount = restartCount;
      await beforeRestart({ name, restartCount });
    }
    if (stopping) state.status = "stopped";
  }

  return {
    start() {
      if (stopping) return currentDone;
      if (started) return currentDone;
      started = true;
      state.status = "starting";
      currentDone = runLoop().catch((error) => {
        state.status = "failed";
        state.lastError = sanitizeErrorDetail(
          error instanceof Error ? error.message : String(error),
        );
        logger.error("worker_supervisor_failed", {
          supervised_worker: name,
          error: state.lastError,
        });
      });
      return currentDone;
    },
    async stop(signal = "manual") {
      if (stopping) return currentDone;
      stopping = true;
      state.status = "stopping";
      try {
        if (current?.stop) {
          await current.stop(signal);
        }
      } catch (error) {
        logger.error("worker_stop_failed", {
          supervised_worker: name,
          signal,
          error: sanitizeErrorDetail(
            error instanceof Error ? error.message : String(error),
          ),
        });
      }
      await currentDone;
      state.status = "stopped";
    },
    getState() {
      return { ...state };
    },
    isRunning() {
      return current?.isRunning?.() ?? false;
    },
  };
}

export function createUnifiedWorkerRuntime({
  env = process.env,
  logger = createRuntimeLogger(),
  createClientImpl = createClient,
  createBcvWorker = createBcvSyncWorker,
  createSlaWorkerImpl = createSlaWorker,
  startHealthServer = startRuntimeHealthServer,
  now = () => new Date(),
  bcvLogger = createBcvLogger(),
  slaLogger = createSlaLogger(),
} = {}) {
  const config = validateRuntimeEnv(env);
  const supabase = createClientImpl(config.url, config.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  const rpc = (name, args) => supabase.rpc(name, args);
  const insertAttempt = (attempt) =>
    supabase.from("bcv_sync_attempts").insert(attempt).select("id").maybeSingle();

  const bcv = superviseWorker({
    name: BCV_WORKER_NAME,
    logger,
    create: () =>
      createBcvWorker({
        rpc,
        insertAttempt,
        supabase,
        logger: bcvLogger,
        fetchTimeoutMs: config.bcvFetchTimeoutMs,
        shutdownTimeoutMs: config.bcvShutdownTimeoutMs,
        // Health server is owned by the unified runtime.
      }),
  });

  const sla = superviseWorker({
    name: SLA_WORKER_NAME,
    logger,
    create: () =>
      createSlaWorkerImpl({
        rpc,
        logger: slaLogger,
        pollMs: config.slaPollMs,
        shutdownTimeoutMs: config.slaShutdownTimeoutMs,
      }),
  });

  let healthServer = null;
  let startedAt = now();
  let stopping = false;
  let stopped = false;
  let stopPromise = null;

  const getWorkers = () => ({
    [BCV_WORKER_NAME]: bcv.getState(),
    [SLA_WORKER_NAME]: sla.getState(),
  });

  async function start() {
    if (stopped) throw new Error("runtime has already been stopped");
    if (healthServer) return { port: healthServer.port };
    startedAt = now();

    if (config.port !== null) {
      healthServer = await startHealthServer({
        port: config.port,
        host: config.host,
        startedAt,
        now,
        getWorkers,
      });
      logger.info("health_server_started", {
        host: healthServer.host,
        port: healthServer.port,
      });
    } else {
      logger.warn("health_server_disabled", {
        reason: "PORT not set",
      });
    }

    // Start independently; supervision handles failures/restarts.
    void bcv.start();
    void sla.start();
    logger.info("runtime_started", {
      workers: [BCV_WORKER_NAME, SLA_WORKER_NAME],
      bcv_slots: BCV_SCHEDULE_SLOTS.map((slot) => slot.label),
      bcv_timezone: CARACAS_TIME_ZONE,
      sla_poll_ms: config.slaPollMs,
    });
    return { port: healthServer?.port ?? null };
  }

  async function stop(signal = "manual") {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      if (stopped) return;
      stopping = true;
      logger.info("runtime_shutdown", { signal });

      const results = await Promise.allSettled([
        bcv.stop(signal),
        sla.stop(signal),
      ]);
      for (const result of results) {
        if (result.status === "rejected") {
          logger.error("runtime_worker_shutdown_error", {
            error: sanitizeErrorDetail(
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
            ),
          });
        }
      }

      if (healthServer) {
        try {
          await healthServer.close();
          logger.info("health_server_stopped", { status: "stopped" });
        } catch (error) {
          logger.error("health_server_stop_error", {
            error: sanitizeErrorDetail(
              error instanceof Error ? error.message : String(error),
            ),
          });
        } finally {
          healthServer = null;
        }
      }

      stopped = true;
      stopping = false;
      logger.info("runtime_stopped", { status: "stopped" });
    })();
    return stopPromise;
  }

  return {
    start,
    stop,
    getHealthPort: () => healthServer?.port ?? null,
    getWorkerStates: getWorkers,
    isStopping: () => stopping,
  };
}

export async function main(env = process.env) {
  const config = validateRuntimeEnv(env);
  const logger = createRuntimeLogger();
  const runtime = createUnifiedWorkerRuntime({
    env,
    logger,
    bcvLogger: createBcvLogger(),
    slaLogger: createSlaLogger(),
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    void runtime
      .stop(signal)
      .then(() => process.exit(0))
      .catch((error) => {
        logger.error("runtime_fatal_shutdown_error", {
          error: sanitizeErrorDetail(
            error instanceof Error ? error.message : String(error),
          ),
        });
        process.exit(1);
      });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await runtime.start();
  logger.info("runtime_ready", {
    port: config.port,
    workers: [BCV_WORKER_NAME, SLA_WORKER_NAME],
  });

  // Keep process alive; workers manage their own schedules.
  await new Promise(() => {});
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  void main().catch((error) => {
    const message = sanitizeErrorDetail(
      error instanceof Error ? error.message : String(error),
    );
    console.error(
      JSON.stringify({
        event: "worker_fatal",
        worker: RUNTIME_NAME,
        error: message,
      }),
    );
    process.exit(1);
  });
}
