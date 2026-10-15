import { cleanAIChapterTitle } from "../../../lib/chapter-title";
import { env } from "cloudflare:workers";
import { sessionResponse, workspaceSession } from "./session";

export const runtime = "edge";
type Row = Record<string, unknown>;
const db = () => { if (!env.DB) throw new Error("Database unavailable"); return env.DB; };
const now = () => new Date().toISOString();
const str = (value:unknown, limit:number) => String(value ?? "").slice(0,limit);
function previousStoryBible(project:Row,characters:Row[]=[],cards:Row[]=[]){
  return [project.mainline&&`# 故事主线\n${project.mainline}`,project.premise&&`# 世界与核心冲突\n${project.premise}`,project.important_notes&&`# 重要提示\n${project.important_notes}`,
    ...characters.map(c=>`# 人物\n## ${c.name}\n身份：${c.role||""}\n目标：${c.goal||""}\n性格：${c.traits||""}\n关系：${c.relationships||""}\n秘密：${c.secret||""}\n成长：${c.arc||""}`),
    ...cards.map(c=>`# 其他设定\n## ${c.category}\n${c.content||""}`)].filter(Boolean).join("\n\n").slice(0,60000);
}
const fail = (message:string,status=400) => Response.json({error:message},{status});
async function activeProject(projectId:string) {
  return db().prepare("SELECT * FROM projects WHERE id=? AND deleted_at IS NULL").bind(projectId).first<Row>();
}
async function activeChapter(id:string) {
  return db().prepare("SELECT c.* FROM chapters c JOIN projects p ON p.id=c.project_id WHERE c.id=? AND c.deleted_at IS NULL AND p.deleted_at IS NULL").bind(id).first<Row>();
}
async function snapshot(projectId:string,reason:string) {
  const project=await db().prepare("SELECT * FROM projects WHERE id=?").bind(projectId).first<Row>();
  const rows=await db().prepare("SELECT * FROM chapters WHERE project_id=? AND deleted_at IS NULL ORDER BY position").bind(projectId).all<Row>();
  const characters=await db().prepare("SELECT * FROM characters WHERE project_id=?").bind(projectId).all<Row>();
  const cards=await db().prepare("SELECT * FROM lore_cards WHERE project_id=?").bind(projectId).all<Row>();
  return db().prepare("INSERT INTO project_snapshots (id,project_id,reason,payload,created_at) VALUES (?,?,?,?,?)")
    .bind(crypto.randomUUID(),projectId,reason,JSON.stringify({project,chapters:rows.results,characters:characters.results,cards:cards.results}),now());
}
function insertChapter(projectId:string,c:Row,position:number) {
  return db().prepare("INSERT INTO chapters (id,project_id,position,title,synopsis,body,outline_revision,body_outline_revision,updated_at,memory,continuity_review,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET position=excluded.position,title=excluded.title,synopsis=excluded.synopsis,body=excluded.body,outline_revision=excluded.outline_revision,body_outline_revision=excluded.body_outline_revision,updated_at=excluded.updated_at,memory=excluded.memory,continuity_review=excluded.continuity_review,deleted_at=NULL WHERE chapters.project_id=excluded.project_id")
    .bind(String(c.id||crypto.randomUUID()),projectId,position,str(c.title,180),str(c.synopsis,15000),str(c.body,300000),Number(c.outline_revision)||1,c.body_outline_revision==null?null:Number(c.body_outline_revision),now(),str(c.memory,3000),Number(c.continuity_review)||0);
}

export async function GET(request:Request) {
  const session=workspaceSession(request);
  try {
    const params = new URL(request.url).searchParams;
    if (params.get("view") === "chapters") {
      const projectId = params.get("projectId") || "";
      if (!await activeProject(projectId)) return fail("作品不存在或已删除", 404);
      const ids = (params.get("ids") || "").split(",").filter(Boolean);
      const fullBody = params.get("content") === "body";
      if (!ids.length || ids.length > (fullBody ? 3 : 20) || new Set(ids).size !== ids.length || ids.some(id => id.length > 80)) return fail("章节请求无效");
      const columns = fullBody ? "c.*" : "c.id,c.project_id,c.position,c.title,c.synopsis,c.memory,c.continuity_review,c.outline_revision,c.body_outline_revision,c.updated_at,'' AS body";
      const rows = await db().prepare(`SELECT ${columns},LENGTH(c.body) AS body_length FROM chapters c WHERE c.project_id=? AND c.deleted_at IS NULL AND c.id IN (${ids.map(()=>"?").join(",")})`).bind(projectId, ...ids).all<Row>();
      const byId = new Map(rows.results.map(row => [row.id, row]));
      if (byId.size !== ids.length) return fail("章节目录已变化，请刷新目录后重试", 409);
      return sessionResponse({ chapters: ids.map(id => ({ ...byId.get(id), outline_loaded: true, body_loaded: fullBody })) }, session);
    }
    // Preserve the full response for already-open older clients. The new
    // continuous reader explicitly opts into the lightweight catalog.
    const catalog = params.get("view") === "catalog";
    const columns = catalog ? "c.id,c.project_id,c.position,c.title,c.continuity_review,c.outline_revision,c.body_outline_revision,c.updated_at,LENGTH(c.body) AS body_length,'' AS body,'' AS synopsis,'' AS memory" : "c.*,LENGTH(c.body) AS body_length";
    const [projects,chapters,snapshots,drafts]=await Promise.all([
      db().prepare("SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY updated_at DESC").all<Row>(),
      db().prepare(`SELECT ${columns} FROM chapters c JOIN projects p ON p.id=c.project_id WHERE p.deleted_at IS NULL AND c.deleted_at IS NULL ORDER BY c.position ASC,c.id ASC`).all<Row>(),
      db().prepare("SELECT s.id,s.project_id,s.reason,s.created_at FROM project_snapshots s JOIN projects p ON p.id=s.project_id WHERE p.deleted_at IS NULL ORDER BY s.created_at DESC LIMIT 30").all<Row>(),
      db().prepare("SELECT d.* FROM generation_drafts d JOIN projects p ON p.id=d.project_id WHERE p.deleted_at IS NULL ORDER BY d.created_at DESC LIMIT 30").all<Row>(),
    ]);
    return sessionResponse({projects:projects.results,chapters:chapters.results.map(c=>({...c,body_loaded:!catalog,outline_loaded:!catalog})),snapshots:snapshots.results,drafts:drafts.results},session);
  }catch(error){console.error("workspace read",error);return fail("项目暂时无法读取，请稍后刷新。",503);}
}

export async function POST(request:Request) {
  const session=workspaceSession(request);
  try{
    const data=await request.json() as Row;
    const action=String(data.action||"");
    const id=String(data.id||"");
    const projectId=String(data.projectId||"");
    if(action==="createProject"){
      const newId=crypto.randomUUID();
      await db().prepare("INSERT INTO projects (id,title,premise,summary,mainline,story_bible,important_notes,genre,style,updated_at,workspace_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .bind(newId,str(data.title||"未命名小说",120),"",str(data.summary,8000),"",str(data.story_bible,60000),"",str(data.genre,200),str(data.style,8000),now(),session.id).run();
      return Response.json({id:newId});
    }
    if(action==="updateProject"&&id){
      if(!await activeProject(id))return fail("作品不存在或已删除",403);
      const previous=await activeProject(id);
      const bibleChanged=String(previous?.story_bible||"")!==str(data.story_bible,60000);
      await db().batch([await snapshot(id,"修改作品设定前"),db().prepare("UPDATE projects SET title=?,summary=?,story_bible=?,genre=?,style=?,updated_at=? WHERE id=?")
        .bind(str(data.title||"未命名小说",120),str(data.summary,8000),str(data.story_bible,60000),str(data.genre,200),str(data.style,8000),now(),id),...(bibleChanged?[db().prepare("UPDATE chapters SET continuity_review=1 WHERE project_id=? AND deleted_at IS NULL AND body<>''").bind(id)]:[])]);
      return Response.json({ok:true});
    }
    if(action==="snapshotProject"&&projectId){
      if(!await activeProject(projectId))return fail("作品不存在",403);
      await (await snapshot(projectId,str(data.reason||"手动备份",80))).run();
      return Response.json({ok:true});
    }
    if(action==="deleteProject"&&id){
      if(!await activeProject(id))return fail("作品不存在",403);
      await db().prepare("UPDATE projects SET deleted_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL").bind(now(),now(),id).run();
      return Response.json({ok:true});
    }
    if(action==="addChapter"&&projectId){
      if(!await activeProject(projectId))return fail("作品不存在或已删除",403);
      const newId=crypto.randomUUID();
      const count=await db().prepare("SELECT COALESCE(MAX(position),-1)+1 AS next FROM chapters WHERE project_id=? AND deleted_at IS NULL").bind(projectId).first<{next:number}>();
      await db().prepare("INSERT INTO chapters (id,project_id,position,title,synopsis,body,outline_revision,updated_at,memory) VALUES (?,?,?,?,?,'',1,?,'')")
        .bind(newId,projectId,count?.next??0,str(data.title||"新章节",180),str(data.synopsis,15000),now()).run();
      return Response.json({id:newId});
    }
    if(action==="updateChapter"&&id){
      const row=await activeChapter(id);
      if(!row)return fail("章节不存在或已删除",403);
      const title=str(data.title??row.title,180),synopsis=str(data.synopsis??row.synopsis,15000),body=str(data.body??row.body,300000);
      const changed=title!==row.title||synopsis!==row.synopsis;
      const revision=Number(row.outline_revision)+(changed?1:0);
      await db().prepare("UPDATE chapters SET title=?,synopsis=?,body=?,memory=?,outline_revision=?,body_outline_revision=?,updated_at=? WHERE id=?")
        .bind(title,synopsis,body,str(data.memory??row.memory,3000),revision,data.body_outline_revision===undefined?row.body_outline_revision:data.body_outline_revision===-1?revision:data.body_outline_revision,now(),id).run();
      return Response.json({ok:true,outlineRevision:revision});
    }
    if(action==="markReviewed"&&id){
      if(!await activeChapter(id))return fail("章节不存在",403);
      await db().prepare("UPDATE chapters SET continuity_review=0,updated_at=? WHERE id=?").bind(now(),id).run();
      return Response.json({ok:true});
    }
    if(action==="deleteChapter"&&id){
      const row=await activeChapter(id);if(!row)return fail("章节不存在",403);
      await db().batch([await snapshot(String(row.project_id),"删除章节前"),db().prepare("UPDATE chapters SET deleted_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL").bind(now(),now(),id)]);
      return Response.json({ok:true});
    }
    if(action==="reorder"&&projectId&&Array.isArray(data.ids)){
      if(!await activeProject(projectId))return fail("作品不存在",403);
      const rows=await db().prepare("SELECT id FROM chapters WHERE project_id=? AND deleted_at IS NULL").bind(projectId).all<{id:string}>();
      const ids=data.ids.filter((v):v is string=>typeof v==="string");
      if(ids.length!==rows.results.length||new Set(ids).size!==ids.length||ids.some(v=>!rows.results.some(r=>r.id===v)))return fail("章节列表已变化，请刷新重试",409);
      await db().batch(ids.map((chapterId,i)=>db().prepare("UPDATE chapters SET position=? WHERE id=? AND project_id=? AND deleted_at IS NULL").bind(i,chapterId,projectId)));
      return Response.json({ok:true});
    }
    if(action==="replaceOutline"&&projectId&&Array.isArray(data.chapters)){
      if(!await activeProject(projectId))return fail("作品不存在",403);
      const incoming=data.chapters.slice(0,100).map((c,i)=>({id:crypto.randomUUID(),title:cleanAIChapterTitle((c as Row).title),synopsis:str((c as Row).synopsis,15000),position:i}));
      if(!incoming.length)return fail("大纲不能为空");
      await db().batch([await snapshot(projectId,"重建全书大纲"),db().prepare("UPDATE chapters SET deleted_at=?,updated_at=? WHERE project_id=? AND deleted_at IS NULL").bind(now(),now(),projectId),...incoming.map(c=>insertChapter(projectId,c,c.position))]);
      return Response.json({id:incoming[0].id});
    }
    if(action==="appendOutline"&&projectId&&Array.isArray(data.chapters)){
      if(!await activeProject(projectId))return fail("作品不存在",403);
      const count=await db().prepare("SELECT COALESCE(MAX(position),-1)+1 AS next FROM chapters WHERE project_id=? AND deleted_at IS NULL").bind(projectId).first<{next:number}>();
      const incoming=data.chapters.slice(0,100).map((c,i)=>({id:crypto.randomUUID(),title:cleanAIChapterTitle((c as Row).title),synopsis:str((c as Row).synopsis,15000),position:(count?.next??0)+i}));
      if(!incoming.length)return fail("没有可追加的章节");
      await db().batch([await snapshot(projectId,"追加大纲前"),...incoming.map(c=>insertChapter(projectId,c,c.position))]);
      return Response.json({id:incoming[0].id});
    }
    if(action==="insertOutline"&&projectId&&Array.isArray(data.chapters)){
      if(!await activeProject(projectId))return fail("作品不存在",403);
      const rows=await db().prepare("SELECT id,position,body FROM chapters WHERE project_id=? AND deleted_at IS NULL ORDER BY position").bind(projectId).all<{id:string;position:number;body:string}>();
      const after=String(data.afterChapterId||"");
      const anchor=after?rows.results.findIndex(c=>c.id===after):-1;
      if(after&&anchor<0)return fail("插入位置已变化，请刷新后重试",409);
      const at=anchor+1;
      const incoming=data.chapters.slice(0,30).map((c,i)=>({id:crypto.randomUUID(),title:cleanAIChapterTitle((c as Row).title),synopsis:str((c as Row).synopsis,15000),position:at+i}));
      if(!incoming.length)return fail("没有可插入的章节");
      const neighbors=[rows.results[anchor],rows.results[at]].filter((c):c is {id:string;position:number;body:string}=>!!c&&!!c.body);
      await db().batch([
        await snapshot(projectId,"插入大纲前"),
        db().prepare("UPDATE chapters SET position=position+? WHERE project_id=? AND deleted_at IS NULL AND position>=?").bind(incoming.length,projectId,at),
        ...incoming.map(c=>insertChapter(projectId,c,c.position)),
        ...neighbors.map(c=>db().prepare("UPDATE chapters SET continuity_review=1 WHERE id=?").bind(c.id)),
      ]);
      return Response.json({id:incoming[0].id});
    }
    if(action==="restoreSnapshot"&&id){
      const row=await db().prepare("SELECT s.* FROM project_snapshots s JOIN projects p ON p.id=s.project_id WHERE s.id=? AND p.deleted_at IS NULL").bind(id).first<Row>();
      if(!row)return fail("版本不存在",404);
      const payload=JSON.parse(String(row.payload)) as {project:Row;chapters:Row[];characters?:Row[];cards?:Row[]};
      const restoreProjectId=String(row.project_id);
      await db().batch([await snapshot(restoreProjectId,"恢复前备份"),db().prepare("UPDATE chapters SET deleted_at=?,updated_at=? WHERE project_id=? AND deleted_at IS NULL").bind(now(),now(),restoreProjectId),
        ...payload.chapters.map((c,i)=>insertChapter(restoreProjectId,c,i)),
        db().prepare("UPDATE projects SET title=?,premise=?,summary=?,mainline=?,story_bible=?,important_notes=?,genre=?,style=?,updated_at=? WHERE id=?")
          .bind(str(payload.project.title,120),str(payload.project.premise,12000),str(payload.project.summary,8000),str(payload.project.mainline,10000),str(payload.project.story_bible===undefined?previousStoryBible(payload.project,payload.characters,payload.cards):payload.project.story_bible,60000),str(payload.project.important_notes,6000),str(payload.project.genre,200),str(payload.project.style,8000),now(),restoreProjectId),
        ...(payload.characters?[db().prepare("DELETE FROM characters WHERE project_id=?").bind(restoreProjectId),...payload.characters.map(c=>db().prepare("INSERT INTO characters (id,project_id,name,role,goal,traits,relationships,secret,arc,from_chapter,until_chapter,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind(String(c.id),restoreProjectId,str(c.name,120),str(c.role,200),str(c.goal,2000),str(c.traits,2000),str(c.relationships,2000),str(c.secret,2000),str(c.arc,2000),c.from_chapter??null,c.until_chapter??null,now()))]:[]),
        ...(payload.cards?[db().prepare("DELETE FROM lore_cards WHERE project_id=?").bind(restoreProjectId),...payload.cards.map(c=>db().prepare("INSERT INTO lore_cards (id,project_id,category,content,from_chapter,until_chapter,done,updated_at) VALUES (?,?,?,?,?,?,?,?)").bind(String(c.id),restoreProjectId,str(c.category,40),str(c.content,2500),c.from_chapter??null,c.until_chapter??null,Number(c.done)||0,now()))]:[])]);
      return Response.json({id:restoreProjectId});
    }
    if(action==="saveLoreCard"&&projectId){
      if(!await activeProject(projectId))return fail("作品不存在",403);
      const cardId=id||crypto.randomUUID(),category=str(data.category||"rule",40),content=str(data.content,2500);
      const from=data.from_chapter==null?null:Math.max(1,Math.floor(Number(data.from_chapter)||1));
      const until=data.until_chapter==null?null:Math.max(from||1,Math.floor(Number(data.until_chapter)||1));
      if(!content.trim())return fail("请填写设定内容");
      await db().prepare("INSERT INTO lore_cards (id,project_id,category,content,from_chapter,until_chapter,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET category=excluded.category,content=excluded.content,from_chapter=excluded.from_chapter,until_chapter=excluded.until_chapter,updated_at=excluded.updated_at WHERE project_id=excluded.project_id")
        .bind(cardId,projectId,category,content,from,until,now()).run();
      return Response.json({id:cardId});
    }
    if(action==="saveCharacter"&&projectId){
      if(!await activeProject(projectId))return fail("作品不存在",403);
      const name=str(data.name,120).trim();if(!name)return fail("请填写人物姓名");
      const existing=id?await db().prepare("SELECT id FROM characters WHERE id=? AND project_id=?").bind(id,projectId).first():null;
      if(id&&!existing)return fail("人物设定不存在",404);
      const characterId=id||crypto.randomUUID();
      const from=data.from_chapter==null?null:Math.max(1,Math.floor(Number(data.from_chapter)||1));
      const until=data.until_chapter==null?null:Math.max(from||1,Math.floor(Number(data.until_chapter)||1));
      await db().batch([await snapshot(projectId,"修改人物设定前"),db().prepare("INSERT INTO characters (id,project_id,name,role,goal,traits,relationships,secret,arc,from_chapter,until_chapter,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,role=excluded.role,goal=excluded.goal,traits=excluded.traits,relationships=excluded.relationships,secret=excluded.secret,arc=excluded.arc,from_chapter=excluded.from_chapter,until_chapter=excluded.until_chapter,updated_at=excluded.updated_at WHERE project_id=excluded.project_id")
        .bind(characterId,projectId,name,str(data.role,200),str(data.goal,2000),str(data.traits,2000),str(data.relationships,2000),str(data.secret,2000),str(data.arc,2000),from,until,now()),
        db().prepare("UPDATE chapters SET continuity_review=1 WHERE project_id=? AND deleted_at IS NULL AND body<>'' AND (? IS NULL OR position+1>=?) AND (? IS NULL OR position+1<=?)").bind(projectId,from,from,until,until)]);
      return Response.json({id:characterId});
    }
    if(action==="deleteCharacter"&&id){
      const row=await db().prepare("SELECT c.project_id FROM characters c JOIN projects p ON p.id=c.project_id WHERE c.id=? AND p.deleted_at IS NULL").bind(id).first<{project_id:string}>();
      if(!row)return fail("人物设定不存在",404);
      await db().batch([await snapshot(row.project_id,"删除人物设定前"),db().prepare("DELETE FROM characters WHERE id=?").bind(id),db().prepare("UPDATE chapters SET continuity_review=1 WHERE project_id=? AND deleted_at IS NULL AND body<>''").bind(row.project_id)]);
      return Response.json({ok:true});
    }
    if(action==="convertCharacter"&&id){
      const row=await db().prepare("SELECT l.* FROM lore_cards l JOIN projects p ON p.id=l.project_id WHERE l.id=? AND l.category='character' AND p.deleted_at IS NULL").bind(id).first<Row>();
      if(!row)return fail("旧人物卡不存在",404);
      const projectId=String(row.project_id),characterId=crypto.randomUUID();
      await db().batch([await snapshot(projectId,"转换旧人物卡前"),db().prepare("INSERT INTO characters (id,project_id,name,traits,from_chapter,until_chapter,updated_at) VALUES (?,?,?,?,?,?,?)").bind(characterId,projectId,str(String(row.content).split(/[：:\n]/)[0]||"待命名人物",120),str(row.content,2000),row.from_chapter??null,row.until_chapter??null,now()),db().prepare("DELETE FROM lore_cards WHERE id=?").bind(id)]);
      return Response.json({id:characterId});
    }
    if(action==="deleteLoreCard"&&id){
      const row=await db().prepare("SELECT l.id FROM lore_cards l JOIN projects p ON p.id=l.project_id WHERE l.id=? AND p.deleted_at IS NULL").bind(id).first();
      if(!row)return fail("设定卡不存在",404);
      await db().prepare("DELETE FROM lore_cards WHERE id=?").bind(id).run();return Response.json({ok:true});
    }
    if(action==="markLoreCard"&&id){
      const row=await db().prepare("SELECT l.id FROM lore_cards l JOIN projects p ON p.id=l.project_id WHERE l.id=? AND p.deleted_at IS NULL").bind(id).first();
      if(!row)return fail("设定卡不存在",404);
      await db().prepare("UPDATE lore_cards SET done=?,updated_at=? WHERE id=?").bind(data.done?1:0,now(),id).run();
      return Response.json({ok:true});
    }
    if(action==="saveDraft"&&projectId){
      if(!await activeProject(projectId))return fail("作品不存在",403);
      const draftId=crypto.randomUUID();
      await db().prepare("INSERT INTO generation_drafts (id,project_id,kind,target_id,content,created_at) VALUES (?,?,?,?,?,?)")
        .bind(draftId,projectId,str(data.kind,40),data.targetId?str(data.targetId,100):null,str(data.content,320000),now()).run();
      return Response.json({id:draftId});
    }
    return fail("未知操作");
  }catch(error){console.error("workspace write",error);return fail("保存失败，请保留当前内容并重试。",503);}
}
