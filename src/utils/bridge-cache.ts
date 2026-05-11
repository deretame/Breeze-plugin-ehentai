export function unwrapBridgeValue(raw: unknown, depth = 0): unknown {
  if (depth > 8) {
    return raw;
  }

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const map = raw as Record<string, unknown>;
    if (map.ok === true && "value" in map) {
      return unwrapBridgeValue(map.value, depth + 1);
    }
    return raw;
  }

  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) {
      return "";
    }
    try {
      const parsed = JSON.parse(text);
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        (parsed as Record<string, unknown>).ok === true &&
        "value" in (parsed as Record<string, unknown>)
      ) {
        return unwrapBridgeValue((parsed as Record<string, unknown>).value, depth + 1);
      }
    } catch {
      // keep raw text as-is
    }
  }

  return raw;
}
