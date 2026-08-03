import type { InfoContract } from "breeze-plugin-kit";
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

function buildComicListScene(input: {
  title: string;
  request: {
    fnPath: string;
    core?: Record<string, unknown>;
    extern?: Record<string, unknown>;
  };
  filter?: {
    fnPath: string;
    core?: Record<string, unknown>;
    extern?: Record<string, unknown>;
  };
}) {
  return {
    title: input.title,
    source: PLUGIN_UUID,
    body: {
      type: "pluginPagedComicList" as const,
      request: {
        fnPath: input.request.fnPath,
        core: input.request.core ?? {},
        extern: input.request.extern ?? {},
      },
    },
    ...(input.filter
      ? {
          filter: {
            fnPath: input.filter.fnPath,
            core: input.filter.core ?? {},
            extern: input.filter.extern ?? {},
          },
        }
      : {}),
  };
}

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
    npmName: "breeze-plugin-ehentai",
    function: [
      {
        id: "latest",
        title: "最新",
        action: {
          type: "openComicList",
          payload: {
            scene: buildComicListScene({
              title: "最新",
              request: {
                fnPath: "getLatestData",
                extern: { source: "latest" },
              },
            }),
          },
        },
      },
      {
        id: "popular",
        title: "热门",
        action: {
          type: "openComicList",
          payload: {
            scene: buildComicListScene({
              title: "热门",
              request: {
                fnPath: "getPopularData",
                extern: { source: "popular" },
              },
            }),
          },
        },
      },
      {
        id: "ranking",
        title: "排行榜",
        action: {
          type: "openComicList",
          payload: {
            scene: buildComicListScene({
              title: "排行榜",
              request: {
                fnPath: "getRankingData",
                extern: { source: "ranking", rankType: "day" },
              },
              filter: {
                fnPath: "getRankingFilterBundle",
                extern: { source: "ranking" },
              },
            }),
          },
        },
      },
      {
        id: "favorites",
        title: "收藏",
        action: {
          type: "openComicList",
          payload: {
            scene: buildComicListScene({
              title: "收藏",
              request: {
                fnPath: "getFavorites",
                extern: {},
              },
              filter: {
                fnPath: "getFavoritesFilterBundle",
                extern: {},
              },
            }),
          },
        },
      },
    ],
  };
}
