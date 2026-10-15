// Keep legacy genre/style readable until the author next saves the unified field.
export function mergeCreativeStyle(genre: unknown, style: unknown): string {
  const genreText = String(genre ?? "").trim();
  const styleText = String(style ?? "");
  if (!genreText) return styleText;
  return [`题材：${genreText}`, styleText.trim() ? `文风：${styleText}` : ""].filter(Boolean).join("\n\n");
}

export const creativeStyleTemplate = `题材：
视角：
文风：
节奏：
避免：`;
