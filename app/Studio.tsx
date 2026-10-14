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

type Project = {id:string;title:string;premise:string;summary:string;important_notes:string;genre:string;style:string;updated_at:string};
type Chapter = {id:string;project_id:string;position:number;title:string;synopsis:string;body:string;outline_revision:number;body_outline_revision:number|null};
type ModelConfig = {endpoint:string;model:string;key:string;temperature:number};
type Proposal = {kind:"outline"|"append"|"rewrite"|"body"; chapters?:{title:string;synopsis:string}[]; text?:string; target?:string};
type ProjectField = "summary"|"important_notes";
type FieldOperation = "generate"|"expand"|"rewrite";
type FieldProposal = {field:ProjectField;text:string;draft:boolean};
const defaultModel:ModelConfig = {endpoint:"https://api.deepseek.com/chat/completions",model:"deepseek-flash",key:"",temperature:0.8};

export default function Home() {
  const [projects,setProjects]=useState<Project[]>([]);
  const [allChapters,setAllChapters]=useState<Chapter[]>([]);
  const [projectId,setProjectId]=useState("");
  const [chapterId,setChapterId]=useState("");
  const [mode,setMode]=useState<"outline"|"body">("outline");
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [saving,setSaving]=useState(false);
  const [sidebar,setSidebar]=useState(true);
  const [newOpen,setNewOpen]=useState(false);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [storyOpen,setStoryOpen]=useState(false);
  const [draftTitle,setDraftTitle]=useState("");
  const [draftPremise,setDraftPremise]=useState("");
  const [draftSummary,setDraftSummary]=useState("");
  const [draftImportantNotes,setDraftImportantNotes]=useState("");
  const [instruction,setInstruction]=useState("");
  const [count,setCount]=useState(8);
  const [proposal,setProposal]=useState<Proposal|null>(null);
  const [fieldInstruction,setFieldInstruction]=useState("");
  const [fieldBusy,setFieldBusy]=useState<ProjectField|null>(null);
  const [fieldProposal,setFieldProposal]=useState<FieldProposal|null>(null);
  const [model,setModel]=useState<ModelConfig>(defaultModel);
  const pending=useRef<Record<string,ReturnType<typeof setTimeout>>>({});
  const pendingPatch=useRef<Record<string,Partial<Chapter>>>({});
  const project=projects.find(p=>p.id===projectId);
  const chapters=allChapters.filter(c=>c.project_id===projectId).sort((a,b)=>a.position-b.position);
  const chapter=chapters.find(c=>c.id===chapterId);

  const load=useCallback(async()=>{
    try {
      const response=await fetch("/api/workspace",{cache:"no-store"});const data=await response.json() as {error?:string;projects:Project[];chapters:Chapter[]};
      if(!response.ok) throw new Error(data.error);
      setProjects(data.projects);setAllChapters(data.chapters);
      setProjectId(current=>data.projects.some((p:Project)=>p.id===current)?current:(data.projects[0]?.id||""));
      setChapterId(current=>data.chapters.some((c:Chapter)=>c.id===current)?current:(data.chapters[0]?.id||""));
    } catch(e){toast.error(e instanceof Error?e.message:"读取失败");}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{if(projectId && !chapters.some(c=>c.id===chapterId)) setChapterId(chapters[0]?.id||"");},[projectId,chapterId,chapters.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>()=>{Object.values(pending.current).forEach(clearTimeout);},[]);
  async function post(action:string,fields:Record<string,unknown>={}){
    const r=await fetch("/api/workspace",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,...fields})});
    const data=await r.json() as {error?:string;id:string};if(!r.ok) throw new Error(data.error||"保存失败");return data;
  }
  function updateChapter(id:string,patch:Partial<Chapter>){
    setAllChapters(items=>items.map(c=>c.id===id?{...c,...patch}:c));
    pendingPatch.current[id]={...pendingPatch.current[id],...patch};
    clearTimeout(pending.current[id]);
    pending.current[id]=setTimeout(async()=>{
      const values=pendingPatch.current[id];delete pendingPatch.current[id];
      setSaving(true);
      try{await post("updateChapter",{id,...values});}catch(e){toast.error(e instanceof Error?e.message:"保存失败，请再次编辑本章后重试");}
      finally{setSaving(false);}
    },650);
  }
  async function persistChapter(id:string,patch:Partial<Chapter>){
    clearTimeout(pending.current[id]);delete pendingPatch.current[id];setSaving(true);
    try{await post("updateChapter",{id,...patch});setAllChapters(items=>items.map(c=>c.id===id?{...c,...patch}:c));await load();}
    catch(e){toast.error(e instanceof Error?e.message:"保存失败");}
    finally{setSaving(false);}
  }
  async function createProject(){
    try {const result=await post("createProject",{title:draftTitle.trim()||"未命名小说",premise:draftPremise,summary:draftSummary,important_notes:draftImportantNotes});await load();setProjectId(result.id);setChapterId("");setNewOpen(false);setDraftTitle("");setDraftPremise("");setDraftSummary("");setDraftImportantNotes("");toast.success("作品已创建");}
    catch(e){toast.error(e instanceof Error?e.message:"创建失败");}
  }
  async function saveProject(patch:Partial<Project>){
    if(!project)return;setProjects(items=>items.map(p=>p.id===project.id?{...p,...patch}:p));
    try{await post("updateProject",{...project,...patch,id:project.id});toast.success("设定已保存");return true;}
    catch(e){toast.error(e instanceof Error?e.message:"保存失败");return false;}
  }
  async function generateProjectField(field:ProjectField,operation:FieldOperation,draft=false){
    if((!project&&!draft)||fieldBusy)return;
    if(!model.endpoint||!model.model){toast.error("请先配置模型");return;}
    setFieldBusy(field);setFieldProposal(null);
    try{
      const source=draft
        ? {title:draftTitle,premise:draftPremise,summary:draftSummary,important_notes:draftImportantNotes,genre:"",style:""}
        : project!;
      const response=await fetch("/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({kind:"projectField",field,operation,...model,title:source.title,premise:source.premise,summary:source.summary,important_notes:source.important_notes,genre:source.genre,style:source.style,chapters:draft?[]:chapters,instruction:fieldInstruction})});
      const result=await response.json() as {error?:string;text?:string};
      if(!response.ok||!result.text?.trim())throw new Error(result.error||"模型没有返回内容");
      setFieldProposal({field,text:result.text.trim(),draft});
    }catch(e){toast.error(e instanceof Error?e.message:"生成失败");}
    finally{setFieldBusy(null);}
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
      setFieldProposal(null);
      toast.success("已保存到作品设定");
    }catch(e){toast.error(e instanceof Error?e.message:"保存失败");}
    finally{setFieldBusy(null);}
  }
  function projectFieldActions(field:ProjectField,draft=false){
    const value=draft?(field==="summary"?draftSummary:draftImportantNotes):(project?.[field]||"");
    const label=field==="summary"?"小说概要":"重要提示";
    return <div className="field-ai"><div className="field-ai-actions">
      <Button variant="outline" size="sm" disabled={!!fieldBusy} onClick={()=>void generateProjectField(field,"generate",draft)}><Sparkles size={14}/>{fieldBusy===field?"生成中…":"AI 生成"}</Button>
      <Button variant="outline" size="sm" disabled={!!fieldBusy||!value.trim()} onClick={()=>void generateProjectField(field,"expand",draft)}>扩写</Button>
      <Button variant="outline" size="sm" disabled={!!fieldBusy||!value.trim()} onClick={()=>void generateProjectField(field,"rewrite",draft)}>重写</Button>
    </div>{fieldProposal?.field===field&&fieldProposal.draft===draft&&<div className="field-preview"><strong>{label}草稿</strong><p>{fieldProposal.text}</p><div className="field-preview-actions"><Button variant="outline" size="sm" onClick={()=>setFieldProposal(null)}>舍弃</Button><Button size="sm" disabled={!!fieldBusy} onClick={()=>void acceptProjectField()}>{draft?"采用草稿":"采用并保存"}</Button></div></div>}</div>;
  }
  async function addChapter(title="新章节",synopsis=""){
    if(!project)return;
    try{const result=await post("addChapter",{projectId,title,synopsis});await load();setChapterId(result.id);return result.id as string;}
    catch(e){toast.error(e instanceof Error?e.message:"添加失败");return null;}
  }
  async function deleteChapter(){
    if(!chapter||!window.confirm(`删除「${chapter.title}」及其正文？此操作不可撤销。`))return;
    try{await post("deleteChapter",{id:chapter.id});setChapterId("");await load();toast.success("章节已删除");}catch(e){toast.error(e instanceof Error?e.message:"删除失败");}
  }
  async function moveChapter(direction:number){
    if(!chapter)return;const index=chapters.findIndex(c=>c.id===chapter.id);const next=index+direction;if(next<0||next>=chapters.length)return;
    const ids=chapters.map(c=>c.id);[ids[index],ids[next]]=[ids[next],ids[index]];
    setAllChapters(items=>items.map(c=>c.project_id===projectId?{...c,position:ids.indexOf(c.id)}:c));
    try{await post("reorder",{projectId,ids});}catch(e){toast.error("排序失败");await load();}
  }
  async function generate(kind:Proposal["kind"]|"test"){
    if(!model.endpoint||!model.model){setSettingsOpen(true);toast("请先配置模型地址和名称");return;}
    if(!project)return; if((kind==="rewrite"||kind==="body")&&!chapter)return;
    setBusy(true);setProposal(null);
    try{
      const response=await fetch("/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({kind,...model,title:project.title,premise:project.premise,summary:project.summary,important_notes:project.important_notes,genre:project.genre,style:project.style,chapters,selected:chapter,instruction,count})});
      const result=await response.json() as {error?:string;chapters?:{title:string;synopsis:string}[];text?:string};if(!response.ok)throw new Error(result.error||"模型调用失败");
      if(kind==="test")toast.success("连接成功");
      else {setProposal({kind,chapters:result.chapters,text:result.text,target:chapter?.id});toast.success("已生成草稿，请确认后采用");}
    }catch(e){toast.error(e instanceof Error?e.message:"生成失败");}
    finally{setBusy(false);}
  }
  async function acceptProposal(){
    if(!proposal||!project)return;setBusy(true);
    try{
      if(proposal.kind==="rewrite"&&proposal.target&&proposal.chapters?.[0]){
        await persistChapter(proposal.target,proposal.chapters[0]);
      }else if(proposal.kind==="body"&&proposal.target&&proposal.text){
        const target=chapters.find(c=>c.id===proposal.target);await persistChapter(proposal.target,{body:proposal.text,body_outline_revision:target?.outline_revision??1});setMode("body");
      }else if(proposal.chapters?.length){
        if(proposal.kind==="outline"&&chapters.length){
          if(!window.confirm("采用新大纲会删除当前所有章节及正文，确定继续吗？")){setBusy(false);return;}
          for(const c of chapters) await post("deleteChapter",{id:c.id});
        }
        let first="";
        for(const c of proposal.chapters){const result=await post("addChapter",{projectId,title:c.title,synopsis:c.synopsis});if(!first)first=result.id;}
        await load();if(first)setChapterId(first);
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
      <div className="top-actions"><span className="save-state">{saving?"保存中…":"自动保存"}</span><Button variant="ghost" size="sm" onClick={exportBook} disabled={!project}><Download size={16}/> 导出</Button>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}><Button variant="outline" size="sm" onClick={()=>setSettingsOpen(true)}><Settings2 size={16}/> 模型配置</Button><DialogContent className="settings-dialog"><DialogHeader><DialogTitle>自定义模型</DialogTitle></DialogHeader><p className="dialog-note">已配置 DeepSeek 默认模型。切换到其他兼容接口时，可在下方填写地址、模型和密钥；自定义密钥只在当前页面使用。</p><div className="field"><Label htmlFor="endpoint">接口地址</Label><Input id="endpoint" placeholder="https://example.com/v1/chat/completions" value={model.endpoint} onChange={e=>setModel({...model,endpoint:e.target.value})}/></div><div className="field"><Label htmlFor="model">模型名称</Label><Input id="model" placeholder="填写服务商提供的模型 ID" value={model.model} onChange={e=>setModel({...model,model:e.target.value})}/></div><div className="field"><Label htmlFor="key">API 密钥</Label><Input id="key" type="password" autoComplete="off" placeholder="默认 DeepSeek 留空；自定义模型请填写" value={model.key} onChange={e=>setModel({...model,key:e.target.value})}/></div><div className="field"><Label htmlFor="temp">创造性 · {model.temperature.toFixed(1)}</Label><input id="temp" type="range" min="0" max="1.5" step="0.1" value={model.temperature} onChange={e=>setModel({...model,temperature:Number(e.target.value)})}/></div><div className="dialog-actions"><Button variant="outline" onClick={()=>void generate("test")} disabled={busy||!project}>测试连接</Button><Button onClick={()=>setSettingsOpen(false)}>完成</Button></div></DialogContent></Dialog>
      </div></header>
    <div className="workspace">
      <aside className={`sidebar ${sidebar?"":"sidebar-closed"}`}><div className="sidebar-head"><span className="eyebrow">我的作品</span><Dialog open={newOpen} onOpenChange={setNewOpen}><button className="icon-button" aria-label="新建作品" title="新建作品" onClick={()=>setNewOpen(true)}><Plus size={18}/></button><DialogContent className="settings-dialog"><DialogHeader><DialogTitle>新建小说</DialogTitle></DialogHeader><div className="field"><Label htmlFor="new-title">书名</Label><Input id="new-title" value={draftTitle} onChange={e=>setDraftTitle(e.target.value)} placeholder="为故事起一个名字"/></div><div className="field"><Label htmlFor="new-ai-instruction">AI 修改要求（可选）</Label><Textarea id="new-ai-instruction" rows={2} value={fieldInstruction} onChange={e=>setFieldInstruction(e.target.value)} placeholder="例如：悬疑风格、节奏紧凑……"/></div><div className="field"><Label htmlFor="new-summary">小说概要</Label><Textarea id="new-summary" value={draftSummary} onChange={e=>setDraftSummary(e.target.value)} placeholder="这本小说讲述什么故事？" rows={3}/></div>{projectFieldActions("summary",true)}<div className="field"><Label htmlFor="new-premise">世界设定与核心冲突</Label><Textarea id="new-premise" value={draftPremise} onChange={e=>setDraftPremise(e.target.value)} placeholder="主角、世界、核心冲突……" rows={3}/></div><div className="field"><Label htmlFor="new-notes">重要提示</Label><Textarea id="new-notes" value={draftImportantNotes} onChange={e=>setDraftImportantNotes(e.target.value)} placeholder="必须遵守的人物设定、禁忌和剧情要求……" rows={3}/></div>{projectFieldActions("important_notes",true)}<div className="dialog-actions"><Button onClick={()=>void createProject()}>创建作品</Button></div></DialogContent></Dialog></div>
        <div className="project-list">{projects.map(p=><button key={p.id} className={`project-item ${p.id===projectId?"active":""}`} onClick={()=>{setProjectId(p.id);setChapterId(allChapters.find(c=>c.project_id===p.id)?.id||"");setProposal(null);}}><BookOpen size={16}/><span>{p.title}</span></button>)}{!projects.length&&!loading&&<p className="side-empty">先创建一部作品</p>}</div>
        {project&&<><div className="section-label"><span>章节目录 <b>{chapters.length}</b></span><button className="icon-button" aria-label="添加章节" title="添加章节" onClick={()=>void addChapter()}><Plus size={17}/></button></div><div className="chapter-list">{chapters.map((c,i)=><button key={c.id} className={`chapter-item ${c.id===chapterId?"selected":""}`} onClick={()=>{setChapterId(c.id);setProposal(null);}}><span className="chapter-number">{String(i+1).padStart(2,"0")}</span><span className="chapter-name">{c.title}</span>{c.body&&<span className="written-dot" title="已有正文"/>}</button>)}{!chapters.length&&<p className="side-empty">生成大纲或手动添加章节</p>}</div><button className="sidebar-add" onClick={()=>void addChapter()}><Plus size={16}/> 添加章节</button></>}
        <div className="sidebar-bottom"><span>让故事从一页开始。</span></div>
      </aside>
      <main className="main-area"><div className="main-top"><button className="icon-button sidebar-toggle" title="展开或收起目录" aria-label="展开或收起目录" onClick={()=>setSidebar(!sidebar)}>{sidebar?<PanelLeftClose size={18}/>:<PanelLeftOpen size={18}/>}</button><div className="breadcrumb">{project?.title||"新作品"}<span>/</span>{chapter?chapter.title:"大纲"}</div>{project&&<Dialog open={storyOpen} onOpenChange={setStoryOpen}><Button variant="ghost" size="sm" onClick={()=>setStoryOpen(true)}>作品设定 <ArrowRight size={14}/></Button><DialogContent className="settings-dialog"><DialogHeader><DialogTitle>作品设定</DialogTitle></DialogHeader><div className="field"><Label htmlFor="story-title">书名</Label><Input id="story-title" value={project.title} onChange={e=>setProjects(items=>items.map(p=>p.id===project.id?{...p,title:e.target.value}:p))}/></div><div className="field"><Label htmlFor="story-genre">题材</Label><Input id="story-genre" value={project.genre} onChange={e=>setProjects(items=>items.map(p=>p.id===project.id?{...p,genre:e.target.value}:p))} placeholder="悬疑、科幻、奇幻……"/></div><div className="field"><Label htmlFor="field-instruction">AI 修改要求（可选）</Label><Textarea id="field-instruction" rows={2} value={fieldInstruction} onChange={e=>setFieldInstruction(e.target.value)} placeholder="例如：突出主角的成长；保持悬疑氛围……"/></div><div className="field"><Label htmlFor="story-summary">小说概要</Label><Textarea id="story-summary" rows={5} value={project.summary} onChange={e=>setProjects(items=>items.map(p=>p.id===project.id?{...p,summary:e.target.value}:p))} placeholder="概括故事主线、主要人物和发展方向……"/></div>{projectFieldActions("summary")}<div className="field"><Label htmlFor="story-premise">世界设定与核心冲突</Label><Textarea id="story-premise" rows={5} value={project.premise} onChange={e=>setProjects(items=>items.map(p=>p.id===project.id?{...p,premise:e.target.value}:p))}/></div><div className="field"><Label htmlFor="story-notes">重要提示</Label><Textarea id="story-notes" rows={5} value={project.important_notes} onChange={e=>setProjects(items=>items.map(p=>p.id===project.id?{...p,important_notes:e.target.value}:p))} placeholder="模型生成大纲与正文时必须记住的约束……"/></div>{projectFieldActions("important_notes")}<div className="field"><Label htmlFor="story-style">文风</Label><Textarea id="story-style" rows={3} value={project.style} onChange={e=>setProjects(items=>items.map(p=>p.id===project.id?{...p,style:e.target.value}:p))} placeholder="例如：克制、细腻、第三人称……"/></div><div className="dialog-actions"><Button variant="destructive" onClick={async()=>{if(!window.confirm("删除整部作品及全部章节？此操作不可撤销。"))return;await post("deleteProject",{id:project.id});setStoryOpen(false);setProjectId("");await load();}}>删除作品</Button><Button onClick={async()=>{if(await saveProject(project))setStoryOpen(false);}}>保存设定</Button></div></DialogContent></Dialog>}</div>
        {!project? <section className="welcome"><div className="welcome-icon"><BookOpen size={32}/></div><div className="eyebrow">新的故事</div><h1>从一个念头，写到最后一章。</h1><p>先创建作品，写下故事设定。你可以生成大纲，也可以从空白章节开始。</p><Button onClick={()=>setNewOpen(true)}><Plus size={17}/> 新建小说</Button></section>:
        <><div className="editor-heading"><div><span className="eyebrow">{chapter?`第 ${chapters.findIndex(c=>c.id===chapter.id)+1} 章`:"故事蓝图"}</span><h1>{chapter?.title||project.title}</h1></div><Tabs value={mode} onValueChange={value=>{setMode(value as "outline"|"body");setProposal(null);}}><TabsList><TabsTrigger value="outline"><FileText size={16}/> 大纲</TabsTrigger><TabsTrigger value="body"><PenLine size={16}/> 正文</TabsTrigger></TabsList></Tabs></div>
        <div className="editor-scroll"><div className="editor-paper">{chapter?<>{mode==="outline"?<><div className="editor-label">章节标题</div><input className="title-input" aria-label="章节标题" value={chapter.title} onChange={e=>updateChapter(chapter.id,{title:e.target.value})} placeholder="输入章节标题"/><div className="editor-label synopsis-label">章节概述</div><textarea className="synopsis-editor" aria-label="章节概述" value={chapter.synopsis} onChange={e=>updateChapter(chapter.id,{synopsis:e.target.value})} placeholder="这一章发生什么？人物想要什么，又遇到什么阻碍？"/><div className="chapter-controls"><Button variant="ghost" size="sm" onClick={()=>void moveChapter(-1)} disabled={chapters.indexOf(chapter)===0}><ChevronUp size={15}/> 上移</Button><Button variant="ghost" size="sm" onClick={()=>void moveChapter(1)} disabled={chapters.indexOf(chapter)===chapters.length-1}><ChevronDown size={15}/> 下移</Button><Button variant="ghost" size="sm" onClick={()=>void deleteChapter()}><Trash2 size={15}/> 删除章节</Button></div></>:<><div className="body-synopsis"><span>本章概述</span><p>{chapter.synopsis||"先在大纲中写下本章概述，生成正文会更准确。"}</p></div>{chapter.body&&chapter.body_outline_revision!==null&&chapter.body_outline_revision<chapter.outline_revision&&<div className="stale-note">大纲已修改，请检查正文是否仍与当前概述一致。</div>}<textarea className="body-editor" aria-label="章节正文" value={chapter.body} onChange={e=>updateChapter(chapter.id,{body:e.target.value})} placeholder="在这里写作，或使用右侧的 AI 助手生成本章正文……"/></>}</>:<div className="outline-empty"><div className="empty-ornament"><Sparkles size={26}/></div><h2>故事，从大纲开始</h2><p>在右侧填写章节数并生成整部大纲，或手动添加第一章。</p><Button variant="outline" onClick={()=>void addChapter()}><Plus size={16}/> 手动添加章节</Button></div>}</div></div></>}
      </main>
      {project&&<aside className="assistant-panel"><div className="assistant-head"><div className="assistant-symbol"><Sparkles size={17}/></div><span>创作助手</span></div><div className="assistant-content"><div className="helper-title">{mode==="outline"?"让故事继续生长":"写下这一章"}</div><p className="helper-description">{mode==="outline"?"会参考小说概要、重要提示和作品设定。生成内容会先展示，确认后才保存。":"会参考小说概要、重要提示、章节概述与前文。你可以先调整写作要求。"}</p><div className="field"><Label htmlFor="instruction">补充要求</Label><Textarea id="instruction" rows={5} placeholder={mode==="outline"?"例如：前三章增加悬念；加强女主的主动性……":"例如：突出雨夜的压迫感，多写人物之间的对话……"} value={instruction} onChange={e=>setInstruction(e.target.value)}/></div>{mode==="outline"&&<div className="field"><Label htmlFor="count">生成章节数</Label><Input id="count" type="number" min={1} max={30} value={count} onChange={e=>setCount(Number(e.target.value))}/></div>}
          <div className="generate-actions">{mode==="outline"?<>{<Button className="primary-action" disabled={busy} onClick={()=>void generate("outline")}><Sparkles size={16}/>{busy?"生成中…":"生成全书大纲"}</Button>}<div className="action-grid"><Button variant="outline" disabled={busy||!chapter} onClick={()=>void generate("rewrite")}><RefreshCw size={15}/> 重写本章</Button><Button variant="outline" disabled={busy||!chapters.length} onClick={()=>void generate("append")}><Plus size={15}/> 追加大纲</Button></div></>:<Button className="primary-action" disabled={busy||!chapter} onClick={()=>void generate("body")}><Sparkles size={16}/>{busy?"生成中…":"生成本章正文"}</Button>}</div><p className="model-hint">{model.model?`当前模型 · ${model.model}`:"尚未配置模型"} <button onClick={()=>setSettingsOpen(true)}>设置</button></p>
          {proposal&&<section className="proposal"><div className="proposal-head"><span>生成草稿</span><button className="icon-button" onClick={()=>setProposal(null)} aria-label="关闭草稿"><X size={16}/></button></div><div className="proposal-scroll">{proposal.chapters?.map((c,i)=><div className="proposal-chapter" key={i}><strong>{c.title}</strong><p>{c.synopsis}</p></div>)}{proposal.text&&<p className="proposal-body">{proposal.text}</p>}</div><div className="proposal-buttons"><Button variant="outline" size="sm" onClick={()=>setProposal(null)}>舍弃</Button><Button size="sm" disabled={busy} onClick={()=>void acceptProposal()}><Check size={15}/> 采用内容</Button></div></section>}
        </div><div className="assistant-footer"><span className="footer-line"/>你的文字始终由你决定。</div></aside>}
    </div>
  </div>;
}
