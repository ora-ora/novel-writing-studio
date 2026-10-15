"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { batchAround, Chapter, estimatedChapterHeight, fetchChapterBatch, hasBody, ReaderMode } from "@/lib/chapters";

export type ReaderAction = "rewrite" | "insert" | "body" | "continue" | "bodyRewrite";
export type ReaderJump = { id: string; token: number; mode: ReaderMode };
type ReadingPosition = { chapterId: string; progress: number };
type Props = {
  projectId: string;
  chapters: Chapter[];
  mode: ReaderMode;
  initialChapterId: string;
  jump: ReaderJump | null;
  busy: boolean;
  onRead: (id: string) => void;
  onEdit: (id: string) => void;
  onAI: (id: string, action: ReaderAction) => void;
  onRefresh: () => void;
};

const Slot = memo(function Slot({ chapter, row, index, mode, root, ready, error, busy, width, onVisibility, onMeasured, onRetry, onEdit, onAI }: {
  chapter: Chapter; row?: Chapter; index: number; mode: ReaderMode; root: HTMLElement | null; ready: boolean;
  error?: string; busy: boolean; width: number;
  onVisibility: (id: string, index: number, visible: boolean) => void;
  onMeasured: (id: string) => void;
  onRetry: (index: number) => void;
  onEdit: Props["onEdit"]; onAI: Props["onAI"];
}) {
  const article = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!ready || !article.current) return;
    const observer = new IntersectionObserver(entries => {
      const visible = entries[0].isIntersecting;
      setNear(visible);
      onVisibility(chapter.id, index, visible);
    }, { root, rootMargin: `${Math.max(600, window.innerHeight)}px 0px` });
    observer.observe(article.current);
    return () => { observer.disconnect(); onVisibility(chapter.id, index, false); };
  }, [ready, root, chapter.id, chapter.updated_at, index, onVisibility]);
  useLayoutEffect(() => {
    if (!near || !row || !content.current) return;
    const element = content.current;
    const measure = () => { setHeight(Math.ceil(element.getBoundingClientRect().height)); onMeasured(chapter.id); };
    const observer = new ResizeObserver(measure);
    observer.observe(element); measure();
    return () => observer.disconnect();
  }, [near, row, chapter.id, onMeasured]);
  return <article ref={article} id={`reader-chapter-${chapter.id}`} className="reader-slot" aria-label={`第 ${index + 1} 章 ${chapter.title}`}>
    {near && row ? <div ref={content} className="reader-chapter">
      <div className="reader-chapter-heading"><span className="eyebrow">第 {index + 1} 章</span><h2>{row.title}</h2></div>
      {mode === "outline" ? <p className="reader-prose reader-synopsis">{row.synopsis || "本章还没有概述。"}</p> : <>
        {(!!row.continuity_review || (hasBody(row) && row.body_outline_revision !== null && row.body_outline_revision < row.outline_revision)) && <p className="stale-note">设定或大纲已变化，请在编辑本章时复核正文。</p>}
        {row.body ? <div className="reader-prose">{row.body.split(/\n+/).map((paragraph, i) => <p key={i}>{paragraph || "\u00a0"}</p>)}</div> : <p className="reader-unwritten">尚未创作正文，可以手动写作或让 AI 生成这一章。</p>}
      </>}
      <div className="reader-chapter-actions">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => onEdit(chapter.id)}>编辑本章</Button>
        {mode === "outline" ? <>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onAI(chapter.id, "rewrite")}>AI 重写大纲</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onAI(chapter.id, "insert")}>AI 在此后插入</Button>
        </> : <>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onAI(chapter.id, hasBody(row) ? "continue" : "body")}>{hasBody(row) ? "AI 章末续写" : "AI 生成正文"}</Button>
          {hasBody(row) && <Button variant="ghost" size="sm" disabled={busy} onClick={() => onAI(chapter.id, "bodyRewrite")}>AI 重写正文</Button>}
        </>}
      </div>
    </div> : <div className="reader-placeholder" style={{ height: height || estimatedChapterHeight(chapter, mode, width) }}>
      {near && <div className="reader-load-state" role="status"><span>第 {index + 1} 章 · {chapter.title}</span>{error ? <><p>{error}</p><Button variant="outline" size="sm" onClick={() => onRetry(index)}>重新加载</Button></> : <p>正在预加载…</p>}</div>}
    </div>}
  </article>;
});

export default function ContinuousReader(props: Props) {
  const { projectId, chapters, mode, initialChapterId, jump, busy, onRefresh } = props;
  const container = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [ready, setReady] = useState(false);
  const [width, setWidth] = useState(700);
  const [rows, setRows] = useState<Map<string, Chapter>>(() => new Map());
  const [errors, setErrors] = useState<Map<string, string>>(() => new Map());
  const cache = useRef(new Map<string, Chapter>());
  const metadata = useRef(chapters); metadata.current = chapters;
  const callbacks = useRef(props); callbacks.current = props;
  const nearIds = useRef(new Set<string>());
  const inflight = useRef(new Map<string, AbortController>());
  const alive = useRef(true);
  const pendingPosition = useRef<ReadingPosition | null>(null);
  const lastPosition = useRef<ReadingPosition | null>(null);
  const lastRead = useRef("");
  const initialized = useRef(false);
  const frame = useRef(0);
  const restoreFrame = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const storageKey = `novel-reading:${projectId}:${mode}`;
  const viewportTop = useCallback(() => root ? root.getBoundingClientRect().top : Math.max(0, document.querySelector(".reading-mode .main-top")?.getBoundingClientRect().bottom || 0), [root]);

  const align = useCallback((position: ReadingPosition) => {
    const element = document.getElementById(`reader-chapter-${position.chapterId}`);
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const top = viewportTop();
    const delta = rect.top - top + Math.max(0, Math.min(.98, position.progress)) * rect.height - (position.progress > 0 ? 80 : 20);
    if (root) root.scrollTop += delta;
    else window.scrollBy({ top: delta, behavior: "instant" });
  }, [root, viewportTop]);

  const loadAt = useCallback(async (index: number, retry = false) => {
    const catalog = metadata.current;
    const { start, end } = batchAround(index, catalog.length, mode);
    const needed = catalog.slice(start, end).filter(c => cache.current.get(c.id)?.updated_at !== c.updated_at);
    if (!needed.length) return;
    const key = needed.map(c => `${c.id}:${c.updated_at}`).join("|");
    if (inflight.current.has(key)) return;
    const controller = new AbortController(); inflight.current.set(key, controller);
    if (retry) setErrors(current => { const next = new Map(current); needed.forEach(c => next.delete(c.id)); return next; });
    try {
      const data = await fetchChapterBatch(projectId, needed.map(c => c.id), mode, controller.signal);
      if (!alive.current) return;
      for (const row of data) {
        const current = metadata.current.find(c => c.id === row.id);
        if (!current || current.updated_at !== row.updated_at) throw new Error("章节目录已更新，请刷新目录");
      }
      for (const row of data) { cache.current.delete(row.id); cache.current.set(row.id, row); }
      // Keep a bounded cache. Nearby slots and the restoration target remain mounted.
      let characters = [...cache.current.values()].reduce((n, c) => n + c.body.length + c.synopsis.length, 0);
      for (const [id, row] of cache.current) {
        if (cache.current.size <= (mode === "body" ? 15 : 60) && characters <= 300000) break;
        if (nearIds.current.has(id) || id === pendingPosition.current?.chapterId) continue;
        cache.current.delete(id); characters -= row.body.length + row.synopsis.length;
      }
      setRows(new Map(cache.current));
      setErrors(current => { const next = new Map(current); data.forEach(c => next.delete(c.id)); return next; });
    } catch (error) {
      if (controller.signal.aborted || !alive.current) return;
      setErrors(current => { const next = new Map(current); needed.forEach(c => next.set(c.id, error instanceof Error ? error.message : "章节读取失败")); return next; });
      // Keep the requested position on a failed load; its retry will finish restoration.
    } finally { if (inflight.current.get(key) === controller) inflight.current.delete(key); }
  }, [mode, projectId]);

  const jumpTo = useCallback((id: string, progress = 0) => {
    const index = metadata.current.findIndex(c => c.id === id);
    if (index < 0) return;
    pendingPosition.current = { chapterId: id, progress };
    callbacks.current.onRead(id);
    align(pendingPosition.current);
    void loadAt(index, true);
    cancelAnimationFrame(restoreFrame.current);
    restoreFrame.current = requestAnimationFrame(() => {
      const position = pendingPosition.current;
      if (position?.chapterId === id && document.getElementById(`reader-chapter-${id}`)?.querySelector(".reader-chapter")) {
        align(position); lastPosition.current = position; pendingPosition.current = null;
      }
    });
  }, [align, loadAt]);

  const measurePosition = useCallback(() => {
    if (!alive.current || pendingPosition.current) return;
    const top = viewportTop();
    const line = top + 80;
    const candidates = [...nearIds.current].map(id => ({ id, element: document.getElementById(`reader-chapter-${id}`) })).filter(item => item.element).map(item => ({ id: item.id, rect: item.element!.getBoundingClientRect() })).filter(item => item.rect.bottom > line).sort((a,b) => a.rect.top - b.rect.top);
    const current = candidates.find(item => item.rect.top <= line) || candidates[0];
    if (!current) return;
    const position = { chapterId: current.id, progress: Math.max(0, Math.min(.98, (line - current.rect.top) / current.rect.height)) };
    lastPosition.current = position;
    if (lastRead.current !== current.id) { lastRead.current = current.id; callbacks.current.onRead(current.id); }
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { try { localStorage.setItem(storageKey, JSON.stringify(position)); } catch {} }, 180);
  }, [storageKey, viewportTop]);

  const onMeasured = useCallback((id: string) => {
    if (pendingPosition.current?.chapterId === id) {
      align(pendingPosition.current);
      lastPosition.current = pendingPosition.current;
      pendingPosition.current = null;
    }
    cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(measurePosition);
  }, [align, measurePosition]);

  const onVisibility = useCallback((id: string, index: number, visible: boolean) => {
    if (visible) { nearIds.current.add(id); void loadAt(index); }
    else nearIds.current.delete(id);
    cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(measurePosition);
  }, [loadAt, measurePosition]);

  useEffect(() => {
    const configure = () => { setRoot(window.matchMedia("(max-width: 650px)").matches ? null : container.current); setWidth(container.current?.clientWidth || window.innerWidth); setReady(true); };
    configure(); window.addEventListener("resize", configure);
    return () => window.removeEventListener("resize", configure);
  }, []);

  useEffect(() => {
    if (!ready || initialized.current || !chapters.length) return;
    initialized.current = true;
    let saved: ReadingPosition | null = null;
    try { saved = JSON.parse(localStorage.getItem(storageKey) || "null"); } catch {}
    const requested = jump?.mode === mode ? jump.id : "";
    const id = [requested, saved?.chapterId, initialChapterId, chapters[0].id].find(id => chapters.some(c => c.id === id))!;
    jumpTo(id, !requested && saved?.chapterId === id && Number.isFinite(saved.progress) ? saved.progress : 0);
  }, [ready, chapters, initialChapterId, jump, jumpTo, mode, storageKey]);

  const lastJump = useRef(jump?.token);
  useEffect(() => {
    if (!ready || !jump || jump.mode !== mode || jump.token === lastJump.current) return;
    lastJump.current = jump.token; jumpTo(jump.id);
  }, [ready, jump, jumpTo, mode]);

  useEffect(() => {
    if (!ready) return;
    const target = root || window;
    const scroll = () => { cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(measurePosition); };
    target.addEventListener("scroll", scroll, { passive: true });
    return () => target.removeEventListener("scroll", scroll);
  }, [ready, root, measurePosition]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      inflight.current.forEach(controller => controller.abort()); inflight.current.clear();
      cancelAnimationFrame(frame.current); cancelAnimationFrame(restoreFrame.current); clearTimeout(saveTimer.current);
      if (lastPosition.current) { try { localStorage.setItem(storageKey, JSON.stringify(lastPosition.current)); } catch {} }
    };
  }, [storageKey]);

  const retry = useCallback((index: number) => void loadAt(index, true), [loadAt]);
  const edit = useCallback((id: string) => callbacks.current.onEdit(id), []);
  const ai = useCallback((id: string, action: ReaderAction) => callbacks.current.onAI(id, action), []);
  const slots = useMemo(() => chapters.map((chapter,index) => <Slot key={chapter.id} chapter={chapter} index={index} mode={mode} row={rows.get(chapter.id)?.updated_at === chapter.updated_at ? rows.get(chapter.id) : undefined} root={root} ready={ready} width={width} error={errors.get(chapter.id)} busy={busy} onVisibility={onVisibility} onMeasured={onMeasured} onRetry={retry} onEdit={edit} onAI={ai}/>), [chapters,mode,rows,root,ready,width,errors,busy,onVisibility,onMeasured,retry,edit,ai]);

  return <div ref={container} className="continuous-scroll" aria-label={mode === "outline" ? "连续浏览章节大纲" : "连续阅读小说正文"}>
    <div className="reader-info"><span>共 {chapters.length} 章 · 上下滑动自动预加载</span><Button variant="ghost" size="sm" onClick={onRefresh}>刷新目录</Button></div>
    <div className="reader-list">{slots}</div>
    <p className="reader-end">{chapters.length ? "已到全书结尾" : "还没有章节，先添加章节或生成大纲。"}</p>
  </div>;
}
