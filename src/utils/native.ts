import type { NativeApi } from "breeze-plugin-kit";

export function requireNative(): NativeApi {
  const value = (globalThis as typeof globalThis & { native?: NativeApi }).native;
  if (!value || typeof value.put !== "function" || typeof value.take !== "function") {
    throw new Error("运行时缺少 native 能力");
  }
  return value;
}
