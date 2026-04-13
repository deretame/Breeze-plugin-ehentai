import { PLUGIN_NAME, PLUGIN_UUID, PLUGIN_VERSION } from "../domain/constants";
import type { InfoContract } from "../domain/contracts";

export function mapInfo(): InfoContract {
  return {
    name: PLUGIN_NAME,
    uuid: PLUGIN_UUID,
    describe: "e-hentai minimal reader plugin",
    version: PLUGIN_VERSION,
    function: [
      // {
      //   id: "search",
      //   title: "Search",
      //   action: {
      //     type: "openSearch",
      //     payload: {
      //       source: PLUGIN_SOURCE,
      //     },
      //   },
      // },
    ],
  };
}
