const DEFAULT_CHUNK_SIZE = 200;

export type GalleryChunk = {
  index: number;
  start: number;
  end: number;
};

function normalizePositiveInt(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return null;
  }
  const normalized = Math.trunc(num);
  return normalized > 0 ? normalized : null;
}

export function getGalleryChunkSize(): number {
  return DEFAULT_CHUNK_SIZE;
}

export function buildGalleryChunks(
  totalPages?: number,
  chunkSize = DEFAULT_CHUNK_SIZE,
): GalleryChunk[] {
  const normalizedTotal = normalizePositiveInt(totalPages);
  const normalizedChunkSize = normalizePositiveInt(chunkSize);
  if (!normalizedTotal || !normalizedChunkSize) {
    return [{ index: 1, start: 1, end: normalizedChunkSize ?? DEFAULT_CHUNK_SIZE }];
  }

  const chunks: GalleryChunk[] = [];
  for (
    let start = 1, index = 1;
    start <= normalizedTotal;
    start += normalizedChunkSize, index += 1
  ) {
    const end = Math.min(normalizedTotal, start + normalizedChunkSize - 1);
    chunks.push({ index, start, end });
  }
  return chunks;
}

export function formatGalleryChunkName(
  chunk: GalleryChunk,
  totalPages?: number,
): string {
  const maxPage = Math.max(
    normalizePositiveInt(totalPages) ?? chunk.end,
    chunk.end,
  );
  const width = Math.max(3, String(maxPage).length);
  const start = String(chunk.start).padStart(width, "0");
  const end = String(chunk.end).padStart(width, "0");
  return `Gallery ${start}-${end}`;
}

export function resolveGalleryChunkFromExtern(
  extern: Record<string, unknown>,
  totalPages?: number,
  chunkSize = DEFAULT_CHUNK_SIZE,
): GalleryChunk {
  const chunks = buildGalleryChunks(totalPages, chunkSize);
  const requestedIndex = normalizePositiveInt(extern.chunkIndex);
  const requestedStart = normalizePositiveInt(extern.chunkStart);
  const requestedEnd = normalizePositiveInt(extern.chunkEnd);

  if (requestedStart && requestedEnd && requestedStart <= requestedEnd) {
    const normalizedEnd = totalPages
      ? Math.min(requestedEnd, totalPages)
      : requestedEnd;
    const matchingChunk = chunks.find(
      (chunk) =>
        chunk.start === requestedStart && chunk.end === normalizedEnd,
    );
    if (matchingChunk) {
      return matchingChunk;
    }
    return {
      index: requestedIndex ?? 1,
      start: requestedStart,
      end: normalizedEnd,
    };
  }

  if (requestedIndex && requestedIndex <= chunks.length) {
    return chunks[requestedIndex - 1];
  }

  return chunks[0];
}

export function buildGalleryChunkExtern(
  chunk: GalleryChunk,
  totalPages?: number,
  chunkSize = DEFAULT_CHUNK_SIZE,
): Record<string, unknown> {
  return {
    chunkIndex: chunk.index,
    chunkStart: chunk.start,
    chunkEnd: chunk.end,
    chunkSize,
    totalPageCount: normalizePositiveInt(totalPages) ?? chunk.end,
  };
}
