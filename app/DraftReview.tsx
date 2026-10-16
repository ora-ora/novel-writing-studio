"use client";
import {useEffect,useRef,useState} from "react";
import {Button} from "@/components/ui/button";
import {AIRunner,consistencyRequest} from "./LongformPanel";
import {parseJSON} from "@/lib/longform";
type Finding={severity:string;quote:string;referenceId:string;sourceLabel?:string;evidence:string;reason:string;suggestion:string};
export function RevisionCompare({oldText,newText}:{oldText:string;newText:string}){
 return <details className="revision-compare"><summary>新旧版本对比</summary><div className="compare-columns"><section><strong>原文</strong><p>{oldText||"（原文为空）"}</p></section><section><strong>新稿 · 尚未采用</strong><p>{newText}</p></section></div></details>;
}
export default function DraftReview({projectId,chapterId,text,auto,run,refresh,onFix,stop}:{projectId:string;chapterId:string;text:string;auto:boolean;run:AIRunner;refresh:number;onFix:(instruction:string)=>void;stop:()=>void}){
 const [busy,setBusy]=useState(false),[report,setReport]=useState<Finding[]|null>(null),[error,setError]=useState(""),[checkId,setCheckId]=useState(""),[stale,setStale]=useState(false),[resolutions,setResolutions]=useState<Record<string,string>>({});
 const last=useRef(""),autoStarted=useRef(false),sequence=useRef(0),latest=useRef({run,text,chapterId,projectId});latest.current={run,text,chapterId,projectId};
 async function check(){
  const input=latest.current,seq=++sequence.current;setBusy(true);setError("");setReport(null);setResolutions({});
  try{
   const result=await input.run({kind:"checkDraft",selected:{id:input.chapterId},draft:input.text});
   if(seq!==sequence.current)return;
   const data=parseJSON<{findings?:Finding[]}>(result.text,{});
   if(!Array.isArray(data.findings))throw new Error("检查结果格式无效");
   setReport(data.findings);setCheckId(result.checkId||"");setStale(!!result.checkStale||input.text!==latest.current.text);
  }catch(e){if(seq===sequence.current)setError(e instanceof Error?e.message:"检查失败");}
  finally{if(seq===sequence.current)setBusy(false);}
 }
 useEffect(()=>{
  if(last.current===text)return;
  if(last.current){setStale(true);setReport(null);sequence.current++;setBusy(false);}
  last.current=text;
  return()=>{sequence.current++;};
 },[text,projectId,chapterId]); // eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{if(auto&&!autoStarted.current){autoStarted.current=true;void check();}},[auto]); // eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{if(!checkId)return;void fetch("/api/consistency?"+new URLSearchParams({projectId,view:"check",id:checkId})).then(r=>r.json() as Promise<{stale?:number}>).then(data=>{if(data.stale)setStale(true);}).catch(()=>{});},[refresh,projectId,checkId]);
 async function resolve(index:number,resolution:string){
  try{await consistencyRequest(projectId,"resolveFinding",{id:checkId,index,resolution});setResolutions(old=>({...old,[index]:resolution}));}catch(e){setError(e instanceof Error?e.message:"保存失败");}
 }
 return <section className="draft-review" aria-label="采用前一致性检查"><div className="longform-actions"><strong>一致性检查</strong><Button size="sm" variant="outline" disabled={busy} onClick={()=>void check()}>{busy?"正在检查…":report?"重新检查":"检查草稿"}</Button>{busy&&<Button size="sm" variant="outline" onClick={stop}>停止检查</Button>}</div>
  <p className="review-help">对照相关设定和前情列出疑点，不能保证发现所有问题。可继续编辑或自行决定采用。</p>
  {error&&<p role="alert" className="stale-note">{error} · 草稿仍保留</p>}
  {stale&&<p className="stale-note">草稿或参考资料已变化，检查结果已过期。</p>}
  {report?.length===0&&!stale&&<p className="check-clear">本次检查未发现有依据的疑点。</p>}
  {report?.map((finding,index)=><article className="finding-card" key={index}><strong>{resolutions[index]?"已处理："+resolutions[index]:finding.severity==="conflict"?"明确冲突":"需要确认"}</strong><blockquote>草稿：{finding.quote}</blockquote><p>依据：{finding.evidence}</p><small>来源：{finding.sourceLabel||finding.referenceId}</small><p>{finding.reason}</p><p>建议：{finding.suggestion}</p><div className="longform-actions"><Button size="sm" variant="outline" onClick={()=>{document.querySelector(".proposal-draft-editor")?.scrollIntoView({block:"center",behavior:"smooth"});(document.querySelector(".proposal-draft-editor") as HTMLTextAreaElement)?.focus();}}>定位修改</Button><Button size="sm" variant="outline" onClick={()=>onFix("只修正以下一致性疑点，保留其他剧情与事实："+finding.reason+"；依据："+finding.evidence+"；建议："+finding.suggestion)}>让 AI 修正</Button><Button size="sm" variant="ghost" onClick={()=>void resolve(index,"本次忽略")}>忽略</Button><Button size="sm" variant="ghost" onClick={()=>void resolve(index,"有意安排")}>有意安排</Button></div></article>)}
 </section>;
}
