import { env } from "cloudflare:workers";
import { sessionResponse, workspaceSession } from "./session";

export const runtime = "edge";
type Row = Record<string, unknown>;
const db = () => { if (!env.DB) throw new Error("Database unavailable"); return env.DB; };
const now = () => new Date().toISOString();
const str = (value:unknown, limit:number) => String(value ?? "").slice(0,limit);
const fail = (message:string,status=400) => Response.json({error:message},{status});
async function owned(projectId:string, workspaceId:string) {
  return db().prepare("SELECT * FROM projects WHERE id=? AND workspace_id=?").bind(projectId,workspaceId).first<Row>();
}
async function ownedChapter(id:string,workspaceId:string) {
  return db().prepare("SELECT c.* FROM chapters c JOIN projects p ON p.id=c.project_id WHERE c.id=? AND p.workspace_id=?").bind(id,workspaceId).first<Row>();
}
async function snapshot(projectId:string,reason:string) {
  const project=await db().prepare("SELECT * FROM projects WHERE id=?").bind(projectId).first<Row>();
  const rows=await db().prepare("SELECT * FROM chapters WHERE project_id=? ORDER BY position").bind(projectId).all<Row>();
  return db().prepare("INSERT INTO project_snapshots (id,project_id,reason,payload,created_at) VALUES (?,?,?,?,?)")
    .bind(crypto.randomUUID(),projectId,reason,JSON.stringify({project,chapters:rows.results}),now());
}
function insertChapter(projectId:string,c:Row,position:number) {
  return db().prepare("INSERT INTO chapters (id,project_id,position,title,synopsis,body,outline_revision,body_outline_revision,updated_at,memory) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .bind(String(c.id||crypto.randomUUID()),projectId,position,str(c.title,180),str(c.synopsis,15000),str(c.body,300000),Number(c.outline_revision)||1,c.body_outline_revision==null?null:Number(c.body_outline_revision),now(),str(c.memory,3000));
}

export async function GET(request:Request) {
  const session=workspaceSession(request);
  try {
    const [projects,chapters,cards,snapshots,drafts]=await Promise.all([
      db().prepare("SELECT * FROM projects WHERE workspace_id=? OR workspace_id='legacy' ORDER BY updated_at DESC").bind(session.id).all<Row>(),
      db().prepare("SELECT c.* FROM chapters c JOIN projects p ON p.id=c.project_id WHERE p.workspace_id=? OR p.workspace_id='legacy' ORDER BY c.position ASC").bind(session.id).all<Row>(),
      db().prepare("SELECT l.* FROM lore_cards l JOIN projects p ON p.id=l.project_id WHERE p.workspace_id=? ORDER BY l.updated_at DESC").bind(session.id).all<Row>(),
      db().prepare("SELECT s.id,s.project_id,s.reason,s.created_at FROM project_snapshots s JOIN projects p ON p.id=s.project_id WHERE p.workspace_id=? ORDER BY s.created_at DESC LIMIT 30").bind(session.id).all<Row>(),
      db().prepare("SELECT d.* FROM generation_drafts d JOIN projects p ON p.id=d.project_id WHERE p.workspace_id=? ORDER BY d.created_at DESC LIMIT 30").bind(session.id).all<Row>(),
    ]);
    return sessionResponse({projects:projects.results.map(p=>({...p,legacy:p.workspace_id==="legacy"})),chapters:chapters.results,cards:cards.results,snapshots:snapshots.results,drafts:drafts.results},session);
  }catch(error){console.error("workspace read",error);return fail("项目暂时无法读取，请稍后刷新。",503);}
}

export async function POST(request:Request) {
  const session=workspaceSession(request);
  if(session.fresh)return fail("工作区会话尚未建立，请刷新页面重试",401);
  try{
    const data=await request.json() as Row;
    const action=String(data.action||"");
    const id=String(data.id||"");
    const projectId=String(data.projectId||"");
    if(action==="createProject"){
      const newId=crypto.randomUUID();
      await db().prepare("INSERT INTO projects (id,title,premise,summary,important_notes,genre,style,updated_at,workspace_id) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(newId,str(data.title||"未命名小说",120),str(data.premise,12000),str(data.summary,8000),str(data.important_notes,6000),str(data.genre,200),str(data.style,2000),now(),session.id).run();
      return Response.json({id:newId});
    }
    if(action==="cloneLegacy"&&id){
      const old=await db().prepare("SELECT * FROM projects WHERE id=? AND workspace_id='legacy'").bind(id).first<Row>();
      if(!old)return fail("旧版作品不存在",404);
      const chapters=await db().prepare("SELECT * FROM chapters WHERE project_id=? ORDER BY position").bind(id).all<Row>();
      const newId=crypto.randomUUID();
      await db().batch([
        db().prepare("INSERT INTO projects (id,title,premise,summary,important_notes,genre,style,updated_at,workspace_id) VALUES (?,?,?,?,?,?,?,?,?)")
          .bind(newId,str(old.title,120),str(old.premise,12000),str(old.summary,8000),str(old.important_notes,6000),str(old.genre,200),str(old.style,2000),now(),session.id),
        ...chapters.results.map((c,i)=>insertChapter(newId,{...c,id:crypto.randomUUID()},i)),
      ]);
      return Response.json({id:newId});
    }
    if(action==="updateProject"&&id){
      if(!await owned(id,session.id))return fail("作品不存在或需要先复制到私人工作区",403);
      await db().batch([await snapshot(id,"修改作品设定前"),db().prepare("UPDATE projects SET title=?,premise=?,summary=?,important_notes=?,genre=?,style=?,updated_at=? WHERE id=? AND workspace_id=?")
        .bind(str(data.title||"未命名小说",120),str(data.premise,12000),str(data.summary,8000),str(data.important_notes,6000),str(data.genre,200),str(data.style,2000),now(),id,session.id)]);
      return Response.json({ok:true});
    }
    if(action==="snapshotProject"&&projectId){
      if(!await owned(projectId,session.id))return fail("作品不存在",403);
      await (await snapshot(projectId,str(data.reason||"手动备份",80))).run();
      return Response.json({ok:true});
    }
    if(action==="deleteProject"&&id){
      if(!await owned(id,session.id))return fail("作品不存在",403);
      await db().batch([db().prepare("DELETE FROM chapters WHERE project_id=?").bind(id),db().prepare("DELETE FROM projects WHERE id=? AND workspace_id=?").bind(id,session.id)]);
      return Response.json({ok:true});
    }
    if(action==="addChapter"&&projectId){
      if(!await owned(projectId,session.id))return fail("请先复制旧版作品",403);
      const newId=crypto.randomUUID();
      const count=await db().prepare("SELECT COALESCE(MAX(position),-1)+1 AS next FROM chapters WHERE project_id=?").bind(projectId).first<{next:number}>();
      await db().prepare("INSERT INTO chapters (id,project_id,position,title,synopsis,body,outline_revision,updated_at,memory) VALUES (?,?,?,?,?,'',1,?,'')")
        .bind(newId,projectId,count?.next??0,str(data.title||"新章节",180),str(data.synopsis,15000),now()).run();
      return Response.json({id:newId});
    }
    if(action==="updateChapter"&&id){
      const row=await ownedChapter(id,session.id);
      if(!row)return fail("章节不存在或需要先复制旧版作品",403);
      const title=str(data.title??row.title,180),synopsis=str(data.synopsis??row.synopsis,15000),body=str(data.body??row.body,300000);
      const changed=title!==row.title||synopsis!==row.synopsis;
      const revision=Number(row.outline_revision)+(changed?1:0);
      await db().prepare("UPDATE chapters SET title=?,synopsis=?,body=?,memory=?,outline_revision=?,body_outline_revision=?,updated_at=? WHERE id=?")
        .bind(title,synopsis,body,str(data.memory??row.memory,3000),revision,data.body_outline_revision===undefined?row.body_outline_revision:data.body_outline_revision===-1?revision:data.body_outline_revision,now(),id).run();
      return Response.json({ok:true,outlineRevision:revision});
    }
    if(action==="deleteChapter"&&id){
      const row=await ownedChapter(id,session.id);if(!row)return fail("章节不存在",403);
      await db().batch([await snapshot(String(row.project_id),"删除章节"),db().prepare("DELETE FROM chapters WHERE id=?").bind(id)]);
      return Response.json({ok:true});
    }
    if(action==="reorder"&&projectId&&Array.isArray(data.ids)){
      if(!await owned(projectId,session.id))return fail("作品不存在",403);
      const rows=await db().prepare("SELECT id FROM chapters WHERE project_id=?").bind(projectId).all<{id:string}>();
      const ids=data.ids.filter((v):v is string=>typeof v==="string");
      if(ids.length!==rows.results.length||new Set(ids).size!==ids.length||ids.some(v=>!rows.results.some(r=>r.id===v)))return fail("章节列表已变化，请刷新重试",409);
      await db().batch(ids.map((chapterId,i)=>db().prepare("UPDATE chapters SET position=? WHERE id=? AND project_id=?").bind(i,chapterId,projectId)));
      return Response.json({ok:true});
    }
    if(action==="replaceOutline"&&projectId&&Array.isArray(data.chapters)){
      if(!await owned(projectId,session.id))return fail("作品不存在",403);
      const incoming=data.chapters.slice(0,100).map((c,i)=>({id:crypto.randomUUID(),title:str((c as Row).title,180),synopsis:str((c as Row).synopsis,15000),position:i}));
      if(!incoming.length)return fail("大纲不能为空");
      await db().batch([await snapshot(projectId,"重建全书大纲"),db().prepare("DELETE FROM chapters WHERE project_id=?").bind(projectId),...incoming.map(c=>insertChapter(projectId,c,c.position))]);
      return Response.json({id:incoming[0].id});
    }
    if(action==="appendOutline"&&projectId&&Array.isArray(data.chapters)){
      if(!await owned(projectId,session.id))return fail("作品不存在",403);
      const count=await db().prepare("SELECT COALESCE(MAX(position),-1)+1 AS next FROM chapters WHERE project_id=?").bind(projectId).first<{next:number}>();
      const incoming=data.chapters.slice(0,100).map((c,i)=>({id:crypto.randomUUID(),title:str((c as Row).title,180),synopsis:str((c as Row).synopsis,15000),position:(count?.next??0)+i}));
      if(!incoming.length)return fail("没有可追加的章节");
      await db().batch([await snapshot(projectId,"追加大纲前"),...incoming.map(c=>insertChapter(projectId,c,c.position))]);
      return Response.json({id:incoming[0].id});
    }
    if(action==="restoreSnapshot"&&id){
      const row=await db().prepare("SELECT s.* FROM project_snapshots s JOIN projects p ON p.id=s.project_id WHERE s.id=? AND p.workspace_id=?").bind(id,session.id).first<Row>();
      if(!row)return fail("版本不存在",404);
      const payload=JSON.parse(String(row.payload)) as {project:Row;chapters:Row[]};
      const restoreProjectId=String(row.project_id);
      await db().batch([await snapshot(restoreProjectId,"恢复前备份"),db().prepare("DELETE FROM chapters WHERE project_id=?").bind(restoreProjectId),
        ...payload.chapters.map((c,i)=>insertChapter(restoreProjectId,c,i)),
        db().prepare("UPDATE projects SET title=?,premise=?,summary=?,important_notes=?,genre=?,style=?,updated_at=? WHERE id=? AND workspace_id=?")
          .bind(str(payload.project.title,120),str(payload.project.premise,12000),str(payload.project.summary,8000),str(payload.project.important_notes,6000),str(payload.project.genre,200),str(payload.project.style,2000),now(),restoreProjectId,session.id)]);
      return Response.json({id:restoreProjectId});
    }
    if(action==="saveLoreCard"&&projectId){
      if(!await owned(projectId,session.id))return fail("作品不存在",403);
      const cardId=id||crypto.randomUUID(),category=str(data.category||"rule",40),content=str(data.content,2500);
      const from=data.from_chapter==null?null:Math.max(1,Math.floor(Number(data.from_chapter)||1));
      const until=data.until_chapter==null?null:Math.max(from||1,Math.floor(Number(data.until_chapter)||1));
      if(!content.trim())return fail("请填写设定内容");
      await db().prepare("INSERT INTO lore_cards (id,project_id,category,content,from_chapter,until_chapter,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET category=excluded.category,content=excluded.content,from_chapter=excluded.from_chapter,until_chapter=excluded.until_chapter,updated_at=excluded.updated_at WHERE project_id=excluded.project_id")
        .bind(cardId,projectId,category,content,from,until,now()).run();
      return Response.json({id:cardId});
    }
    if(action==="deleteLoreCard"&&id){
      const row=await db().prepare("SELECT l.id FROM lore_cards l JOIN projects p ON p.id=l.project_id WHERE l.id=? AND p.workspace_id=?").bind(id,session.id).first();
      if(!row)return fail("设定卡不存在",404);
      await db().prepare("DELETE FROM lore_cards WHERE id=?").bind(id).run();return Response.json({ok:true});
    }
    if(action==="markLoreCard"&&id){
      const row=await db().prepare("SELECT l.id FROM lore_cards l JOIN projects p ON p.id=l.project_id WHERE l.id=? AND p.workspace_id=?").bind(id,session.id).first();
      if(!row)return fail("设定卡不存在",404);
      await db().prepare("UPDATE lore_cards SET done=?,updated_at=? WHERE id=?").bind(data.done?1:0,now(),id).run();
      return Response.json({ok:true});
    }
    if(action==="saveDraft"&&projectId){
      if(!await owned(projectId,session.id))return fail("作品不存在",403);
      const draftId=crypto.randomUUID();
      await db().prepare("INSERT INTO generation_drafts (id,project_id,kind,target_id,content,created_at) VALUES (?,?,?,?,?,?)")
        .bind(draftId,projectId,str(data.kind,40),data.targetId?str(data.targetId,100):null,str(data.content,320000),now()).run();
      return Response.json({id:draftId});
    }
    return fail("未知操作");
  }catch(error){console.error("workspace write",error);return fail("保存失败，请保留当前内容并重试。",503);}
}
