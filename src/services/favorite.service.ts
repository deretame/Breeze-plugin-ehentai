import type {
  FavoriteWorkflowContinuePayload,
  FavoriteWorkflowInput,
  FavoriteWorkflowResult,
  FavoriteWorkflowStartPayload,
} from "breeze-plugin-kit";
import type { PluginSettings } from "../domain/types";
import { authRequiredError, validationError } from "../errors/plugin-error";
import { buildFavoritePopupEndpoint, buildFavoritesEndpoint } from "../network/endpoints";
import { httpClient } from "../network/client";
import { isFavoritesLoginPage, parseFavoriteFoldersPage } from "../parsers/favorites.parser";
import { asRecord, normalizeComicId } from "../utils/guards";
import { buildRequestConfig } from "./settings.service";

const FAVORITE_CATEGORY_COUNT = 10;
const FAVORITE_CONTINUATION_PREFIX = "ehentai-favorite:v1:";
const FAVORITE_CONTINUATION_TTL_MS = 15 * 60 * 1000;

type FavoriteContinuation = {
  action: "add" | "move";
  comicId: string;
  currentFavorite: boolean;
  folderIds: string[];
  createdAt: number;
};

type FavoriteFoldersResult = {
  items: Array<{ id: string; name: string }>;
};

function buildFallbackFolders(): Array<{ id: string; name: string }> {
  return Array.from({ length: FAVORITE_CATEGORY_COUNT }, (_, index) => ({
    id: String(index),
    name: `分类 ${index + 1}`,
  }));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "收藏请求失败");
}

function workflowErrorCode(error: unknown): string {
  const code = String((error as { code?: unknown } | null)?.code ?? "").trim();
  return code || "FAVORITE_WORKFLOW_FAILED";
}

function workflowFailure(
  action: FavoriteWorkflowStartPayload["action"],
  error: unknown,
  currentFavorite = action === "move" || action === "removeFromTarget",
): FavoriteWorkflowResult {
  return {
    status: "failed",
    favorited: currentFavorite,
    committed: false,
    message: errorMessage(error),
    errorCode: workflowErrorCode(error),
  };
}

function encodeContinuation(value: FavoriteContinuation): string {
  return `${FAVORITE_CONTINUATION_PREFIX}${encodeURIComponent(JSON.stringify(value))}`;
}

function decodeContinuation(value: string): FavoriteContinuation | null {
  const raw = String(value ?? "");
  if (!raw.startsWith(FAVORITE_CONTINUATION_PREFIX)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      decodeURIComponent(raw.slice(FAVORITE_CONTINUATION_PREFIX.length)),
    ) as Partial<FavoriteContinuation>;
    const action = parsed.action;
    const comicId = String(parsed.comicId ?? "").trim();
    const folderIds = Array.isArray(parsed.folderIds)
      ? parsed.folderIds.map((item) => String(item ?? "").trim()).filter(Boolean)
      : [];
    const createdAt = Number(parsed.createdAt ?? 0);
    if (
      (action !== "add" && action !== "move") ||
      !comicId ||
      !folderIds.length ||
      !Number.isFinite(createdAt) ||
      Date.now() - createdAt > FAVORITE_CONTINUATION_TTL_MS
    ) {
      return null;
    }
    return {
      action,
      comicId,
      currentFavorite: parsed.currentFavorite === true,
      folderIds,
      createdAt,
    };
  } catch {
    return null;
  }
}

function normalizeFolderId(value: unknown): string {
  const folderId = String(value ?? "").trim();
  if (!/^\d+$/.test(folderId) || Number(folderId) >= FAVORITE_CATEGORY_COUNT) {
    throw validationError("收藏分类必须是 0 到 9");
  }
  return folderId;
}

function getFolderIdFromInteraction(input: FavoriteWorkflowContinuePayload["input"]): string {
  const values = asRecord(input.values);
  const rawValue = input.value ?? values.favcat ?? values.folderId;
  const valueRecord = asRecord(rawValue);
  return normalizeFolderId(valueRecord.id ?? valueRecord.value ?? rawValue);
}

function buildFavoriteFolderInput(
  folders: Array<{ id: string; name: string }>,
  title: string,
  description: string,
): FavoriteWorkflowInput {
  return {
    type: "select",
    key: "favcat",
    title,
    description,
    required: true,
    selection: "single",
    options: folders.map((folder) => ({
      id: folder.id,
      label: folder.name,
    })),
    allowCreate: false,
  };
}

async function listFavoriteFoldersService(
  settings: PluginSettings,
): Promise<FavoriteFoldersResult> {
  const requestConfig = buildRequestConfig(settings);
  if (!requestConfig) {
    throw authRequiredError("请先登录后再查看收藏分类");
  }

  const favoritesEndpoint = buildFavoritesEndpoint(1, settings.site);
  const html = await httpClient.getText(favoritesEndpoint, requestConfig);
  if (isFavoritesLoginPage(html)) {
    throw authRequiredError("登录状态已失效，请重新登录");
  }

  const folders = parseFavoriteFoldersPage(html);
  return { items: folders.length ? folders : buildFallbackFolders() };
}

async function applyFavorite(
  comicId: string,
  settings: PluginSettings,
  folderId: string,
  options: { existing: boolean; note?: string } = { existing: false },
): Promise<void> {
  const requestConfig = buildRequestConfig(settings);
  if (!requestConfig) {
    throw authRequiredError("请先登录后再收藏");
  }

  const normalizedFolderId = folderId === "favdel" ? folderId : normalizeFolderId(folderId);
  const endpoint = buildFavoritePopupEndpoint(comicId, settings.site);
  const html = await httpClient.postText(
    endpoint,
    {
      favcat: normalizedFolderId,
      favnote: String(options.note ?? ""),
      apply:
        normalizedFolderId === "favdel" || options.existing ? "Apply Changes" : "Add to Favorites",
      update: "1",
    },
    requestConfig,
  );
  if (isFavoritesLoginPage(html)) {
    throw authRequiredError("登录状态已失效，请重新登录");
  }
  if (!String(html ?? "").trim()) {
    throw new Error("收藏请求返回空响应");
  }
}

export async function startFavoriteActionService(
  payload: FavoriteWorkflowStartPayload,
  settings: PluginSettings,
): Promise<FavoriteWorkflowResult> {
  const comicId = String(payload.comicId ?? "").trim();
  if (!comicId) {
    return workflowFailure(payload.action, validationError("comicId 不能为空"), false);
  }

  try {
    normalizeComicId(comicId);
    if (payload.action === "removeAll") {
      await applyFavorite(comicId, settings, "favdel");
      return { status: "completed", favorited: false, committed: true };
    }

    if (payload.action === "removeFromTarget") {
      if (!payload.context?.target?.id && !payload.context?.target?.name) {
        return workflowFailure(
          payload.action,
          validationError("缺少当前收藏分类信息，无法安全移除"),
          true,
        );
      }
      // e-hentai stores one gallery in one category. Removing it from the
      // current category therefore removes its global favorite as well.
      await applyFavorite(comicId, settings, "favdel");
      return { status: "completed", favorited: false, committed: true };
    }

    if (payload.action !== "add" && payload.action !== "move") {
      return workflowFailure(payload.action, validationError("不支持的收藏动作"));
    }

    const folders = await listFavoriteFoldersService(settings);
    const folderIds = folders.items.map((folder) => folder.id);
    return {
      status: "awaitingInput",
      favorited: payload.action === "move",
      committed: false,
      continuationToken: encodeContinuation({
        action: payload.action,
        comicId,
        currentFavorite: payload.action === "move",
        folderIds,
        createdAt: Date.now(),
      }),
      input: buildFavoriteFolderInput(
        folders.items,
        payload.action === "add" ? "加入收藏" : "移动收藏分类",
        payload.action === "add" ? "请选择收藏分类" : "请选择目标收藏分类",
      ),
    };
  } catch (error) {
    return workflowFailure(payload.action, error, payload.action === "move");
  }
}

export async function continueFavoriteActionService(
  payload: FavoriteWorkflowContinuePayload,
  settings: PluginSettings,
): Promise<FavoriteWorkflowResult> {
  const token = decodeContinuation(payload.continuationToken);
  if (
    !token ||
    token.comicId !== String(payload.comicId ?? "").trim() ||
    token.action !== payload.action
  ) {
    return workflowFailure(payload.action, validationError("收藏工作流令牌无效或已过期"));
  }

  if (payload.input.cancelled) {
    return {
      status: "cancelled",
      favorited: token.currentFavorite,
      committed: false,
      message: "用户取消了收藏操作",
    };
  }

  try {
    if (payload.input.created) {
      throw validationError("e-hentai 不支持创建收藏分类");
    }
    const folderId = getFolderIdFromInteraction(payload.input);
    if (!token.folderIds.includes(folderId)) {
      throw validationError("选择的收藏分类不存在或已失效");
    }
    await applyFavorite(token.comicId, settings, folderId, {
      existing: token.action === "move",
    });
    return { status: "completed", favorited: true, committed: true };
  } catch (error) {
    return workflowFailure(payload.action, error, token.currentFavorite);
  }
}
