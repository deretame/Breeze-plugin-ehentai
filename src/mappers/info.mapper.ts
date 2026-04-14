import {
  PLUGIN_CREATOR,
  PLUGIN_DESCRIPTION,
  PLUGIN_HOME,
  PLUGIN_ICON_URL,
  PLUGIN_NAME,
  PLUGIN_UPDATE_URL,
  PLUGIN_UUID,
  PLUGIN_VERSION,
} from "../domain/constants";
import type { InfoContract } from "../domain/contracts";

export function mapInfo(): InfoContract {
  return {
    name: PLUGIN_NAME,
    uuid: PLUGIN_UUID,
    iconUrl: PLUGIN_ICON_URL,
    creator: { ...PLUGIN_CREATOR },
    describe: PLUGIN_DESCRIPTION,
    version: PLUGIN_VERSION,
    home: PLUGIN_HOME,
    updateUrl: PLUGIN_UPDATE_URL,
    function: [],
  };
}
