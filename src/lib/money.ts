/**
 * Formats an amount in a currency's smallest unit (as Stripe sends it) for display, e.g. 999 "usd" → "$9.99".
 * Currencies without minor units (e.g. JPY) aren't divided.
 */
export function formatMoney(amount: number, currency: string, locale?: string): string {
  try {
    const format = new Intl.NumberFormat(locale, { style: "currency", currency: currency.toUpperCase() });
    return format.format(amount / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2));
  } catch {
    return `${amount} ${currency.toUpperCase()}`; // an unknown currency code
  }
}
