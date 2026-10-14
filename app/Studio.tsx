"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Plus, Settings2, Sparkles, PenLine, Download, ChevronUp, ChevronDown, Trash2, PanelLeftClose, PanelLeftOpen, RefreshCw, Check, X, ArrowRight, FileText } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Toaster, toast } from "sonner";

type Project = {id:string;title:string;premise:string;summary:string;important_notes:string;genre:string;style:string;updated_at:string;legacy?:boolean};
type Chapter = {id:string;project_id:string;position:number;title:string;synopsis:string;body:string;memory:string;continuity_review:number;outline_revision:number;body_outline_revision:number|null};
type LoreCard = {id:string;project_id:string;category:string;content:string;from_chapter:number|null;until_chapter:number|null;done:number};
type Snapshot = {id:string;project_id:string;reason:string;created_at:string};
type SavedDraft = {id:string;project_id:string;kind:string;target_id:string|null;content:string;created_at:string};
type ModelConfig = {endpoint:string;model:string;key:string;temperature:number};
type Proposal = {kind:"outline"|"append"|"insert"|"rewrite"|"body"|"continue"|"bodyRewrite"|"selection"|"memory"; chapters?:{title:string;synopsis:string}[]; text?:string; target?:string; selection?:string; afterChapterId?:string; insertionOffset?:number; baseBody?:string};
type ProjectField = "summary"|"important_notes";
type FieldOperation = "generate"|"expand"|"rewrite";
type FieldProposal = {field:ProjectField;text:string;draft:boolean};
const defaultModel:ModelConfig = {endpoint:"https://api.deepseek.com/chat/completions",model:"deepseek-flash",key:"",temperature:0.8};

export default function Home() {
  const [projects,setProjects]=useState<Project[]>([]);
  const [allChapters,setAllChapters]=useState<Chapter[]>([]);
  const [cards,setCards]=useState<LoreCard[]>([]);
  const [snapshots,setSnapshots]=useState<Snapshot[]>([]);
  const [drafts,setDrafts]=useState<SavedDraft[]>([]);
  const [projectId,setProjectId]=useState("");
  const [chapterId,setChapterId]=useState("");
  const [mode,setMode]=useState<"outline"|"body">("outline");
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [addingChapter,setAddingChapter]=useState(false);
  const [saving,setSaving]=useState(false);
  const [saveError,setSaveError]=useState(false);
  const [streaming,setStreaming]=useState("");
  const [showHistory,setShowHistory]=useState(false);
  const [showCards,setShowCards]=useState(false);
  const [cardCategory,setCardCategory]=useState("rule");
  const [cardText,setCardText]=useState("");
  const [editingCardId,setEditingCardId]=useState("");
  const [cardFrom,setCardFrom]=useState("");
  const [cardUntil,setCardUntil]=useState("");
  const [selection,setSelection]=useState("");
  const [selectionStart,setSelectionStart]=useState(0);
  const [selectionEnd,setSelectionEnd]=useState(0);
  const [skipAnimation,setSkipAnimation]=useState(false);
  const [sidebar,setSidebar]=useState(true);
  const [newOpen,setNewOpen]=useState(false);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [storyOpen,setStoryOpen]=useState(false);
  const [projectDirty,setProjectDirty]=useState(false);
  const [draftTitle,setDraftTitle]=useState("");
  const [draftPremise,setDraftPremise]=useState("");
  const [draftSummary,setDraftSummary]=useState("");
  const [draftImportantNotes,setDraftImportantNotes]=useState("");
  const [draftLoaded,setDraftLoaded]=useState(false);
  const [instruction,setInstruction]=useState("");
  const [count,setCount]=useState(8);
  const [insertAfterId,setInsertAfterId]=useState("__start__");
  const [bodyCursor,setBodyCursor]=useState<number|null>(null);
  const [proposal,setProposal]=useState<Proposal|null>(null);
  const [fieldInstruction,setFieldInstruction]=useState("");
  const [fieldBusy,setFieldBusy]=useState<ProjectField|null>(null);
  const [fieldBusyDraft,setFieldBusyDraft]=useState(false);
  const [fieldProposal,setFieldProposal]=useState<FieldProposal|null>(null);
  const [model,setModel]=useState<ModelConfig>(defaultModel);
  const pending=useRef<Record<string,ReturnType<typeof setTimeout>>>({});
  const addChapterPending=useRef(false);
  const pendingPatch=useRef<Record<string,Partial<Chapter>>>({});
  const generationAbort=useRef<AbortController|null>(null);
  const streamingRef=useRef("");
  const streamBox=useRef<HTMLDivElement|null>(null);
  const fieldStreamBox=useRef<HTMLParagraphElement|null>(null);
  const followStream=useRef(true);
  const selectionOperation=useRef("rewrite");
  const project=projects.find(p=>p.id===projectId);
  const chapters=allChapters.filter(c=>c.project_id===projectId).sort((a,b)=>a.position-b.position);
  const chapter=chapters.find(c=>c.id===chapterId);

  const load=useCallback(async()=>{
    try {
      const response=await fetch("/api/workspace",{cache:"no-store"});const data=await response.json() as {error?:string;projects:Project[];chapters:Chapter[];cards:LoreCard[];snapshots:Snapshot[];drafts:SavedDraft[]};
      if(!response.ok) throw new Error(data.error);
      setProjects(data.projects);setAllChapters(data.chapters.map(c=>{
        let backup:Partial<Chapter>={};
        try{backup=JSON.parse(localStorage.getItem("novel-backup-"+c.id)||"{}") as Partial<Chapter>;}catch{}
        if(Object.keys(backup).length){pendingPatch.current[c.id]={...backup,...pendingPatch.current[c.id]};setSaveError(true);}
        return {...c,...backup,...pendingPatch.current[c.id]};
      }));
      setCards(data.cards||[]);setSnapshots(data.snapshots||[]);setDrafts(data.drafts||[]);
      setProjectId(current=>data.projects.some((p:Project)=>p.id===current)?current:(data.projects.find(p=>!p.legacy)?.id||data.projects[0]?.id||""));
      setChapterId(current=>data.chapters.some((c:Chapter)=>c.id===current)?current:(data.chapters[0]?.id||""));
    } catch(e){toast.error(e instanceof Error?e.message:"读取失败");}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem("novel-model")||"null") as Partial<ModelConfig>|null;if(saved?.endpoint&&saved.model)setModel({...defaultModel,...saved,key:""});}catch{}},[]);
  useEffect(()=>{localStorage.setItem("novel-model",JSON.stringify({endpoint:model.endpoint,model:model.model,temperature:model.temperature}));},[model.endpoint,model.model,model.temperature]);
  useEffect(()=>{try{const d=JSON.parse(localStorage.getItem("novel-new-draft")||"null") as {title?:string;premise?:string;summary?:string;notes?:string}|null;if(d){setDraftTitle(d.title||"");setDraftPremise(d.premise||"");setDraftSummary(d.summary||"");setDraftImportantNotes(d.notes||"");}}catch{}setDraftLoaded(true);},[]);
  useEffect(()=>{if(draftLoaded)localStorage.setItem("novel-new-draft",JSON.stringify({title:draftTitle,premise:draftPremise,summary:draftSummary,notes:draftImportantNotes}));},[draftLoaded,draftTitle,draftPremise,draftSummary,draftImportantNotes]);
  useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem("novel-field-proposal")||"null") as FieldProposal|null;if(saved?.draft)setFieldProposal(saved);}catch{}},[]);
  useEffect(()=>{if(fieldProposal?.draft)localStorage.setItem("novel-field-proposal",JSON.stringify(fieldProposal));else localStorage.removeItem("novel-field-proposal");},[fieldProposal]);
  useEffect(()=>{if(followStream.current){if(streamBox.current)streamBox.current.scrollTop=streamBox.current.scrollHeight;if(fieldStreamBox.current)fieldStreamBox.current.scrollTop=fieldStreamBox.current.scrollHeight;}},[streaming]);
  useEffect(()=>{if(projectId && !chapters.some(c=>c.id===chapterId)) setChapterId(chapters[0]?.id||"");},[projectId,chapterId,chapters.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{setInsertAfterId(chapterId||"__start__");setBodyCursor(null);},[chapterId,projectId]);
  useEffect(()=>()=>{Object.values(pending.current).forEach(clearTimeout);},[]);
  async function post(action:string,fields:Record<string,unknown>={}){
    const r=await fetch("/api/workspace",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,...fields})});
    const data=await r.json() as {error?:string;id:string;outlineRevision?:number};if(!r.ok) throw new Error(data.error||"保存失败");return data;
  }
  async function flushChapter(id:string){
    clearTimeout(pending.current[id]);
    const values=pendingPatch.current[id];if(!values)return true;
    setSaving(true);
    try{const result=await post("updateChapter",{id,...values});delete pendingPatch.current[id];if(result.outlineRevision)setAllChapters(items=>items.map(c=>c.id===id?{...c,outline_revision:result.outlineRevision!}:c));setSaveError(false);localStorage.removeItem("novel-backup-"+id);return true;}
    catch(e){setSaveError(true);localStorage.setItem("novel-backup-"+id,JSON.stringify(values));toast.error(e instanceof Error?e.message:"保存失败，草稿已暂存在此浏览器");return false;}
    finally{setSaving(false);}
  }
  async function flushAllChapters(){for(const id of Object.keys(pendingPatch.current))if(!await flushChapter(id))return false;return true;}
  function updateChapter(id:string,patch:Partial<Chapter>){
    setAllChapters(items=>items.map(c=>c.id===id?{...c,...patch}:c));
    pendingPatch.current[id]={...pendingPatch.current[id],...patch};
    clearTimeout(pending.current[id]);
    pending.current[id]=setTimeout(()=>{void flushChapter(id);},650);
  }
  async function persistChapter(id:string,patch:Partial<Chapter>){
    pendingPatch.current[id]={...pendingPatch.current[id],...patch};
    if(!await flushChapter(id))return false;
    setAllChapters(items=>items.map(c=>c.id===id?{...c,...patch}:c));await load();return true;
  }
  async function createProject(){
    try {const result=await post("createProject",{title:draftTitle.trim()||"未命名小说",premise:draftPremise,summary:draftSummary,important_notes:draftImportantNotes});await load();setProjectId(result.id);setChapterId("");setNewOpen(false);setDraftTitle("");setDraftPremise("");setDraftSummary("");setDraftImportantNotes("");localStorage.removeItem("novel-new-draft");toast.success("作品已创建");}
    catch(e){toast.error(e instanceof Error?e.message:"创建失败");}
  }
  async function cloneLegacy(){
    if(!project?.legacy)return;
    try{const result=await post("cloneLegacy",{id:project.id});await load();setProjectId(result.id);setChapterId("");toast.success("已复制到当前浏览器的工作区，可以开始编辑");}
    catch(e){toast.error(e instanceof Error?e.message:"复制失败");}
  }
  async function saveCard(){
    if(!project||!cardText.trim())return;
    if(projectDirty&&!await saveProject(project))return;
    try{await post("saveLoreCard",{id:editingCardId||undefined,projectId:project.id,category:cardCategory,content:cardText,from_chapter:cardFrom?Number(cardFrom):null,until_chapter:cardUntil?Number(cardUntil):null});setCardText("");setCardFrom("");setCardUntil("");setEditingCardId("");await load();toast.success("设定卡已保存");}
    catch(e){toast.error(e instanceof Error?e.message:"保存失败");}
  }
  async function saveProject(patch:Partial<Project>){
    if(!project)return;setProjects(items=>items.map(p=>p.id===project.id?{...p,...patch}:p));
    try{await post("updateProject",{...project,...patch,id:project.id});setProjectDirty(false);setSaveError(false);toast.success("设定已保存");return true;}
    catch(e){setSaveError(true);toast.error(e instanceof Error?e.message:"保存失败");return false;}
  }
  async function generateProjectField(field:ProjectField,operation:FieldOperation,draft=false){
    if((!project&&!draft)||fieldBusy)return;
    if(!model.endpoint||!model.model){toast.error("请先配置模型");return;}
    setFieldBusy(field);setFieldBusyDraft(draft);setFieldProposal(null);
    try{
      const source=draft
        ? {title:draftTitle,premise:draftPremise,summary:draftSummary,important_notes:draftImportantNotes,genre:"",style:""}
        : project!;
      const {result}=await streamRequest({kind:"projectField",field,operation,...model,projectId:draft?undefined:project?.id,title:source.title,premise:source.premise,summary:source.summary,important_notes:source.important_notes,genre:source.genre,style:source.style,chapters:draft?[]:chapters,instruction:fieldInstruction});
      if(!result?.text?.trim())throw new Error("模型没有返回内容");
      setFieldProposal({field,text:result.text.trim(),draft});
      if(!draft)await retainDraft(field,result.text);
    }catch(e){if(streamingRef.current){setFieldProposal({field,text:streamingRef.current,draft});if(!draft)await retainDraft(field,streamingRef.current);}toast.error(e instanceof Error?e.message:"生成中断，已保留收到的内容");}
    finally{setFieldBusy(null);generationAbort.current=null;}
  }
  async function acceptProjectField(){
    if(!fieldProposal)return;
    if(fieldProposal.draft){
      if(fieldProposal.field==="summary")setDraftSummary(fieldProposal.text);
      else setDraftImportantNotes(fieldProposal.text);
      setFieldProposal(null);
      toast.success("已采用草稿，创建作品后保存");
      return;
    }
    if(!project)return;
    const next={...project,[fieldProposal.field]:fieldProposal.text};
    setFieldBusy(fieldProposal.field);
    try{
      await post("updateProject",next);
      setProjects(items=>items.map(p=>p.id===project.id?next:p));
      setFieldProposal(null);setProjectDirty(false);
      toast.success("已保存到作品设定");
    }catch(e){toast.error(e instanceof Error?e.message:"保存失败");}
    finally{setFieldBusy(null);}
  }
  function projectFieldActions(field:ProjectField,draft=false){
    const value=draft?(field==="summary"?draftSummary:draftImportantNotes):(project?.[field]||"");
    const label=field==="summary"?"小说概要":"重要提示";
    return <div className="field-ai"><div className="field-ai-actions">
      <Button variant="outline" size="sm" disabled={!!fieldBusy||!!(!draft&&project?.legacy)} onClick={()=>void generateProjectField(field,"generate",draft)}><Sparkles size={14}/>{fieldBusy===field?"生成中…":"AI 生成"}</Button>
      <Button variant="outline" size="sm" disabled={!!fieldBusy||!value.trim()||!!(!draft&&project?.legacy)} onClick={()=>void generateProjectField(field,"expand",draft)}>扩写</Button>
      <Button variant="outline" size="sm" disabled={!!fieldBusy||!value.trim()||!!(!draft&&project?.legacy)} onClick={()=>void generateProjectField(field,"rewrite",draft)}>重写</Button>
    </div>{fieldBusy===field&&fieldBusyDraft===draft&&<div className="field-preview"><strong>AI 正在写作</strong><p ref={fieldStreamBox} onScroll={e=>{const el=e.currentTarget;followStream.current=el.scrollHeight-el.scrollTop-el.clientHeight<48;}} className={skipAnimation?"":"typing-output"} aria-live="polite">{streaming||"正在连接模型…"}</p><div className="field-preview-actions"><Button variant="outline" size="sm" onClick={stopGeneration}>停止生成</Button><Button variant="ghost" size="sm" onClick={()=>setSkipAnimation(!skipAnimation)}>{skipAnimation?"启用动画":"关闭动画"}</Button></div></div>}{fieldProposal?.field===field&&fieldProposal.draft===draft&&<div className="field-preview"><strong>{label}草稿</strong><p>{fieldProposal.text}</p><div className="field-preview-actions"><Button variant="outline" size="sm" onClick={()=>setFieldProposal(null)}>舍弃</Button><Button size="sm" disabled={!!fieldBusy||!!(!draft&&project?.legacy)} onClick={()=>void acceptProjectField()}>{draft?"采用草稿":"采用并保存"}</Button></div></div>}</div>;
  }
  async function addChapter(title="新章节",synopsis=""){
    if(!project||addChapterPending.current)return null;
    addChapterPending.current=true;setAddingChapter(true);
    try{const result=await post("addChapter",{projectId,title,synopsis});await load();setChapterId(result.id);return result.id as string;}
    catch(e){toast.error(e instanceof Error?e.message:"添加失败");return null;}
    finally{addChapterPending.current=false;setAddingChapter(false);}
  }
  async function deleteChapter(){
    if(!chapter||!window.confirm(`将「${chapter.title}」移出章节目录？概述与正文会保留；恢复入口稍后提供。`))return;
    if(!await flushAllChapters())return;
    try{await post("deleteChapter",{id:chapter.id});setChapterId("");await load();toast.success("章节已删除");}catch(e){toast.error(e instanceof Error?e.message:"删除失败");}
  }
  async function moveChapter(direction:number){
    if(!chapter)return;const index=chapters.findIndex(c=>c.id===chapter.id);const next=index+direction;if(next<0||next>=chapters.length)return;
    const ids=chapters.map(c=>c.id);[ids[index],ids[next]]=[ids[next],ids[index]];
    setAllChapters(items=>items.map(c=>c.project_id===projectId?{...c,position:ids.indexOf(c.id)}:c));
    try{await post("reorder",{projectId,ids});}catch(e){toast.error("排序失败");await load();}
  }
  async function streamRequest(payload:Record<string,unknown>,onDelta?:(delta:string)=>void){
    const controller=new AbortController();generationAbort.current=controller;streamingRef.current="";followStream.current=true;setStreaming("");
    const response=await fetch("/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...payload,stream:true}),signal:controller.signal});
    if(!response.ok){const result=await response.json() as {error?:string};throw new Error(result.error||"模型调用失败");}
    if(!response.body)throw new Error("模型没有返回流式内容");
    const reader=response.body.getReader(),decoder=new TextDecoder();
    let buffer="",full="",final:Record<string,unknown>|null=null;
    while(true){
      const {done,value}=await reader.read();if(done)break;
      buffer+=decoder.decode(value,{stream:true}).replace(/\r\n/g,"\n");
      const events=buffer.split("\n\n");buffer=events.pop()||"";
      for(const event of events){
        const line=event.split("\n").find(v=>v.startsWith("data:"));if(!line)continue;
        const item=JSON.parse(line.slice(5)) as {delta?:string;done?:boolean;error?:string;text?:string;chapters?:{title:string;synopsis:string}[]};
        if(item.error)throw new Error(item.error);
        if(item.delta){full+=item.delta;streamingRef.current=full;setStreaming(full);onDelta?.(item.delta);}
        if(item.done)final=item;
      }
    }
    generationAbort.current=null;
    return {result:final as {text?:string;chapters?:{title:string;synopsis:string}[]}|null,partial:full};
  }
  function stopGeneration(){generationAbort.current?.abort();generationAbort.current=null;}
  async function retainDraft(kind:string,content:string,targetId?:string){
    if(!project||!content.trim())return;
    try{const result=await post("saveDraft",{projectId:project.id,kind,targetId,content});setDrafts(items=>[{id:result.id,project_id:project.id,kind,target_id:targetId||null,content,created_at:new Date().toISOString()},...items].slice(0,30));}catch{toast.error("生成草稿未能保存，请复制预览内容");}
  }
  async function generate(kind:Proposal["kind"]|"test"){
    if(!model.endpoint||!model.model){setSettingsOpen(true);toast("请先配置模型地址和名称");return;}
    if(!project)return; if(project.legacy){toast.error("请先复制旧版作品");return;} if(["rewrite","body","continue","bodyRewrite","selection","memory"].includes(kind)&&!chapter)return;
    if(["continue","bodyRewrite"].includes(kind)&&!chapter?.body.trim()){toast.error("请先写出一些正文");return;}
    if(projectDirty&&!await saveProject(project))return;
    if(!await flushAllChapters())return;
    setBusy(true);setProposal(null);
    try{
      const afterChapterId=insertAfterId==="__start__"?"":insertAfterId;
      if(kind==="insert"&&afterChapterId&&!chapters.some(c=>c.id===afterChapterId))throw new Error("插入位置已变化，请重新选择");
      const insertionOffset=bodyCursor===null?chapter?.body.length||0:Math.max(0,Math.min(bodyCursor,chapter?.body.length||0));
      const payload={kind,...model,projectId:project.id,title:project.title,premise:project.premise,summary:project.summary,important_notes:project.important_notes,genre:project.genre,style:project.style,chapters,selected:chapter,instruction,count,selection,operation:selectionOperation.current,afterChapterId,cursor:insertionOffset};
      const {result}=await streamRequest(payload);
      if(!result)throw new Error("生成中断");
      if(kind==="test")toast.success("连接成功");
      else {setProposal({kind,chapters:result.chapters,text:result.text,target:chapter?.id,selection,afterChapterId,insertionOffset,baseBody:chapter?.body});await retainDraft(kind,kind==="selection"?JSON.stringify({text:result.text,selection,start:selectionStart,end:selectionEnd}):["continue","bodyRewrite","insert"].includes(kind)?JSON.stringify({text:result.text,chapters:result.chapters,afterChapterId,insertionOffset,baseBody:chapter?.body}):result.text||JSON.stringify(result.chapters),chapter?.id);toast.success("已生成草稿，请确认后采用");}
    }catch(e){if(streamingRef.current&&kind!=="test"){setProposal({kind,text:streamingRef.current,target:chapter?.id,selection,afterChapterId:insertAfterId==="__start__"?"":insertAfterId,insertionOffset:bodyCursor??chapter?.body.length,baseBody:chapter?.body});await retainDraft(kind,streamingRef.current,chapter?.id);}if((e as Error).name==="AbortError")toast("已停止，已收到的文字留在预览中");else toast.error(e instanceof Error?e.message:"生成失败");}
    finally{setBusy(false);generationAbort.current=null;}
  }
  async function acceptProposal(){
    if(!proposal||!project)return;setBusy(true);
    try{
      if(["rewrite","body","continue","bodyRewrite","selection","memory"].includes(proposal.kind))await post("snapshotProject",{projectId,reason:"采用 AI 草稿前"});
      if(proposal.kind==="rewrite"&&proposal.target&&proposal.chapters?.[0]){
        if(!await persistChapter(proposal.target,proposal.chapters[0]))return;
      }else if(proposal.kind==="body"&&proposal.target&&proposal.text){
        if(chapters.find(c=>c.id===proposal.target)?.body&&!window.confirm("生成正文将覆盖这一章现有正文。已创建可恢复版本，确定采用吗？"))return;
        if(!await persistChapter(proposal.target,{body:proposal.text,body_outline_revision:-1}))return;setMode("body");
      }else if((proposal.kind==="continue"||proposal.kind==="bodyRewrite")&&proposal.target&&proposal.text){
        const target=chapters.find(c=>c.id===proposal.target);
        if(!target||target.body!==proposal.baseBody)throw new Error("正文已变化，请重新生成草稿");
        const offset=proposal.insertionOffset??target.body.length;
        const next=proposal.kind==="continue"?target.body.slice(0,offset)+proposal.text+target.body.slice(offset):proposal.text;
        if(!await persistChapter(target.id,{body:next,body_outline_revision:-1}))return;setMode("body");
      }else if(proposal.kind==="memory"&&proposal.target&&proposal.text){
        if(!await persistChapter(proposal.target,{memory:proposal.text}))return;
      }else if(proposal.kind==="selection"&&proposal.target&&proposal.text){
        const target=chapters.find(c=>c.id===proposal.target);
        if(!target||target.body.slice(selectionStart,selectionEnd)!==proposal.selection)throw new Error("正文已变化，请重新选择片段");
        if(!await persistChapter(target.id,{body:target.body.slice(0,selectionStart)+proposal.text+target.body.slice(selectionEnd)}))return;
      }else if(proposal.chapters?.length){
        if(proposal.kind==="outline"&&chapters.length){
          if(!window.confirm("采用新大纲会替换当前章节与正文。旧稿会保存为可恢复的版本，确定继续吗？"))return;
        }
        if(!await flushAllChapters())return;
        const result=await post(proposal.kind==="append"?"appendOutline":proposal.kind==="insert"?"insertOutline":"replaceOutline",{projectId,chapters:proposal.chapters,afterChapterId:proposal.afterChapterId||""});
        await load();if(result.id)setChapterId(result.id);
      }
      setProposal(null);toast.success("已采用生成结果");
    }catch(e){toast.error(e instanceof Error?e.message:"采用失败，请检查章节列表");await load();}
    finally{setBusy(false);}
  }
  function exportBook(){
    if(!project)return;
    const content=`# ${project.title}\n\n## 小说概要\n\n${project.summary || ""}\n\n## 重要提示\n\n${project.important_notes || ""}\n\n## 世界设定与核心冲突\n\n${project.premise}\n\n`+chapters.map((c,i)=>`## 第${i+1}章 ${c.title}\n\n> ${c.synopsis}\n\n${c.body||""}\n`).join("\n");
    const blob=new Blob([content],{type:"text/markdown;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`${project.title.replace(/[\\/:*?"<>|]/g,"_")}.md`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  useEffect(()=>{
    const context=(document as Document & {modelContext?:{registerTool:(tool:unknown,options:{signal:AbortSignal})=>Promise<void>|void}}).modelContext;
    if(!context?.registerTool)return;const lifecycle=new AbortController();
    void Promise.resolve(context.registerTool({name:"read_novel_workspace",title:"读取小说工作台",description:"读取当前作品、章节标题和概述",inputSchema:{type:"object",properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>({project:project?.title||null,chapters:chapters.map(c=>({id:c.id,title:c.title,synopsis:c.synopsis}))})},{signal:lifecycle.signal})).catch(()=>{});
    if(projectId) void Promise.resolve(context.registerTool({name:"add_novel_chapter",title:"添加小说章节",description:"为当前作品添加一个带标题和概述的章节，并在工作台显示",inputSchema:{type:"object",properties:{title:{type:"string"},synopsis:{type:"string"}},required:["title","synopsis"],additionalProperties:false},annotations:{readOnlyHint:false},execute:async(input:unknown)=>{const value=input as {title?:unknown;synopsis?:unknown};if(typeof value?.title!=="string"||!value.title.trim()||typeof value?.synopsis!=="string")throw new Error("请提供章节标题和概述");const result=await post("addChapter",{projectId,title:value.title.slice(0,180),synopsis:value.synopsis.slice(0,15000)});await load();setChapterId(result.id);return {id:result.id,title:value.title};}},{signal:lifecycle.signal})).catch(()=>{});
    return ()=>lifecycle.abort();
  },[project?.title,chapters.length,projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="app-shell"><Toaster richColors position="top-center" />
    <header className="topbar"><div className="brand"><div className="brand-mark"><BookOpen size={19}/></div><span>纸间</span><span className="brand-divider"/><small>小说创作工作台</small></div>
      <div className="top-actions"><span className="save-state">{saveError?"保存失败 · 草稿已暂存":projectDirty?"设定待保存":saving?"保存中…":Object.keys(pendingPatch.current).length?"待保存":"已保存"}</span>{saveError&&<Button variant="outline" size="sm" onClick={async()=>{for(const id of Object.keys(pendingPatch.current))await flushChapter(id);if(projectDirty&&project)await saveProject(project);}}>重试保存</Button>}<Button variant="ghost" size="sm" onClick={exportBook} disabled={!project}><Download size={16}/> 导出</Button>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}><Button variant="outline" size="sm" onClick={()=>setSettingsOpen(true)}><Settings2 size={16}/> 模型配置</Button><DialogContent className="settings-dialog"><DialogHeader><DialogTitle>自定义模型</DialogTitle></DialogHeader><p className="dialog-note">已配置 DeepSeek 默认模型。切换到其他兼容接口时，可在下方填写地址、模型和密钥；自定义密钥只在当前页面使用。</p><div className="field"><Label htmlFor="endpoint">接口地址</Label><Input id="endpoint" placeholder="https://example.com/v1/chat/completions" value={model.endpoint} onChange={e=>setModel({...model,endpoint:e.target.value})}/></div><div className="field"><Label htmlFor="model">模型名称</Label><Input id="model" placeholder="填写服务商提供的模型 ID" value={model.model} onChange={e=>setModel({...model,model:e.target.value})}/></div><div className="field"><Label htmlFor="key">API 密钥</Label><Input id="key" type="password" autoComplete="off" placeholder="默认 DeepSeek 留空；自定义模型请填写" value={model.key} onChange={e=>setModel({...model,key:e.target.value})}/></div><div className="field"><Label htmlFor="temp">创造性 · {model.temperature.toFixed(1)}</Label><input id="temp" type="range" min="0" max="1.5" step="0.1" value={model.temperature} onChange={e=>setModel({...model,temperature:Number(e.target.value)})}/></div><div className="dialog-actions"><Button variant="outline" onClick={()=>void generate("test")} disabled={busy||!project||project.legacy}>测试连接</Button><Button onClick={()=>setSettingsOpen(false)}>完成</Button></div></DialogContent></Dialog>
      </div></header>
    <Dialog open={showCards} onOpenChange={setShowCards}><DialogContent className="settings-dialog"><DialogHeader><DialogTitle>故事设定卡</DialogTitle></DialogHeader>
      <p className="dialog-note">将人物、时间线、伏笔与禁忌分开记录。限定章节的规则只会在适用章节的生成请求中使用。</p>
      <div className="card-list">{cards.filter(c=>c.project_id===projectId).map(c=><div className="story-card" key={c.id}><div><label className="card-check"><input type="checkbox" checked={!!c.done} onChange={async e=>{await post("markLoreCard",{id:c.id,done:e.target.checked});await load();}}/> 已核对</label><strong>{({rule:"规则",character:"人物",timeline:"时间线",foreshadow:"伏笔",ban:"禁忌"} as Record<string,string>)[c.category]||c.category}</strong><small>{c.from_chapter?`第${c.from_chapter}章${c.until_chapter?`—${c.until_chapter}章`:"起"}`:"全书"}</small></div><p>{c.content}</p><Button variant="ghost" size="sm" onClick={()=>{setEditingCardId(c.id);setCardCategory(c.category);setCardText(c.content);setCardFrom(c.from_chapter?String(c.from_chapter):"");setCardUntil(c.until_chapter?String(c.until_chapter):"");}}>编辑</Button><Button variant="ghost" size="sm" onClick={async()=>{if(!window.confirm("删除这张设定卡？"))return;await post("deleteLoreCard",{id:c.id});await load();}}>删除</Button></div>)}</div>
      <div className="field"><Label>类型</Label><select value={cardCategory} onChange={e=>setCardCategory(e.target.value)}><option value="rule">规则</option><option value="character">人物</option><option value="timeline">时间线</option><option value="foreshadow">伏笔</option><option value="ban">禁忌</option></select></div>
      <div className="field"><Label>设定内容</Label><Textarea value={cardText} onChange={e=>setCardText(e.target.value)} rows={3} placeholder="例如：第4章之前不得揭示林晚的身份"/></div>
      <div className="card-range"><div className="field"><Label>起始章（可选）</Label><Input type="number" min="1" value={cardFrom} onChange={e=>setCardFrom(e.target.value)}/></div><div className="field"><Label>结束章（可选）</Label><Input type="number" min="1" value={cardUntil} onChange={e=>setCardUntil(e.target.value)}/></div></div>
      <div className="dialog-actions"><Button onClick={()=>void saveCard()} disabled={!cardText.trim()}>{editingCardId?"保存修改":"添加设定卡"}</Button>{editingCardId&&<Button variant="ghost" onClick={()=>{setEditingCardId("");setCardText("");setCardFrom("");setCardUntil("");}}>取消编辑</Button>}</div>
    </DialogContent></Dialog>
    <Dialog open={showHistory} onOpenChange={setShowHistory}><DialogContent className="settings-dialog"><DialogHeader><DialogTitle>版本与生成草稿</DialogTitle></DialogHeader>
      <h3 className="history-heading">可恢复版本</h3>{snapshots.filter(s=>s.project_id===projectId).map(s=><div className="history-item" key={s.id}><span>{s.reason}<small>{new Date(s.created_at).toLocaleString("zh-CN")}</small></span><Button variant="outline" size="sm" onClick={async()=>{if(!window.confirm("将整部作品恢复到这个版本？当前状态会先自动备份。"))return;if(!await flushAllChapters())return;await post("restoreSnapshot",{id:s.id});await load();setChapterId("");setShowHistory(false);toast.success("已恢复版本");}}>恢复</Button></div>)}
      <h3 className="history-heading">近期 AI 草稿</h3>{drafts.filter(d=>d.project_id===projectId).map(d=><div className="history-item" key={d.id}><span>{d.kind}<small>{new Date(d.created_at).toLocaleString("zh-CN")}</small></span><Button variant="outline" size="sm" onClick={()=>{if(d.kind==="summary"||d.kind==="important_notes"){setFieldProposal({field:d.kind,text:d.content,draft:false});setStoryOpen(true);}else{let cs;try{cs=JSON.parse(d.content);}catch{}if(d.kind==="selection"&&cs&&typeof cs==="object"&&!Array.isArray(cs)){setSelectionStart(cs.start||0);setSelectionEnd(cs.end||0);setProposal({kind:"selection",target:d.target_id||undefined,text:cs.text,selection:cs.selection});}else if(["continue","bodyRewrite","insert"].includes(d.kind)&&cs&&typeof cs==="object"&&!Array.isArray(cs)){setProposal({kind:d.kind as Proposal["kind"],target:d.target_id||undefined,text:cs.text,chapters:cs.chapters,afterChapterId:cs.afterChapterId,insertionOffset:cs.insertionOffset,baseBody:cs.baseBody});}else setProposal({kind:d.kind as Proposal["kind"],target:d.target_id||undefined,text:Array.isArray(cs)?undefined:d.content,chapters:Array.isArray(cs)?cs:undefined});}setShowHistory(false);}}>查看</Button></div>)}
    </DialogContent></Dialog>
    <div className="workspace">
      <aside className={`sidebar ${sidebar?"":"sidebar-closed"}`}><div className="sidebar-head"><span className="eyebrow">我的作品</span><Dialog open={newOpen} onOpenChange={setNewOpen}><button className="icon-button" aria-label="新建作品" title="新建作品" onClick={()=>setNewOpen(true)}><Plus size={18}/></button><DialogContent className="settings-dialog"><DialogHeader><DialogTitle>新建小说</DialogTitle></DialogHeader><div className="field"><Label htmlFor="new-title">书名</Label><Input id="new-title" value={draftTitle} onChange={e=>setDraftTitle(e.target.value)} placeholder="为故事起一个名字"/></div><div className="field"><Label htmlFor="new-ai-instruction">AI 修改要求（可选）</Label><Textarea id="new-ai-instruction" rows={2} value={fieldInstruction} onChange={e=>setFieldInstruction(e.target.value)} placeholder="例如：悬疑风格、节奏紧凑……"/></div><div className="field"><Label htmlFor="new-summary">小说概要</Label><Textarea id="new-summary" value={draftSummary} onChange={e=>setDraftSummary(e.target.value)} placeholder="这本小说讲述什么故事？" rows={3}/></div>{projectFieldActions("summary",true)}<div className="field"><Label htmlFor="new-premise">世界设定与核心冲突</Label><Textarea id="new-premise" value={draftPremise} onChange={e=>setDraftPremise(e.target.value)} placeholder="主角、世界、核心冲突……" rows={3}/></div><div className="field"><Label htmlFor="new-notes">重要提示</Label><Textarea id="new-notes" value={draftImportantNotes} onChange={e=>setDraftImportantNotes(e.target.value)} placeholder="必须遵守的人物设定、禁忌和剧情要求……" rows={3}/></div>{projectFieldActions("important_notes",true)}<div className="dialog-actions"><Button onClick={()=>void createProject()}>创建作品</Button></div></DialogContent></Dialog></div>
        <div className="project-list">{projects.map(p=><button key={p.id} className={`project-item ${p.id===projectId?"active":""}`} onClick={async()=>{if(busy||fieldBusy){toast("请先停止当前生成");return;}if(chapterId&&!await flushChapter(chapterId))return;if(projectDirty&&!await saveProject(project||{}))return;setProjectId(p.id);setChapterId(allChapters.find(c=>c.project_id===p.id)?.id||"");setProposal(null);}}><BookOpen size={16}/><span>{p.title}{p.legacy?" · 旧版共享":""}</span></button>)}{!projects.length&&!loading&&<p className="side-empty">先创建一部作品</p>}</div>
        {project&&<><div className="section-label"><span>章节目录 <b>{chapters.length}</b></span><button className="icon-button" aria-label="添加章节" title="添加章节" disabled={!!project?.legacy||addingChapter} onClick={()=>void addChapter()}><Plus size={17}/></button></div><div className="chapter-list">{chapters.map((c,i)=><button key={c.id} className={`chapter-item ${c.id===chapterId?"selected":""}`} onClick={async()=>{if(busy||fieldBusy){toast("请先停止当前生成");return;}if(chapterId&&!await flushChapter(chapterId))return;setChapterId(c.id);setProposal(null);setSelection("");}}><span className="chapter-number">{String(i+1).padStart(2,"0")}</span><span className="chapter-name">{c.title}</span>{c.body&&<span className="written-dot" title="已有正文"/>}</button>)}{!chapters.length&&<p className="side-empty">生成大纲或手动添加章节</p>}</div><button className="sidebar-add" disabled={!!project?.legacy||addingChapter} onClick={()=>void addChapter()}><Plus size={16}/> 添加章节</button></>}
        <div className="sidebar-bottom"><span>让故事从一页开始。</span></div>
      </aside>
      <main className="main-area"><div className="main-top"><button className="icon-button sidebar-toggle" title="展开或收起目录" aria-label="展开或收起目录" onClick={()=>setSidebar(!sidebar)}>{sidebar?<PanelLeftClose size={18}/>:<PanelLeftOpen size={18}/>}</button><div className="breadcrumb">{project?.title||"新作品"}<span>/</span>{chapter?chapter.title:"大纲"}</div>{project&&<><Button variant="ghost" size="sm" disabled={project.legacy} onClick={()=>setShowCards(true)}>设定卡</Button><Button variant="ghost" size="sm" disabled={project.legacy} onClick={()=>setShowHistory(true)}>版本</Button></>}{project&&<Dialog open={storyOpen} onOpenChange={async open=>{if(!open&&projectDirty){if(!await saveProject(project||{}))return;}setStoryOpen(open);}}><Button variant="ghost" size="sm" onClick={()=>setStoryOpen(true)}>作品设定 <ArrowRight size={14}/></Button><DialogContent className="settings-dialog"><DialogHeader><DialogTitle>作品设定</DialogTitle></DialogHeader><div className="field"><Label htmlFor="story-title">书名</Label><Input readOnly={!!project.legacy} id="story-title" value={project.title} onChange={e=>{setProjectDirty(true);setProjects(items=>items.map(p=>p.id===project.id?{...p,title:e.target.value}:p));}}/></div><div className="field"><Label htmlFor="story-genre">题材</Label><Input readOnly={!!project.legacy} id="story-genre" value={project.genre} onChange={e=>{setProjectDirty(true);setProjects(items=>items.map(p=>p.id===project.id?{...p,genre:e.target.value}:p));}} placeholder="悬疑、科幻、奇幻……"/></div><div className="field"><Label htmlFor="field-instruction">AI 修改要求（可选）</Label><Textarea id="field-instruction" rows={2} value={fieldInstruction} onChange={e=>setFieldInstruction(e.target.value)} placeholder="例如：突出主角的成长；保持悬疑氛围……"/></div><div className="field"><Label htmlFor="story-summary">小说概要</Label><Textarea readOnly={!!project.legacy} id="story-summary" rows={5} value={project.summary} onChange={e=>{setProjectDirty(true);setProjects(items=>items.map(p=>p.id===project.id?{...p,summary:e.target.value}:p));}} placeholder="概括故事主线、主要人物和发展方向……"/></div>{projectFieldActions("summary")}<div className="field"><Label htmlFor="story-premise">世界设定与核心冲突</Label><Textarea readOnly={!!project.legacy} id="story-premise" rows={5} value={project.premise} onChange={e=>{setProjectDirty(true);setProjects(items=>items.map(p=>p.id===project.id?{...p,premise:e.target.value}:p));}}/></div><div className="field"><Label htmlFor="story-notes">重要提示</Label><Textarea readOnly={!!project.legacy} id="story-notes" rows={5} value={project.important_notes} onChange={e=>{setProjectDirty(true);setProjects(items=>items.map(p=>p.id===project.id?{...p,important_notes:e.target.value}:p));}} placeholder="模型生成大纲与正文时必须记住的约束……"/></div>{projectFieldActions("important_notes")}<div className="field"><Label htmlFor="story-style">文风</Label><Textarea readOnly={!!project.legacy} id="story-style" rows={3} value={project.style} onChange={e=>{setProjectDirty(true);setProjects(items=>items.map(p=>p.id===project.id?{...p,style:e.target.value}:p));}} placeholder="例如：克制、细腻、第三人称……"/></div><div className="dialog-actions"><Button variant="destructive" disabled={!!project.legacy} onClick={async()=>{if(!window.confirm("将整部作品移出工作台？作品、章节和正文会保留；恢复入口稍后提供。"))return;if(!await flushAllChapters())return;if(projectDirty&&!await saveProject(project))return;await post("deleteProject",{id:project.id});setStoryOpen(false);setProjectId("");await load();}}>删除作品</Button><Button disabled={!!project.legacy} onClick={async()=>{if(await saveProject(project))setStoryOpen(false);}}>保存设定</Button></div></DialogContent></Dialog>}</div>
        {project?.legacy&&<div className="legacy-banner">这是旧版共享作品。复制到当前浏览器的工作区后即可编辑；旧版原件会保留。<Button size="sm" onClick={()=>void cloneLegacy()}>复制到我的工作区</Button></div>}{!project? <section className="welcome"><div className="welcome-icon"><BookOpen size={32}/></div><div className="eyebrow">新的故事</div><h1>从一个念头，写到最后一章。</h1><p>先创建作品，写下故事设定。你可以生成大纲，也可以从空白章节开始。</p><Button onClick={()=>setNewOpen(true)}><Plus size={17}/> 新建小说</Button></section>:
        <><div className="editor-heading"><div><span className="eyebrow">{chapter?`第 ${chapters.findIndex(c=>c.id===chapter.id)+1} 章`:"故事蓝图"}</span><h1>{chapter?.title||project.title}</h1></div><Tabs value={mode} onValueChange={value=>{setMode(value as "outline"|"body");setProposal(null);}}><TabsList><TabsTrigger value="outline"><FileText size={16}/> 大纲</TabsTrigger><TabsTrigger value="body"><PenLine size={16}/> 正文</TabsTrigger></TabsList></Tabs></div>
        <div className="editor-scroll"><div className="editor-paper">{chapter?<>{mode==="outline"?<><div className="editor-label">章节标题</div><input readOnly={!!project.legacy} className="title-input" aria-label="章节标题" value={chapter.title} onChange={e=>updateChapter(chapter.id,{title:e.target.value})} placeholder="输入章节标题"/><div className="editor-label synopsis-label">章节概述</div><textarea readOnly={!!project.legacy} className="synopsis-editor" aria-label="章节概述" value={chapter.synopsis} onChange={e=>updateChapter(chapter.id,{synopsis:e.target.value})} placeholder="这一章发生什么？人物想要什么，又遇到什么阻碍？"/><div className="chapter-controls"><Button variant="ghost" size="sm" onClick={()=>void moveChapter(-1)} disabled={!!project.legacy||chapters.indexOf(chapter)===0}><ChevronUp size={15}/> 上移</Button><Button variant="ghost" size="sm" onClick={()=>void moveChapter(1)} disabled={!!project.legacy||chapters.indexOf(chapter)===chapters.length-1}><ChevronDown size={15}/> 下移</Button><Button variant="ghost" size="sm" disabled={!!project.legacy} onClick={()=>void deleteChapter()}><Trash2 size={15}/> 删除章节</Button></div></>:<><div className="body-synopsis"><span>本章概述</span><p>{chapter.synopsis||"先在大纲中写下本章概述，生成正文会更准确。"}</p></div>{chapter.body&&chapter.body_outline_revision!==null&&chapter.body_outline_revision<chapter.outline_revision&&<div className="stale-note">大纲已修改，请检查正文是否仍与当前概述一致。</div>}{!!chapter.continuity_review&&<div className="stale-note">相邻大纲插入了新章节，请复核本章承接与时间线。<Button size="sm" variant="outline" onClick={async()=>{await post("markReviewed",{id:chapter.id});await load();}}>已复核</Button></div>}<textarea readOnly={!!project.legacy} onSelect={e=>{const area=e.currentTarget;setSelectionStart(area.selectionStart);setSelectionEnd(area.selectionEnd);setBodyCursor(area.selectionEnd);setSelection(area.value.slice(area.selectionStart,area.selectionEnd));}} className="body-editor" aria-label="章节正文" value={chapter.body} onChange={e=>updateChapter(chapter.id,{body:e.target.value})} placeholder="在这里写作，或使用右侧的 AI 助手生成本章正文……"/><div className="revision-tools"><span>{selection?`已选 ${selection.length} 字`:"选中正文片段后可局部修订"}</span>{(["expand","rewrite","shorten","polish"] as const).map(op=><Button key={op} size="sm" variant="outline" disabled={!selection||busy||!!project.legacy} onClick={()=>{selectionOperation.current=op;void generate("selection");}}>{({expand:"扩写",rewrite:"重写",shorten:"缩写",polish:"润色"})[op]}</Button>)}</div><div className="memory-box"><Label htmlFor="chapter-memory">本章事实记忆 · 后续章节会引用</Label><Textarea id="chapter-memory" readOnly={!!project.legacy} rows={3} value={chapter.memory||""} onChange={e=>updateChapter(chapter.id,{memory:e.target.value})} placeholder="本章发生了什么，哪些伏笔尚未回收？"/><Button variant="outline" size="sm" disabled={!chapter.body||busy||!!project.legacy} onClick={()=>void generate("memory")}>AI 整理本章记忆</Button></div></>}</>:<div className="outline-empty"><div className="empty-ornament"><Sparkles size={26}/></div><h2>故事，从大纲开始</h2><p>在右侧填写章节数并生成整部大纲，或手动添加第一章。</p><Button variant="outline" disabled={!!project?.legacy||addingChapter} onClick={()=>void addChapter()}><Plus size={16}/> 手动添加章节</Button></div>}</div></div></>}
      </main>
      {project&&<aside className="assistant-panel"><div className="assistant-head"><div className="assistant-symbol"><Sparkles size={17}/></div><span>创作助手</span></div><div className="assistant-content"><div className="helper-title">{mode==="outline"?"让故事继续生长":"写下这一章"}</div><p className="helper-description">{mode==="outline"?"会参考小说概要、重要提示和作品设定。生成内容会先展示，确认后才保存。":"会参考小说概要、重要提示、章节概述与前文。你可以先调整写作要求。"}</p><div className="field"><Label htmlFor="instruction">补充要求</Label><Textarea id="instruction" rows={5} placeholder={mode==="outline"?"例如：前三章增加悬念；加强女主的主动性……":"例如：突出雨夜的压迫感，多写人物之间的对话……"} value={instruction} onChange={e=>setInstruction(e.target.value)}/></div>{mode==="outline"&&<div className="field"><Label htmlFor="count">生成章节数</Label><Input id="count" type="number" min={1} max={30} value={count} onChange={e=>setCount(Number(e.target.value))}/></div>}
          {mode==="outline"&&<div className="field"><Label htmlFor="insert-after">AI 插入位置</Label><select id="insert-after" value={insertAfterId} onChange={e=>setInsertAfterId(e.target.value)}><option value="__start__">全书最前面</option>{chapters.map((c,i)=><option key={c.id} value={c.id}>第 {i+1} 章《{c.title}》之后</option>)}</select><p className="model-hint">插入只新增章节，已有正文保留；相邻正文会提示复核。</p></div>}
          <div className="generate-actions">{mode==="outline"?<><Button className="primary-action" disabled={busy||!!project?.legacy} onClick={()=>void generate("outline")}><Sparkles size={16}/>{busy?"生成中…":"生成全书大纲"}</Button><div className="action-grid"><Button variant="outline" disabled={busy||!chapter||!!project?.legacy} onClick={()=>void generate("rewrite")}><RefreshCw size={15}/> 重写本章</Button><Button variant="outline" disabled={busy||!chapters.length||!!project?.legacy} onClick={()=>void generate("append")}><Plus size={15}/> 追加大纲</Button><Button variant="outline" disabled={busy||!!project?.legacy} onClick={()=>void generate("insert")}><Plus size={15}/> AI 插入大纲</Button></div></>:<><Button className="primary-action" disabled={busy||!chapter||!!project?.legacy} onClick={()=>void generate("body")}><Sparkles size={16}/>{busy?"生成中…":"生成本章正文"}</Button><div className="action-grid"><Button variant="outline" disabled={busy||!chapter?.body||!!project?.legacy} onClick={()=>void generate("continue")}>从光标处续写</Button><Button variant="outline" disabled={busy||!chapter?.body||!!project?.legacy} onClick={()=>void generate("bodyRewrite")}>重写整章正文</Button></div><p className="model-hint">将光标放在正文中指定位置；未放置时从章末续写。</p></>}</div><p className="model-hint">{model.model?`当前模型 · ${model.model}`:"尚未配置模型"} <button onClick={()=>setSettingsOpen(true)}>设置</button></p>
          <p className="model-hint">默认模型每日最多 10 次／工作区、全站 30 次。本次约携带 {Math.ceil(((project.summary||"").length+(project.important_notes||"").length+(project.premise||"").length+chapters.reduce((n,c)=>n+c.synopsis.length,0))/1000)} 千字设定与大纲，长篇生成可能另有正文上下文。</p>
          {busy&&<section className="proposal"><div className="proposal-head"><span>AI 正在输出</span><button className="icon-button" onClick={stopGeneration} aria-label="停止生成"><X size={16}/></button></div><div className="proposal-scroll" ref={streamBox} onScroll={e=>{const el=e.currentTarget;followStream.current=el.scrollHeight-el.scrollTop-el.clientHeight<48;}}><p className={skipAnimation?"proposal-body":"proposal-body typing-output"} aria-live="polite">{streaming||"正在连接模型…"}</p></div><div className="proposal-buttons"><Button variant="outline" size="sm" onClick={()=>setSkipAnimation(!skipAnimation)}>{skipAnimation?"启用动画":"关闭动画"}</Button><Button variant="outline" size="sm" onClick={stopGeneration}>停止生成</Button></div></section>}
          {proposal&&<section className="proposal"><div className="proposal-head"><span>生成草稿</span><button className="icon-button" onClick={()=>setProposal(null)} aria-label="关闭草稿"><X size={16}/></button></div><div className="proposal-scroll">{proposal.kind==="insert"&&<div className="revision-before">插入在：{proposal.afterChapterId?`《${chapters.find(c=>c.id===proposal.afterChapterId)?.title||"已删除章节"}》之后`:"全书最前面"}</div>}{proposal.kind==="continue"&&<div className="revision-before">在正文第 {proposal.insertionOffset??proposal.baseBody?.length??0} 字处续写</div>}{proposal.kind==="bodyRewrite"&&<div className="revision-before"><strong>当前正文</strong><p>{proposal.baseBody}</p><strong>重写稿</strong></div>}{proposal.kind==="selection"&&proposal.selection&&<div className="revision-before"><strong>原文</strong><p>{proposal.selection}</p><strong>修订稿</strong></div>}{proposal.chapters?.map((c,i)=><div className="proposal-chapter" key={i}><strong>{c.title}</strong><p>{c.synopsis}</p></div>)}{proposal.text&&<p className="proposal-body">{proposal.text}</p>}</div><div className="proposal-buttons"><Button variant="outline" size="sm" onClick={()=>setProposal(null)}>舍弃</Button><Button size="sm" disabled={busy||(["outline","append","insert","rewrite"].includes(proposal.kind)&&!proposal.chapters?.length)||(["body","continue","bodyRewrite","selection","memory"].includes(proposal.kind)&&!proposal.text)} onClick={()=>void acceptProposal()}><Check size={15}/> 采用内容</Button></div></section>}
        </div><div className="assistant-footer"><span className="footer-line"/>你的文字始终由你决定。</div></aside>}
    </div>
  </div>;
}
