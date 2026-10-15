// Destination is the final zero-based position, including when moving forward.
export function moveChapterId(ids: readonly string[], id: string, destination: number): string[] {
  const source = ids.indexOf(id);
  if (source < 0 || !Number.isInteger(destination) || destination < 0 || destination >= ids.length) {
    throw new Error("请选择有效的章节位置");
  }
  const next = [...ids];
  next.splice(source, 1);
  next.splice(destination, 0, id);
  return next;
}
