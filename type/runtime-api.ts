import type { HostPluginConfigApi, NativeApi } from "./runtime-globals";

type RuntimeGlobal = typeof globalThis & {
  native?: NativeApi;
  pluginConfig?: HostPluginConfigApi;
};

function requireApi<T>(name: "native" | "pluginConfig"): T {
  const value = (globalThis as RuntimeGlobal)[name];
  if (!value) {
    throw new TypeError(`runtime API 不可用: ${name}`);
  }
  return value as T;
}

export const runtime = {
  get native() {
    return requireApi<NativeApi>("native");
  },
  get pluginConfig() {
    return requireApi<HostPluginConfigApi>("pluginConfig");
  },
};
