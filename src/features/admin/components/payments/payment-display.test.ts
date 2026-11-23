import { describe, expect, it } from "vitest";
import {
  formatReportedAmount,
  orderPickerLabel,
  paymentMethodLabel,
  paymentStatusLabel,
  receiptFileName,
} from "./payment-display";

describe("payments admin presentation helpers", () => {
  it("derives the receipt filename from the real storage path only", () => {
    expect(receiptFileName("42/11111111-1111-4111-8111-111111111111.png")).toBe(
      "11111111-1111-4111-8111-111111111111.png",
    );
    expect(receiptFileName("7/abc.jpg")).toBe("abc.jpg");
    expect(receiptFileName("42/")).toBe("comprobante");
  });

  it("formats an amount with the real reported currency, never a default USD symbol", () => {
    const formatted = formatReportedAmount(50, "ves");
    expect(formatted).toContain("50,00");
    expect(formatted).toContain("VES");
    expect(formatReportedAmount(12.5, "")).toContain("12,50");
    expect(formatReportedAmount(Number.NaN, "USD")).toBe("—");
  });

  it("labels known methods and statuses but does not invent values for unknown ones", () => {
    expect(paymentMethodLabel("pago_movil")).toBe("Pago móvil");
    expect(paymentMethodLabel("cash_usd")).toBe("Efectivo USD");
    expect(paymentMethodLabel("otro_metodo")).toBe("otro_metodo");
    expect(paymentStatusLabel("approved")).toBe("aprobado");
    expect(paymentStatusLabel("rejected")).toBe("rechazado");
    expect(paymentStatusLabel("nuevo_estado")).toBe("nuevo_estado");
  });

  it("builds order labels from the real id and stored customer name", () => {
    expect(orderPickerLabel(42, "Cliente Real")).toBe("#42 · Cliente Real");
    expect(orderPickerLabel(42, null)).toBe("#42");
    expect(orderPickerLabel(42, "  ")).toBe("#42");
    expect(orderPickerLabel(0, "Cliente Real")).toBe("—");
  });
});
