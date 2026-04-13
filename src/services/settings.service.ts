import { DEFAULT_SETTINGS } from "../domain/constants";
import type { SettingsBundleContract } from "../domain/contracts";
import type { PluginSettings } from "../domain/types";
import { mapSettingsBundle } from "../mappers/settings.mapper";
import { validateSettingsInput } from "../utils/guards";

export function readSettings(extern?: Record<string, unknown>): PluginSettings {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(extern ?? {}),
  };

  return validateSettingsInput(merged);
}

export function getSettingsBundleService(values: PluginSettings = { ...DEFAULT_SETTINGS }): SettingsBundleContract {
  return mapSettingsBundle(values);
}
