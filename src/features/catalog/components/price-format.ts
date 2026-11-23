/** Shared USD formatter for the public catalog (prices are stored in USD). */
const usdFormatter = new Intl.NumberFormat("es-VE", {
  style: "currency",
  currency: "USD",
  currencyDisplay: "narrowSymbol",
});

export function formatUsd(amount: number): string {
  return usdFormatter.format(amount);
}
