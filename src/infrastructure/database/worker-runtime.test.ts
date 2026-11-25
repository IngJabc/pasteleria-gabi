import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createRuntimeHealthSnapshot,
  createUnifiedWorkerRuntime,
  startRuntimeHealthServer,
  superviseWorker,
  validateRuntimeEnv,
} from "../../../supabase/worker/runtime.mjs";

type HealthServerOptions = Parameters<typeof startRuntimeHealthServer>[0];

function makeWorker(name: string) {
  let running = false;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const start = vi.fn(async () => {
    running = true;
  });
  const stop = vi.fn(async () => {
    running = false;
    resolveDone();
  });
  return {
    name,
    start,
    stop,
    done,
    isRunning: () => running,
    resolveDone,
  };
}

function makeSupabaseStub() {
  return {
    rpc: vi.fn(),
    from: vi.fn(() => ({
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          maybeSingle: vi.fn(),
        })),
      })),
    })),
  };
}

function runtimeEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    PORT: "0",
    ...overrides,
  } as unknown as NodeJS.ProcessEnv;
}

const servers: Array<{ close: () => Promise<void> }> = [];

async function startTestHealthServer(options: unknown) {
  const server = await startRuntimeHealthServer({
    ...(options as HealthServerOptions),
    host: "127.0.0.1",
  });
  servers.push(server);
  return server;
}

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (server) {
      try {
        await server.close();
      } catch {
        // Already closed by runtime shutdown.
      }
    }
  }
});

describe("worker runtime", () => {
  it("validates required env vars without exposing values", () => {
    expect(() =>
      validateRuntimeEnv({
        NEXT_PUBLIC_SUPABASE_URL: "",
        SUPABASE_SERVICE_ROLE_KEY: "secret",
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);

    try {
      validateRuntimeEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "",
      } as unknown as NodeJS.ProcessEnv);
      throw new Error("expected env validation failure");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("SUPABASE_SERVICE_ROLE_KEY");
      expect(message).not.toContain("secret");
    }

    const config = validateRuntimeEnv(runtimeEnv({ SLA_POLL_MS: "60000" }));
    expect(config.slaPollMs).toBe(60000);
    expect(config.port).toBe(0);
  });

  it("exposes backward-compatible /healthz and does not trigger workers", async () => {
    const getWorkers = vi.fn(() => ({
      "bcv-sync": { status: "running", restartCount: 0, lastError: null },
      "receipt-sla": { status: "running", restartCount: 0, lastError: null },
    }));
    const server = await startRuntimeHealthServer({
      port: 0,
      host: "127.0.0.1",
      startedAt: new Date("2026-11-24T13:00:00.000Z"),
      now: () => new Date("2026-11-24T13:00:30.000Z"),
      getWorkers,
    });
    servers.push(server);

    const res = await fetch(`http://127.0.0.1:${server.port}/healthz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.service).toBe("bcv-sync");
    expect(body.uptime_seconds).toBe(30);
    expect(body.runtime).toBe("pasteleria-worker-runtime");
    expect(body.workers).toBeTruthy();
    expect(getWorkers).toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toMatch(
      /SUPABASE|service_role|secret|key|token|NEXT_PUBLIC|DATABASE/i,
    );

    const notFound = await fetch(`http://127.0.0.1:${server.port}/unknown`);
    expect(notFound.status).toBe(404);
  });

  it("creates health snapshot with additive worker info while preserving BCV fields", () => {
    const snapshot = createRuntimeHealthSnapshot({
      startedAt: new Date("2026-11-24T13:00:00.000Z"),
      now: () => new Date("2026-11-24T13:00:05.000Z"),
      workers: { "bcv-sync": { status: "running" } },
    });
    expect(snapshot).toMatchObject({
      status: "ok",
      service: "bcv-sync",
      uptime_seconds: 5,
      runtime: "pasteleria-worker-runtime",
    });
  });

  it("supervises workers with failure isolation and restart", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    let createCount = 0;
    const first = makeWorker("bcv-sync");
    const second = makeWorker("bcv-sync");

    const supervisor = superviseWorker({
      name: "bcv-sync",
      logger,
      restartDelayMs: 0,
      beforeRestart: async () => {},
      create: () => {
        createCount += 1;
        if (createCount === 1) {
          first.start.mockImplementationOnce(async () => {
            throw new Error("boom");
          });
          return first;
        }
        return second;
      },
    });

    void supervisor.start();
    await vi.waitFor(() => expect(createCount).toBeGreaterThanOrEqual(2));
    await vi.waitFor(() => expect(second.start).toHaveBeenCalledTimes(1));
    expect(logger.error).toHaveBeenCalledWith(
      "worker_start_failed",
      expect.objectContaining({ supervised_worker: "bcv-sync" }),
    );

    await supervisor.stop("test");
    expect(second.stop).toHaveBeenCalled();
  });

  it("starts both workers independently and isolates start failure", async () => {
    const sla = makeWorker("receipt-sla");
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const runtime = createUnifiedWorkerRuntime({
      env: runtimeEnv(),
      logger,
      now: () => new Date("2026-11-24T13:00:00.000Z"),
      createClientImpl: vi.fn(() => makeSupabaseStub()),
      startHealthServer: startTestHealthServer,
      createBcvWorker: vi.fn((config: unknown) => {
        void config;
        throw new Error("bcv init failed");
      }),
      createSlaWorkerImpl: vi.fn((config: unknown) => {
        void config;
        return sla;
      }),
    });

    const started = await runtime.start();
    expect(started.port).toBeGreaterThan(0);

    await vi.waitFor(() => expect(sla.start).toHaveBeenCalledTimes(1));
    expect(runtime.getWorkerStates()["receipt-sla"].status).not.toBe("created");

    await runtime.stop("test");
    expect(sla.stop).toHaveBeenCalled();
  });

  it("does not treat a long-running start promise as a startup block", async () => {
    const bcv = makeWorker("bcv-sync");
    const sla = makeWorker("receipt-sla");
    // The real SLA worker returns its loop lifetime from start().
    sla.start.mockImplementation(async () => {
      await sla.done;
    });

    const runtime = createUnifiedWorkerRuntime({
      env: runtimeEnv(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      createClientImpl: vi.fn(() => makeSupabaseStub()),
      startHealthServer: startTestHealthServer,
      createBcvWorker: vi.fn((config: unknown) => {
        void config;
        return bcv;
      }),
      createSlaWorkerImpl: vi.fn((config: unknown) => {
        void config;
        return sla;
      }),
    });

    await runtime.start();
    await vi.waitFor(() => expect(runtime.getWorkerStates()["receipt-sla"].status).toBe("running"));
    expect(sla.stop).not.toHaveBeenCalled();

    await runtime.stop("test");
    expect(sla.stop).toHaveBeenCalledTimes(1);
  });

  it("passes independent schedule configuration to both workers", async () => {
    const bcv = makeWorker("bcv-sync");
    const sla = makeWorker("receipt-sla");
    const bcvFactory = vi.fn((config: unknown) => {
      void config;
      return bcv;
    });
    const slaFactory = vi.fn((config: unknown) => {
      void config;
      return sla;
    });

    const runtime = createUnifiedWorkerRuntime({
      env: runtimeEnv({
        SLA_POLL_MS: "60000",
        SLA_SHUTDOWN_TIMEOUT_MS: "2000",
        BCV_SYNC_FETCH_TIMEOUT_MS: "3000",
        BCV_SYNC_SHUTDOWN_TIMEOUT_MS: "4000",
      }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      createClientImpl: vi.fn(() => makeSupabaseStub()),
      startHealthServer: startTestHealthServer,
      createBcvWorker: bcvFactory,
      createSlaWorkerImpl: slaFactory,
    });

    await runtime.start();
    await vi.waitFor(() => expect(bcvFactory).toHaveBeenCalled());
    await vi.waitFor(() => expect(slaFactory).toHaveBeenCalled());

    const bcvArgs = bcvFactory.mock.calls[0][0] as Record<string, unknown>;
    expect(bcvArgs).toMatchObject({ fetchTimeoutMs: 3000, shutdownTimeoutMs: 4000 });
    expect(bcvArgs.healthPort).toBeUndefined();
    expect(bcvArgs.healthHost).toBeUndefined();
    expect(slaFactory.mock.calls[0][0]).toMatchObject({
      pollMs: 60000,
      shutdownTimeoutMs: 2000,
    });

    await runtime.stop("test");
  });

  it("shutdown is idempotent and closes both workers and health server", async () => {
    const bcv = makeWorker("bcv-sync");
    const sla = makeWorker("receipt-sla");
    const healthClose = vi.fn(async () => {});

    const runtime = createUnifiedWorkerRuntime({
      env: runtimeEnv(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      createClientImpl: vi.fn(() => makeSupabaseStub()),
      startHealthServer: vi.fn(async (options: unknown) => {
        void options;
        return { port: 12345, host: "127.0.0.1", close: healthClose };
      }),
      createBcvWorker: vi.fn((config: unknown) => {
        void config;
        return bcv;
      }),
      createSlaWorkerImpl: vi.fn((config: unknown) => {
        void config;
        return sla;
      }),
    });

    await runtime.start();
    await vi.waitFor(() => expect(bcv.start).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(sla.start).toHaveBeenCalledTimes(1));

    await Promise.all([runtime.stop("SIGTERM"), runtime.stop("SIGTERM")]);
    expect(bcv.stop).toHaveBeenCalledTimes(1);
    expect(sla.stop).toHaveBeenCalledTimes(1);
    expect(healthClose).toHaveBeenCalledTimes(1);
  });

  it("health requests do not trigger worker cycles", async () => {
    const bcv = makeWorker("bcv-sync");
    const sla = makeWorker("receipt-sla");
    const bcvFactory = vi.fn((config: unknown) => {
      void config;
      return bcv;
    });
    const slaFactory = vi.fn((config: unknown) => {
      void config;
      return sla;
    });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const runtime = createUnifiedWorkerRuntime({
      env: runtimeEnv(),
      logger,
      createClientImpl: vi.fn(() => makeSupabaseStub()),
      startHealthServer: startTestHealthServer,
      createBcvWorker: bcvFactory,
      createSlaWorkerImpl: slaFactory,
    });

    const { port } = await runtime.start();
    await vi.waitFor(() => expect(bcv.isRunning()).toBe(true));
    await vi.waitFor(() => expect(sla.isRunning()).toBe(true));
    await fetch(`http://127.0.0.1:${port}/healthz`);
    await fetch(`http://127.0.0.1:${port}/healthz/`);

    expect(bcvFactory).toHaveBeenCalledTimes(1);
    expect(slaFactory).toHaveBeenCalledTimes(1);
    expect(bcv.start).toHaveBeenCalledTimes(1);
    expect(sla.start).toHaveBeenCalledTimes(1);
    expect(runtime.getWorkerStates()["bcv-sync"].status).toBe("running");
    expect(runtime.getWorkerStates()["receipt-sla"].status).toBe("running");

    await runtime.stop("test");
  });
});
