// Chapter numbers belong to the directory, not the AI-authored title.
// Require a boundary so a real title such as "第一章的秘密" remains intact.
export function cleanAIChapterTitle(value: unknown): string {
  let title = String(value ?? "").trim();
  const prefix = /^(?:#{1,6}\s*)?(?:第\s*[0-9０-９零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟]+\s*章(?:[\s:：、.．—–-]+|$)|[【\[]\s*第\s*[0-9０-９零〇一二三四五六七八九十百千万两]+\s*章\s*[】\]][\s:：、.．—–-]*)/u;
  while (prefix.test(title)) title = title.replace(prefix, "").trim();
  return title.slice(0, 180) || "未命名章节";
}
