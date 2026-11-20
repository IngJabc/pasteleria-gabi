/**
 * OQ-16 — unit tests for the lightweight receipt-SLA worker.
 *
 * The worker is plain ESM (so it can run under `node` without Next.js's
 * `server-only` guard). These tests inject the clock, RPC, sleep and cycle so
 * no network, timers or 15-minute waits are involved.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  createLogger,
  createSlaWorker,
  defaultSleep,
  processSlaCycle,
  WORKER_NAME,
} from "../../../supabase/worker/sla-worker.mjs";

const workerSource = readFileSync(
  fileURLToPath(new URL("../../../supabase/worker/sla-worker.mjs", import.meta.url)),
  "utf8",
);

const METRICS = {
  bucket: 12345,
  pending_submissions: 3,
  due_submissions: 1,
  active_administrators: 2,
  notifications_created: 2,
  processed_at: "2026-11-20T12:00:00.000Z",
};

function fakeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("receipt-SLA worker", () => {
  it("emits structured single-line JSON logs without customer data", () => {
    const lines: string[] = [];
    const logger = createLogger({
      now: () => new Date("2026-11-20T12:00:00.000Z"),
      write: (line) => lines.push(line),
    });
    logger.info("worker_started", { poll_ms: 900_000 });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({
      timestamp: "2026-11-20T12:00:00.000Z",
      level: "info",
      worker: WORKER_NAME,
      event: "worker_started",
      poll_ms: 900_000,
    });
  });

  it("uses the Supabase service-role HTTP client, not a PG connection or Next-only module", () => {
    expect(workerSource).toContain('from "@supabase/supabase-js"');
    expect(workerSource).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(workerSource).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(workerSource).toContain("persistSession: false");
    expect(workerSource).toContain("autoRefreshToken: false");
    expect(workerSource).toContain('rpc("process_sla_notifications", { p_now: null })');
    // Prose comments mention these modules; assert there is no actual import.
    expect(workerSource).not.toMatch(/(?:import|require)\b[^\n]*(?:server-only|env\.server)/);
    expect(workerSource).not.toMatch(/postgres(?:ql)?:\/\//);
  });

  it("calls only the service-role SLA RPC with a null clock override", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: METRICS, error: null });
    const logger = fakeLogger();
    const metrics = await processSlaCycle({ rpc, logger, clock: () => new Date(0) });

    expect(rpc).toHaveBeenCalledExactlyOnceWith("process_sla_notifications", { p_now: null });
    expect(metrics).toEqual(METRICS);
    expect(logger.info).toHaveBeenCalledWith(
      "sla_cycle_complete",
      expect.objectContaining({ duration_ms: 0, ...METRICS }),
    );
  });

  it("fails closed on malformed RPC payloads and isolates the error to the cycle", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { bucket: 1 }, error: null });
    const logger = fakeLogger();
    await expect(processSlaCycle({ rpc, logger })).rejects.toThrow(
      "process_sla_notifications returned an invalid pending_submissions",
    );
    expect(logger.error).toHaveBeenCalledWith("sla_cycle_failed", expect.any(Object));
  });

  it("surfaces database errors from the RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "RPC unavailable" } });
    const logger = fakeLogger();
    await expect(processSlaCycle({ rpc, logger })).rejects.toThrow("RPC unavailable");
  });

  it("provides an abortable delay", async () => {
    const controller = new AbortController();
    const pending = defaultSleep(60_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow("aborted");
  });

  it("runs immediately, then polls at the configured interval without overlap", async () => {
    const logger = fakeLogger();
    let active = 0;
    let maxActive = 0;
    const deferred: { current: (() => void) | null } = { current: null };
    const runCycle = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => {
        deferred.current = resolve;
      });
      active -= 1;
      return METRICS;
    });
    const sleeping: number[] = [];
    const sleepRelease: { current: (() => void) | null } = { current: null };
    let blockFirstSleep = true;

    const worker = createSlaWorker({
      rpc: vi.fn(),
      logger,
      pollMs: 900_000,
      runCycle,
      sleep: async (ms, signal) => {
        sleeping.push(ms);
        if (blockFirstSleep) {
          return new Promise<void>((resolve) => {
            sleepRelease.current = resolve;
          });
        }
        if (sleeping.length > 3) {
          return new Promise<void>((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          });
        }
      },
    });

    const started = worker.start();
    await vi.waitFor(() => expect(runCycle).toHaveBeenCalledTimes(1));
    // The first cycle runs before any poll sleep is entered.
    expect(sleeping).toEqual([]);
    deferred.current?.();
    await vi.waitFor(() => expect(sleeping).toHaveLength(1));
    blockFirstSleep = false;
    sleepRelease.current?.();
    for (let i = 1; i < 4; i += 1) {
      await vi.waitFor(() => expect(runCycle).toHaveBeenCalledTimes(i + 1));
      deferred.current?.();
    }
    await vi.waitFor(() => expect(sleeping).toHaveLength(4));
    expect(sleeping).toEqual([900_000, 900_000, 900_000, 900_000]);
    expect(maxActive).toBe(1);

    await worker.stop("test");
    await started;
    expect(logger.info).toHaveBeenCalledWith("worker_stopped", { status: "stopped" });
  });

  it("does not stop the loop after a failed cycle", async () => {
    const logger = fakeLogger();
    const runCycle = vi.fn()
      .mockRejectedValueOnce(new Error("temporary RPC failure"))
      .mockResolvedValue(METRICS);
    let sleepCalls = 0;
    const worker = createSlaWorker({
      rpc: vi.fn(),
      logger,
      runCycle,
      sleep: async (_ms, signal) => {
        if ((sleepCalls += 1) === 1) return;
        return new Promise<void>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      },
    });

    const started = worker.start();
    await vi.waitFor(() => expect(runCycle).toHaveBeenCalledTimes(2));
    await worker.stop("test");
    await started;
    expect(runCycle).toHaveBeenCalledTimes(2);
  });

  it("waits for an in-flight cycle on graceful shutdown", async () => {
    const logger = fakeLogger();
    const releaseRef: { current: (() => void) | null } = { current: null };
    const runCycle = vi.fn(
      () =>
        new Promise<typeof METRICS>((resolve) => {
          releaseRef.current = () => resolve(METRICS);
        }),
    );
    const worker = createSlaWorker({
      rpc: vi.fn(),
      logger,
      runCycle,
      shutdownTimeoutMs: 1_000,
      sleep: async (_ms, signal) =>
        new Promise<void>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    });

    const started = worker.start();
    await vi.waitFor(() => expect(runCycle).toHaveBeenCalledTimes(1));
    const stopping = worker.stop("SIGTERM");
    expect(logger.info).toHaveBeenCalledWith(
      "worker_shutdown",
      expect.objectContaining({ signal: "SIGTERM", waiting_for_cycle: true }),
    );
    releaseRef.current?.();
    await stopping;
    await started;
    expect(logger.error).not.toHaveBeenCalledWith("worker_shutdown_timeout", expect.anything());
  });

  it("does not log a false timeout after a clean shutdown", async () => {
    const logger = fakeLogger();
    const releaseRef: { current: (() => void) | null } = { current: null };
    const runCycle = vi.fn(
      () =>
        new Promise<typeof METRICS>((resolve) => {
          releaseRef.current = () => resolve(METRICS);
        }),
    );
    const worker = createSlaWorker({
      rpc: vi.fn(),
      logger,
      runCycle,
      shutdownTimeoutMs: 10,
      sleep: async (_ms, signal) =>
        new Promise<void>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    });

    worker.start();
    await vi.waitFor(() => expect(runCycle).toHaveBeenCalledTimes(1));
    const stopping = worker.stop("SIGTERM");
    releaseRef.current?.();
    await stopping;
    // Outlive the (now-cancelled) shutdown timer: no delayed error may appear.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(logger.error).not.toHaveBeenCalledWith("worker_shutdown_timeout", expect.anything());
  });

  it("bounds shutdown when a cycle never completes", async () => {
    const logger = fakeLogger();
    const runCycle = vi.fn(() => new Promise<typeof METRICS>(() => undefined));
    const worker = createSlaWorker({
      rpc: vi.fn(),
      logger,
      runCycle,
      shutdownTimeoutMs: 5,
      sleep: async (ms, signal) =>
        new Promise<void>((resolve, reject) => {
          if (signal) {
            signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
            return;
          }
          setTimeout(resolve, ms);
        }),
    });

    worker.start();
    await vi.waitFor(() => expect(runCycle).toHaveBeenCalledTimes(1));
    await worker.stop("SIGINT");
    expect(logger.error).toHaveBeenCalledWith(
      "worker_shutdown_timeout",
      expect.objectContaining({ timeout_ms: 5 }),
    );
  });
});
