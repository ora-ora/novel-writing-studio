"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Plus, Settings2, Sparkles, PenLine, Download, ChevronUp, ChevronDown, MoreHorizontal, Trash2, PanelLeftClose, PanelLeftOpen, RefreshCw, Check, X, ArrowRight, FileText } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { moveChapterId } from "@/lib/chapter-order";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Toaster, toast } from "sonner";
import ContinuousReader, { ReaderAction, ReaderJump } from "./ContinuousReader";
import { Chapter, fetchChapterBatch, hasBody } from "@/lib/chapters";

type Project = {id:string;title:string;summary:string;story_bible:string;genre:string;style:string;updated_at:string;};
type Snapshot = {id:string;project_id:string;reason:string;created_at:string};
type SavedDraft = {id:string;project_id:string;kind:string;target_id:string|null;content:string;created_at:string};
type ModelConfig = {endpoint:string;model:string;key:string;temperature:number};
type Proposal = {kind:"outline"|"append"|"insert"|"rewrite"|"body"|"continue"|"bodyRewrite"|"selection"|"memory"; chapters?:{title:string;synopsis:string}[]; text?:string; target?:string; selection?:string; afterChapterId?:string; insertionOffset?:number; baseBody?:string};
type ProjectField = "summary"|"story_bible";
type FieldOperation = "generate"|"expand"|"rewrite";
type FieldProposal = {field:ProjectField;text:string;draft:boolean;selectionStart?:number;selectionEnd?:number;baseText?:string};
const storyTemplate=`# 故事主线
主角想要什么：
最大的阻碍：
关键转折：
结局方向：

# 人物
## 主角
身份与目标：
性格与弱点：
重要关系：
变化：

# 世界与规则

# 时间线

# 伏笔与禁忌`;
const defaultModel:ModelConfig = {endpoint:"https://api.deepseek.com/chat/completions",model:"deepseek-flash",key:"",temperature:0.8};

export default function Home() {
  const [projects,setProjects]=useState<Project[]>([]);
  const [allChapters,setAllChapters]=useState<Chapter[]>([]);
  const [reviewBusy,setReviewBusy]=useState(false);
  const [reviewText,setReviewText]=useState("");
  const [bibleSelection,setBibleSelection]=useState({start:0,end:0,text:""});
  const [snapshots,setSnapshots]=useState<Snapshot[]>([]);
  const [drafts,setDrafts]=useState<SavedDraft[]>([]);
  const [projectId,setProjectId]=useState("");
  const [chapterId,setChapterId]=useState("");
  const [mode,setMode]=useState<"outline"|"body">("outline");
  const [view,setView]=useState<"read"|"edit">("read");
  const [readingChapterId,setReadingChapterId]=useState("");
  const [readerJump,setReaderJump]=useState<ReaderJump|null>(null);
  const [detailBusy,setDetailBusy]=useState(false);
  const [detailError,setDetailError]=useState("");
  const [exportBusy,setExportBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [generationKind,setGenerationKind]=useState<Proposal["kind"]|"test"|null>(null);
  const [addingChapter,setAddingChapter]=useState(false);
  const [saving,setSaving]=useState(false);
  const [saveError,setSaveError]=useState(false);
  const [streaming,setStreaming]=useState("");
  const [showHistory,setShowHistory]=useState(false);
  const [selection,setSelection]=useState("");
  const [selectionStart,setSelectionStart]=useState(0);
  const [selectionEnd,setSelectionEnd]=useState(0);
  const [skipAnimation,setSkipAnimation]=useState(false);
  const [sidebar,setSidebar]=useState(true);
  const [treeFocusId,setTreeFocusId]=useState("");
  const [moveTargetId,setMoveTargetId]=useState("");
  const [movePosition,setMovePosition]=useState("");
  const [reordering,setReordering]=useState(false);
  const reorderPending=useRef(false);
  const [mobileAssistantOpen,setMobileAssistantOpen]=useState(false);
  const [newOpen,setNewOpen]=useState(false);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [storyOpen,setStoryOpen]=useState(false);
  const [projectDirty,setProjectDirty]=useState(false);
  const [draftTitle,setDraftTitle]=useState("");
  const [draftStoryBible,setDraftStoryBible]=useState("");
  const [draftSummary,setDraftSummary]=useState("");
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
  const saveRequests=useRef(new Map<string,Promise<boolean>>());
  const generationAbort=useRef<AbortController|null>(null);
  const streamingRef=useRef("");
  const streamBox=useRef<HTMLDivElement|null>(null);
  const fieldStreamBox=useRef<HTMLParagraphElement|null>(null);
  const followStream=useRef(true);
  const selectionOperation=useRef("rewrite");
  const generationPending=useRef(false);
  const navigationSequence=useRef(0);
  const chapterRows=useRef(allChapters);chapterRows.current=allChapters;
  const chapterRequests=useRef(new Map<string,Promise<Chapter>>());
  const detailOrder=useRef<string[]>([]);
  const directory=useRef<HTMLDivElement>(null);
  const project=projects.find(p=>p.id===projectId);
  const chapters=useMemo(()=>allChapters.filter(c=>c.project_id===projectId).sort((a,b)=>a.position-b.position||a.id.localeCompare(b.id)),[allChapters,projectId]);
  const chapter=chapters.find(c=>c.id===chapterId);
  const readingChapter=chapters.find(c=>c.id===readingChapterId)||chapter;
  const moveTarget=chapters.find(c=>c.id===moveTargetId);
  const moveIndex=Number(movePosition)-1;
  const validMove=!!moveTarget&&movePosition.trim()!==""&&Number.isInteger(moveIndex)&&moveIndex>=0&&moveIndex<chapters.length&&chapters[moveIndex]?.id!==moveTargetId;
  const reorderDisabled=reordering||busy||!!fieldBusy||reviewBusy||addingChapter;
  useEffect(()=>{setTreeFocusId("");setMoveTargetId("");},[projectId]);

  const load=useCallback(async()=>{
    try {
      const response=await fetch("/api/workspace?view=catalog",{cache:"no-store"});const data=await response.json() as {error?:string;projects:Project[];chapters:Chapter[];snapshots:Snapshot[];drafts:SavedDraft[]};
      if(!response.ok) throw new Error(data.error);
      setProjects(data.projects);setAllChapters(previous=>data.chapters.map(c=>{
        let backup:Partial<Chapter>={};
        try{backup=JSON.parse(localStorage.getItem("novel-backup-"+c.id)||"{}") as Partial<Chapter>;}catch{}
        if(Object.keys(backup).length){pendingPatch.current[c.id]={...backup,...pendingPatch.current[c.id]};setSaveError(true);}
        const old=previous.find(item=>item.id===c.id);
        const cached=old?.updated_at===c.updated_at?{body:old.body,synopsis:old.synopsis,memory:old.memory,body_loaded:old.body_loaded,outline_loaded:old.outline_loaded}:{};
        const patch={...backup,...pendingPatch.current[c.id]};
        return {...c,...cached,...patch,...(typeof patch.body==="string"?{body_length:patch.body.length}: {})};
      }));
      setSnapshots(data.snapshots||[]);setDrafts(data.drafts||[]);
      setProjectId(current=>data.projects.some((p:Project)=>p.id===current)?current:(data.projects[0]?.id||""));
      setChapterId(current=>data.chapters.some((c:Chapter)=>c.id===current)?current:(data.chapters[0]?.id||""));
    } catch(e){toast.error(e instanceof Error?e.message:"读取失败");}
    finally{setLoading(false);}
  },[]);
  const ensureChapter=useCallback(async(id:string):Promise<Chapter>=>{
    const current=chapterRows.current.find(c=>c.id===id);
    if(!current)throw new Error("目标章节不存在，请刷新目录");
    if(current.body_loaded)return {...current,...pendingPatch.current[id]};
    const key=`${id}:${current.updated_at}`;
    const existing=chapterRequests.current.get(key);if(existing)return existing;
    const request=fetchChapterBatch(current.project_id,[id],"body").then(rows=>{
      const row={...rows[0],...pendingPatch.current[id]};
      detailOrder.current=[...detailOrder.current.filter(key=>key!==id),id].slice(-6);
      setAllChapters(items=>items.map(item=>{
        if(item.id===id&&item.updated_at===current.updated_at)return row;
        if(item.body_loaded&&!detailOrder.current.includes(item.id)&&!pendingPatch.current[item.id])return {...item,body:"",body_loaded:false};
        return item;
      }));
      return row;
    }).finally(()=>chapterRequests.current.delete(key));
    chapterRequests.current.set(key,request);return request;
  },[]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{
    if(view!=="edit"||!chapterId||chapter?.body_loaded){setDetailBusy(false);setDetailError("");return;}
    let active=true;setDetailBusy(true);setDetailError("");
    void ensureChapter(chapterId).catch(error=>{if(active)setDetailError(error instanceof Error?error.message:"章节加载失败");}).finally(()=>{if(active)setDetailBusy(false);});
    return()=>{active=false;};
  },[view,chapterId,chapter?.updated_at,chapter?.body_loaded,ensureChapter]);
  useEffect(()=>{if(window.matchMedia("(max-width: 850px)").matches)setSidebar(false);},[]);
  useEffect(()=>{
    if(!sidebar)return;
    const list=directory.current, item=list?.querySelector<HTMLElement>(".chapter-item.selected");
    if(!list||!item)return;
    const bounds=list.getBoundingClientRect(),rect=item.getBoundingClientRect();
    if(rect.top<bounds.top)list.scrollTop+=rect.top-bounds.top;
    else if(rect.bottom>bounds.bottom)list.scrollTop+=rect.bottom-bounds.bottom;
  },[readingChapterId,chapterId,treeFocusId,chapters,sidebar,view]);
  useEffect(()=>{
    if(view==="edit"&&window.matchMedia("(max-width: 650px)").matches)window.scrollTo({top:0,behavior:"instant"});
  },[view,chapterId]);
  useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem("novel-model")||"null") as Partial<ModelConfig>|null;if(saved?.endpoint&&saved.model)setModel({...defaultModel,...saved,key:""});}catch{}},[]);
  useEffect(()=>{localStorage.setItem("novel-model",JSON.stringify({endpoint:model.endpoint,model:model.model,temperature:model.temperature}));},[model.endpoint,model.model,model.temperature]);
  useEffect(()=>{try{const d=JSON.parse(localStorage.getItem("novel-new-draft")||"null") as {title?:string;premise?:string;summary?:string;notes?:string;story_bible?:string}|null;if(d){setDraftTitle(d.title||"");setDraftSummary(d.summary||"");setDraftStoryBible(d.story_bible||[d.premise&&`# 世界与规则\n${d.premise}`,d.notes&&`# 重要提示\n${d.notes}`].filter(Boolean).join("\n\n"));}}catch{}setDraftLoaded(true);},[]);
  useEffect(()=>{if(draftLoaded)localStorage.setItem("novel-new-draft",JSON.stringify({title:draftTitle,summary:draftSummary,story_bible:draftStoryBible}));},[draftLoaded,draftTitle,draftSummary,draftStoryBible]);
  useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem("novel-field-proposal")||"null") as FieldProposal|null;if(saved?.draft)setFieldProposal(saved);}catch{}},[]);
  useEffect(()=>{if(fieldProposal?.draft)localStorage.setItem("novel-field-proposal",JSON.stringify(fieldProposal));else localStorage.removeItem("novel-field-proposal");},[fieldProposal]);
  useEffect(()=>{if(followStream.current){if(streamBox.current)streamBox.current.scrollTop=streamBox.current.scrollHeight;if(fieldStreamBox.current)fieldStreamBox.current.scrollTop=fieldStreamBox.current.scrollHeight;}},[streaming]);
  useEffect(()=>{if(projectId && !chapters.some(c=>c.id===chapterId)) setChapterId(chapters[0]?.id||"");},[projectId,chapterId,chapters.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{
    if(view==="read"&&readingChapterId&&!busy&&!fieldBusy&&!reviewBusy&&!proposal&&!generationPending.current&&chapters.some(c=>c.id===readingChapterId))setChapterId(readingChapterId);
  },[view,readingChapterId,busy,fieldBusy,reviewBusy,proposal,chapters]);
  useEffect(()=>{setInsertAfterId(chapterId||"__start__");setBodyCursor(null);},[chapterId,projectId]);
  useEffect(()=>()=>{Object.values(pending.current).forEach(clearTimeout);},[]);
  async function post(action:string,fields:Record<string,unknown>={}){
    const r=await fetch("/api/workspace",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,...fields})});
    const data=await r.json() as {error?:string;id:string;outlineRevision?:number};if(!r.ok) throw new Error(data.error||"保存失败");return data;
  }
  async function flushChapter(id:string):Promise<boolean>{
    clearTimeout(pending.current[id]);
    const active=saveRequests.current.get(id);
    if(active){if(!await active)return false;return flushChapter(id);}
    const values=pendingPatch.current[id];if(!values)return true;
    setSaving(true);
    const request=(async()=>{
      try{const result=await post("updateChapter",{id,...values});if(pendingPatch.current[id]===values){delete pendingPatch.current[id];localStorage.removeItem("novel-backup-"+id);}if(result.outlineRevision)setAllChapters(items=>items.map(c=>c.id===id?{...c,outline_revision:result.outlineRevision!}:c));setSaveError(false);return true;}
      catch(e){setSaveError(true);localStorage.setItem("novel-backup-"+id,JSON.stringify(pendingPatch.current[id]||values));toast.error(e instanceof Error?e.message:"保存失败，草稿已暂存在此浏览器");return false;}
      finally{saveRequests.current.delete(id);setSaving(saveRequests.current.size>0);}
    })();
    saveRequests.current.set(id,request);
    if(!await request)return false;
    return pendingPatch.current[id]?flushChapter(id):true;
  }
  async function flushAllChapters(){for(const id of Object.keys(pendingPatch.current))if(!await flushChapter(id))return false;return true;}
  function updateChapter(id:string,patch:Partial<Chapter>){
    setAllChapters(items=>items.map(c=>c.id===id?{...c,...patch,...(typeof patch.body==="string"?{body_length:patch.body.length}: {})}:c));
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
    try {const result=await post("createProject",{title:draftTitle.trim()||"未命名小说",summary:draftSummary,story_bible:draftStoryBible});await load();setProjectId(result.id);setChapterId("");setNewOpen(false);setDraftTitle("");setDraftSummary("");setDraftStoryBible("");localStorage.removeItem("novel-new-draft");toast.success("作品已创建");}
    catch(e){toast.error(e instanceof Error?e.message:"创建失败");}
  }
  async function switchProject(nextId:string){
    if(nextId===projectId)return;
    if(reorderPending.current){toast("请等待章节移动完成");return;}
    if(busy||fieldBusy){toast("请先停止当前生成");return;}
    navigationSequence.current++;
    if(!await flushAllChapters())return;
    if(projectDirty&&project&&!await saveProject(project))return;
    setProjectId(nextId);
    setReadingChapterId("");setReaderJump(null);
    setChapterId(allChapters.filter(c=>c.project_id===nextId).sort((a,b)=>a.position-b.position)[0]?.id||"");
    setProposal(null);
    setFieldProposal(null);setBibleSelection({start:0,end:0,text:""});setReviewText("");
    setSelection("");
  }
  async function editChapter(id:string){
    if(busy||fieldBusy||reviewBusy||generationPending.current){toast("请先停止当前生成");return;}
    const sequence=++navigationSequence.current;
    if(!await flushAllChapters())return;
    try{await ensureChapter(id);if(sequence!==navigationSequence.current)return;setChapterId(id);setReaderJump(null);setProposal(null);setSelection("");setView("edit");setMobileAssistantOpen(false);}
    catch(error){toast.error(error instanceof Error?error.message:"章节加载失败");}
  }
  async function readChapters(){navigationSequence.current++;if(await flushAllChapters())setView("read");}
  function selectReaderChapter(id:string){
    setReadingChapterId(id);
    if(!busy&&!fieldBusy&&!reviewBusy&&!proposal&&!generationPending.current)setChapterId(id);
  }
  function readerAI(id:string,action:ReaderAction){
    setMobileAssistantOpen(true);setBodyCursor(null);
    if(action==="insert")setInsertAfterId(id);
    void generate(action,id,action==="insert"?id:undefined);
  }
  async function reviewSettings(){
    if(!project||reviewBusy||fieldBusy)return;
    if(projectDirty&&!await saveProject(project))return;
    if(!await flushAllChapters())return;
    setReviewBusy(true);setReviewText("");
    try{const {result}=await streamRequest({kind:"reviewSettings",...model,projectId:project.id,title:project.title,summary:project.summary,story_bible:project.story_bible,genre:project.genre,style:project.style,chapters,instruction:fieldInstruction});const report=result?.text||"";if(!report.trim())throw new Error("模型没有返回检查结果");setReviewText(report);await retainDraft("reviewSettings",report);}
    catch(e){if(streamingRef.current)setReviewText(streamingRef.current);toast.error(e instanceof Error?e.message:"检查失败");}
    finally{setReviewBusy(false);generationAbort.current=null;}
  }
  async function saveProject(patch:Partial<Project>){
    if(!project)return;setProjects(items=>items.map(p=>p.id===project.id?{...p,...patch}:p));
    try{await post("updateProject",{...project,...patch,id:project.id});setProjectDirty(false);setSaveError(false);await load();toast.success("设定已保存");return true;}
    catch(e){setSaveError(true);toast.error(e instanceof Error?e.message:"保存失败");return false;}
  }
  async function generateProjectField(field:ProjectField,operation:FieldOperation,draft=false){
    if((!project&&!draft)||fieldBusy)return;
    if(!model.endpoint||!model.model){toast.error("请先配置模型");return;}
    setFieldBusy(field);setFieldBusyDraft(draft);setFieldProposal(null);
    const source=draft?{title:draftTitle,summary:draftSummary,story_bible:draftStoryBible,genre:"",style:""}:project!;
    const selected=field==="story_bible"&&operation!=="generate"&&bibleSelection.text&&source.story_bible.slice(bibleSelection.start,bibleSelection.end)===bibleSelection.text?bibleSelection:null;
    try{
      const {result}=await streamRequest({kind:"projectField",field,operation,...model,projectId:draft?undefined:project?.id,title:source.title,summary:source.summary,story_bible:source.story_bible,genre:source.genre,style:source.style,chapters:draft?[]:chapters,instruction:fieldInstruction,fieldSelection:selected?.text||""});
      if(!result?.text?.trim())throw new Error("模型没有返回内容");
      const next={field,text:result.text.trim(),draft,selectionStart:selected?.start,selectionEnd:selected?.end,baseText:field==="story_bible"?source.story_bible:undefined};
      setFieldProposal(next);
      if(!draft)await retainDraft(field,JSON.stringify(next));
    }catch(e){if(streamingRef.current){const partial={field,text:streamingRef.current,draft,selectionStart:selected?.start,selectionEnd:selected?.end,baseText:field==="story_bible"?source.story_bible:undefined};setFieldProposal(partial);if(!draft)await retainDraft(field,JSON.stringify(partial));}toast.error(e instanceof Error?e.message:"生成中断，已保留收到的内容");}
    finally{setFieldBusy(null);generationAbort.current=null;}
  }
  async function acceptProjectField(){
    if(!fieldProposal)return;
    if(fieldProposal.draft){
      if(fieldProposal.field==="summary")setDraftSummary(fieldProposal.text);
      else setDraftStoryBible(fieldProposal.selectionStart!==undefined&&fieldProposal.baseText!==undefined?fieldProposal.baseText.slice(0,fieldProposal.selectionStart)+fieldProposal.text+fieldProposal.baseText.slice(fieldProposal.selectionEnd):fieldProposal.text);
      setFieldProposal(null);
      toast.success("已采用草稿，创建作品后保存");
      return;
    }
    if(!project)return;
    if(fieldProposal.field==="story_bible"&&fieldProposal.baseText!==undefined&&project.story_bible!==fieldProposal.baseText){toast.error("故事资料已经修改，请重新生成草稿");return;}
    const value=fieldProposal.selectionStart!==undefined&&fieldProposal.selectionEnd!==undefined&&fieldProposal.baseText!==undefined
      ?fieldProposal.baseText.slice(0,fieldProposal.selectionStart)+fieldProposal.text+fieldProposal.baseText.slice(fieldProposal.selectionEnd)
      :fieldProposal.text;
    const next={...project,[fieldProposal.field]:value};
    setFieldBusy(fieldProposal.field);
    try{
      await post("updateProject",next);
      setProjects(items=>items.map(p=>p.id===project.id?next:p));
      await load();
      setFieldProposal(null);setProjectDirty(false);
      toast.success("已保存到作品设定");
    }catch(e){toast.error(e instanceof Error?e.message:"保存失败");}
    finally{setFieldBusy(null);}
  }
  function projectFieldActions(field:ProjectField,draft=false){
    const value=draft?(field==="summary"?draftSummary:draftStoryBible):(project?.[field]||"");
    const label=field==="summary"?"小说概要":"故事资料";
    return <div className="field-ai"><div className="field-ai-actions">
      <Button variant="outline" size="sm" disabled={!!fieldBusy} onClick={()=>void generateProjectField(field,"generate",draft)}><Sparkles size={14}/>{fieldBusy===field?"生成中…":"AI 生成"}</Button>
      <Button variant="outline" size="sm" disabled={!!fieldBusy||!value.trim()} onClick={()=>void generateProjectField(field,"expand",draft)}>扩写{field==="story_bible"&&bibleSelection.text?"选中段落":""}</Button>
      <Button variant="outline" size="sm" disabled={!!fieldBusy||!value.trim()} onClick={()=>void generateProjectField(field,"rewrite",draft)}>重写{field==="story_bible"&&bibleSelection.text?"选中段落":""}</Button>
    </div>{fieldBusy===field&&fieldBusyDraft===draft&&<div className="field-preview"><strong>AI 正在写作</strong><p ref={fieldStreamBox} onScroll={e=>{const el=e.currentTarget;followStream.current=el.scrollHeight-el.scrollTop-el.clientHeight<48;}} className={skipAnimation?"":"typing-output"} aria-live="polite">{streaming||"正在连接模型…"}</p><div className="field-preview-actions"><Button variant="outline" size="sm" onClick={stopGeneration}>停止生成</Button><Button variant="ghost" size="sm" onClick={()=>setSkipAnimation(!skipAnimation)}>{skipAnimation?"启用动画":"关闭动画"}</Button></div></div>}{fieldProposal?.field===field&&fieldProposal.draft===draft&&<div className="field-preview"><strong>{label}草稿{fieldProposal.selectionStart!==undefined?" · 仅替换选中段落":""}</strong><p>{fieldProposal.text}</p><div className="field-preview-actions"><Button variant="outline" size="sm" onClick={()=>setFieldProposal(null)}>舍弃</Button><Button size="sm" disabled={!!fieldBusy} onClick={()=>void acceptProjectField()}>{draft?"采用草稿":"采用并保存"}</Button></div></div>}</div>;
  }
  async function addChapter(title="新章节",synopsis=""){
    if(!project||addChapterPending.current||reorderPending.current)return null;
    addChapterPending.current=true;setAddingChapter(true);
    try{const result=await post("addChapter",{projectId,title,synopsis});await load();setChapterId(result.id);setView("edit");if(window.matchMedia("(max-width: 850px)").matches)setSidebar(false);return result.id as string;}
    catch(e){toast.error(e instanceof Error?e.message:"添加失败");return null;}
    finally{addChapterPending.current=false;setAddingChapter(false);}
  }
  async function deleteChapter(){
    if(reorderPending.current){toast("请等待章节移动完成");return;}
    if(!chapter||!window.confirm(`将「${chapter.title}」移出章节目录？概述与正文会保留；恢复入口稍后提供。`))return;
    if(!await flushAllChapters())return;
    try{await post("deleteChapter",{id:chapter.id});setChapterId("");await load();toast.success("章节已删除");}catch(e){toast.error(e instanceof Error?e.message:"删除失败");}
  }
  async function moveChapter(id:string,destination:number){
    if(reorderPending.current||reorderDisabled||generationPending.current)return;
    const original=chapters.map(c=>c.id), target=chapters.find(c=>c.id===id);
    if(!target||original[destination]===id)return;
    let ids:string[];
    try{ids=moveChapterId(original,id,destination);}catch(e){toast.error(e instanceof Error?e.message:"移动失败");return;}
    const owner=projectId, previousPositions=new Map(chapters.map(c=>[c.id,c.position]));
    reorderPending.current=true;setReordering(true);
    try{
      if(!await flushAllChapters())return;
      const positions=new Map(ids.map((key,index)=>[key,index]));
      setAllChapters(items=>items.map(c=>c.project_id===owner&&positions.has(c.id)?{...c,position:positions.get(c.id)!}:c));
      setTreeFocusId(id);
      await post("reorder",{projectId:owner,ids});
      setMoveTargetId("");
      toast.success(`已移动到第 ${destination+1} 章`);
    }catch(e){
      setAllChapters(items=>items.map(c=>c.project_id===owner&&previousPositions.has(c.id)?{...c,position:previousPositions.get(c.id)!}:c));
      toast.error(e instanceof Error?e.message:"排序失败");
      await load();
    }finally{reorderPending.current=false;setReordering(false);}
  }
  async function streamRequest(payload:Record<string,unknown>,onDelta?:(delta:string)=>void){
    if(reorderPending.current)throw new Error("请等待章节移动完成，再使用 AI");
    if(payload.projectId&&!await flushAllChapters())throw new Error("请先保存章节，再使用 AI");
    const controller=new AbortController();generationAbort.current=controller;streamingRef.current="";followStream.current=true;setStreaming("");
    const response=await fetch("/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...payload,...(payload.projectId?{chapters:[],selected:payload.selected?{id:(payload.selected as Chapter).id}:undefined}:{}),stream:true}),signal:controller.signal});
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
  async function generate(kind:Proposal["kind"]|"test",requestedTarget?:string,requestedAfter?:string){
    if(reorderPending.current){toast("请等待章节移动完成");return;}
    if(busy||fieldBusy||reviewBusy||generationPending.current)return;
    if(!model.endpoint||!model.model){setSettingsOpen(true);toast("请先配置模型地址和名称");return;}
    if(!project)return;
    if(requestedTarget)setChapterId(requestedTarget);
    generationPending.current=true;streamingRef.current="";setStreaming("");setGenerationKind(kind);setBusy(true);setProposal(null);
    let target:Chapter|undefined;
    try{
      if(projectDirty&&!await saveProject(project))return;
      if(!await flushAllChapters())return;
      const id=requestedTarget||chapterId;
      if(kind!=="test"&&id)target=await ensureChapter(id);
      const chapter=target;
      if(["rewrite","body","continue","bodyRewrite","selection","memory"].includes(kind)&&!chapter)throw new Error("请先选择目标章节");
      if(["continue","bodyRewrite"].includes(kind)&&!chapter?.body.trim())throw new Error("请先写出一些正文");
      if(chapter)setChapterId(chapter.id);
      if((kind==="selection"||kind==="memory")&&window.matchMedia("(max-width: 650px)").matches)setMobileAssistantOpen(true);
      const afterChapterId=requestedAfter??(insertAfterId==="__start__"?"":insertAfterId);
      if(kind==="insert"&&afterChapterId&&!chapters.some(c=>c.id===afterChapterId))throw new Error("插入位置已变化，请重新选择");
      const insertionOffset=requestedTarget||bodyCursor===null?chapter?.body.length||0:Math.max(0,Math.min(bodyCursor,chapter?.body.length||0));
      const payload={kind,...model,projectId:project.id,title:project.title,summary:project.summary,story_bible:project.story_bible,genre:project.genre,style:project.style,chapters,selected:chapter,instruction,count,selection,operation:selectionOperation.current,afterChapterId,cursor:insertionOffset};
      const {result}=await streamRequest(payload);
      if(!result)throw new Error("生成中断");
      if(kind==="test")toast.success("连接成功");
      else {setProposal({kind,chapters:result.chapters,text:result.text,target:chapter?.id,selection,afterChapterId,insertionOffset,baseBody:chapter?.body});await retainDraft(kind,kind==="selection"?JSON.stringify({text:result.text,selection,start:selectionStart,end:selectionEnd}):["continue","bodyRewrite","insert"].includes(kind)?JSON.stringify({text:result.text,chapters:result.chapters,afterChapterId,insertionOffset,baseBody:chapter?.body}):result.text||JSON.stringify(result.chapters),chapter?.id);toast.success("已生成草稿，请确认后采用");}
    }catch(e){if(streamingRef.current&&kind!=="test"){setProposal({kind,text:streamingRef.current,target:target?.id,selection,afterChapterId:requestedAfter??(insertAfterId==="__start__"?"":insertAfterId),insertionOffset:requestedTarget?target?.body.length:bodyCursor??target?.body.length,baseBody:target?.body});await retainDraft(kind,streamingRef.current,target?.id);}if((e as Error).name==="AbortError")toast("已停止，已收到的文字留在预览中");else toast.error(e instanceof Error?e.message:"生成失败");}
    finally{setBusy(false);setGenerationKind(null);generationPending.current=false;generationAbort.current=null;}
  }
  async function acceptProposal(){
    if(reorderPending.current){toast("请等待章节移动完成");return;}
    if(!proposal||!project)return;setBusy(true);
    try{
      const chapterKinds=["rewrite","body","continue","bodyRewrite","selection","memory"];
      const proposalTarget=proposal.target&&chapterKinds.includes(proposal.kind)?await ensureChapter(proposal.target):undefined;
      if(["rewrite","body","continue","bodyRewrite","selection","memory"].includes(proposal.kind))await post("snapshotProject",{projectId,reason:"采用 AI 草稿前"});
      if(proposal.kind==="rewrite"&&proposal.target&&proposal.chapters?.[0]){
        if(!await persistChapter(proposal.target,proposal.chapters[0]))return;
      }else if(proposal.kind==="body"&&proposal.target&&proposal.text){
        if(proposalTarget?.body&&!window.confirm("生成正文将覆盖这一章现有正文。已创建可恢复版本，确定采用吗？"))return;
        if(!await persistChapter(proposal.target,{body:proposal.text,body_outline_revision:-1}))return;setMode("body");
      }else if((proposal.kind==="continue"||proposal.kind==="bodyRewrite")&&proposal.target&&proposal.text){
        const target=proposalTarget;
        if(!target||target.body!==proposal.baseBody)throw new Error("正文已变化，请重新生成草稿");
        const offset=proposal.insertionOffset??target.body.length;
        const next=proposal.kind==="continue"?target.body.slice(0,offset)+proposal.text+target.body.slice(offset):proposal.text;
        if(!await persistChapter(target.id,{body:next,body_outline_revision:-1}))return;setMode("body");
      }else if(proposal.kind==="memory"&&proposal.target&&proposal.text){
        if(!await persistChapter(proposal.target,{memory:proposal.text}))return;
      }else if(proposal.kind==="selection"&&proposal.target&&proposal.text){
        const target=proposalTarget;
        if(!target||target.body.slice(selectionStart,selectionEnd)!==proposal.selection)throw new Error("正文已变化，请重新选择片段");
        if(!await persistChapter(target.id,{body:target.body.slice(0,selectionStart)+proposal.text+target.body.slice(selectionEnd)}))return;
      }else if(proposal.chapters?.length){
        if(proposal.kind==="outline"&&chapters.length){
          if(!window.confirm("采用新大纲会替换当前章节与正文。旧稿会保存为可恢复的版本，确定继续吗？"))return;
        }
        if(!await flushAllChapters())return;
        const result=await post(proposal.kind==="append"?"appendOutline":proposal.kind==="insert"?"insertOutline":"replaceOutline",{projectId,chapters:proposal.chapters,afterChapterId:proposal.afterChapterId||""});
        await load();if(result.id){setChapterId(result.id);setReadingChapterId(result.id);setMode("outline");setReaderJump({id:result.id,token:Date.now(),mode:"outline"});setView("read");}
      }
      if(proposal.target&&chapterKinds.includes(proposal.kind)){setChapterId(proposal.target);setReadingChapterId(proposal.target);setReaderJump({id:proposal.target,token:Date.now(),mode:["body","continue","bodyRewrite","selection"].includes(proposal.kind)?"body":mode});}
      setProposal(null);toast.success("已采用生成结果");
    }catch(e){toast.error(e instanceof Error?e.message:"采用失败，请检查章节列表");await load();}
    finally{setBusy(false);}
  }
  async function exportBook(){
    if(!project||exportBusy)return;setExportBusy(true);
    try{
      if(!await flushAllChapters())return;
      const parts=[`# ${project.title}\n\n## 小说概要\n\n${project.summary||""}\n\n## 故事资料\n\n${project.story_bible||""}\n\n`];
      for(let index=0;index<chapters.length;index+=3){
        const rows=await fetchChapterBatch(project.id,chapters.slice(index,index+3).map(c=>c.id),"body");
        rows.forEach((c,i)=>parts.push(`## 第${index+i+1}章 ${c.title}\n\n> ${c.synopsis}\n\n${c.body||""}\n\n`));
      }
      const blob=new Blob(parts,{type:"text/markdown;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`${project.title.replace(/[\\/:*?"<>|]/g,"_")}.md`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(error){toast.error(error instanceof Error?error.message:"导出失败，请刷新目录后重试");}
    finally{setExportBusy(false);}
  }
  useEffect(()=>{
    const context=(document as Document & {modelContext?:{registerTool:(tool:unknown,options:{signal:AbortSignal})=>Promise<void>|void}}).modelContext;
    if(!context?.registerTool)return;const lifecycle=new AbortController();
    void Promise.resolve(context.registerTool({name:"read_novel_workspace",title:"读取小说工作台",description:"读取当前作品、章节标题和概述",inputSchema:{type:"object",properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:async()=>{const rows:Chapter[]=[];for(let at=0;at<chapters.length;at+=20)rows.push(...await fetchChapterBatch(projectId,chapters.slice(at,at+20).map(c=>c.id),"outline"));return {project:project?.title||null,chapters:rows.map(c=>({id:c.id,title:c.title,synopsis:c.synopsis}))};}},{signal:lifecycle.signal})).catch(()=>{});
    if(projectId) void Promise.resolve(context.registerTool({name:"add_novel_chapter",title:"添加小说章节",description:"为当前作品添加一个带标题和概述的章节，并在工作台显示",inputSchema:{type:"object",properties:{title:{type:"string"},synopsis:{type:"string"}},required:["title","synopsis"],additionalProperties:false},annotations:{readOnlyHint:false},execute:async(input:unknown)=>{const value=input as {title?:unknown;synopsis?:unknown};if(typeof value?.title!=="string"||!value.title.trim()||typeof value?.synopsis!=="string")throw new Error("请提供章节标题和概述");const result=await post("addChapter",{projectId,title:value.title.slice(0,180),synopsis:value.synopsis.slice(0,15000)});await load();setChapterId(result.id);return {id:result.id,title:value.title};}},{signal:lifecycle.signal})).catch(()=>{});
    return ()=>lifecycle.abort();
  },[project?.title,chapters.length,projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="app-shell"><Toaster richColors position="top-center" />
    <header className="topbar"><div className="brand"><div className="brand-mark"><BookOpen size={19}/></div><span>纸间</span><span className="brand-divider"/><small>全站共享创作工作台</small></div>
      <div className="project-switcher"><label htmlFor="project-select">共享作品集</label><select id="project-select" aria-label="选择作品" value={projectId} onChange={e=>void switchProject(e.target.value)}><option value="" disabled>选择作品</option>{projects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select><Dialog open={newOpen} onOpenChange={setNewOpen}><button className="icon-button" aria-label="新建作品" title="新建作品" onClick={()=>setNewOpen(true)}><Plus size={18}/></button><DialogContent className="settings-dialog character-dialog"><DialogHeader><DialogTitle>新建小说</DialogTitle></DialogHeader>
        <div className="field"><Label htmlFor="new-title">书名</Label><Input id="new-title" value={draftTitle} onChange={e=>setDraftTitle(e.target.value)} placeholder="为故事起一个名字"/></div>
        <div className="field"><Label htmlFor="new-summary">小说概要</Label><Textarea id="new-summary" value={draftSummary} onChange={e=>setDraftSummary(e.target.value)} placeholder="这本小说讲述什么故事？" rows={3}/></div>{projectFieldActions("summary",true)}
        <div className="field"><Label htmlFor="new-bible">故事资料（可选）</Label><Textarea id="new-bible" className="story-bible-editor" rows={12} value={draftStoryBible} onSelect={e=>{const el=e.currentTarget;setBibleSelection({start:el.selectionStart,end:el.selectionEnd,text:el.value.slice(el.selectionStart,el.selectionEnd)});}} onChange={e=>{setDraftStoryBible(e.target.value);setBibleSelection({start:0,end:0,text:""});}} placeholder="用 # 主线、# 人物等标签自由记录故事设定……"/></div>
        {!draftStoryBible.trim()&&<Button variant="outline" size="sm" onClick={()=>setDraftStoryBible(storyTemplate)}>插入默认模板</Button>}{projectFieldActions("story_bible",true)}
        <div className="dialog-actions"><Button onClick={()=>void createProject()}>创建作品</Button></div></DialogContent></Dialog></div>
      <div className="top-actions"><span className="save-state">{saveError?"保存失败 · 草稿已暂存":projectDirty?"设定待保存":saving?"保存中…":Object.keys(pendingPatch.current).length?"待保存":"已保存"}</span>{saveError&&<Button variant="outline" size="sm" onClick={async()=>{for(const id of Object.keys(pendingPatch.current))await flushChapter(id);if(projectDirty&&project)await saveProject(project);}}>重试保存</Button>}<Button variant="ghost" size="sm" onClick={()=>void exportBook()} disabled={!project||exportBusy}><Download size={16}/> {exportBusy?"导出中…":"导出"}</Button>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}><Button variant="outline" size="sm" onClick={()=>setSettingsOpen(true)}><Settings2 size={16}/> 模型配置</Button><DialogContent className="settings-dialog"><DialogHeader><DialogTitle>自定义模型</DialogTitle></DialogHeader><p className="dialog-note">已配置 DeepSeek 默认模型。切换到其他兼容接口时，可在下方填写地址、模型和密钥；自定义密钥只在当前页面使用。</p><div className="field"><Label htmlFor="endpoint">接口地址</Label><Input id="endpoint" placeholder="https://example.com/v1/chat/completions" value={model.endpoint} onChange={e=>setModel({...model,endpoint:e.target.value})}/></div><div className="field"><Label htmlFor="model">模型名称</Label><Input id="model" placeholder="填写服务商提供的模型 ID" value={model.model} onChange={e=>setModel({...model,model:e.target.value})}/></div><div className="field"><Label htmlFor="key">API 密钥</Label><Input id="key" type="password" autoComplete="off" placeholder="默认 DeepSeek 留空；自定义模型请填写" value={model.key} onChange={e=>setModel({...model,key:e.target.value})}/></div><div className="field"><Label htmlFor="temp">创造性 · {model.temperature.toFixed(1)}</Label><input id="temp" type="range" min="0" max="1.5" step="0.1" value={model.temperature} onChange={e=>setModel({...model,temperature:Number(e.target.value)})}/></div><div className="dialog-actions"><Button variant="outline" onClick={()=>void generate("test")} disabled={busy||!project}>测试连接</Button><Button onClick={()=>setSettingsOpen(false)}>完成</Button></div></DialogContent></Dialog>
      </div></header>
    <Dialog open={showHistory} onOpenChange={setShowHistory}><DialogContent className="settings-dialog"><DialogHeader><DialogTitle>版本与生成草稿</DialogTitle></DialogHeader>
      <h3 className="history-heading">可恢复版本</h3>{snapshots.filter(s=>s.project_id===projectId).map(s=><div className="history-item" key={s.id}><span>{s.reason}<small>{new Date(s.created_at).toLocaleString("zh-CN")}</small></span><Button variant="outline" size="sm" onClick={async()=>{if(!window.confirm("将整部作品恢复到这个版本？当前状态会先自动备份。"))return;if(!await flushAllChapters())return;await post("restoreSnapshot",{id:s.id});await load();setChapterId("");setShowHistory(false);toast.success("已恢复版本");}}>恢复</Button></div>)}
      <h3 className="history-heading">近期 AI 草稿</h3>{drafts.filter(d=>d.project_id===projectId).map(d=><div className="history-item" key={d.id}><span>{d.kind}<small>{new Date(d.created_at).toLocaleString("zh-CN")}</small></span><Button variant="outline" size="sm" onClick={()=>{
        if(d.kind==="reviewSettings"){setReviewText(d.content);setStoryOpen(true);}
        else if(d.kind==="summary"||d.kind==="story_bible"){
          let saved:FieldProposal|undefined;try{const parsed=JSON.parse(d.content) as FieldProposal;if(parsed?.field===d.kind&&typeof parsed.text==="string")saved=parsed;}catch{}
          setFieldProposal(saved||{field:d.kind,text:d.content,draft:false});setStoryOpen(true);
        }else{let cs;try{cs=JSON.parse(d.content);}catch{}
          if(d.kind==="selection"&&cs&&typeof cs==="object"&&!Array.isArray(cs)){setSelectionStart(cs.start||0);setSelectionEnd(cs.end||0);setProposal({kind:"selection",target:d.target_id||undefined,text:cs.text,selection:cs.selection});}
          else if(["continue","bodyRewrite","insert"].includes(d.kind)&&cs&&typeof cs==="object"&&!Array.isArray(cs)){setProposal({kind:d.kind as Proposal["kind"],target:d.target_id||undefined,text:cs.text,chapters:cs.chapters,afterChapterId:cs.afterChapterId,insertionOffset:cs.insertionOffset,baseBody:cs.baseBody});}
          else if(["outline","append","rewrite","body","memory"].includes(d.kind))setProposal({kind:d.kind as Proposal["kind"],target:d.target_id||undefined,text:Array.isArray(cs)?undefined:d.content,chapters:Array.isArray(cs)?cs:undefined});
          else toast("旧格式草稿可在此前的版本中查看");
        }setShowHistory(false);
      }}>查看</Button></div>)}
    </DialogContent></Dialog>
    <div className="workspace">
      {sidebar&&<button className="sidebar-scrim" aria-label="关闭章节目录" onClick={()=>setSidebar(false)}/>}
      {project&&mobileAssistantOpen&&<button className="assistant-scrim" aria-label="关闭创作助手" onClick={()=>setMobileAssistantOpen(false)}/>}
      <aside id="chapter-directory" aria-label="章节目录" className={`sidebar ${sidebar?"":"sidebar-closed"}`}>
        <div className="sidebar-head"><span className="eyebrow">章节目录 <b>{chapters.length}</b></span><div className="sidebar-head-actions">
          {project&&<button className="icon-button" aria-label="添加章节" title="添加章节" disabled={addingChapter||reordering} onClick={()=>void addChapter()}><Plus size={17}/></button>}
          <button className="icon-button directory-close" aria-label="关闭章节目录" onClick={()=>setSidebar(false)}><X size={18}/></button>
        </div></div>
        {project&&<><div ref={directory} className="chapter-list">{chapters.map((c,i)=>{
          const selected=c.id===(treeFocusId||(view==="read"?readingChapterId:chapterId));
          return <div key={c.id} className={`chapter-row ${selected?"selected":""}`}>
            <button className={`chapter-item ${selected?"selected":""}`} aria-current={selected?"true":undefined} onClick={()=>{
              setTreeFocusId("");
              if(view==="read"){setReaderJump({id:c.id,token:Date.now(),mode});selectReaderChapter(c.id);}else void editChapter(c.id);
              if(window.matchMedia("(max-width: 850px)").matches)setSidebar(false);
            }}><span className="chapter-number">{String(i+1).padStart(2,"0")}</span><span className="chapter-name">{c.title}</span>{hasBody(c)&&<span className="written-dot" title="已有正文"/>}</button>
            <DropdownMenu><DropdownMenuTrigger asChild><button className="icon-button chapter-more" aria-label={`第 ${i+1} 章「${c.title}」的更多操作`} title="章节更多操作" disabled={reorderDisabled}><MoreHorizontal size={19}/></button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={5} className="chapter-menu-content">
                <DropdownMenuItem disabled={reorderDisabled||i===0} onSelect={()=>void moveChapter(c.id,i-1)}><ChevronUp/>上移一章</DropdownMenuItem>
                <DropdownMenuItem disabled={reorderDisabled||i===chapters.length-1} onSelect={()=>void moveChapter(c.id,i+1)}><ChevronDown/>下移一章</DropdownMenuItem>
                <DropdownMenuItem disabled={reorderDisabled||chapters.length<2} onSelect={()=>{setMoveTargetId(c.id);setMovePosition(String(i+1));}}><ArrowRight/>移动到…</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>;
        })}{!chapters.length&&<p className="side-empty">生成大纲或手动添加章节</p>}</div>
        <button className="sidebar-add" disabled={addingChapter||reordering} onClick={()=>void addChapter()}><Plus size={16}/> 添加章节</button></>}
        {!project&&!loading&&<p className="side-empty">从顶部选择或新建作品</p>}
        <div className="sidebar-bottom"><span>全站共享 · 数据保存在云端。</span></div>
      </aside>
      <Dialog open={!!moveTarget} onOpenChange={open=>{if(!open&&!reordering)setMoveTargetId("");}}>
        <DialogContent className="settings-dialog move-chapter-dialog"><DialogHeader><DialogTitle>移动章节</DialogTitle></DialogHeader>
          <p className="move-chapter-title">{moveTarget?.title}</p>
          <form onSubmit={e=>{e.preventDefault();if(validMove)void moveChapter(moveTargetId,moveIndex);}}>
            <Label htmlFor="chapter-destination">移动后成为第几章</Label>
            <Input id="chapter-destination" type="number" inputMode="numeric" min={1} max={chapters.length} step={1} autoFocus value={movePosition} disabled={reordering} onChange={e=>setMovePosition(e.target.value)} aria-describedby="move-chapter-help"/>
            <p id="move-chapter-help">当前第 {moveTarget?chapters.indexOf(moveTarget)+1:"—"} 章，共 {chapters.length} 章。输入 1 至 {chapters.length}，章节概述和正文会一起保留。</p>
            <div className="dialog-actions"><Button type="button" variant="outline" disabled={reordering} onClick={()=>setMoveTargetId("")}>取消</Button><Button type="submit" disabled={!validMove||reorderDisabled}>{reordering?"移动中…":"确认移动"}</Button></div>
          </form>
        </DialogContent>
      </Dialog>
      <main className={`main-area ${view==="read"?"reading-mode":""}`}><div className="main-top"><button className="icon-button sidebar-toggle" title="章节目录" aria-label="展开或收起章节目录" aria-controls="chapter-directory" aria-expanded={sidebar} onClick={()=>setSidebar(!sidebar)}>{sidebar?<PanelLeftClose size={20}/>:<PanelLeftOpen size={20}/>}<span className="directory-button-label">章节目录</span></button><div className="breadcrumb">{project?.title||"新作品"}<span>/</span>{(view==="read"?readingChapter:chapter)?.title||"大纲"}</div>{project&&<><Button className="version-button" variant="ghost" size="sm" onClick={()=>setShowHistory(true)}>版本</Button></>}{project&&<Dialog open={storyOpen} onOpenChange={async open=>{if(!open&&projectDirty){if(!await saveProject(project||{}))return;}setStoryOpen(open);}}><Button className="story-settings-button" variant="ghost" size="sm" onClick={()=>{setStoryOpen(true);}}>作品设定 <ArrowRight size={14}/></Button><DialogContent className="settings-dialog character-dialog"><DialogHeader><DialogTitle>作品设定</DialogTitle></DialogHeader>
        <div className="field"><Label htmlFor="story-title">书名</Label><Input id="story-title" value={project.title} onChange={e=>{setProjectDirty(true);setProjects(items=>items.map(p=>p.id===project.id?{...p,title:e.target.value}:p));}}/></div>
        <div className="field"><Label htmlFor="story-genre">题材</Label><Input id="story-genre" value={project.genre} onChange={e=>{setProjectDirty(true);setProjects(items=>items.map(p=>p.id===project.id?{...p,genre:e.target.value}:p));}} placeholder="悬疑、科幻、奇幻……"/></div>
        <div className="field"><Label htmlFor="story-summary">小说概要</Label><Textarea id="story-summary" rows={4} value={project.summary} onChange={e=>{setProjectDirty(true);setProjects(items=>items.map(p=>p.id===project.id?{...p,summary:e.target.value}:p));}} placeholder="概括故事主线、人物和吸引读者的悬念……"/></div>{projectFieldActions("summary")}
        <div className="field"><Label htmlFor="story-style">文风</Label><Textarea id="story-style" rows={2} value={project.style} onChange={e=>{setProjectDirty(true);setProjects(items=>items.map(p=>p.id===project.id?{...p,style:e.target.value}:p));}} placeholder="例如：克制、细腻、第三人称……"/></div>
        <h3 className="history-heading">故事资料</h3><p className="dialog-note">在同一个文本框里用 # 标题自由区分主线、人物和其他设定。标签可以随时增删。</p>
        <div className="field"><Label htmlFor="story-bible">资料正文</Label><Textarea id="story-bible" className="story-bible-editor" rows={18} value={project.story_bible||""} onSelect={e=>{const el=e.currentTarget;setBibleSelection({start:el.selectionStart,end:el.selectionEnd,text:el.value.slice(el.selectionStart,el.selectionEnd)});}} onChange={e=>{setProjectDirty(true);setBibleSelection({start:0,end:0,text:""});setProjects(items=>items.map(p=>p.id===project.id?{...p,story_bible:e.target.value}:p));}} placeholder="例如：# 故事主线\n# 人物\n# 世界与规则……"/></div>
        {!project.story_bible?.trim()&&<Button variant="outline" size="sm" onClick={()=>{setProjectDirty(true);setProjects(items=>items.map(p=>p.id===project.id?{...p,story_bible:storyTemplate}:p));}}>插入默认模板</Button>}
        <div className="field"><Label htmlFor="field-instruction">AI 修改要求（可选）</Label><Textarea id="field-instruction" rows={2} value={fieldInstruction} onChange={e=>setFieldInstruction(e.target.value)} placeholder="例如：扩写选中的人物动机；保持悬疑氛围……"/></div>
        <p className="model-hint">选中资料中的文字后，“扩写”和“重写”只处理该段；未选中时处理整份资料。模型单次最多读取资料前 4 万字，请把关键约束放在前面。</p>{projectFieldActions("story_bible")}
        <div className="field-ai-actions"><Button variant="outline" size="sm" disabled={reviewBusy} onClick={()=>void reviewSettings()}>{reviewBusy?"检查中…":"AI 检查资料与章节冲突"}</Button></div>
        {reviewBusy&&<div className="field-preview"><strong>正在检查</strong><p className={skipAnimation?"":"typing-output"}>{streaming||"正在连接模型…"}</p><Button size="sm" variant="outline" onClick={stopGeneration}>停止</Button></div>}
        {reviewText&&<div className="field-preview"><strong>冲突检查建议</strong><p>{reviewText}</p><Button size="sm" variant="outline" onClick={()=>setReviewText("")}>关闭</Button></div>}
        <div className="dialog-actions"><Button variant="destructive" onClick={async()=>{if(!window.confirm("将整部作品移出工作台？作品、章节和正文会保留；恢复入口稍后提供。"))return;if(!await flushAllChapters())return;if(projectDirty&&!await saveProject(project))return;await post("deleteProject",{id:project.id});setStoryOpen(false);setProjectId("");await load();}}>删除作品</Button><Button onClick={async()=>{if(await saveProject(project))setStoryOpen(false);}}>保存设定</Button></div></DialogContent></Dialog>}{project&&<Tabs className="workspace-mode-tabs" value={mode} onValueChange={async value=>{if(!await flushAllChapters())return;setMode(value as "outline"|"body");setReaderJump(null);setSelection("");}}><TabsList aria-label="切换大纲或正文"><TabsTrigger value="outline" disabled={busy||!!fieldBusy}><FileText size={16}/> 大纲</TabsTrigger><TabsTrigger value="body" disabled={busy||!!fieldBusy}><PenLine size={16}/> 正文</TabsTrigger></TabsList></Tabs>}</div>
        {!project? <section className="welcome"><div className="welcome-icon"><BookOpen size={32}/></div><div className="eyebrow">新的故事</div><h1>从一个念头，写到最后一章。</h1><p>先创建作品，写下故事设定。你可以生成大纲，也可以从空白章节开始。</p><Button onClick={()=>setNewOpen(true)}><Plus size={17}/> 新建小说</Button></section>:
        <><div className="editor-heading"><div><span className="eyebrow">{view==="read"?"连续浏览":chapter?`第 ${chapters.findIndex(c=>c.id===chapter.id)+1} 章`:"故事蓝图"}</span><h1>{(view==="read"?readingChapter:chapter)?.title||project.title}</h1></div></div><div className="reading-toolbar" role="group" aria-label="浏览或编辑"><Button variant={view==="read"?"secondary":"ghost"} size="sm" aria-pressed={view==="read"} onClick={()=>void readChapters()}>连续浏览</Button><Button variant={view==="edit"?"secondary":"ghost"} size="sm" aria-pressed={view==="edit"} disabled={!chapters.length||busy||!!fieldBusy} onClick={()=>void editChapter(readingChapterId||chapterId||chapters[0]?.id)}>单章编辑</Button>{view==="edit"&&<span>自动保存 · 返回浏览会恢复阅读位置</span>}{project&&<Button className="mobile-assistant-toggle" variant="outline" size="sm" aria-expanded={mobileAssistantOpen} onClick={()=>{setSidebar(false);setMobileAssistantOpen(true);}}><Sparkles size={16}/> AI 助手</Button>}</div>
        {view==="read"&&chapters.length>0?<ContinuousReader key={`${project.id}:${mode}`} projectId={project.id} chapters={chapters} mode={mode} initialChapterId={chapterId} jump={readerJump} busy={busy||!!fieldBusy||reviewBusy} onRead={selectReaderChapter} onEdit={id=>void editChapter(id)} onAI={readerAI} onRefresh={()=>void load()}/>:chapter&&!chapter.body_loaded?<div className="editor-scroll editor-loading" role="status"><p>{detailError||"正在加载章节…"}</p>{detailError&&<Button variant="outline" disabled={detailBusy} onClick={()=>void editChapter(chapter.id)}>重新加载</Button>}</div>:<div className="editor-scroll"><div className="editor-paper">{chapter?<>{mode==="outline"?<><div className="editor-label">章节标题</div><input className="title-input" aria-label="章节标题" disabled={busy||!!fieldBusy} value={chapter.title} onChange={e=>updateChapter(chapter.id,{title:e.target.value})} placeholder="输入章节标题"/><div className="editor-label synopsis-label">章节概述</div><textarea className="synopsis-editor" aria-label="章节概述" disabled={busy||!!fieldBusy} value={chapter.synopsis} onChange={e=>updateChapter(chapter.id,{synopsis:e.target.value})} placeholder="这一章发生什么？人物想要什么，又遇到什么阻碍？"/><div className="chapter-controls"><Button variant="ghost" size="sm" onClick={()=>void deleteChapter()}><Trash2 size={15}/> 删除章节</Button></div></>:<><div className="body-synopsis"><span>本章概述</span><p>{chapter.synopsis||"先在大纲中写下本章概述，生成正文会更准确。"}</p></div>{chapter.body&&chapter.body_outline_revision!==null&&chapter.body_outline_revision<chapter.outline_revision&&<div className="stale-note">大纲已修改，请检查正文是否仍与当前概述一致。</div>}{!!chapter.continuity_review&&<div className="stale-note">故事设定或相邻大纲已变化，请复核本章承接、人物与时间线。<Button size="sm" variant="outline" onClick={async()=>{await post("markReviewed",{id:chapter.id});await load();}}>已复核</Button></div>}<textarea onSelect={e=>{const area=e.currentTarget;setSelectionStart(area.selectionStart);setSelectionEnd(area.selectionEnd);setBodyCursor(area.selectionEnd);setSelection(area.value.slice(area.selectionStart,area.selectionEnd));}} className="body-editor" aria-label="章节正文" disabled={busy||!!fieldBusy} value={chapter.body} onChange={e=>updateChapter(chapter.id,{body:e.target.value})} placeholder="在这里写作，或打开 AI 助手生成本章正文……"/><div className="revision-tools"><span>{selection?`已选 ${selection.length} 字`:"选中正文片段后可局部修订"}</span>{(["expand","rewrite","shorten","polish"] as const).map(op=><Button key={op} size="sm" variant="outline" disabled={!selection||busy||false} onClick={()=>{selectionOperation.current=op;void generate("selection");}}>{({expand:"扩写",rewrite:"重写",shorten:"缩写",polish:"润色"})[op]}</Button>)}</div><div className="memory-box"><Label htmlFor="chapter-memory">本章事实记忆 · 后续章节会引用</Label><Textarea id="chapter-memory" rows={3} disabled={busy||!!fieldBusy} value={chapter.memory||""} onChange={e=>updateChapter(chapter.id,{memory:e.target.value})} placeholder="本章发生了什么，哪些伏笔尚未回收？"/><Button variant="outline" size="sm" disabled={!chapter.body||busy||false} onClick={()=>void generate("memory")}>AI 整理本章记忆</Button></div></>}</>:<div className="outline-empty"><div className="empty-ornament"><Sparkles size={26}/></div><h2>故事，从大纲开始</h2><p>在 AI 助手中设置章节数并生成整部大纲，或手动添加第一章。</p><Button variant="outline" disabled={false||addingChapter} onClick={()=>void addChapter()}><Plus size={16}/> 手动添加章节</Button></div>}</div></div>}</>}
      </main>
      {project&&<aside className={`assistant-panel ${mobileAssistantOpen?"mobile-open":""}`} aria-label="创作助手"><div className="assistant-head"><div className="assistant-symbol"><Sparkles size={17}/></div><span>创作助手</span><button className="icon-button assistant-close" aria-label="关闭创作助手" onClick={()=>setMobileAssistantOpen(false)}><X size={18}/></button></div><div className="assistant-content"><div className="helper-title">{mode==="outline"?"让故事继续生长":"写下这一章"}</div><p className="assistant-target">AI 目标 · {["outline","append"].includes(generationKind||proposal?.kind||"")?"全书":chapters.find(c=>c.id===(proposal?.target||chapterId))?.title||"全书"}{(busy||proposal)&&<small>本次目标已固定，滚动浏览不会改变</small>}</p><p className="helper-description">{mode==="outline"?"会参考小说概要与故事资料。生成内容会先展示，确认后才保存。":"会参考小说概要、故事资料、章节概述与前文。你可以先调整写作要求。"}</p><div className="field"><Label htmlFor="instruction">补充要求</Label><Textarea id="instruction" rows={5} placeholder={mode==="outline"?"例如：前三章增加悬念；加强女主的主动性……":"例如：突出雨夜的压迫感，多写人物之间的对话……"} value={instruction} onChange={e=>setInstruction(e.target.value)}/></div>{mode==="outline"&&<div className="field"><Label htmlFor="count">生成章节数</Label><Input id="count" type="number" min={1} max={30} value={count} onChange={e=>setCount(Number(e.target.value))}/></div>}
          {mode==="outline"&&<div className="field"><Label htmlFor="insert-after">AI 插入位置</Label><select id="insert-after" value={insertAfterId} onChange={e=>setInsertAfterId(e.target.value)}><option value="__start__">全书最前面</option>{chapters.map((c,i)=><option key={c.id} value={c.id}>第 {i+1} 章《{c.title}》之后</option>)}</select><p className="model-hint">插入只新增章节，已有正文保留；相邻正文会提示复核。</p></div>}
          <div className="generate-actions">{mode==="outline"?<><Button className="primary-action" disabled={busy||false} onClick={()=>void generate("outline")}><Sparkles size={16}/>{busy?"生成中…":"生成全书大纲"}</Button><div className="action-grid"><Button variant="outline" disabled={busy||!chapter||false} onClick={()=>void generate("rewrite")}><RefreshCw size={15}/> 重写本章</Button><Button variant="outline" disabled={busy||!chapters.length||false} onClick={()=>void generate("append")}><Plus size={15}/> 追加大纲</Button><Button variant="outline" disabled={busy||false} onClick={()=>void generate("insert")}><Plus size={15}/> AI 插入大纲</Button></div></>:<><Button className="primary-action" disabled={busy||!chapter||false} onClick={()=>void generate("body")}><Sparkles size={16}/>{busy?"生成中…":"生成本章正文"}</Button><div className="action-grid"><Button variant="outline" disabled={busy||!chapter?.body||false} onClick={()=>void generate("continue")}>从光标处续写</Button><Button variant="outline" disabled={busy||!chapter?.body||false} onClick={()=>void generate("bodyRewrite")}>重写整章正文</Button></div><p className="model-hint">将光标放在正文中指定位置；未放置时从章末续写。</p></>}</div><p className="model-hint">{model.model?`当前模型 · ${model.model}`:"尚未配置模型"} <button onClick={()=>setSettingsOpen(true)}>设置</button></p>
          <p className="model-hint">默认模型每日全站共用 30 次额度。AI 会从当前作品读取所需大纲、事实记忆与前文；滚动预加载只读取已保存内容，不调用模型。</p>
          {busy&&<section className="proposal"><div className="proposal-head"><span>AI 正在输出</span><button className="icon-button" onClick={stopGeneration} aria-label="停止生成"><X size={16}/></button></div><div className="proposal-scroll" ref={streamBox} onScroll={e=>{const el=e.currentTarget;followStream.current=el.scrollHeight-el.scrollTop-el.clientHeight<48;}}><p className={skipAnimation?"proposal-body":"proposal-body typing-output"} aria-live="polite">{streaming||"正在连接模型…"}</p></div><div className="proposal-buttons"><Button variant="outline" size="sm" onClick={()=>setSkipAnimation(!skipAnimation)}>{skipAnimation?"启用动画":"关闭动画"}</Button><Button variant="outline" size="sm" onClick={stopGeneration}>停止生成</Button></div></section>}
          {proposal&&<section className="proposal"><div className="proposal-head"><span>生成草稿</span><button className="icon-button" onClick={()=>setProposal(null)} aria-label="关闭草稿"><X size={16}/></button></div><div className="proposal-scroll">{proposal.kind==="insert"&&<div className="revision-before">插入在：{proposal.afterChapterId?`《${chapters.find(c=>c.id===proposal.afterChapterId)?.title||"已删除章节"}》之后`:"全书最前面"}</div>}{proposal.kind==="continue"&&<div className="revision-before">在正文第 {proposal.insertionOffset??proposal.baseBody?.length??0} 字处续写</div>}{proposal.kind==="bodyRewrite"&&<div className="revision-before"><strong>当前正文</strong><p>{proposal.baseBody}</p><strong>重写稿</strong></div>}{proposal.kind==="selection"&&proposal.selection&&<div className="revision-before"><strong>原文</strong><p>{proposal.selection}</p><strong>修订稿</strong></div>}{proposal.chapters?.map((c,i)=><div className="proposal-chapter" key={i}><strong>{c.title}</strong><p>{c.synopsis}</p></div>)}{proposal.text&&<p className="proposal-body">{proposal.text}</p>}</div><div className="proposal-buttons"><Button variant="outline" size="sm" onClick={()=>setProposal(null)}>舍弃</Button><Button size="sm" disabled={busy||(["outline","append","insert","rewrite"].includes(proposal.kind)&&!proposal.chapters?.length)||(["body","continue","bodyRewrite","selection","memory"].includes(proposal.kind)&&!proposal.text)} onClick={()=>void acceptProposal()}><Check size={15}/> 采用内容</Button></div></section>}
        </div><div className="assistant-footer"><span className="footer-line"/>你的文字始终由你决定。</div></aside>}
    </div>
  </div>;
}
