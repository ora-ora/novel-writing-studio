"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Textarea} from "@/components/ui/textarea";
import {Chapter,fetchChapterBatch} from "@/lib/chapters";
import {parseJSON,SettingEntry} from "@/lib/longform";
import {toast} from "sonner";

export type AIResult={text?:string;sourceHash?:string;runId?:string;checkId?:string;checkStale?:boolean;bodyRevision?:number;references?:{included:string[];excluded:string[];budget:number}};
export type AIRunner=(payload:Record<string,unknown>,onDelta?:(delta:string)=>void)=>Promise<AIResult>;
export async function consistencyRequest(projectId:string,action:string,fields:Record<string,unknown>={}){
 const response=await fetch("/api/consistency",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId,action,...fields})});
 const result=await response.json() as {id:string;error?:string;included:string[];excluded:string[];budget:number};if(!response.ok)throw new Error(result.error||"操作失败");return result;
}
type Memory={chapter_id:string;title:string;position:number;body_revision:number;current_revision:number;summary:string;facts:string;updated_at:string};
type Job={id:string;kind:string;chapters:string;completed:string;status:string;error:string};
type Run={id:string;chapter_id:string;kind:string;refs:string;snapshot:string;stale:number;adopted:number};
type Check={id:string;chapter_id:string;findings:string;resolutions:string;stale:number;created_at:string};
type Data={entries:SettingEntry[];memories:Memory[];jobs:Job[];runs:Run[];checks:Check[]};
const kindNames:Record<string,string>={character:"人物",world:"世界规则",timeline:"时间线",foreshadow:"伏笔"};
export default function LongformPanel({projectId,chapters,run,before,onChange,stop,refresh=0}:{projectId:string;chapters:Chapter[];run:AIRunner;before:()=>Promise<boolean>;onChange:()=>Promise<void>;stop:()=>void;refresh?:number}){
 const [data,setData]=useState<Data>({entries:[],memories:[],jobs:[],runs:[],checks:[]});
 const [error,setError]=useState(""),[busy,setBusy]=useState(false),[stream,setStream]=useState("");
 const [range,setRange]=useState({start:1,end:chapters.length||1});
 const [editing,setEditing]=useState<Partial<SettingEntry>|null>(null);
 const [mergeFrom,setMergeFrom]=useState<SettingEntry|null>(null);
 const [memory,setMemory]=useState<Memory|null>(null);
 const [filter,setFilter]=useState("candidate");
 const paused=useRef(true),alive=useRef(true);
 const owner=useRef(crypto.randomUUID());
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;paused.current=true;};},[]);
 const load=useCallback(async(progress=false)=>{
  const r=await fetch("/api/consistency?"+new URLSearchParams({projectId,view:progress?"progress":"full"}),{cache:"no-store"});const result=await r.json() as Data & {error?:string};
  if(!r.ok)throw new Error(result.error);if(alive.current){setData(old=>progress?{...old,jobs:result.jobs}:result);setError("");}
  return result as Data;
 },[projectId]);
 useEffect(()=>{void load().catch(e=>setError(String(e.message)));},[load,refresh]);
 async function action(name:string,fields:Record<string,unknown>={}){
  setBusy(true);try{const result=await consistencyRequest(projectId,name,fields);await load();await onChange();return result;}catch(e){toast.error(e instanceof Error?e.message:"操作失败");return null;}finally{setBusy(false);}
 }
 async function extract(id:string,jobId?:string){
  const [chapter]=await fetchChapterBatch(projectId,[id],"body");if(!chapter?.body)return;
  setStream("");const result=await run({kind:"extractChapter",selected:{id}},delta=>{if(alive.current)setStream(s=>s+delta);});
  const object=parseJSON<Record<string,unknown>>(String(result.text).slice(String(result.text).indexOf("{"),String(result.text).lastIndexOf("}")+1),{});
  await consistencyRequest(projectId,"saveExtraction",{chapterId:id,bodyRevision:result.bodyRevision,result:object,jobId,owner:owner.current});
 }
 async function runJob(job:Job){
  if(busy||!await before())return;paused.current=false;setBusy(true);setError("");
  try{
   await consistencyRequest(projectId,"jobState",{id:job.id,status:"running",owner:owner.current});
   for(const id of parseJSON<string[]>(job.chapters,[])){
    if(paused.current||!alive.current)break;
    await consistencyRequest(projectId,"jobState",{id:job.id,status:"running",owner:owner.current});
    const [row]=await fetchChapterBatch(projectId,[id],"body");
    const latest=await load(true),existing=latest.memories.find(m=>m.chapter_id===id);
    if(job.kind==="scan"){
     if(parseJSON<Record<string,number>>(job.completed,{})[id]===row.body_revision)continue;
     setStream("");await run({kind:"checkDraft",selected:{id},draft:row.body},delta=>{if(alive.current)setStream(s=>s+delta);});
     await consistencyRequest(projectId,"jobProgress",{id:job.id,chapterId:id,bodyRevision:row.body_revision,owner:owner.current});
    }else{
     if(existing&&existing.body_revision===row.body_revision){await consistencyRequest(projectId,"jobProgress",{id:job.id,chapterId:id,bodyRevision:row.body_revision,owner:owner.current});continue;}
     await extract(id,job.id);
    }
    await load(true);
   }
   await consistencyRequest(projectId,"jobState",{id:job.id,status:paused.current||!alive.current?"paused":"completed",owner:owner.current});
   if(alive.current){await load();await onChange();toast.success(paused.current?"任务已暂停，可继续":"批量建立完成，关键候选等待确认");}
  }catch(e){
   const message=e instanceof Error?e.message:"提取失败";await consistencyRequest(projectId,"jobState",{id:job.id,status:"failed",error:message,owner:owner.current}).catch(()=>{});
   if(alive.current){setError(message);await load();}
  }finally{if(alive.current){setBusy(false);setStream("");}}
 }
 async function createJob(kind="extract"){
  if(!await before())return;
  const result=await action("createJob",{...range,kind});if(!result)return;
  const latest=await load(),job=latest.jobs.find(j=>j.id===result.id);if(job)await runJob(job);
 }
 const candidates=data.entries.filter(e=>e.status==="candidate");
 const safe=candidates.filter(e=>e.evidence&&!data.entries.some(other=>other.id!==e.id&&other.status!=="ignored"&&other.kind===e.kind&&other.name===e.name&&other.content!==e.content));
 return <details className="longform-panel"><summary>设定集、逐章记忆与影响追踪 <span>{candidates.length} 项待确认</span></summary>
  <p className="dialog-note">自由资料继续保留。正式设定用于约束生成；正文提取的候选须确认，有来源可追溯。</p>
  {error&&<p role="alert" className="stale-note">{error}<Button size="sm" variant="outline" onClick={()=>void load().catch(e=>setError(e.message))}>重试读取</Button></p>}
  <div className="longform-actions">
   <Button size="sm" variant="outline" disabled={busy} onClick={async()=>{
    if(!await before())return;setBusy(true);setStream("");
    try{const result=await run({kind:"organizeSettings"},delta=>setStream(s=>s+delta));const text=String(result.text||"");await consistencyRequest(projectId,"saveSettingExtraction",{sourceHash:result.sourceHash,result:parseJSON(text.slice(text.indexOf("{"),text.lastIndexOf("}")+1),{})});await load();toast.success("设定候选已整理，请确认后生效");}
    catch(e){toast.error(e instanceof Error?e.message:"整理失败");}finally{setBusy(false);setStream("");}
   }}>AI 整理故事资料</Button>
   <Button size="sm" variant="outline" disabled={busy} onClick={()=>setEditing({kind:"character",name:"",content:"",aliases:"[]",status:"confirmed",hard:0})}>新建设定</Button>
   <Button size="sm" variant="outline" disabled={busy||!safe.length} onClick={()=>void action("acceptCandidates",{ids:safe.map(e=>e.id)})}>接受全部无冲突项（{safe.length}）</Button>
   <Button size="sm" variant="outline" disabled={busy||!candidates.length} onClick={()=>void action("acceptCandidates",{ids:candidates.map(e=>e.id)})}>接受全部变更</Button>
  </div>
  <label className="longform-filter">查看 <select value={filter} onChange={e=>setFilter(e.target.value)}><option value="candidate">关键变化与候选</option><option value="confirmed">正式设定</option><option value="ignored">已忽略</option></select></label>
  {editing&&<section className="setting-editor">
   {editing.status==="candidate"&&<label>合并到已有设定（可选）<select defaultValue="" onChange={e=>{
    const existing=data.entries.find(entry=>entry.id===e.target.value);
    if(existing){setMergeFrom(editing as SettingEntry);setEditing({...existing,content:existing.content+"\n\n待合并的新事实：\n"+editing.content,aliases:JSON.stringify(Array.from(new Set([...parseJSON<string[]>(existing.aliases,[]),...parseJSON<string[]>(editing.aliases,[])])))});}
   }}><option value="">作为新条目复核</option>{data.entries.filter(entry=>entry.status==="confirmed"&&entry.kind===editing.kind).map(entry=><option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>}
   <label>类型<select value={editing.kind} onChange={e=>setEditing({...editing,kind:e.target.value})}>{Object.entries(kindNames).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <label>名称<Input value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})}/></label>
   <label>内容与适用时间<Textarea rows={5} value={editing.content} onChange={e=>setEditing({...editing,content:e.target.value})} placeholder="记录事实、适用时间和人物认知边界，避免把未来变化当成当前状态。"/></label>
   <details><summary>别名与引用规则</summary><label>明确指向同一人物的别名，以逗号分隔<Input value={parseJSON<string[]>(editing.aliases,[]).join("，")} onChange={e=>setEditing({...editing,aliases:JSON.stringify(e.target.value.split(/[,，]/).map(x=>x.trim()).filter(Boolean))})}/></label>
    <label><input type="checkbox" checked={!!editing.hard} onChange={e=>setEditing({...editing,hard:e.target.checked?1:0})}/> 硬性规则，每章参考</label>
    <label>允许揭露的最早章序（留空不限）<Input type="number" min={1} value={editing.reveal_position==null?"":editing.reveal_position+1} onChange={e=>setEditing({...editing,reveal_position:e.target.value?Number(e.target.value)-1:null})}/></label>
   </details>
   <div className="longform-actions"><Button size="sm" disabled={busy} onClick={async()=>{if(await action("saveEntry",{...editing,aliases:parseJSON(editing.aliases,[]),status:"confirmed"})){if(mergeFrom)await action("saveEntry",{...mergeFrom,aliases:parseJSON(mergeFrom.aliases,[]),status:"ignored"});setEditing(null);setMergeFrom(null);}}}>确认并保存</Button><Button size="sm" variant="ghost" onClick={()=>{setEditing(null);setMergeFrom(null);}}>取消</Button></div>
  </section>}
  <div className="setting-list">{data.entries.filter(e=>e.status===filter).map(entry=><article className="setting-card" key={entry.id}>
   <strong>{kindNames[entry.kind]} · {entry.name}</strong><small>v{entry.version}{entry.source_chapter_id?" · 来自第 "+((chapters.find(c=>c.id===entry.source_chapter_id)?.position??-1)+1)+" 章":""}</small>
   <p>{entry.content}</p>{entry.evidence&&<blockquote>依据：{entry.evidence}</blockquote>}
   <div className="longform-actions"><Button size="sm" variant="outline" disabled={busy} onClick={()=>setEditing(entry)}>复核／合并编辑</Button>{entry.status==="candidate"&&<><Button size="sm" disabled={busy} onClick={()=>void action("acceptCandidates",{ids:[entry.id]})}>确认</Button><Button size="sm" variant="ghost" disabled={busy} onClick={()=>void action("saveEntry",{...entry,aliases:parseJSON(entry.aliases,[]),status:"ignored"})}>忽略</Button></>}</div>
  </article>)}</div>
  <details className="memory-list"><summary>逐章摘要与事实记忆（{data.memories.length}）</summary>{data.memories.map(m=><article className="setting-card" key={m.chapter_id}><strong>第 {m.position+1} 章 {m.title}</strong><small>{m.body_revision===m.current_revision?"记忆已更新":"正文已变 · 记忆待更新"}</small><p>{m.summary}</p><details><summary>普通事实</summary><p>{m.facts}</p></details><div className="longform-actions"><Button size="sm" variant="outline" disabled={busy} onClick={()=>setMemory(m)}>编辑记忆</Button><Button size="sm" variant="outline" disabled={busy} onClick={async()=>{if(!await before())return;setBusy(true);try{await extract(m.chapter_id);await load();await onChange();}catch(e){toast.error(e instanceof Error?e.message:"失败");}finally{setBusy(false);setStream("");}}}>重新提取</Button></div></article>)}</details>
  {memory&&<section className="setting-editor"><strong>编辑本章记忆</strong><Textarea rows={4} aria-label="本章摘要" value={memory.summary} onChange={e=>setMemory({...memory,summary:e.target.value})}/><Textarea rows={4} aria-label="本章事实" value={memory.facts} onChange={e=>setMemory({...memory,facts:e.target.value})}/><Button size="sm" disabled={busy} onClick={async()=>{if(await action("saveMemory",{chapterId:memory.chapter_id,bodyRevision:memory.current_revision,summary:memory.summary,facts:memory.facts,expectedUpdatedAt:memory.updated_at}))setMemory(null);}}>保存记忆</Button><Button size="sm" variant="ghost" onClick={()=>setMemory(null)}>取消</Button></section>}
  <details><summary>从已有正文批量建立</summary><p>按章调用当前模型，可暂停、重试。刷新或关闭弹窗后停止继续处理，重新打开可续跑；已完成且正文未变的章节跳过。</p>
   <div className="batch-range"><label>起始章<Input type="number" min={1} value={range.start} disabled={busy} onChange={e=>setRange({...range,start:Number(e.target.value)})}/></label><label>结束章<Input type="number" min={range.start} value={range.end} disabled={busy} onChange={e=>setRange({...range,end:Number(e.target.value)})}/></label></div>
   <Button size="sm" disabled={busy} onClick={()=>void createJob()}>开始分批建立</Button><Button size="sm" variant="outline" disabled={busy} onClick={()=>void createJob("scan")}>逐章一致性扫描</Button>{busy&&<Button size="sm" variant="outline" onClick={()=>{paused.current=true;toast("当前章处理完成后暂停");}}>暂停任务</Button>}
   {data.jobs.map(job=><article className="setting-card" key={job.id}><strong>{job.kind==="scan"?"一致性扫描 · ":"记忆建立 · "}{job.status==="completed"?"已完成":job.status==="failed"?"失败，可重试":"可继续的任务"}</strong><p>已记录 {Object.keys(parseJSON(job.completed,{})).length} / {parseJSON<string[]>(job.chapters,[]).length} 章</p>{job.error&&<p>{job.error}</p>}<Button size="sm" variant="outline" disabled={busy} onClick={()=>void runJob(job)}>继续／检查更新章节</Button></article>)}
  </details>
  {busy&&<div className="field-preview"><strong>AI 正在整理</strong><p role="status">{stream?"已收到 "+stream.length+" 字，正在整理摘要与设定候选…":"正在连接模型…"}</p><Button size="sm" variant="outline" onClick={()=>{paused.current=true;stop();}}>停止当前生成</Button></div>}
  <details><summary>影响与引用记录</summary><p>待复核表示参考内容改变，正文未必有错。重大设定变更可标记全书待复核，再逐章检查。</p><Button size="sm" variant="outline" disabled={busy} onClick={()=>void action("fullScan")}>标记全书待复核</Button>
   <h4>近期一致性检查</h4>{data.checks.map(check=><details className="setting-card" key={check.id}><summary>{chapters.find(c=>c.id===check.chapter_id)?.title||"全书"} · {check.stale?"检查已过期":"检查记录"} · {new Date(check.created_at).toLocaleString("zh-CN")}</summary>{parseJSON<Record<string,string>[]>(check.findings,[]).length===0?<p>未发现有依据的疑点。</p>:parseJSON<Record<string,string>[]>(check.findings,[]).map((finding,index)=><section key={index}><strong>{finding.severity==="conflict"?"明确冲突":"需要确认"}</strong><blockquote>{finding.quote}</blockquote><p>依据：{finding.evidence}</p><p>{finding.reason}</p><p>{finding.suggestion}</p><small>{parseJSON<Record<string,string>>(check.resolutions,{})[index]||"尚未处理"}</small><Button size="sm" variant="ghost" disabled={busy} onClick={()=>void action("resolveFinding",{id:check.id,index,resolution:"本次忽略"})}>本次忽略</Button><Button size="sm" variant="ghost" disabled={busy} onClick={()=>void action("resolveFinding",{id:check.id,index,resolution:"有意安排"})}>有意安排</Button></section>)}</details>)}
   {data.runs.map(r=><details className="setting-card" key={r.id}><summary>{chapters.find(c=>c.id===r.chapter_id)?.title||"全书"} · {r.kind} · {r.stale?"引用已变，待复核":"引用有效"}{r.adopted?" · 已采用":""}</summary>{parseJSON<{label:string;version:number;content:string}[]>(r.refs,[]).map((ref,i)=><p key={i}>{ref.label} · v{ref.version}<small>{ref.content}</small></p>)}<p>预算排除：{parseJSON<{excluded?:string[]}>(r.snapshot,{}).excluded?.join("、")||"无"}</p></details>)}
  </details>
 </details>;
}
