/**
 * Automatic BCV rate synchronization worker (backend only).
 *
 * Runs on a fixed Caracas schedule: Monday-Friday 09:00 and 13:00
 * America/Caracas. It does not poll every 30 minutes and does not depend on the
 * host timezone. The worker fetches BCV Today, validates the payload, registers
 * a rate through the existing service-role RPC (`register_bcv_rate`) and records
 * a durable sync attempt in `bcv_sync_attempts` for admin visibility.
 *
 * Render Free Web Service compatibility: when PORT is set, the worker also
 * exposes a lightweight GET /healthz endpoint on 0.0.0.0. HTTP requests never
 * trigger exchange-rate updates and never expose secrets or internal config.
 * The scheduler and HTTP server run concurrently in the same process.
 *
 * This worker is intentionally independent from OQ-16 SLA notifications.
 *
 * Local execution (Node 22+):
 *   node --env-file=.env.local supabase/worker/bcv-rate-worker.mjs
 * Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * Optional env: PORT, BCV_SYNC_FETCH_TIMEOUT_MS, BCV_SYNC_SHUTDOWN_TIMEOUT_MS,
 * BCV_SYNC_TEST_INTERVAL_MS (testing only: fixed delay between cycles in ms).
 */

import { createClient } from "@supabase/supabase-js";
import http from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const WORKER_NAME = "bcv-sync";
export const BCV_RATE_URL = "https://bcv.today/api/v1/rate.json";
export const BCV_SOURCE = "automatic:bcv.today";
export const CARACAS_TIME_ZONE = "America/Caracas";
export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;
export const DEFAULT_HEALTH_HOST = "0.0.0.0";
export const SCHEDULE_SLOTS = [
  { hour: 9, minute: 0, label: "09:00" },
  { hour: 13, minute: 0, label: "13:00" },
];
const WEEKDAY_INDEX = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export function createLogger({
  now = () => new Date(),
  write = (line) => console.log(line),
} = {}) {
  function emit(level, event, fields) {
    write(
      JSON.stringify({
        timestamp: now().toISOString(),
        level,
        worker: WORKER_NAME,
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

function positiveInt(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Optional fixed delay for local testing. Returns null when unset, so the
 * normal Caracas slot schedule remains the default and production is untouched.
 */
export function parseTestIntervalMs(value) {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function startBcvHealthServer({
  port = 0,
  host = DEFAULT_HEALTH_HOST,
  startedAt = new Date(),
  now = () => new Date(),
  workerName = WORKER_NAME,
} = {}) {
  const server = http.createServer((req, res) => {
    const method = req.method === "HEAD" ? "HEAD" : req.method;
    const url = req.url ?? "/";
    if ((method === "GET" || method === "HEAD") && (url === "/healthz" || url === "/healthz/")) {
      // Minimal, non-sensitive payload. Never expose secrets, Supabase data, or config.
      const body = JSON.stringify({
        status: "ok",
        service: workerName,
        uptime_seconds: Math.max(0, Math.floor((now().getTime() - startedAt.getTime()) / 1000)),
      });
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

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function sanitizeErrorDetail(value, max = 500) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "unknown_error";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function normalizeRateString(value) {
  const numeric = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const rounded = Math.round((numeric + Number.EPSILON) * 10000) / 10000;
  if (!Number.isFinite(rounded) || rounded <= 0) return null;
  const fixed = rounded.toFixed(4).replace(/\.?0+$/, "");
  return /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(fixed) ? fixed : null;
}

export function parseIsoTimestamp(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(trimmed)) {
    return null;
  }
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

export function parseEffectiveDate(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const [year, month, day] = trimmed.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return trimmed;
}

export function getCaracasDateTime(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: CARACAS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAY_INDEX[parts.weekday] ?? 0,
  };
}

function getTimeZoneOffsetMs(date, timeZone = CARACAS_TIME_ZONE) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

export function caracasLocalToUtcMs({ year, month, day, hour = 0, minute = 0, second = 0 }) {
  // Convert a wall-clock time in America/Caracas to a UTC instant using IANA
  // timezone data, not a fixed offset assumption.
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let utcMs = targetAsUtc;
  for (let i = 0; i < 4; i += 1) {
    const offset = getTimeZoneOffsetMs(new Date(utcMs), CARACAS_TIME_ZONE);
    const next = targetAsUtc - offset;
    if (next === utcMs) break;
    utcMs = next;
  }
  return utcMs;
}

export function getScheduleSlotKey(parts) {
  const date = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  const slot = SCHEDULE_SLOTS.find((item) => item.hour === parts.hour && item.minute === parts.minute);
  return slot ? `${date}T${slot.label}` : null;
}

export function getNextScheduleSlot(date = new Date()) {
  const current = getCaracasDateTime(date);
  const currentDateUtc = Date.UTC(current.year, current.month - 1, current.day);
  for (let offset = 0; offset < 14; offset += 1) {
    const candidate = new Date(currentDateUtc + offset * 86400000);
    const year = candidate.getUTCFullYear();
    const month = candidate.getUTCMonth() + 1;
    const day = candidate.getUTCDate();
    const weekday = ((candidate.getUTCDay() + 6) % 7) + 1; // Mon=1..Sun=7
    if (weekday > 5) continue;
    for (const slot of SCHEDULE_SLOTS) {
      const slotMs = caracasLocalToUtcMs({ year, month, day, hour: slot.hour, minute: slot.minute });
      if (slotMs <= date.getTime()) continue;
      const slotDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      return {
        slotKey: `${slotDate}T${slot.label}`,
        slotDate,
        slotLabel: slot.label,
        scheduledAt: new Date(slotMs).toISOString(),
        delayMs: Math.max(0, slotMs - date.getTime()),
      };
    }
  }
  throw new Error("unable to compute next Caracas schedule slot");
}

export function validateBcvPayload(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, errorCode: "invalid_payload", errorDetail: "BCV payload is not a JSON object" };
  }
  const rate = normalizeRateString(payload.USD);
  if (!rate) {
    return { ok: false, errorCode: "invalid_usd_rate", errorDetail: "USD rate is missing or invalid" };
  }
  const effectiveDate = parseEffectiveDate(payload.effective_date ?? payload.date);
  if (!effectiveDate) {
    return { ok: false, errorCode: "invalid_effective_date", errorDetail: "effective_date is missing or invalid" };
  }
  const providerUpdatedAt = payload.updated_at == null ? null : parseIsoTimestamp(payload.updated_at);
  if (payload.updated_at != null && !providerUpdatedAt) {
    return { ok: false, errorCode: "invalid_provider_updated_at", errorDetail: "updated_at is invalid" };
  }
  return {
    ok: true,
    value: {
      rate,
      effectiveDate,
      providerUpdatedAt,
    },
  };
}

export async function fetchBcvRate({
  fetchImpl = fetch,
  url = BCV_RATE_URL,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  clock = () => new Date(),
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        ok: false,
        errorCode: "http_error",
        errorDetail: `BCV request failed with status ${response.status}`,
      };
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, errorCode: "invalid_json", errorDetail: "BCV response is not valid JSON" };
    }
    const validated = validateBcvPayload(payload);
    if (!validated.ok) return validated;
    return {
      ok: true,
      value: {
        ...validated.value,
        retrievedAt: clock().toISOString(),
      },
    };
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      errorCode: isAbort ? "timeout" : "network_error",
      errorDetail: sanitizeErrorDetail(error instanceof Error ? error.message : String(error)),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function buildAttemptIdempotencyKey(source, slotKey, effectiveDate) {
  return `bcv-sync:${source}:${slotKey}:${effectiveDate}`;
}

// Rate registration dedupes by effective date + normalized rate so the same BCV
// publication observed in different schedule slots does not create duplicate
// exchange-rate history rows. Sync attempts remain independently recorded.
export function buildRateIdempotencyKey(source, effectiveDate, rate) {
  return `bcv-rate:${source}:${effectiveDate}:${rate}`;
}

// Backward-compatible alias for tests/callers; attempt keys are slot-scoped.
export const buildIdempotencyKey = buildAttemptIdempotencyKey;

export function parseRateResult(data) {
  if (!isPlainObject(data) || typeof data.rate_id !== "number" || typeof data.idempotent !== "boolean") {
    throw new Error("register_bcv_rate returned an invalid payload");
  }
  return { rateId: data.rate_id, idempotent: data.idempotent };
}

export async function recordSyncAttempt({
  insertAttempt,
  logger = createLogger(),
  attempt,
}) {
  const { data, error } = await insertAttempt(attempt);
  if (error) {
    // A duplicate idempotency key means this slot/effective date was already recorded.
    if (error.code === "23505") {
      logger.info("sync_attempt_duplicate", {
        idempotency_key: attempt.idempotency_key,
        status: attempt.status,
      });
      return { ok: true, duplicate: true };
    }
    logger.error("sync_attempt_record_failed", {
      idempotency_key: attempt.idempotency_key,
      status: attempt.status,
      error: sanitizeErrorDetail(error.message ?? error.code ?? "unknown"),
    });
    return { ok: false, error };
  }
  return { ok: true, duplicate: false, data };
}

export async function runBcvSyncOnce({
  rpc,
  insertAttempt,
  supabase,
  logger = createLogger(),
  fetchImpl = fetch,
  clock = () => new Date(),
  slot,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  source = BCV_SOURCE,
}) {
  const slotInfo = slot ?? getNextScheduleSlot(clock());
  const startedAt = clock().toISOString();
  const baseAttempt = {
    attempted_at: startedAt,
    source,
    schedule_slot: slotInfo.slotKey,
  };

  const fetched = await fetchBcvRate({ fetchImpl, timeoutMs, clock });
  if (!fetched.ok) {
    const failureAttempt = {
      ...baseAttempt,
      status: "failure",
      effective_date: null,
      provider_updated_at: null,
      retrieved_at: null,
      rate_ves_per_usd: null,
      error_code: fetched.errorCode,
      error_detail: sanitizeErrorDetail(fetched.errorDetail),
      idempotency_key: `bcv-sync-failure:${source}:${slotInfo.slotKey}:${fetched.errorCode}`,
      registered_rate_id: null,
    };
    await recordSyncAttempt({ insertAttempt, logger, attempt: failureAttempt });
    logger.warn("sync_failed", {
      slot: slotInfo.slotKey,
      error_code: fetched.errorCode,
    });
    return { ok: false, status: "failure", errorCode: fetched.errorCode };
  }

  const attemptIdempotencyKey = buildAttemptIdempotencyKey(source, slotInfo.slotKey, fetched.value.effectiveDate);
  const rateIdempotencyKey = buildRateIdempotencyKey(source, fetched.value.effectiveDate, fetched.value.rate);
  const { data: rpcData, error: rpcError } = await rpc("register_bcv_rate", {
    p_rate_ves_per_usd: fetched.value.rate,
    p_source: source,
    p_admin_id: null,
    p_observed_at: fetched.value.providerUpdatedAt ?? fetched.value.retrievedAt,
    p_supersedes_id: null,
    p_note: `Automatic BCV sync ${slotInfo.slotKey} effective ${fetched.value.effectiveDate}`,
    p_idempotency_key: rateIdempotencyKey,
  });

  if (rpcError) {
    const failureAttempt = {
      ...baseAttempt,
      status: "failure",
      effective_date: fetched.value.effectiveDate,
      provider_updated_at: fetched.value.providerUpdatedAt,
      retrieved_at: fetched.value.retrievedAt,
      rate_ves_per_usd: fetched.value.rate,
      error_code: "register_failed",
      error_detail: sanitizeErrorDetail(rpcError.message ?? "register_bcv_rate failed"),
      idempotency_key: `bcv-sync-failure:${source}:${slotInfo.slotKey}:register_failed`,
      registered_rate_id: null,
    };
    await recordSyncAttempt({ insertAttempt, logger, attempt: failureAttempt });
    logger.error("sync_register_failed", {
      slot: slotInfo.slotKey,
      effective_date: fetched.value.effectiveDate,
    });
    return { ok: false, status: "failure", errorCode: "register_failed" };
  }

  let rateResult;
  try {
    rateResult = parseRateResult(rpcData);
  } catch (error) {
    const failureAttempt = {
      ...baseAttempt,
      status: "failure",
      effective_date: fetched.value.effectiveDate,
      provider_updated_at: fetched.value.providerUpdatedAt,
      retrieved_at: fetched.value.retrievedAt,
      rate_ves_per_usd: fetched.value.rate,
      error_code: "invalid_rpc_result",
      error_detail: sanitizeErrorDetail(error instanceof Error ? error.message : String(error)),
      idempotency_key: `bcv-sync-failure:${source}:${slotInfo.slotKey}:invalid_rpc_result`,
      registered_rate_id: null,
    };
    await recordSyncAttempt({ insertAttempt, logger, attempt: failureAttempt });
    return { ok: false, status: "failure", errorCode: "invalid_rpc_result" };
  }

  // When register_bcv_rate returns idempotent: true, the RPC only proves the
  // submitted idempotency key already exists. It does NOT tell us which rate is
  // currently active. A manual rate B can be active while the worker re-fetches
  // an older automatic rate A with the same rate idempotency key. In that case we
  // must preserve B as active and classify the attempt as manual_overridden.
  let manualOverride = false;
  let activeSource = null;
  let activeRateId = null;
  if (rateResult.idempotent) {
    try {
      if (!supabase?.from) {
        throw new Error("supabase client required for idempotent active-rate check");
      }
      const { data: activeRate, error: rateError } = await supabase
        .from("exchange_rates")
        .select("id, source, is_active")
        .eq("is_active", true)
        .order("observed_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (rateError) throw rateError;
      if (activeRate) {
        activeRateId = typeof activeRate.id === "number" ? activeRate.id : null;
        activeSource = typeof activeRate.source === "string" ? activeRate.source : null;
        if (activeSource && !activeSource.startsWith("automatic:")) {
          manualOverride = true;
          logger.info("sync_idempotent_but_manual_override_detected", {
            slot: slotInfo.slotKey,
            idempotentRateId: rateResult.rateId,
            activeRateId,
            activeSource,
          });
        }
      }
    } catch (error) {
      logger.warn("sync_manual_override_check_failed", {
        slot: slotInfo.slotKey,
        idempotentRateId: rateResult.rateId,
        error: sanitizeErrorDetail(error instanceof Error ? error.message : String(error)),
      });
    }
  }

  if (manualOverride) {
    // Preserve the current manual rate as active. Record the slot attempt as
    // manual_overridden so the automatic fetch is visible but never treated as a
    // successful registration that displaced manual control.
    const manualAttempt = {
      ...baseAttempt,
      status: "manual_overridden",
      effective_date: fetched.value.effectiveDate,
      provider_updated_at: fetched.value.providerUpdatedAt,
      retrieved_at: fetched.value.retrievedAt,
      rate_ves_per_usd: fetched.value.rate,
      error_code: null,
      error_detail: null,
      idempotency_key: attemptIdempotencyKey,
      registered_rate_id: activeRateId ?? rateResult.rateId,
    };
    const recorded = await recordSyncAttempt({ insertAttempt, logger, attempt: manualAttempt });
    if (!recorded.ok) {
      logger.error("sync_manual_override_attempt_persist_failed", {
        slot: slotInfo.slotKey,
        activeRateId,
        idempotentRateId: rateResult.rateId,
        activeSource,
      });
      return {
        ok: false,
        status: "attempt_persist_failed",
        errorCode: "sync_attempt_persist_failed",
        rateId: activeRateId ?? rateResult.rateId,
      };
    }
    logger.info("sync_manual_overridden", {
      slot: slotInfo.slotKey,
      activeRateId,
      idempotentRateId: rateResult.rateId,
      activeSource,
    });
    return {
      ok: true,
      status: "manual_overridden",
      rateId: activeRateId ?? rateResult.rateId,
    };
  }

  const successAttempt = {
    ...baseAttempt,
    status: "success",
    effective_date: fetched.value.effectiveDate,
    provider_updated_at: fetched.value.providerUpdatedAt,
    retrieved_at: fetched.value.retrievedAt,
    rate_ves_per_usd: fetched.value.rate,
    error_code: null,
    error_detail: null,
    idempotency_key: attemptIdempotencyKey,
    registered_rate_id: rateResult.rateId,
  };
  const recorded = await recordSyncAttempt({ insertAttempt, logger, attempt: successAttempt });
  if (!recorded.ok) {
    // Rate registration already succeeded; report inconsistency loudly but do not
    // register/deactivate rates again. The next slot is protected by rate
    // idempotency and the attempt key remains slot-scoped.
    logger.error("sync_attempt_persist_failed_after_register", {
      slot: slotInfo.slotKey,
      effective_date: fetched.value.effectiveDate,
      registered_rate_id: rateResult.rateId,
      rate_idempotency_key: rateIdempotencyKey,
      attempt_idempotency_key: attemptIdempotencyKey,
    });
    return {
      ok: false,
      status: "attempt_persist_failed",
      errorCode: "sync_attempt_persist_failed",
      rateId: rateResult.rateId,
      idempotent: rateResult.idempotent,
    };
  }

  logger.info("sync_success", {
    slot: slotInfo.slotKey,
    effective_date: fetched.value.effectiveDate,
    rate_ves_per_usd: fetched.value.rate,
    registered_rate_id: rateResult.rateId,
    idempotent: rateResult.idempotent,
    attempt_duplicate: recorded.duplicate,
  });
  return {
    ok: true,
    status: rateResult.idempotent ? "idempotent" : "registered",
    rateId: rateResult.rateId,
  };
}

export function defaultSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function createBcvSyncWorker({
  rpc,
  insertAttempt,
  supabase,
  logger = createLogger(),
  fetchImpl = fetch,
  clock = () => new Date(),
  sleep = defaultSleep,
  shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  fetchTimeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  getNextSlot = getNextScheduleSlot,
  runOnce = runBcvSyncOnce,
  healthPort,
  healthHost = DEFAULT_HEALTH_HOST,
  startHealthServer = startBcvHealthServer,
  testIntervalMs = null,
} = {}) {
  const controller = new AbortController();
  let stopping = false;
  let running = false;
  let inFlight = null;
  let healthServer = null;
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });

  function cycle(slot) {
    if (running) return inFlight ?? Promise.resolve();
    running = true;
    const startedAt = clock();
    inFlight = Promise.resolve()
      .then(() => runOnce({ rpc, insertAttempt, supabase, logger, fetchImpl, clock, slot, timeoutMs: fetchTimeoutMs }))
      .catch((error) => {
        logger.error("sync_cycle_unhandled", {
          slot: slot?.slotKey ?? null,
          error: sanitizeErrorDetail(error instanceof Error ? error.message : String(error)),
        });
      })
      .finally(() => {
        running = false;
        logger.info("sync_cycle_finished", {
          slot: slot?.slotKey ?? null,
          duration_ms: Math.max(0, clock().getTime() - startedAt.getTime()),
        });
      });
    return inFlight;
  }

  async function loop() {
    logger.info("worker_started", {
      timezone: CARACAS_TIME_ZONE,
      slots: SCHEDULE_SLOTS.map((slot) => slot.label),
      shutdown_timeout_ms: shutdownTimeoutMs,
      test_interval_ms: testIntervalMs,
    });
    try {
      while (!stopping) {
        const slot = getNextSlot(clock());
        const waitMs = testIntervalMs ?? slot.delayMs;
        logger.info("next_slot_scheduled", {
          slot: slot.slotKey,
          scheduled_at: slot.scheduledAt,
          delay_ms: slot.delayMs,
          wait_ms: waitMs,
          test_mode: testIntervalMs !== null,
        });
        try {
          await sleep(waitMs, controller.signal);
        } catch (error) {
          if (stopping) break;
          throw error;
        }
        if (stopping) break;
        await cycle(slot);
      }
    } catch (error) {
      if (!stopping) {
        logger.error("worker_loop_error", {
          error: sanitizeErrorDetail(error instanceof Error ? error.message : String(error)),
        });
      }
    } finally {
      logger.info("worker_stopped", { status: "stopped" });
      resolveDone();
    }
  }

  async function closeHealthServer() {
    if (!healthServer) return;
    try {
      await healthServer.close();
      logger.info("health_server_stopped", { status: "stopped" });
    } catch (error) {
      logger.error("health_server_stop_error", {
        error: sanitizeErrorDetail(error instanceof Error ? error.message : String(error)),
      });
    } finally {
      healthServer = null;
    }
  }

  async function shutdown(signal) {
    if (stopping) {
      await done;
      return;
    }
    stopping = true;
    controller.abort();
    logger.info("worker_shutdown", { signal, waiting_for_cycle: running });
    await closeHealthServer();
    let timeoutTimer;
    const timedOut = new Promise((resolve) => {
      timeoutTimer = setTimeout(() => {
        logger.error("worker_shutdown_timeout", { timeout_ms: shutdownTimeoutMs });
        resolveDone();
        resolve("timeout");
      }, shutdownTimeoutMs);
    });
    await Promise.race([done, timedOut]);
    clearTimeout(timeoutTimer);
    await done;
  }

  let loopPromise = null;
  async function start() {
    if (loopPromise) return;
    if (healthPort !== undefined && healthPort !== null && healthPort !== "") {
      const parsedPort = Number(healthPort);
      if (!Number.isSafeInteger(parsedPort) || parsedPort < 0 || parsedPort > 65535) {
        throw new Error("PORT must be a valid TCP port");
      }
      healthServer = await startHealthServer({
        port: parsedPort,
        host: healthHost,
        startedAt: clock(),
        now: clock,
        workerName: WORKER_NAME,
      });
      logger.info("health_server_started", { host: healthHost, port: healthServer.port });
    }
    loopPromise = loop().finally(async () => {
      await closeHealthServer();
    });
  }

  async function stop(signal = "manual") {
    await shutdown(signal);
  }

  return { start, stop, done, isRunning: () => running, getHealthPort: () => healthServer?.port ?? null };
}

export async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  const rpc = (name, args) => supabase.rpc(name, args);
  const insertAttempt = (attempt) =>
    supabase.from("bcv_sync_attempts").insert(attempt).select("id").maybeSingle();

  const logger = createLogger();
  const worker = createBcvSyncWorker({
    rpc,
    insertAttempt,
    supabase,
    logger,
    fetchTimeoutMs: positiveInt(process.env.BCV_SYNC_FETCH_TIMEOUT_MS, DEFAULT_FETCH_TIMEOUT_MS),
    shutdownTimeoutMs: positiveInt(process.env.BCV_SYNC_SHUTDOWN_TIMEOUT_MS, DEFAULT_SHUTDOWN_TIMEOUT_MS),
    healthPort: process.env.PORT,
    healthHost: DEFAULT_HEALTH_HOST,
    testIntervalMs: parseTestIntervalMs(process.env.BCV_SYNC_TEST_INTERVAL_MS),
  });

  const shutdown = (signal) => {
    void worker.stop(signal).then(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await worker.start();
  await worker.done;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  void main().catch((error) => {
    console.error(JSON.stringify({ event: "worker_fatal", worker: WORKER_NAME, error: sanitizeErrorDetail(error) }));
    process.exit(1);
  });
}
