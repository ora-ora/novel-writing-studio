import { env } from "cloudflare:workers";

export const runtime = "edge";
const db = () => { if (!env.DB) throw new Error("Database unavailable"); return env.DB; };
const now = () => new Date().toISOString();
const fail = (message: string, status = 400) => Response.json({ error: message }, { status });

export async function GET() {
  try {
    const [projects, chapters] = await Promise.all([
      db().prepare("SELECT * FROM projects ORDER BY updated_at DESC").all(),
      db().prepare("SELECT * FROM chapters ORDER BY position ASC").all(),
    ]);
    return Response.json({ projects: projects.results, chapters: chapters.results });
  } catch (error) {
    console.error("workspace read", error);
    return fail("项目暂时无法读取，请稍后刷新。", 503);
  }
}

export async function POST(request: Request) {
  try {
    const data = await request.json() as Record<string, unknown>;
    const action = String(data.action || "");
    const id = String(data.id || "");
    const projectId = String(data.projectId || "");
    if (action === "createProject") {
      const title = String(data.title || "未命名小说").trim().slice(0, 120);
      const newId = crypto.randomUUID();
      await db().prepare("INSERT INTO projects (id,title,premise,summary,important_notes,genre,style,updated_at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(newId, title, String(data.premise || "").slice(0, 12000), String(data.summary || "").slice(0, 8000), String(data.important_notes || "").slice(0, 6000), String(data.genre || "").slice(0, 200), String(data.style || "").slice(0, 2000), now()).run();
      return Response.json({ id: newId });
    }
    if (action === "updateProject" && id) {
      await db().prepare("UPDATE projects SET title=?,premise=?,summary=?,important_notes=?,genre=?,style=?,updated_at=? WHERE id=?")
        .bind(String(data.title || "未命名小说").slice(0, 120), String(data.premise || "").slice(0, 12000), String(data.summary || "").slice(0, 8000), String(data.important_notes || "").slice(0, 6000), String(data.genre || "").slice(0, 200), String(data.style || "").slice(0, 2000), now(), id).run();
      return Response.json({ ok: true });
    }
    if (action === "deleteProject" && id) {
      await db().batch([
        db().prepare("DELETE FROM chapters WHERE project_id=?").bind(id),
        db().prepare("DELETE FROM projects WHERE id=?").bind(id),
      ]);
      return Response.json({ ok: true });
    }
    if (action === "addChapter" && projectId) {
      const newId = crypto.randomUUID();
      const count = await db().prepare("SELECT COALESCE(MAX(position),-1)+1 AS next FROM chapters WHERE project_id=?").bind(projectId).first<{next:number}>();
      await db().prepare("INSERT INTO chapters (id,project_id,position,title,synopsis,body,outline_revision,updated_at) VALUES (?,?,?,?,?,'',1,?)")
        .bind(newId, projectId, count?.next ?? 0, String(data.title || "新章节").slice(0, 180), String(data.synopsis || "").slice(0, 15000), now()).run();
      return Response.json({ id: newId });
    }
    if (action === "updateChapter" && id) {
      const row = await db().prepare("SELECT * FROM chapters WHERE id=?").bind(id).first<Record<string, unknown>>();
      if (!row) return fail("章节不存在", 404);
      const title = String(data.title ?? row.title).slice(0,180);
      const synopsis = String(data.synopsis ?? row.synopsis).slice(0,15000);
      const body = String(data.body ?? row.body).slice(0,300000);
      const changed = title !== row.title || synopsis !== row.synopsis;
      await db().prepare("UPDATE chapters SET title=?,synopsis=?,body=?,outline_revision=?,body_outline_revision=?,updated_at=? WHERE id=?")
        .bind(title,synopsis,body,Number(row.outline_revision)+(changed?1:0), data.bodyOutlineRevision === undefined ? row.body_outline_revision : data.bodyOutlineRevision,now(),id).run();
      return Response.json({ ok:true, outlineRevision:Number(row.outline_revision)+(changed?1:0) });
    }
    if (action === "deleteChapter" && id) {
      await db().prepare("DELETE FROM chapters WHERE id=?").bind(id).run();
      return Response.json({ok:true});
    }
    if (action === "reorder" && projectId && Array.isArray(data.ids)) {
      const ids = data.ids.filter((v):v is string=>typeof v === "string").slice(0,300);
      await db().batch(ids.map((chapterId,i)=>db().prepare("UPDATE chapters SET position=? WHERE id=? AND project_id=?").bind(i,chapterId,projectId)));
      return Response.json({ok:true});
    }
    return fail("未知操作");
  } catch (error) {
    console.error("workspace write", error);
    return fail("保存失败，请保留当前内容并重试。", 503);
  }
}
