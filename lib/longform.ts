export type SettingEntry = {
 id:string; project_id:string; kind:string; name:string; aliases:string; content:string;
 status:string; hard:number; reveal_position:number|null; source_chapter_id:string|null;
 source_revision:number|null; evidence:string; version:number; updated_at:string;
 reveal_chapter_id?:string|null;
};
export type Reference = {type:string;id:string;version:string|number;label:string;content:string};
export type ContextResult = {text:string;refs:Reference[];included:string[];excluded:string[];budget:number};
export const parseJSON = <T,>(value:unknown,fallback:T):T => {try{return JSON.parse(String(value)) as T;}catch{return fallback;}};
export async function fingerprint(value:unknown){const data=new TextEncoder().encode(typeof value==="string"?value:JSON.stringify(value));return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",data))).map(n=>n.toString(16).padStart(2,"0")).join("");}
export function projectContextVersion(project:Record<string,unknown>,entries:SettingEntry[]){return fingerprint([project.summary,project.style,project.story_bible,project.book_outline,entries.filter(e=>e.hard&&e.status==="confirmed").map(e=>[e.id,e.version]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))]);}
export function orderContext(ids:string[],chapterId?:string|null,revealIds:string[]=[]){const at=chapterId?ids.indexOf(chapterId):-1;return at<0?ids:[...ids.slice(Math.max(0,at-3),at+2),...revealIds.map(id=>"揭露边界:"+id+":"+(ids.indexOf(id)<0?"目标已删除":ids.indexOf(id)>at?"尚未揭露":"可揭露"))];}
export function contextBudget(window:unknown,output=6000){
 const total=Math.min(128000,Math.max(12000,Number(window)||24000));
 return Math.floor(total-output-2048); // Conservative: one Unicode character per token.
}
export function selectSettings(entries:SettingEntry[],query:string,position:number,include:string[]=[],exclude:string[]=[]){
 const terms=query.toLocaleLowerCase();
 const aliases=new Map<string,number>();
 for(const e of entries)for(const name of new Set([e.name,...parseJSON<string[]>(e.aliases,[])].map(n=>n.toLocaleLowerCase())))aliases.set(name,(aliases.get(name)||0)+1);
 return entries.filter(e=>e.status==="confirmed"&&!exclude.includes(e.id)).map(e=>{
   const names=[e.name,...parseJSON<string[]>(e.aliases,[])].filter(n=>n.length>=2&&aliases.get(n.toLocaleLowerCase())===1&&!["老师","队长","父亲","母亲","主角"].includes(n));
   const match=names.some(n=>terms.includes(n.toLocaleLowerCase()));
   return {entry:e,score:e.hard?100:include.includes(e.id)?90:match?70:0};
 }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.entry.id.localeCompare(b.entry.id)).map(x=>({
   ...x,secret:x.entry.reveal_position!==null&&x.entry.reveal_position>position
 }));
}
export async function collectContext(database:D1Database,projectId:string,chapterId:string|undefined,kind:string,query:string,window:unknown,include:string[]=[],exclude:string[]=[]):Promise<ContextResult>{
 const budget=contextBudget(window);
 const project=await database.prepare("SELECT * FROM projects WHERE id=? AND deleted_at IS NULL").bind(projectId).first<Record<string,unknown>>();
 if(!project)throw new Error("作品不存在");
 const chapter=chapterId?await database.prepare("SELECT id,position,outline_revision,body_revision,title,synopsis FROM chapters WHERE id=? AND project_id=? AND deleted_at IS NULL").bind(chapterId,projectId).first<Record<string,unknown>>():null;
 if(chapterId&&!chapter)throw new Error("目标章节不存在");
 const position=Number(chapter?.position??Number.MAX_SAFE_INTEGER);
 const entries=(await database.prepare("SELECT * FROM setting_entries WHERE project_id=? AND status='confirmed' ORDER BY id").bind(projectId).all<SettingEntry>()).results;
 const ordered=(await database.prepare("SELECT id,position FROM chapters WHERE project_id=? AND deleted_at IS NULL ORDER BY position,id").bind(projectId).all<{id:string;position:number}>()).results;
 for(const entry of entries)if(entry.reveal_chapter_id)entry.reveal_position=ordered.find(c=>c.id===entry.reveal_chapter_id)?.position??Number.MAX_SAFE_INTEGER;
 const structured=(await database.prepare("SELECT m.*,c.title,c.position,c.body_revision AS current_revision FROM chapter_memories m JOIN chapters c ON c.id=m.chapter_id WHERE m.project_id=? AND c.deleted_at IS NULL AND m.body_revision=c.body_revision AND c.position<? ORDER BY c.position DESC").bind(projectId,position).all<Record<string,unknown>>()).results;
 const legacy=(await database.prepare("SELECT c.id AS chapter_id,c.title,c.position,c.body_revision,c.memory AS summary,'' AS facts FROM chapters c WHERE c.project_id=? AND c.deleted_at IS NULL AND c.memory<>'' AND c.body_revision=c.memory_revision AND c.position<? AND NOT EXISTS (SELECT 1 FROM chapter_memories m WHERE m.chapter_id=c.id)").bind(projectId,position).all<Record<string,unknown>>()).results;
 const memories=([...structured.map(m=>({...m,ref_type:"memory"})),...legacy.map(m=>({...m,ref_type:"legacyMemory"}))] as (Record<string,unknown>&{ref_type:string})[]).sort((a,b)=>Number(b.position)-Number(a.position));
 const refs:Reference[]=[{type:"project",id:projectId,version:await projectContextVersion(project,entries),label:"作品设定与全书大纲",content:JSON.stringify({summary:project.summary,style:project.style,story_bible:project.story_bible,book_outline:project.book_outline})}];
 refs.push({type:"order",id:projectId,version:await fingerprint(orderContext(ordered.map(c=>c.id),chapterId)),label:"生成时的相关章节顺序",content:orderContext(ordered.map(c=>c.id),chapterId).join(",")});
 if(chapter)refs.push({type:"outline",id:String(chapter.id),version:Number(chapter.outline_revision),label:"目标章纲",content:String(chapter.synopsis)});
 if(chapter)refs.push({type:"body",id:String(chapter.id),version:Number(chapter.body_revision),label:"目标正文版本",content:""});
 const included:string[]=[],excluded:string[]=[];let text=project.book_outline?"[全书大纲]\n"+String(project.book_outline)+"\n":"";const max=Math.floor(budget*.45);
 if(text.length>max)throw new Error("全书大纲超过上下文预算，请精简大纲或提高模型上下文容量");
 if(String(project.story_bible).length>Math.floor(budget*.15))excluded.push("故事资料仅引用开头，请将硬性约束整理为正式设定");
 for(const {entry,secret,score} of selectSettings(entries,query+" "+chapter?.title+" "+chapter?.synopsis,position,include,exclude)){
   const line=`[设定 ${entry.id} v${entry.version} · ${entry.kind} · ${entry.name}${secret?" · 作者秘密，本章禁止揭露":""}]\n${entry.content}\n证据：${entry.evidence}\n`;
   if(text.length+line.length>max){if(score>=90)throw new Error("必要设定超过上下文预算，请减少强制引用或提高模型上下文容量");excluded.push(entry.name);continue;}
   text+=line;included.push(entry.name);refs.push({type:"setting",id:entry.id,version:entry.version,label:entry.name,content:line});
 }
 if(chapter){
  const adjacent=(await database.prepare("SELECT id,position,title,synopsis,body_revision,outline_revision,SUBSTR(body,-600) AS ending FROM chapters WHERE project_id=? AND deleted_at IS NULL AND position>=? AND position<=? ORDER BY position").bind(projectId,Math.max(0,position-3),position+1).all<Record<string,unknown>>()).results;
  for(const c of adjacent){
   if(c.id===chapter.id)continue;
   const boundary=Number((c as Record<string,unknown>).position)>position?"后文参考，禁止提前揭露":"前情";
   const line=`[${boundary} · ${c.title} · 来源 ${c.id}]\n章纲：${c.synopsis}\n${Number((c as Record<string,unknown>).position)<position?"正文末段："+String(c.ending):""}\n`;
   if(text.length+line.length>max)throw new Error("关键衔接资料超过上下文预算，请缩小范围或提高容量");
   text+=line;included.push(String(c.title));
   refs.push({type:"outline",id:String(c.id),version:Number(c.outline_revision),label:String(c.title),content:String(c.synopsis)});
   if(Number(c.position)<position)refs.push({type:"body",id:String(c.id),version:Number(c.body_revision),label:String(c.title),content:String(c.ending)});
  }
 }
 for(const memory of memories){
   const line=`[前情 · 第${Number(memory.position)+1}章 ${memory.title}]\n${memory.summary}\n${memory.facts}\n`;
   if(text.length+line.length>max){excluded.push(String(memory.title));continue;}
   text+=line;included.push(String(memory.title));refs.push({type:memory.ref_type,id:String(memory.chapter_id),version:await fingerprint([memory.body_revision,memory.summary,memory.facts]),label:String(memory.title),content:line});
 }
 const revealIds=entries.filter(e=>e.reveal_chapter_id&&refs.some(ref=>ref.type==="setting"&&ref.id===e.id)).map(e=>e.reveal_chapter_id!);
 const orderRef=refs.find(ref=>ref.type==="order")!;
 orderRef.version=await fingerprint(orderContext(ordered.map(c=>c.id),chapterId,revealIds));
 orderRef.content=JSON.stringify({ids:orderContext(ordered.map(c=>c.id),chapterId),revealIds});
 return {text,refs,included,excluded,budget};
}
export async function saveReferenceRun(database:D1Database,projectId:string,chapterId:string|undefined,kind:string,context:ContextResult,model:string,prompt:string){
 const id=crypto.randomUUID();
 await database.prepare("INSERT INTO reference_runs (id,project_id,chapter_id,kind,snapshot,refs,created_at) VALUES (?,?,?,?,?,?,?)").bind(id,projectId,chapterId||null,kind,JSON.stringify({model,budget:context.budget,included:context.included,excluded:context.excluded,prompt}),JSON.stringify(context.refs),new Date().toISOString()).run();
 return id;
}
export async function invalidateReferences(database:D1Database,projectId:string,type:string,id:string){
 const rows=(await database.prepare("SELECT id,chapter_id,refs,adopted FROM reference_runs WHERE project_id=? AND stale=0").bind(projectId).all<{id:string;chapter_id:string|null;refs:string;adopted:number}>()).results;
 const affected:typeof rows=[];
 const order=type==="order"?(await database.prepare("SELECT id FROM chapters WHERE project_id=? AND deleted_at IS NULL ORDER BY position,id").bind(projectId).all<{id:string}>()).results.map(c=>c.id):[];
 for(const row of rows){
  const refs=parseJSON<Reference[]>(row.refs,[]).filter(ref=>ref.type===type&&ref.id===id);
  if(!refs.length)continue;
  if(type==="order"){
   const unchanged=await Promise.all(refs.map(async ref=>ref.version===await fingerprint(orderContext(order,row.chapter_id,parseJSON<{revealIds?:string[]}>(ref.content,{}).revealIds||[]))));
   if(unchanged.every(Boolean))continue;
  }
  affected.push(row);
 }
 const statements=affected.flatMap(r=>[
   database.prepare("UPDATE reference_runs SET stale=1 WHERE id=?").bind(r.id),
   database.prepare("UPDATE consistency_checks SET stale=1 WHERE run_id=?").bind(r.id),
   ...(r.adopted&&r.chapter_id?[database.prepare("UPDATE chapters SET continuity_review=1 WHERE id=? AND deleted_at IS NULL").bind(r.chapter_id)]:[])
 ]);
 if(statements.length)await database.batch(statements);
}
