export type ToggleFavoritePayload = {
  comicId?: string;
  currentFavorite?: boolean;
  extern?: Record<string, unknown>;
};

export type ToggleFavoriteResult = {
  favorited: boolean;
  nextStep: "none" | "selectFolder";
};

export type ListFavoriteFoldersResult = {
  items: Array<{ id: string; name: string }>;
};

export type MoveFavoriteToFolderPayload = {
  comicId?: string;
  folderId?: string;
  folderName?: string;
  extern?: Record<string, unknown>;
};
