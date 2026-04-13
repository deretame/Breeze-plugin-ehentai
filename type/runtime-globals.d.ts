export {};

export interface NativeApi {
  put(input: Uint8Array): Promise<number>;
}

export interface HostPluginConfigApi {
  savePluginConfig(key: string, value: string): Promise<string>;
  loadPluginConfig(key: string, value: string): Promise<string>;
}

declare global {
  var native: NativeApi;
  var pluginConfig: HostPluginConfigApi;
}
