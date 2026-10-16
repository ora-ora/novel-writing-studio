import { env } from "cloudflare:workers";
import { collectContext, fingerprint, invalidateReferences, orderContext, parseJSON, projectContextVersion, Reference, SettingEntry } from "../../../lib/longform";
export const runtime="edge";
type Row=Record<string,unknown>;
const cut=(v:unknown,n=12000)=>String(v??"").slice(0,n);
const now=()=>new Date().toISOString();
const fail=(error:string,status=400)=>Response.json({error},{status});
const database=()=>{if(!env.DB)throw new Error("数据库不可用");return env.DB;};
async function project(id:string){return database().prepare("SELECT * FROM projects WHERE id=? AND deleted_at IS NULL").bind(id).first<Row>();}
async function chapter(projectId:string,id:string){return database().prepare("SELECT * FROM chapters WHERE id=? AND project_id=? AND deleted_at IS NULL").bind(id,projectId).first<Row>();}
export async function GET(request:Request){
 try{
  const projectId=new URL(request.url).searchParams.get("projectId")||"";
  if(!await project(projectId))return fail("作品不存在",404);
  const d=database();
  if(new URL(request.url).searchParams.get("view")==="check"){
   const id=new URL(request.url).searchParams.get("id")||"";
   const check=await d.prepare("SELECT id,stale FROM consistency_checks WHERE id=? AND project_id=?").bind(id,projectId).first();
   return check?Response.json(check):fail("检查不存在",404);
  }
  if(new URL(request.url).searchParams.get("view")==="progress"){
   const [jobs,memories]=await Promise.all([
    d.prepare("SELECT * FROM extraction_jobs WHERE project_id=? ORDER BY updated_at DESC LIMIT 10").bind(projectId).all(),
    d.prepare("SELECT m.chapter_id,m.body_revision,c.body_revision AS current_revision FROM chapter_memories m JOIN chapters c ON c.id=m.chapter_id WHERE m.project_id=? AND c.deleted_at IS NULL").bind(projectId).all()
   ]);
   return Response.json({jobs:jobs.results,memories:memories.results});
  }
  const [entries,memories,jobs,runs,checks]=await Promise.all([
   d.prepare("SELECT * FROM setting_entries WHERE project_id=? ORDER BY updated_at DESC").bind(projectId).all(),
   d.prepare("SELECT m.*,c.title,c.position,c.body_revision AS current_revision FROM chapter_memories m JOIN chapters c ON c.id=m.chapter_id WHERE m.project_id=? AND c.deleted_at IS NULL ORDER BY c.position").bind(projectId).all(),
   d.prepare("SELECT * FROM extraction_jobs WHERE project_id=? ORDER BY updated_at DESC LIMIT 10").bind(projectId).all(),
   d.prepare("SELECT id,chapter_id,kind,snapshot,refs,stale,adopted,created_at FROM reference_runs WHERE project_id=? ORDER BY created_at DESC LIMIT 50").bind(projectId).all<Row>(),
   d.prepare("SELECT k.* FROM consistency_checks k WHERE k.project_id=? AND NOT EXISTS (SELECT 1 FROM consistency_checks newer WHERE newer.project_id=k.project_id AND newer.chapter_id=k.chapter_id AND (newer.created_at>k.created_at OR (newer.created_at=k.created_at AND newer.id>k.id))) ORDER BY k.created_at DESC LIMIT 1000").bind(projectId).all()
  ]);
  const order=(await d.prepare("SELECT id FROM chapters WHERE project_id=? AND deleted_at IS NULL ORDER BY position,id").bind(projectId).all<{id:string}>()).results.map(c=>c.id);
  return Response.json({entries:entries.results.map(e=>({...e,...(e.reveal_chapter_id?{reveal_position:order.includes(String(e.reveal_chapter_id))?order.indexOf(String(e.reveal_chapter_id)):e.reveal_position}:{})})),memories:memories.results,jobs:jobs.results,runs:runs.results.map(r=>({...r,snapshot:JSON.stringify({...parseJSON<Row>(r.snapshot,{}),prompt:undefined}),refs:JSON.stringify(parseJSON<Reference[]>(r.refs,[]).map(ref=>({...ref,content:ref.content.length>2000?ref.content.slice(0,2000)+"\n（引用摘录；完整快照已存入数据库）":ref.content})))})),checks:checks.results});
 }catch(e){return fail(e instanceof Error?e.message:"读取失败",503);}
}
export async function POST(request:Request){
 try{
  const data=await request.json() as Row,projectId=cut(data.projectId,100),action=cut(data.action,40),d=database();
  if(!await project(projectId))return fail("作品不存在",404);
  if(action==="references"){
   const context=await collectContext(d,projectId,data.chapterId?cut(data.chapterId,100):undefined,"preview",cut(data.query),data.contextWindow,Array.isArray(data.include)?data.include.map(String):[],Array.isArray(data.exclude)?data.exclude.map(String):[]);
   return Response.json(context);
  }
  if(action==="saveEntry"){
   const id=cut(data.id,100)||crypto.randomUUID(),old=await d.prepare("SELECT * FROM setting_entries WHERE id=? AND project_id=?").bind(id,projectId).first<SettingEntry>();
   if(data.id&&!old)return fail("设定不存在",404);
   if(old&&Number(data.version)!==old.version)return fail("设定已被修改，请刷新后重试",409);
   const kind=cut(data.kind,30),name=cut(data.name,120).trim(),content=cut(data.content,12000).trim();
   if(!["character","world","timeline","foreshadow"].includes(kind)||!name||!content)return fail("请填写设定类型、名称和内容");
   const version=(old?.version||0)+1,status=data.status==="confirmed"?"confirmed":data.status==="ignored"?"ignored":"candidate";
   const aliases=JSON.stringify((Array.isArray(data.aliases)?data.aliases:[]).map(x=>cut(x,80)).filter(Boolean).slice(0,30));
   const revealIndex=data.reveal_position==null||data.reveal_position===""?null:Math.max(0,Number(data.reveal_position)||0);
   const revealTarget=revealIndex===null?null:await d.prepare("SELECT id,position FROM chapters WHERE project_id=? AND deleted_at IS NULL ORDER BY position,id LIMIT 1 OFFSET ?").bind(projectId,revealIndex).first<{id:string;position:number}>();
   const reveal=revealTarget?.position??revealIndex;
   const payload={id,project_id:projectId,kind,name,content,status,aliases,hard:data.hard?1:0,reveal_position:reveal,reveal_chapter_id:revealTarget?.id||null,version,updated_at:now()};
   await d.batch([
    d.prepare("INSERT INTO setting_entries (id,project_id,kind,name,aliases,content,status,hard,reveal_position,reveal_chapter_id,version,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,name=excluded.name,aliases=excluded.aliases,content=excluded.content,status=excluded.status,hard=excluded.hard,reveal_position=excluded.reveal_position,reveal_chapter_id=excluded.reveal_chapter_id,version=excluded.version,updated_at=excluded.updated_at").bind(id,projectId,kind,name,aliases,content,status,payload.hard,reveal,revealTarget?.id||null,version,payload.updated_at),
    d.prepare("INSERT INTO setting_versions (entry_id,version,payload,created_at) VALUES (?,?,?,?)").bind(id,version,JSON.stringify({...old,...payload}),now())
   ]);
   await invalidateReferences(d,projectId,"setting",id);
   if(payload.hard||old?.hard)await invalidateReferences(d,projectId,"project",projectId);
   return Response.json({id,version});
  }
  if(action==="acceptCandidates"){
   const ids=Array.isArray(data.ids)?data.ids.map(String).slice(0,100):[];
   const rows=(await d.prepare("SELECT * FROM setting_entries WHERE project_id=?").bind(projectId).all<SettingEntry>()).results;
   const selected=rows.filter(r=>ids.includes(r.id)&&r.status==="candidate");
   const existing=rows.filter(r=>r.status==="confirmed");
   const names=new Set<string>();
   for(const r of selected){
    if(!r.evidence)return fail("无来源候选请先手动复核");
    if(r.source_chapter_id){
     const source=await chapter(projectId,r.source_chapter_id);
     if(!source||Number(source.body_revision)!==r.source_revision)return fail("候选来源正文已变化，请重新提取",409);
    }else{const source=await project(projectId);if(!String(source?.story_bible||"").includes(r.evidence))return fail("来源故事资料已变化，请重新整理",409);}
    const key=r.kind+":"+r.name;
    if(names.has(key)||existing.some(e=>e.kind===r.kind&&e.name===r.name&&e.content!==r.content))return fail("存在同名或冲突候选，请逐条合并到正式设定",409);
    names.add(key);
   }
   for(const r of selected){
    if(existing.some(e=>e.kind===r.kind&&e.name===r.name&&e.content===r.content)){await d.prepare("UPDATE setting_entries SET status='ignored' WHERE id=?").bind(r.id).run();continue;}
    const target=r.reveal_chapter_id?{id:r.reveal_chapter_id}:r.reveal_position===null?null:await d.prepare("SELECT id FROM chapters WHERE project_id=? AND deleted_at IS NULL ORDER BY position,id LIMIT 1 OFFSET ?").bind(projectId,r.reveal_position).first<{id:string}>();
    await d.batch([d.prepare("UPDATE setting_entries SET status='confirmed',version=version+1,reveal_chapter_id=?,updated_at=? WHERE id=? AND status='candidate'").bind(target?.id||null,now(),r.id),d.prepare("INSERT OR IGNORE INTO setting_versions (entry_id,version,payload,created_at) VALUES (?,?,?,?)").bind(r.id,r.version+1,JSON.stringify({...r,reveal_chapter_id:target?.id||null,status:"confirmed",version:r.version+1}),now())]);
   }
   if(selected.some(r=>r.hard))await invalidateReferences(d,projectId,"project",projectId);
   return Response.json({ok:true,count:selected.length});
  }
  if(action==="saveSettingExtraction"){
   const source=await project(projectId),text=String(source?.story_bible||"");
   if(await fingerprint(text)!==data.sourceHash)return fail("故事资料已变化，请重新整理",409);
   const result=(typeof data.result==="string"?parseJSON<Row>(data.result,{}):data.result||{}) as Row;
   if(!Array.isArray(result.candidates))return fail("模型未返回有效设定候选");
   const existing=(await d.prepare("SELECT name,kind,content FROM setting_entries WHERE project_id=? AND status<>'ignored'").bind(projectId).all<Row>()).results;
   const incoming=(result.candidates as Row[]).slice(0,50).filter(e=>["character","world","timeline","foreshadow"].includes(String(e.kind))&&cut(e.name,120).trim()&&cut(e.content).trim()&&cut(e.evidence,1000).trim()&&text.includes(cut(e.evidence,1000))&&!existing.some(old=>old.name===e.name&&old.kind===e.kind&&old.content===e.content));
   if(incoming.length)await d.batch(incoming.map(e=>d.prepare("INSERT INTO setting_entries (id,project_id,kind,name,aliases,content,status,hard,reveal_position,evidence,updated_at) VALUES (?,?,?,?,?,?,'candidate',?,?,?,?)").bind(crypto.randomUUID(),projectId,cut(e.kind,30),cut(e.name,120),JSON.stringify(Array.isArray(e.aliases)?e.aliases.map(x=>cut(x,80)).slice(0,30):[]),cut(e.content),e.hard?1:0,e.reveal_position==null?null:Math.max(0,Number(e.reveal_position)||0),cut(e.evidence,1000),now())));
   return Response.json({ok:true,count:incoming.length});
  }
  if(action==="saveExtraction"){
   const id=cut(data.chapterId,100),c=await chapter(projectId,id);
   if(!c||Number(c.body_revision)!==Number(data.bodyRevision))return fail("正文已变化，请重新提取",409);
   const result=(typeof data.result==="string"?parseJSON<Row>(data.result,{}):data.result||{}) as Row;
   const summary=cut(result.summary,3000),facts=cut(result.facts,6000);
   if(!summary.trim())return fail("模型没有返回有效摘要，请重试");
   if(data.jobId){
    const job=await d.prepare("SELECT lease_owner,lease_until FROM extraction_jobs WHERE id=? AND project_id=?").bind(cut(data.jobId,100),projectId).first<Row>();
    if(!job||job.lease_owner!==data.owner||Number(job.lease_until)<Date.now())return fail("任务会话已失效，请重新续跑",409);
   }
   const candidates=Array.isArray(result.candidates)?result.candidates.slice(0,30) as Row[]:[];
   const valid=candidates.filter(e=>["character","world","timeline","foreshadow"].includes(String(e.kind))&&cut(e.name,120).trim()&&cut(e.content).trim()&&cut(e.evidence,1000).trim()&&String(c.body).includes(cut(e.evidence,1000)));
   const old=(await d.prepare("SELECT id FROM setting_entries WHERE project_id=? AND source_chapter_id=? AND source_revision=?").bind(projectId,id,c.body_revision).all<{id:string}>()).results;
   await d.batch([
    d.prepare("INSERT INTO chapter_memories (chapter_id,project_id,body_revision,summary,facts,candidates,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(chapter_id) DO UPDATE SET body_revision=excluded.body_revision,summary=excluded.summary,facts=excluded.facts,candidates=excluded.candidates,updated_at=excluded.updated_at").bind(id,projectId,c.body_revision,summary,facts,JSON.stringify(valid),now()),
    d.prepare("UPDATE chapters SET memory=?,memory_revision=body_revision,updated_at=? WHERE id=? AND body_revision=?").bind(summary+"\n"+facts,now(),id,c.body_revision),
    ...(old.length?[]:valid.map(e=>d.prepare("INSERT INTO setting_entries (id,project_id,kind,name,aliases,content,status,hard,reveal_position,source_chapter_id,source_revision,evidence,version,updated_at) VALUES (?,?,?,?,?,?,'candidate',?,?,?,?,?,1,?)").bind(crypto.randomUUID(),projectId,String(e.kind),cut(e.name,120),JSON.stringify((Array.isArray(e.aliases)?e.aliases:[]).map(x=>cut(x,80)).slice(0,30)),cut(e.content),e.hard?1:0,Number(c.position),id,c.body_revision,cut(e.evidence,1000),now())))
   ]);
   await d.prepare("UPDATE setting_entries SET reveal_chapter_id=source_chapter_id WHERE project_id=? AND source_chapter_id=? AND reveal_chapter_id IS NULL").bind(projectId,id).run();
   await invalidateReferences(d,projectId,"memory",id);
   await invalidateReferences(d,projectId,"legacyMemory",id);
   if(data.jobId){
    const job=await d.prepare("SELECT * FROM extraction_jobs WHERE id=? AND project_id=?").bind(cut(data.jobId,100),projectId).first<Row>();
    if(job){const completed=parseJSON<Record<string,number>>(job.completed,{});completed[id]=Number(c.body_revision);await d.prepare("UPDATE extraction_jobs SET completed=?,error='',updated_at=? WHERE id=?").bind(JSON.stringify(completed),now(),job.id).run();}
   }
   return Response.json({ok:true,candidates:valid.length,rejected:candidates.length-valid.length});
  }
  if(action==="saveMemory"){
   const c=await chapter(projectId,cut(data.chapterId,100));if(!c||Number(c.body_revision)!==Number(data.bodyRevision))return fail("正文已变化，请重新读取",409);
   const old=await d.prepare("SELECT updated_at FROM chapter_memories WHERE chapter_id=?").bind(c.id).first<Row>();
   if(old&&data.expectedUpdatedAt!==old.updated_at)return fail("记忆已被修改，请刷新",409);
   await d.batch([d.prepare("INSERT INTO chapter_memories (chapter_id,project_id,body_revision,summary,facts,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(chapter_id) DO UPDATE SET summary=excluded.summary,facts=excluded.facts,body_revision=excluded.body_revision,updated_at=excluded.updated_at").bind(c.id,projectId,c.body_revision,cut(data.summary,3000),cut(data.facts,6000),now()),d.prepare("UPDATE chapters SET memory=?,memory_revision=?,updated_at=? WHERE id=? AND body_revision=?").bind(cut(data.summary,3000)+"\n"+cut(data.facts,6000),c.body_revision,now(),c.id,c.body_revision)]);
   await invalidateReferences(d,projectId,"memory",String(c.id));await invalidateReferences(d,projectId,"legacyMemory",String(c.id));return Response.json({ok:true});
  }
  if(action==="createJob"){
   const rows=(await d.prepare("SELECT id,position,body_revision FROM chapters WHERE project_id=? AND deleted_at IS NULL AND body<>'' ORDER BY position").bind(projectId).all<Row>()).results;
   const start=Math.max(1,Number(data.start)||1),end=Math.max(start,Number(data.end)||Number.MAX_SAFE_INTEGER);
   const ids=rows.filter(c=>Number(c.position)+1>=start&&Number(c.position)+1<=end).map(c=>c.id);
   if(!ids.length)return fail("范围内没有正文");
   const id=crypto.randomUUID();await d.prepare("INSERT INTO extraction_jobs (id,project_id,chapters,kind,updated_at) VALUES (?,?,?,?,?)").bind(id,projectId,JSON.stringify(ids),data.kind==="scan"?"scan":"extract",now()).run();return Response.json({id});
  }
  if(action==="jobProgress"){
   const c=await chapter(projectId,cut(data.chapterId,100));
   if(!c||Number(c.body_revision)!==Number(data.bodyRevision))return fail("章节已变化",409);
   const job=await d.prepare("SELECT * FROM extraction_jobs WHERE id=? AND project_id=?").bind(cut(data.id,100),projectId).first<Row>();
   if(!job||job.lease_owner!==data.owner||Number(job.lease_until)<Date.now())return fail("任务会话已失效",409);
   const completed=parseJSON<Record<string,number>>(job.completed,{});completed[String(c.id)]=Number(c.body_revision);
   await d.prepare("UPDATE extraction_jobs SET completed=?,updated_at=? WHERE id=?").bind(JSON.stringify(completed),now(),job.id).run();return Response.json({ok:true});
  }
  if(action==="jobState"){
   const id=cut(data.id,100),job=await d.prepare("SELECT * FROM extraction_jobs WHERE id=? AND project_id=?").bind(id,projectId).first<Row>();if(!job)return fail("任务不存在",404);
   const status=["running","paused","completed","failed"].includes(String(data.status))?String(data.status):"paused";
   const owner=cut(data.owner,100);if(!owner)return fail("缺少任务会话");
   if(status==="running"){
    const result=await d.prepare("UPDATE extraction_jobs SET status='running',lease_owner=?,lease_until=?,error='',updated_at=? WHERE id=? AND (lease_owner=? OR lease_until<?)").bind(owner,Date.now()+180000,now(),id,owner,Date.now()).run();
    if(!result.meta.changes)return fail("另一页面正在处理该任务，请稍后续跑",409);
   }else{
    const result=await d.prepare("UPDATE extraction_jobs SET status=?,error=?,lease_owner='',lease_until=0,updated_at=? WHERE id=? AND lease_owner=?").bind(status,cut(data.error,1000),now(),id,owner).run();
    if(!result.meta.changes)return fail("任务已由其他页面接管",409);
   }
   return Response.json({ok:true});
  }
  if(action==="adoptRun"){
   const run=await d.prepare("SELECT * FROM reference_runs WHERE id=? AND project_id=?").bind(cut(data.runId,100),projectId).first<Row>();if(!run)return fail("引用记录不存在",404);
   let stale=false;
   const entries=(await d.prepare("SELECT * FROM setting_entries WHERE project_id=?").bind(projectId).all<SettingEntry>()).results;
   for(const ref of parseJSON<Reference[]>(run.refs,[])){
    if(ref.type==="order"){
     const rows=(await d.prepare("SELECT id FROM chapters WHERE project_id=? AND deleted_at IS NULL ORDER BY position,id").bind(projectId).all<{id:string}>()).results;
     if(await fingerprint(orderContext(rows.map(c=>c.id),String(run.chapter_id||""),parseJSON<{revealIds?:string[]}>(ref.content,{}).revealIds||[]))!==ref.version)stale=true;
    }
    if(ref.id===run.chapter_id&&ref.type==="body")continue; // Adopting replaces this baseline.
    if(ref.id===run.chapter_id&&ref.type==="outline"&&run.kind==="rewrite")continue;
    if(ref.type==="project"){if(await projectContextVersion((await project(projectId))!,entries)!==ref.version)stale=true;}
    if(ref.type==="setting"&&!entries.some(e=>e.id===ref.id&&e.version===ref.version&&e.status==="confirmed"))stale=true;
    if(ref.type==="legacyMemory"){
     const c=await chapter(projectId,ref.id);
     if(!c||c.memory_revision!==c.body_revision||await fingerprint([c.body_revision,c.memory,""])!==ref.version)stale=true;
    }
    if(["outline","body","memory"].includes(ref.type)){
     if(ref.type==="memory"){
      const memory=await d.prepare("SELECT m.*,c.body_revision AS current_revision FROM chapter_memories m JOIN chapters c ON c.id=m.chapter_id WHERE m.chapter_id=? AND m.project_id=? AND c.deleted_at IS NULL").bind(ref.id,projectId).first<Row>();
      if(!memory||memory.body_revision!==memory.current_revision||await fingerprint([memory.body_revision,memory.summary,memory.facts])!==ref.version)stale=true;
      continue;
     }
     const c=await chapter(projectId,ref.id),version=ref.type==="outline"?c?.outline_revision:ref.type==="body"?c?.body_revision:c?.memory_revision;
     if(!c||Number(version)!==Number(ref.version)||ref.type==="memory"&&c.memory_revision!==c.body_revision)stale=true;
    }
   }
   await d.prepare("UPDATE reference_runs SET adopted=1,stale=? WHERE id=?").bind(stale?1:0,run.id).run();
   if(stale&&run.chapter_id)await d.prepare("UPDATE chapters SET continuity_review=1 WHERE id=?").bind(run.chapter_id).run();
   return Response.json({ok:true});
  }
  if(action==="resolveFinding"){
   const check=await d.prepare("SELECT * FROM consistency_checks WHERE id=? AND project_id=?").bind(cut(data.id,100),projectId).first<Row>();if(!check)return fail("检查不存在",404);
   const resolutions=parseJSON<Record<string,string>>(check.resolutions,{});resolutions[cut(data.index,10)]=cut(data.resolution,100);
   await d.prepare("UPDATE consistency_checks SET resolutions=? WHERE id=?").bind(JSON.stringify(resolutions),check.id).run();return Response.json({ok:true});
  }
  if(action==="fullScan"){
   await d.prepare("UPDATE chapters SET continuity_review=1 WHERE project_id=? AND deleted_at IS NULL AND body<>''").bind(projectId).run();return Response.json({ok:true});
  }
  return fail("未知操作");
 }catch(e){return fail(e instanceof Error?e.message:"操作失败",500);}
}
