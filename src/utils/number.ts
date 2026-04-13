export function toInt(value: unknown, fallback = 0): number {
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function parsePageCount(text: string): number | undefined {
  const match = /(\d+)\s+pages?/i.exec(text);
  if (!match) {
    return undefined;
  }
  return toInt(match[1], 0);
}
