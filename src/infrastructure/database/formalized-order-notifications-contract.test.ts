/**
 * Formalized-order notification contract.
 *
 * Static assertions pin migration 018 to the confirmed business rule: the
 * `new_order` event moves from order-draft INSERT to checkout formalization
 * (digital receipt-link UPDATE, pay-in-store service-role RPC), without any
 * table, RLS, publication or business-write change. The runtime assertions pin
 * the TypeScript boundary so only pay-in-store calls the RPC and a failed
 * notification keeps the checkout cookie retryable.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const migrationsDir = path.join(repoRoot, "supabase", "migrations");
const migrationFile = path.join(
  migrationsDir,
  "018_formalized_order_notifications.sql",
);
const checkoutPaymentFile = path.join(
  repoRoot,
  "src",
  "features",
  "payments",
  "checkout-payment.ts",
);
const databaseTypesFile = path.join(
  repoRoot,
  "src",
  "infrastructure",
  "database",
  "database.types.ts",
);

function stripComments(sql: string): string {
  return sql
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getCheckoutToken: vi.fn(),
  clearCheckoutToken: vi.fn(),
  registerDigitalPaymentWithReceipt: vi.fn(async () => ({
    ok: true as const,
    paymentId: 7,
    orderId: 42,
    status: "in_review",
    submissionId: 3,
    attemptNumber: 1,
    idempotent: false,
    reservations_held: 1,
  })),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/infrastructure/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/features/orders/tracking", () => ({
  getCheckoutToken: mocks.getCheckoutToken,
  clearCheckoutToken: mocks.clearCheckoutToken,
}));
vi.mock("@/features/payments/guest-payments", () => ({
  registerDigitalPaymentWithReceipt:
    mocks.registerDigitalPaymentWithReceipt,
}));

import {
  confirmPayInStoreOrder,
  registerCheckoutPayment,
} from "@/features/payments/checkout-payment";

describe("migration 018 contract (static)", () => {
  const raw = readFileSync(migrationFile, "utf8");
  const sql = stripComments(raw);
  const squashed = sql.replace(/\s+/g, " ").trim();

  it("is the 18th sequential migration and preserves 001-017", () => {
    const files = readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    expect(path.basename(migrationFile)).toBe(
      "018_formalized_order_notifications.sql",
    );
    expect(/^\d{3}_[a-z0-9_]+\.sql$/.test(path.basename(migrationFile))).toBe(
      true,
    );
    expect(files[17]).toBe("018_formalized_order_notifications.sql");
    expect(files).toEqual([
      "001_catalog_and_admin_foundation.sql",
      "002_inventory_foundation.sql",
      "003_orders_and_reservations.sql",
      "004_quote_acceptance.sql",
      "005_receipt_sla_notifications.sql",
      "006_payments_and_verification.sql",
      "007_bcv_rates_and_rounding.sql",
      "008_realtime_publication.sql",
      "009_store_settings_schedule.sql",
      "010_delivery_quote_admin.sql",
      "011_quote_pending_payment_guard.sql",
      "012_delivery_quote_post_acceptance_guard.sql",
      "013_quote_guard_helpers_grants.sql",
      "014_product_reviews.sql",
      "015_bcv_sync_attempts.sql",
      "016_general_admin_notifications.sql",
      "017_unified_notifications_realtime.sql",
      "018_formalized_order_notifications.sql",
    ]);
    expect(raw).toContain("no table, column, RLS policy");
    expect(raw).toContain("no remote apply, seed or deployment");
  });

  it("retires the draft-time trigger and never re-creates an orders INSERT notification", () => {
    expect(squashed).toContain(
      "drop trigger if exists admin_general_notifications_new_order on public.orders;",
    );
    expect(squashed).toContain(
      "drop function if exists private.general_notification_order_trigger();",
    );
    expect(sql).not.toMatch(
      /create\s+trigger\s+admin_general_notifications_new_order\b/i,
    );
    expect(sql).not.toMatch(/after\s+insert\s+on\s+public\.orders/i);
    expect(sql).not.toMatch(
      /create\s+or\s+replace\s+function\s+private\.general_notification_order_trigger\b/i,
    );
  });

  it("creates a service-role-only RPC with the 016 event identity and safe guards", () => {
    expect(squashed).toContain(
      "create or replace function public.notify_online_order_formalized(p_order_id bigint) returns integer language plpgsql volatile security definer set search_path = ''",
    );
    expect(squashed).toContain(
      "if p_order_id is null or p_order_id <= 0 then",
    );
    expect(squashed).toContain("for share;");
    expect(squashed).toContain(
      "if not found or v_channel <> 'online' or v_status in ('canceled', 'expired') then",
    );
    expect(squashed).toContain("return 0;");
    expect(squashed).toContain("private.create_admin_general_notification(");
    expect(squashed).toContain("'new_order', 'new_order:' || p_order_id::text");
    expect(squashed).toContain("'Nuevo pedido online recibido.', p_order_id");
    expect(squashed).toContain(
      "revoke all on function public.notify_online_order_formalized(bigint) from public, anon, authenticated;",
    );
    expect(squashed).toContain(
      "grant execute on function public.notify_online_order_formalized(bigint) to service_role;",
    );
    expect(sql).not.toMatch(
      /grant\s+execute\s+on\s+function\s+public\.notify_online_order_formalized\(bigint\)\s+to\s+(public|anon|authenticated)/i,
    );
  });

  it("emits from the receipt-link UPDATE only, never from a receipt INSERT", () => {
    expect(squashed).toContain(
      "create or replace function private.general_notification_formalized_order_trigger() returns trigger",
    );
    expect(squashed).toContain(
      "if new.order_id is not null and new.order_id > 0 then perform public.notify_online_order_formalized(new.order_id);",
    );
    expect(squashed).toContain(
      "create trigger admin_general_notifications_formalized_order after update of payment_id on public.receipt_submissions for each row when (old.payment_id is null and new.payment_id is not null) execute function private.general_notification_formalized_order_trigger();",
    );
    expect(sql).not.toMatch(
      /create\s+trigger\s+\w+\s+after\s+insert\s+on\s+public\.receipt_submissions/i,
    );
    expect(sql).not.toMatch(
      /perform\s+public\.notify_online_order_formalized\s*\(\s*new\.id\b/i,
    );
  });

  it("changes no table, RLS policy, publication, replica identity or business write", () => {
    expect(sql).not.toMatch(/\bcreate\s+(or\s+replace\s+)?table\b/i);
    expect(sql).not.toMatch(/\balter\s+table\b/i);
    expect(sql).not.toMatch(/\b(add|drop|alter)\s+column\b/i);
    expect(sql).not.toMatch(/\b(create|alter|drop)\s+policy\b/i);
    expect(sql).not.toMatch(/\b(enable|force)\s+row\s+level\s+security\b/i);
    expect(sql).not.toMatch(
      /\b(create|alter|drop)\s+publication\b|\balter\s+publication\b/i,
    );
    expect(sql).not.toMatch(/\breplica\s+identity\b/i);
    expect(sql).not.toMatch(
      /\b(insert\s+into|update|delete\s+from)\s+public\.(orders|payments|receipt_submissions|inventory_\w+|admin_general_notifications)\b/i,
    );

    const statements = squashed
      .split(";")
      .map((statement) => statement.trim())
      .filter((statement) => /^(grant|revoke)\b/i.test(statement));
    expect(statements).toEqual([
      "revoke all on function public.notify_online_order_formalized(bigint) from public, anon, authenticated",
      "grant execute on function public.notify_online_order_formalized(bigint) to service_role",
      "revoke all on function private.general_notification_formalized_order_trigger() from public, anon, authenticated",
      "grant execute on function private.general_notification_formalized_order_trigger() to service_role",
    ]);
  });

  it("calls the RPC only from pay-in-store and declares it in the generated types", () => {
    const source = readFileSync(checkoutPaymentFile, "utf8");
    const payInStoreStart = source.indexOf(
      "export async function confirmPayInStoreOrder",
    );
    const digitalStart = source.indexOf(
      "export async function registerCheckoutPayment",
    );
    expect(payInStoreStart).toBeGreaterThanOrEqual(0);
    expect(digitalStart).toBeGreaterThan(payInStoreStart);
    const payInStore = source.slice(payInStoreStart, digitalStart);
    const digital = source.slice(digitalStart);

    expect(payInStore).toMatch(
      /supabase\.rpc\(\s*"notify_online_order_formalized"/,
    );
    expect(payInStore).toContain("{ p_order_id: orderId }");
    expect(payInStore).toContain("Number.isSafeInteger(orderId) || orderId <= 0");
    expect(payInStore.indexOf("notify_online_order_formalized")).toBeLessThan(
      payInStore.indexOf("clearCheckoutToken()", payInStore.indexOf("notify_online_order_formalized")),
    );
    expect(digital).not.toContain("notify_online_order_formalized");
    expect(
      source.match(/notify_online_order_formalized/g) ?? [],
    ).toHaveLength(1);

    const types = readFileSync(databaseTypesFile, "utf8");
    expect(types).toMatch(
      /"notify_online_order_formalized":\s*\{\s*Args: \{ "p_order_id": number \}; Returns: number\s*\}/,
    );
  });
});

const checkoutToken = "ab".repeat(32);
const paymentInput = {
  method: "pago_movil" as const,
  amount: "10.00",
  reference: "REF-018",
  idempotencyKey: "formalized-018",
  file: {
    name: "comprobante.png",
    type: "image/png",
    size: 12,
    arrayBuffer: () => Promise.resolve(new Uint8Array(12).buffer),
  },
};

function mockOrderRpc(
  order: Record<string, unknown>,
  notifyError: { message: string } | null = null,
): void {
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === "get_order_for_tracking") return { data: order, error: null };
    if (name === "notify_online_order_formalized") {
      return { data: 2, error: notifyError };
    }
    throw new Error(`unexpected RPC ${name}`);
  });
}

describe("pay-in-store formalization boundary", () => {
  const payableOrder = {
    order_id: 42,
    status: "pending",
    fulfillment_type: "pickup",
    delivery_fee_usd: null,
    delivery_requires_quote: false,
    quote_acceptance_available: false,
  };

  beforeEach(() => {
    mocks.getCheckoutToken.mockResolvedValue(checkoutToken);
    mocks.clearCheckoutToken.mockResolvedValue(undefined);
    mockOrderRpc(payableOrder);
  });

  it("notifies once before clearing the checkout cookie on success", async () => {
    const result = await confirmPayInStoreOrder();

    expect(result).toEqual({ ok: true, trackingToken: checkoutToken });
    expect(mocks.rpc.mock.calls.map((call) => call[0])).toEqual([
      "get_order_for_tracking",
      "notify_online_order_formalized",
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith("notify_online_order_formalized", {
      p_order_id: 42,
    });
    expect(mocks.clearCheckoutToken).toHaveBeenCalledOnce();
  });

  it("returns a Spanish error and keeps the cookie when notification fails", async () => {
    mockOrderRpc(payableOrder, { message: "private helper is unavailable" });

    const result = await confirmPayInStoreOrder();

    expect(result).toEqual({
      ok: false,
      error: "No se pudo confirmar el pedido. Inténtalo de nuevo.",
    });
    expect(JSON.stringify(result)).not.toContain("private helper");
    expect(mocks.clearCheckoutToken).not.toHaveBeenCalled();
  });

  it("rejects an unsafe order id without notifying or clearing the cookie", async () => {
    mockOrderRpc({ ...payableOrder, order_id: 0 });

    const result = await confirmPayInStoreOrder();

    expect(result).toEqual({ ok: false, error: "No se pudo validar el pedido." });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.clearCheckoutToken).not.toHaveBeenCalled();
  });

  it("leaves notification to the receipt trigger on the digital path", async () => {
    const result = await registerCheckoutPayment(paymentInput);

    expect(result.ok).toBe(true);
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "notify_online_order_formalized",
      expect.anything(),
    );
    expect(mocks.clearCheckoutToken).toHaveBeenCalledOnce();
  });
});
