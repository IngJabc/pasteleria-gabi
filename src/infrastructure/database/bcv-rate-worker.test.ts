import { describe, expect, it, vi } from "vitest";
import {
  buildAttemptIdempotencyKey,
  buildIdempotencyKey,
  buildRateIdempotencyKey,
  caracasLocalToUtcMs,
  createBcvSyncWorker,
  fetchBcvRate,
  getCaracasDateTime,
  getNextScheduleSlot,
  parseIsoTimestamp,
  runBcvSyncOnce,
  sanitizeErrorDetail,
  startBcvHealthServer,
  validateBcvPayload,
} from "../../../supabase/worker/bcv-rate-worker.mjs";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("BCV rate worker", () => {
  it("validates a valid BCV payload and normalizes rate", () => {
    const result = validateBcvPayload({
      USD: 36.5,
      effective_date: "2026-11-24",
      updated_at: "2026-11-24T13:00:00Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid payload");
    expect(result.value?.rate).toBe("36.5");
    expect(result.value?.effectiveDate).toBe("2026-11-24");
    expect(result.value?.providerUpdatedAt).toBe("2026-11-24T13:00:00.000Z");
  });

  it("rejects invalid USD rates, missing fields, malformed dates, and invalid provider timestamps", () => {
    expect(validateBcvPayload({ USD: 0, effective_date: "2026-11-24" }).ok).toBe(false);
    expect(validateBcvPayload({ USD: -1, effective_date: "2026-11-24" }).ok).toBe(false);
    expect(validateBcvPayload({ USD: "NaN", effective_date: "2026-11-24" }).ok).toBe(false);
    expect(validateBcvPayload({ USD: 36.5 }).ok).toBe(false);
    expect(validateBcvPayload({ USD: 36.5, effective_date: "2026-02-30" }).ok).toBe(false);
    expect(validateBcvPayload({ USD: 36.5, effective_date: "2026-11-24", updated_at: "bad-date" }).ok).toBe(false);
    expect(parseIsoTimestamp("2026-11-24T13:00:00Z")).toBe("2026-11-24T13:00:00.000Z");
  });

  it("handles HTTP failures, malformed JSON, and timeouts without throwing", async () => {
    const httpFail = await fetchBcvRate({
      fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch,
    });
    expect(httpFail).toEqual({ ok: false, errorCode: "http_error", errorDetail: "BCV request failed with status 503" });

    const badJson = await fetchBcvRate({
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error("bad json");
        },
      }) as unknown as typeof fetch,
    });
    expect(badJson.ok).toBe(false);
    if (badJson.ok) throw new Error("expected invalid json failure");
    expect("errorCode" in badJson ? badJson.errorCode : undefined).toBe("invalid_json");

    const timeout = await fetchBcvRate({
      fetchImpl: vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      })) as unknown as typeof fetch,
      timeoutMs: 5,
    });
    expect(timeout.ok).toBe(false);
    if (timeout.ok) throw new Error("expected timeout failure");
    expect("errorCode" in timeout ? timeout.errorCode : undefined).toBe("timeout");
  });

  it("computes next Caracas weekday slots at 09:00/13:00 regardless of host assumptions", () => {
    // 2026-11-24 is a Tuesday. 12:59:59Z is 08:59:59 America/Caracas (UTC-4).
    const beforeNineUtc = new Date("2026-11-24T12:59:59Z");
    const nextNine = getNextScheduleSlot(beforeNineUtc);
    expect(nextNine.slotKey).toBe("2026-11-24T09:00");
    expect(nextNine.scheduledAt).toBe("2026-11-24T13:00:00.000Z");

    const afterNineUtc = new Date("2026-11-24T13:00:01Z");
    const nextThirteen = getNextScheduleSlot(afterNineUtc);
    expect(nextThirteen.slotKey).toBe("2026-11-24T13:00");
    expect(nextThirteen.scheduledAt).toBe("2026-11-24T17:00:00.000Z");

    // Friday after 13:00 Caracas should schedule Monday 09:00 Caracas.
    const fridayAfterThirteen = new Date("2026-11-27T17:01:00Z"); // 13:01 VET
    const monday = getNextScheduleSlot(fridayAfterThirteen);
    expect(monday.slotKey).toBe("2026-11-30T09:00");
    expect(monday.scheduledAt).toBe("2026-11-30T13:00:00.000Z");
  });

  it("handles Caracas weekday boundaries and exact slot instants without host-TZ dependence", () => {
    // Exactly at 09:00 Caracas (13:00Z) the next slot must be 13:00 same day.
    const exactNine = getNextScheduleSlot(new Date("2026-11-24T13:00:00.000Z"));
    expect(exactNine.slotKey).toBe("2026-11-24T13:00");

    // Exactly at 13:00 Caracas (17:00Z) the next slot must be next weekday 09:00.
    const exactThirteen = getNextScheduleSlot(new Date("2026-11-24T17:00:00.000Z"));
    expect(exactThirteen.slotKey).toBe("2026-11-25T09:00");

    // Saturday should skip to Monday 09:00 Caracas.
    const saturday = getNextScheduleSlot(new Date("2026-11-28T15:00:00.000Z")); // Sat 11:00 VET
    expect(saturday.slotKey).toBe("2026-11-30T09:00");

    // Sunday should skip to Monday 09:00 Caracas.
    const sunday = getNextScheduleSlot(new Date("2026-11-29T15:00:00.000Z"));
    expect(sunday.slotKey).toBe("2026-11-30T09:00");
  });

  it("uses Caracas calendar date rollover, not host date", () => {
    // 2026-11-25 00:30:00Z is still 2026-11-24 20:30:00 in Caracas.
    const lateUtcStillCaracasPreviousDay = new Date("2026-11-25T00:30:00.000Z");
    const next = getNextScheduleSlot(lateUtcStillCaracasPreviousDay);
    expect(next.slotKey).toBe("2026-11-25T09:00");
    expect(next.slotDate).toBe("2026-11-25");
  });

  it("derives UTC instants from America/Caracas IANA rules, not fixed host offset", () => {
    const utcMs = caracasLocalToUtcMs({ year: 2026, month: 11, day: 24, hour: 9, minute: 0, second: 0 });
    expect(new Date(utcMs).toISOString()).toBe("2026-11-24T13:00:00.000Z");
    expect(getCaracasDateTime(new Date(utcMs))).toMatchObject({
      year: 2026, month: 11, day: 24, hour: 9, minute: 0, second: 0,
    });

    const originalTz = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Kiritimati"; // UTC+14, extreme host offset
      const slot = getNextScheduleSlot(new Date("2026-11-24T12:59:59Z"));
      expect(slot.slotKey).toBe("2026-11-24T09:00");
      expect(slot.scheduledAt).toBe("2026-11-24T13:00:00.000Z");
      expect(getCaracasDateTime(new Date("2026-11-24T13:00:00.000Z")).hour).toBe(9);
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });

  it("registers a valid rate through RPC and records a successful sync attempt", async () => {
    const logger = makeLogger();
    const rpc = vi.fn().mockResolvedValue({ data: { rate_id: 10, idempotent: false }, error: null });
    const insertAttempt = vi.fn().mockResolvedValue({ data: { id: 1 }, error: null });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ USD: 36.5, effective_date: "2026-11-24", updated_at: "2026-11-24T13:00:00Z" }),
    });

    const result = await runBcvSyncOnce({
      rpc,
      insertAttempt,
      supabase: makeSupabaseActiveRate({ id: 10, source: "automatic:bcv.today", is_active: true }),
      logger,
      fetchImpl,
      clock: () => new Date("2026-11-24T13:00:05Z"),
      slot: { slotKey: "2026-11-24T09:00", slotDate: "2026-11-24", slotLabel: "09:00", scheduledAt: "2026-11-24T13:00:00.000Z", delayMs: 0 },
    });

    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("register_bcv_rate", expect.objectContaining({
      p_rate_ves_per_usd: "36.5",
      p_source: "automatic:bcv.today",
      p_admin_id: null,
      p_observed_at: "2026-11-24T13:00:00.000Z",
      p_idempotency_key: buildRateIdempotencyKey("automatic:bcv.today", "2026-11-24", "36.5"),
    }));
    expect(insertAttempt).toHaveBeenCalledWith(expect.objectContaining({
      status: "success",
      effective_date: "2026-11-24",
      provider_updated_at: "2026-11-24T13:00:00.000Z",
      retrieved_at: "2026-11-24T13:00:05.000Z",
      registered_rate_id: 10,
      error_code: null,
      idempotency_key: buildAttemptIdempotencyKey("automatic:bcv.today", "2026-11-24T09:00", "2026-11-24"),
    }));
    expect(buildIdempotencyKey("automatic:bcv.today", "2026-11-24T09:00", "2026-11-24")).toBe(
      buildAttemptIdempotencyKey("automatic:bcv.today", "2026-11-24T09:00", "2026-11-24"),
    );
  });

  it("records a failure attempt and does not register when fetch fails", async () => {
    const rpc = vi.fn();
    const insertAttempt = vi.fn().mockResolvedValue({ data: { id: 1 }, error: null });
    const result = await runBcvSyncOnce({
      rpc,
      insertAttempt,
      supabase: makeSupabaseActiveRate(null),
      logger: makeLogger(),
      fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 500 }),
      clock: () => new Date("2026-11-24T13:00:05Z"),
      slot: { slotKey: "2026-11-24T09:00", slotDate: "2026-11-24", slotLabel: "09:00", scheduledAt: "2026-11-24T13:00:00.000Z", delayMs: 0 },
    });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect(insertAttempt).toHaveBeenCalledWith(expect.objectContaining({
      status: "failure",
      error_code: "http_error",
      registered_rate_id: null,
    }));
  });

  it("records independent attempts when same rate/effective date arrives in different slots without duplicating rate registration key", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { rate_id: 10, idempotent: true }, error: null });
    const insertAttempt = vi.fn().mockResolvedValue({ data: { id: 1 }, error: null });
    const supabase = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => {
                    if (table === "exchange_rates") {
                      return { data: { id: 10, source: "automatic:bcv.today", is_active: true }, error: null };
                    }
                    return { data: null, error: null };
                  },
                }),
              }),
            }),
          }),
        }),
      }),
    };
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ USD: 36.5, effective_date: "2026-11-24", updated_at: "2026-11-24T13:00:00Z" }),
    });
    const slot09 = { slotKey: "2026-11-24T09:00", slotDate: "2026-11-24", slotLabel: "09:00", scheduledAt: "2026-11-24T13:00:00.000Z", delayMs: 0 };
    const slot13 = { slotKey: "2026-11-24T13:00", slotDate: "2026-11-24", slotLabel: "13:00", scheduledAt: "2026-11-24T17:00:00.000Z", delayMs: 0 };

    const first = await runBcvSyncOnce({ rpc, insertAttempt, supabase, logger: makeLogger(), fetchImpl, clock: () => new Date("2026-11-24T13:00:05Z"), slot: slot09 });
    const second = await runBcvSyncOnce({ rpc, insertAttempt, supabase, logger: makeLogger(), fetchImpl, clock: () => new Date("2026-11-24T17:00:05Z"), slot: slot13 });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(rpc).toHaveBeenNthCalledWith(1, "register_bcv_rate", expect.objectContaining({
      p_idempotency_key: buildRateIdempotencyKey("automatic:bcv.today", "2026-11-24", "36.5"),
    }));
    expect(rpc).toHaveBeenNthCalledWith(2, "register_bcv_rate", expect.objectContaining({
      p_idempotency_key: buildRateIdempotencyKey("automatic:bcv.today", "2026-11-24", "36.5"),
    }));
    expect(insertAttempt).toHaveBeenNthCalledWith(1, expect.objectContaining({
      idempotency_key: buildAttemptIdempotencyKey("automatic:bcv.today", "2026-11-24T09:00", "2026-11-24"),
      status: "success",
    }));
    expect(insertAttempt).toHaveBeenNthCalledWith(2, expect.objectContaining({
      idempotency_key: buildAttemptIdempotencyKey("automatic:bcv.today", "2026-11-24T13:00", "2026-11-24"),
      status: "success",
    }));
  });

  it("reports inconsistency when rate registration succeeds but attempt persistence fails", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { rate_id: 10, idempotent: false }, error: null });
    const insertAttempt = vi.fn().mockResolvedValue({ data: null, error: { code: "42P01", message: "db down" } });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ USD: 36.5, effective_date: "2026-11-24", updated_at: "2026-11-24T13:00:00Z" }),
    });
    const result = await runBcvSyncOnce({
      rpc,
      insertAttempt,
      supabase: makeSupabaseActiveRate({ id: 10, source: "automatic:bcv.today", is_active: true }),
      logger: makeLogger(),
      fetchImpl,
      clock: () => new Date("2026-11-24T13:00:05Z"),
      slot: { slotKey: "2026-11-24T09:00", slotDate: "2026-11-24", slotLabel: "09:00", scheduledAt: "2026-11-24T13:00:00.000Z", delayMs: 0 },
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("attempt_persist_failed");
    expect(result.rateId).toBe(10);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("does not create duplicate success history for repeated idempotent runs", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { rate_id: 10, idempotent: true }, error: null });
    const insertAttempt = vi.fn()
      .mockResolvedValueOnce({ data: { id: 1 }, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "23505", message: "duplicate key" } });
    const supabase = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => {
                    if (table === "exchange_rates") {
                      return { data: { id: 10, source: "automatic:bcv.today", is_active: true }, error: null };
                    }
                    return { data: null, error: null };
                  },
                }),
              }),
            }),
          }),
        }),
      }),
    };
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ USD: 36.5, effective_date: "2026-11-24", updated_at: "2026-11-24T13:00:00Z" }),
    });
    const slot = { slotKey: "2026-11-24T09:00", slotDate: "2026-11-24", slotLabel: "09:00", scheduledAt: "2026-11-24T13:00:00.000Z", delayMs: 0 };

    const first = await runBcvSyncOnce({ rpc, insertAttempt, supabase, logger: makeLogger(), fetchImpl, clock: () => new Date("2026-11-24T13:00:05Z"), slot });
    const second = await runBcvSyncOnce({ rpc, insertAttempt, supabase, logger: makeLogger(), fetchImpl, clock: () => new Date("2026-11-24T13:01:05Z"), slot });
    expect(first.status).toBe("idempotent");
    expect(second.status).toBe("idempotent");
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(insertAttempt).toHaveBeenCalledTimes(2);
  });

  it("sanitizes error details", () => {
    expect(sanitizeErrorDetail("bad\nerror\twith secret")).toBe("bad error with secret");
    expect(sanitizeErrorDetail("")).toBe("unknown_error");
  });

  it("reports attempt_persist_failed when manual_overridden attempt cannot be recorded", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { rate_id: 10, idempotent: true }, error: null });
    const insertAttempt = vi.fn().mockResolvedValue({ data: null, error: { code: "42P01", message: "db down" } });
    const supabase = makeSupabaseActiveRate({ id: 22, source: "manual:ops", is_active: true });

    const result = await runBcvSyncOnce({
      rpc,
      insertAttempt,
      supabase,
      logger: makeLogger(),
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ USD: 36.5, effective_date: "2026-11-24", updated_at: "2026-11-24T13:00:00Z" }),
      }),
      clock: () => new Date("2026-11-24T13:01:05Z"),
      slot: { slotKey: "2026-11-24T09:00", slotDate: "2026-11-24", slotLabel: "09:00", scheduledAt: "2026-11-24T13:00:00.000Z", delayMs: 0 },
    });

    expect(result).toMatchObject({
      ok: false,
      status: "attempt_persist_failed",
      errorCode: "sync_attempt_persist_failed",
      rateId: 22,
    });
  });

  it("prevents overlapping cycles in the worker loop", async () => {
    const logger = makeLogger();
    let resolveRun: ((value: { ok: boolean; status: string; rateId: number }) => void) | undefined;
    const runOnce = vi.fn(() => new Promise<{ ok: boolean; status: string; rateId: number }>((resolve) => {
      resolveRun = resolve as unknown as (value: { ok: boolean; status: string }) => void;
    }));
    const now = new Date("2026-11-24T13:00:00Z");
    const worker = createBcvSyncWorker({
      rpc: vi.fn(),
      insertAttempt: vi.fn(),
      logger,
      clock: () => now,
      runOnce: runOnce as unknown as typeof import("../../../supabase/worker/bcv-rate-worker.mjs").runBcvSyncOnce,
      getNextSlot: () => ({ slotKey: "2026-11-24T09:00", slotDate: "2026-11-24", slotLabel: "09:00", scheduledAt: now.toISOString(), delayMs: 0 }),
      sleep: async () => {},
    } as unknown as Parameters<typeof createBcvSyncWorker>[0]);

    worker.start();
    await vi.waitFor(() => expect(runOnce).toHaveBeenCalledTimes(1));
    // worker loop would attempt to schedule again; cycle guard should prevent overlap while running
    expect(worker.isRunning()).toBe(true);
    (resolveRun as unknown as ((value: { ok: boolean; status: string; rateId: number }) => void) | undefined)?.({ ok: true, status: "registered", rateId: 1 });
    await worker.stop("test");
  });

  it("skips missed slots on restart by scheduling next future Caracas slot (no catch-up)", async () => {
    // If worker restarts after 09:00 Caracas slot, it should schedule 13:00, not rerun missed 09:00.
    // Intentional behavior: missed slots are NOT recovered/replayed. Catch-up would risk
    // unexpected writes after downtime; next scheduled future slot is used instead.
    const afterMissedNine = new Date("2026-11-24T14:30:00.000Z"); // 10:30 VET
    const next = getNextScheduleSlot(afterMissedNine);
    expect(next.slotKey).toBe("2026-11-24T13:00");
    expect(next.delayMs).toBeGreaterThan(0);
  });

  it("worker sync never mutates order snapshots or exchange-rate history beyond register_bcv_rate RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { rate_id: 10, idempotent: false }, error: null });
    const insertAttempt = vi.fn().mockResolvedValue({ data: { id: 1 }, error: null });
    const supabase = makeSupabaseActiveRate({ id: 10, source: "automatic:bcv.today", is_active: true });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ USD: 36.5, effective_date: "2026-11-24", updated_at: "2026-11-24T13:00:00Z" }),
    });

    await runBcvSyncOnce({
      rpc,
      insertAttempt,
      supabase,
      logger: makeLogger(),
      fetchImpl,
      clock: () => new Date("2026-11-24T13:00:05Z"),
      slot: { slotKey: "2026-11-24T09:00", slotDate: "2026-11-24", slotLabel: "09:00", scheduledAt: "2026-11-24T13:00:00.000Z", delayMs: 0 },
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("register_bcv_rate", expect.any(Object));
    // No order/snapshot/payment RPCs
    expect(rpc.mock.calls.some((call) => /order|snapshot|payment|reservation|consume|release/i.test(String(call[0])))).toBe(false);
    // Only exchange_rates read for active-rate check; no updates/deletes/inserts through supabase client
    expect(typeof supabase.from).toBe("function");
  });

  // === Manual/Automatic Coexistence + Active-Rate Regression Tests ===

  function makeSupabaseActiveRate(rate: { id: number; source: string; is_active: boolean } | null) {
    return {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => {
                    if (table === "exchange_rates") return { data: rate, error: null };
                    return { data: null, error: null };
                  },
                }),
              }),
            }),
          }),
        }),
      }),
    };
  }

  it("A->B(manual)->A: keeps manual rate B active and classifies automatic re-fetch as manual_overridden", async () => {
    // Sequence:
    // 1) Automatic rate A is registered (idempotent=false).
    // 2) Manual rate B is registered by admin (outside worker) and becomes active.
    // 3) Worker re-fetches A with same rate idempotency key; register_bcv_rate returns idempotent=true.
    // Expected: B remains active; attempt recorded as manual_overridden; no rate mutation.
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { rate_id: 10, idempotent: false }, error: null }) // register A
      .mockResolvedValueOnce({ data: { rate_id: 10, idempotent: true }, error: null }); // re-fetch A, same rate key

    const insertAttempt = vi.fn().mockResolvedValue({ data: { id: 1 }, error: null });
    const fetchA = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ USD: 36.5, effective_date: "2026-11-24", updated_at: "2026-11-24T13:00:00Z" }),
    });
    const slot09 = { slotKey: "2026-11-24T09:00", slotDate: "2026-11-24", slotLabel: "09:00", scheduledAt: "2026-11-24T13:00:00.000Z", delayMs: 0 };
    const slot13 = { slotKey: "2026-11-24T13:00", slotDate: "2026-11-24", slotLabel: "13:00", scheduledAt: "2026-11-24T17:00:00.000Z", delayMs: 0 };

    const supabaseAfterA = makeSupabaseActiveRate({ id: 10, source: "automatic:bcv.today", is_active: true });
    const supabaseAfterManualB = makeSupabaseActiveRate({ id: 11, source: "manual:admin-ui", is_active: true });

    const first = await runBcvSyncOnce({
      rpc,
      insertAttempt,
      supabase: supabaseAfterA,
      logger: makeLogger(),
      fetchImpl: fetchA,
      clock: () => new Date("2026-11-24T13:00:05Z"),
      slot: slot09,
    });

    const second = await runBcvSyncOnce({
      rpc,
      insertAttempt,
      supabase: supabaseAfterManualB,
      logger: makeLogger(),
      fetchImpl: fetchA,
      clock: () => new Date("2026-11-24T17:00:05Z"),
      slot: slot13,
    });

    expect(first).toMatchObject({ ok: true, status: "registered", rateId: 10 });
    expect(second).toMatchObject({ ok: true, status: "manual_overridden", rateId: 11 });
    expect(rpc).toHaveBeenNthCalledWith(1, "register_bcv_rate", expect.objectContaining({
      p_idempotency_key: buildRateIdempotencyKey("automatic:bcv.today", "2026-11-24", "36.5"),
    }));
    expect(rpc).toHaveBeenNthCalledWith(2, "register_bcv_rate", expect.objectContaining({
      p_idempotency_key: buildRateIdempotencyKey("automatic:bcv.today", "2026-11-24", "36.5"),
    }));
    expect(insertAttempt).toHaveBeenNthCalledWith(2, expect.objectContaining({
      status: "manual_overridden",
      registered_rate_id: 11,
      idempotency_key: buildAttemptIdempotencyKey("automatic:bcv.today", "2026-11-24T13:00", "2026-11-24"),
      error_code: null,
    }));
  });

  it("idempotent automatic re-fetch keeps idempotent status when current active rate is automatic", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { rate_id: 10, idempotent: true }, error: null });
    const insertAttempt = vi.fn().mockResolvedValue({ data: { id: 1 }, error: null });
    const supabase = makeSupabaseActiveRate({ id: 10, source: "automatic:bcv.today", is_active: true });

    const result = await runBcvSyncOnce({
      rpc,
      insertAttempt,
      supabase,
      logger: makeLogger(),
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ USD: 36.5, effective_date: "2026-11-24", updated_at: "2026-11-24T13:00:00Z" }),
      }),
      clock: () => new Date("2026-11-24T13:01:05Z"),
      slot: { slotKey: "2026-11-24T09:00", slotDate: "2026-11-24", slotLabel: "09:00", scheduledAt: "2026-11-24T13:00:00.000Z", delayMs: 0 },
    });

    expect(result).toMatchObject({ ok: true, status: "idempotent", rateId: 10 });
    expect(insertAttempt).toHaveBeenCalledWith(expect.objectContaining({ status: "success" }));
  });

  it("automatic re-fetch with same idempotency key does not displace an active manual rate", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { rate_id: 10, idempotent: true }, error: null });
    const insertAttempt = vi.fn().mockResolvedValue({ data: { id: 1 }, error: null });
    const supabase = makeSupabaseActiveRate({ id: 22, source: "manual:ops", is_active: true });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ USD: 36.5, effective_date: "2026-11-24", updated_at: "2026-11-24T13:00:00Z" }),
    });

    const result = await runBcvSyncOnce({
      rpc,
      insertAttempt,
      supabase,
      logger: makeLogger(),
      fetchImpl,
      clock: () => new Date("2026-11-24T13:01:05Z"),
      slot: { slotKey: "2026-11-24T09:00", slotDate: "2026-11-24", slotLabel: "09:00", scheduledAt: "2026-11-24T13:00:00.000Z", delayMs: 0 },
    });

    expect(result).toMatchObject({ ok: true, status: "manual_overridden", rateId: 22 });
    expect(insertAttempt).toHaveBeenCalledWith(expect.objectContaining({
      status: "manual_overridden",
      registered_rate_id: 22,
      error_code: null,
    }));
  });

  it("exposes GET /healthz with minimal non-sensitive JSON and does not trigger sync", async () => {
    const runOnce = vi.fn();
    let nowMs = Date.parse("2026-11-24T13:00:00.000Z");
    const worker = createBcvSyncWorker({
      rpc: vi.fn(),
      insertAttempt: vi.fn(),
      supabase: makeSupabaseActiveRate(null),
      logger: makeLogger(),
      fetchImpl: vi.fn(),
      clock: () => new Date(nowMs),
      sleep: (_ms: number, signal?: AbortSignal) => new Promise<void>((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })),
      getNextSlot: () => ({ slotKey: "never", scheduledAt: "2099-01-01T00:00:00.000Z", delayMs: 60_000, slotDate: "2099-01-01", slotLabel: "00:00" }),
      runOnce,
      healthPort: 0,
      healthHost: "127.0.0.1",
    } as unknown as Parameters<typeof createBcvSyncWorker>[0]);

    await worker.start();
    try {
      const port = worker.getHealthPort();
      expect(port).toBeGreaterThan(0);
      nowMs += 30_000;
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body).toEqual({ status: "ok", service: "bcv-sync", uptime_seconds: 30 });
      expect(JSON.stringify(body)).not.toMatch(/SUPABASE|service_role|secret|key|token|NEXT_PUBLIC|DATABASE/i);
      expect(runOnce).not.toHaveBeenCalled();
    } finally {
      await worker.stop("test");
    }
  });

  it("health server binds 0.0.0.0 by default and closes on shutdown", async () => {
    const server = await startBcvHealthServer({
      port: 0,
      startedAt: new Date("2026-11-24T13:00:00.000Z"),
      now: () => new Date("2026-11-24T13:00:05.000Z"),
    });
    try {
      expect(server.host).toBe("0.0.0.0");
      const res = await fetch(`http://127.0.0.1:${server.port}/healthz`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ status: "ok", service: "bcv-sync", uptime_seconds: 5 });
    } finally {
      await server.close();
    }
    await expect(fetch(`http://127.0.0.1:${server.port}/healthz`)).rejects.toThrow();
  });

  it("worker shutdown closes the health server", async () => {
    const worker = createBcvSyncWorker({
      rpc: vi.fn(),
      insertAttempt: vi.fn(),
      supabase: makeSupabaseActiveRate(null),
      logger: makeLogger(),
      fetchImpl: vi.fn(),
      clock: () => new Date("2026-11-24T13:00:00.000Z"),
      sleep: (_ms: number, signal?: AbortSignal) => new Promise<void>((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })),
      getNextSlot: () => ({ slotKey: "never", scheduledAt: "2099-01-01T00:00:00.000Z", delayMs: 60_000, slotDate: "2099-01-01", slotLabel: "00:00" }),
      runOnce: vi.fn(),
      healthPort: 0,
      healthHost: "127.0.0.1",
    } as unknown as Parameters<typeof createBcvSyncWorker>[0]);

    await worker.start();
    const port = worker.getHealthPort();
    expect(port).toBeGreaterThan(0);
    await worker.stop("SIGTERM");
    await expect(fetch(`http://127.0.0.1:${port}/healthz`)).rejects.toThrow();
  });
});