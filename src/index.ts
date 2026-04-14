import type {
  ChapterContentContract,
  ComicDetailContract,
  FetchImageBytesContract,
  InfoContract,
  ReadPagesCompatContract,
  ReadSnapshotContract,
  SearchResultContract,
  SettingsBundleContract,
} from "./domain/contracts";
import type {
  ChapterPayload,
  ComicDetailPayload,
  FetchImageBytesPayload,
  SearchComicPayload,
} from "./domain/types";
import { normalizeError } from "./errors/normalize-error";
import {
  getChapterService,
  getReadPagesService,
} from "./services/chapter.service";
import { getComicDetailService } from "./services/detail.service";
import { fetchImageBytesService } from "./services/image.service";
import { getInfoService } from "./services/info.service";
import { getReadSnapshotService } from "./services/read-snapshot.service";
import { searchComicService } from "./services/search.service";
import {
  getSettingsBundleService,
  readSettings,
} from "./services/settings.service";

export async function searchComic(
  payload: SearchComicPayload = {},
): Promise<SearchResultContract> {
  try {
    const settings = readSettings(payload.extern);
    return await searchComicService(payload, settings);
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function getComicDetail(
  payload: ComicDetailPayload = {},
): Promise<ComicDetailContract> {
  try {
    const settings = readSettings(payload.extern);
    return await getComicDetailService(payload, settings);
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function getChapter(
  payload: ChapterPayload = {},
): Promise<ChapterContentContract> {
  try {
    const settings = readSettings(payload.extern);
    return await getChapterService(payload, settings);
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function getReadPages(
  payload: ChapterPayload = {},
): Promise<ReadPagesCompatContract> {
  try {
    const settings = readSettings(payload.extern);
    return await getReadPagesService(payload, settings);
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function getReadSnapshot(
  payload: ChapterPayload = {},
): Promise<ReadSnapshotContract> {
  try {
    const settings = readSettings(payload.extern);
    return await getReadSnapshotService(payload, settings);
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function fetchImageBytes(
  payload: FetchImageBytesPayload = {},
): Promise<FetchImageBytesContract> {
  try {
    return await fetchImageBytesService(payload);
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function getInfo(): Promise<InfoContract> {
  return getInfoService();
}

export async function getSettingsBundle(): Promise<SettingsBundleContract> {
  return getSettingsBundleService();
}

export default {
  getInfo,
  searchComic,
  getComicDetail,
  getChapter,
  getReadSnapshot,
  fetchImageBytes,
  getSettingsBundle,
};
