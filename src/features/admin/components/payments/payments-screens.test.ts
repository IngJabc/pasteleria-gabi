import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativeToFile: string): string {
  return readFileSync(new URL(relativeToFile, import.meta.url), "utf8");
}

const receiptPage = () =>
  source("../../../../app/(admin)/admin/(panel)/comprobantes/page.tsx");
const externalPage = () =>
  source("../../../../app/(admin)/admin/(panel)/pagos/externo/page.tsx");
const posPage = () =>
  source("../../../../app/(admin)/admin/(panel)/punto-de-venta/page.tsx");
const receiptDecision = () => source("./receipt-decision.tsx");
const externalForm = () => source("./external-payment-form.tsx");
const posForm = () =>
  source("../../../payments/components/pos-sale-form.tsx");

// These are source invariants: the repo has no component-rendering test setup,
// so these guards only assert that the screens keep their safety-critical
// strings (route config, server-only URL minting, disabled fictional content).
describe("payments/POS admin screens — source invariants", () => {
  it("opts every new route out of instant navigation without its own main", () => {
    for (const page of [receiptPage(), externalPage(), posPage()]) {
      expect(page).toContain("export const instant = false;");
      expect(page).not.toContain("<main");
    }
  });

  it("renders server-minted receipt images without leaking the private path", () => {
    const page = receiptPage();
    expect(page).toContain('from "next/image"');
    expect(page).toContain("<Image");
    expect(page).toContain("unoptimized");
    expect(page).toContain("width={640}");
    expect(page).toContain("height={480}");
    expect(page).not.toContain("<img");
    expect(page).toMatch(/No hay comprobantes pendientes de revisi/);
    expect(page).toContain("reviewReminders");

    const decision = receiptDecision();
    expect(decision).toContain('"use client"');
    expect(decision).toContain("reviewPayment");
    expect(decision).toContain("LiveRegion");
    expect(decision).toMatch(/disabled=\{isPending(?: \|\| resolved !== "")?\}/);
    expect(decision).not.toContain("receiptPath");
    expect(decision).not.toContain("signedUrl");
  });

  it("uses only real online orders and the existing cash action", () => {
    const page = externalPage();
    expect(page).toContain('.eq("channel", "online")');
    expect(page).toContain('.in("status", ["pending", "confirmed", "ready"])');
    expect(page).toContain(".limit(ORDER_LIMIT)");
    expect(page).not.toContain("createSupabaseAdminClient");
    expect(page).toContain(
      "Por ahora solo se pueden registrar pagos en efectivo USD contra pedidos",
    );

    const form = externalForm();
    expect(form).toContain('"use client"');
    expect(form).toContain("registerCashPayment");
    expect(form).toContain("createIdempotencyKey");
    expect(form).toContain("amountTenderedUsd");
    expect(form.toLowerCase()).not.toContain("binance");
  });

  it("keeps the POS copy truthful and restyles it with design tokens only", () => {
    const page = posPage();
    expect(page).toMatch(/Punto de venta .* Venta en mostrador .* Salida FIFO/);
    expect(page).toMatch(/pagos combinados .*no est.*disponibles; el POS registra ventas/);
    expect(page).toContain(".toFixed(2)");

    const form = posForm();
    expect(form).not.toMatch(/zinc-|dark:|red-/);
    expect(form).toContain("registerPosCashSale");
    expect(form).toContain("createIdempotencyKey");
    expect(form).toContain("resolveIdempotencyKey");
    expect(form).toContain("moneyPattern");
  });
});




