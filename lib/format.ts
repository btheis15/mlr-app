/**
 * Small shared formatter library. Keep all display-formatting here so the
 * whole app reads dates/numbers/currency the same way (the same pattern the
 * Stock Game / Innjoy apps use).
 */

export function formatDate(input: string | number | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatCurrency(n: number): string {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/** "3 days", "1 day", "today" — relative day count from now. */
export function daysUntil(input: string | number | Date): string {
  const target = input instanceof Date ? input : new Date(input);
  const ms = target.getTime() - Date.now();
  const days = Math.round(ms / 86_400_000);
  if (days === 0) return "today";
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`;
  return `in ${days} day${days === 1 ? "" : "s"}`;
}
