export type Chapter = {
  id: string;
  project_id: string;
  position: number;
  title: string;
  synopsis: string;
  body: string;
  memory: string;
  continuity_review: number;
  outline_revision: number;
  body_outline_revision: number | null;
  updated_at: string;
  body_length: number;
  body_loaded: boolean;
  outline_loaded: boolean;
};

export type ReaderMode = "outline" | "body";

export function hasBody(chapter?: Pick<Chapter, "body" | "body_length">) {
  return !!chapter && (!!chapter.body || chapter.body_length > 0);
}

export function batchAround(index: number, total: number, mode: ReaderMode) {
  const size = mode === "body" ? 3 : 20;
  const start = Math.floor(Math.max(0, index) / size) * size;
  return { start, end: Math.min(total, start + size) };
}

export function estimatedChapterHeight(chapter: Chapter, mode: ReaderMode, width: number) {
  if (mode === "outline") return 340;
  const charsPerLine = Math.max(12, Math.floor((Math.min(width, 900) - 64) / 17));
  return Math.max(260, Math.ceil(chapter.body_length / charsPerLine) * 32 + 180);
}

export async function fetchChapterBatch(projectId: string, ids: string[], mode: ReaderMode, signal?: AbortSignal): Promise<Chapter[]> {
  if (!ids.length) return [];
  const limit = mode === "body" ? 3 : 20;
  if (ids.length > limit) throw new Error(`单次最多读取 ${limit} 章`);
  const params = new URLSearchParams({ view: "chapters", projectId, ids: ids.join(","), content: mode });
  const response = await fetch(`/api/workspace?${params}`, { cache: "no-store", signal });
  const data = await response.json() as { chapters?: Chapter[]; error?: string };
  if (!response.ok) throw new Error(data.error || "章节读取失败");
  if (!data.chapters || data.chapters.length !== ids.length || data.chapters.some((c, i) => c.id !== ids[i])) {
    throw new Error("章节目录已变化，请刷新目录后重试");
  }
  return data.chapters;
}
