import { env } from "cloudflare:workers";
import { workspaceSession } from "../workspace/session";

export const runtime = "edge";

type Chapter = {id?:string;title:string; synopsis:string; body?:string};
const error = (message:string,status=400) => Response.json({error:message},{status});
function endpoint(raw: string) {
  const u = new URL(raw);
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (u.protocol !== "https:" || u.username || u.password || !host.includes(".") ||
    host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
    /^(127|10|0|192\.168|169\.254|172\.(1[6-9]|2\d|3[01]))\./.test(host) ||
    host.includes(":") || host.endsWith(".internal")) throw new Error("模型地址须为公开的 HTTPS 地址");
  return u.toString();
}
function parseChapters(text:string) {
  const normalized = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = normalized.indexOf("["); const end = normalized.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("模型未返回章节列表，请调整要求后重试");
  const value = JSON.parse(normalized.slice(start,end+1));
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new Error("模型返回的章节数量不正确");
  return value.map((item:Record<string,unknown>)=>({title:String(item.title || "未命名章节").slice(0,180),synopsis:String(item.synopsis || "").slice(0,15000)}));
}
export async function POST(request:Request) {
  try {
    const input = await request.json() as {kind:string; endpoint:string; key:string; model:string; title:string; premise:string; summary:string; important_notes:string; genre:string; style:string; chapters:Chapter[]; selected?:Chapter; instruction?:string; count?:number; temperature?:number; field?:string; operation?:string; stream?:boolean; projectId?:string; selection?:string; afterChapterId?:string; cursor?:number};
    const defaultEndpoint = "https://api.deepseek.com/chat/completions";
    const defaultModel = "deepseek-flash";
    const useHostedDeepSeek =
      !input.key && String(input.endpoint || "") === defaultEndpoint &&
      String(input.model || "") === defaultModel;
    const url = endpoint(String(input.endpoint || ""));
    if (!input.model?.trim()) return error("请填写模型名称");
    const key = useHostedDeepSeek ? env.DEEPSEEK_API_KEY : input.key;
    if (!key) return error("请填写自定义模型密钥，或选择已配置的 DeepSeek");
    const session=workspaceSession(request);
    if(session.fresh)return error("请刷新页面以建立工作区会话",401);
    const kind = input.kind;
    const chapters = Array.isArray(input.chapters) ? input.chapters.slice(0,150) : [];
    const outline = chapters.map((c,i)=>`第${i+1}章 ${c.title}：${c.synopsis}`).join("\n").slice(0,30000);
    let cardContext="";
    if(input.projectId){
      const cards=await env.DB?.prepare("SELECT l.* FROM lore_cards l JOIN projects p ON p.id=l.project_id WHERE p.id=? AND p.workspace_id=?").bind(input.projectId,session.id).all<{category:string;content:string;from_chapter:number|null;until_chapter:number|null}>();
      const chapterIndex=chapters.findIndex(c=>c.id===input.selected?.id)+1;
      cardContext=(cards?.results||[]).filter(c=>!chapterIndex||(!c.from_chapter||chapterIndex>=c.from_chapter)&&(!c.until_chapter||chapterIndex<=c.until_chapter)).map(c=>`[${c.category}] ${c.content}`).join("\n").slice(0,12000);
    }
    const base = `书名：${String(input.title || "").slice(0,120)}\n题材：${String(input.genre || "").slice(0,200)}\n小说概要：${String(input.summary || "").slice(0,8000)}\n世界设定与核心冲突：${String(input.premise || "").slice(0,12000)}\n这本小说的重要提示（人物设定、禁忌、必须遵守的写作要求）：${String(input.important_notes || "").slice(0,6000)}\n文风：${String(input.style || "").slice(0,2000)}`;
    const context=`${base}\n适用的设定卡：\n${cardContext||"（暂无）"}`;
    const instruction = String(input.instruction || "").slice(0,3000);
    const count = Math.min(30,Math.max(1,Number(input.count)||8));
    let prompt = ""; let json = false;
    if (kind === "outline") { json = true; prompt = `${context}\n请规划${count}章小说大纲。每章有具体标题与120到250字的剧情概述，推进人物动机、冲突与伏笔，结尾有发展空间。附加要求：${instruction}\n只返回 JSON 数组：[ {\"title\":\"章节标题\",\"synopsis\":\"章节概述\"} ]，不要其他文字。`; }
    else if (kind === "append") { json = true; prompt = `${context}\n当前章节大纲：\n${outline}\n请紧接当前结局追加${count}章，保持人物和时间线连贯，不重复旧章节。附加要求：${instruction}\n只返回 JSON 数组：[ {\"title\":\"章节标题\",\"synopsis\":\"章节概述\"} ]。`; }
    else if (kind === "insert") {
      json=true;
      const at=input.afterChapterId?chapters.findIndex(c=>c.id===input.afterChapterId)+1:0;
      if(input.afterChapterId&&at===0)return error("插入位置不存在");
      const before=chapters[at-1],after=chapters[at];
      prompt=`${context}\n全书现有大纲：\n${outline}\n请在${before?`「${before.title}」之后`:"全书开头"}、${after?`「${after.title}」之前`:"现有结尾之后"}插入${count}章。前章结局：${before?.synopsis||"无"}。后章开端：${after?.synopsis||"无"}。写出承上启下的新事件，保持人物、时间、伏笔和已有章节事实不变；不得重写已有章节。附加要求：${instruction}\n只返回新章节的 JSON 数组：[ {\"title\":\"章节标题\",\"synopsis\":\"章节概述\"} ]。`;
    }
    else if (kind === "rewrite" && input.selected) { json = true; prompt = `${context}\n全书已有大纲：\n${outline}\n仅重写目标章节「${input.selected.title}」的标题和概述，保持相邻剧情衔接。修改要求：${instruction || "增强情节张力与连贯性"}\n只返回一个元素的 JSON 数组：[ {\"title\":\"章节标题\",\"synopsis\":\"章节概述\"} ]。`; }
    else if (kind === "body" && input.selected) {
      const index = chapters.findIndex(c=>c.id===input.selected?.id);
      const memories = chapters.slice(0,index).map((c,i)=>`第${i+1}章已发生事实：${(c as Chapter & {memory?:string}).memory||c.synopsis}`).join("\n").slice(-10000);
      const previous = chapters.slice(Math.max(0,index-3),index).map((c,i)=>`前文第${i+1}章 ${c.title}：${c.synopsis}\n正文末段：${(c.body||"").slice(-1400)}`).join("\n");
      prompt = `${context}\n全书大纲：\n${outline}\n前文记忆：\n${memories}\n前文参考：\n${previous}\n现在创作「${input.selected.title}」正文，章节概述：${input.selected.synopsis}\n写出完整有场景、动作、对话与细节的小说正文，约2000到3000汉字。遵守大纲但自然展开，避免总结式叙述，不要重复书名或输出说明。附加要求：${instruction}`;
    } else if(kind==="continue"&&input.selected?.body){
      const body=String(input.selected.body);
      const cursor=Math.min(body.length,Math.max(0,input.cursor==null?body.length:Number(input.cursor)||0));
      prompt=`${context}\n全书大纲：\n${outline}\n本章「${input.selected.title}」概述：${input.selected.synopsis}\n光标前的正文末段：\n${body.slice(Math.max(0,cursor-7000),cursor)}\n光标后已有文字（不可重复或改动）：\n${body.slice(cursor,cursor+1500)||"（正文末尾）"}\n请从光标处自然续写约600到1200汉字，承接动作与情绪，不重述已写情节，不提前泄露尚未揭示的伏笔。附加要求：${instruction}\n只输出要插入的文字，不要标题或解释。`;
    } else if(kind==="bodyRewrite"&&input.selected?.body){
      prompt=`${context}\n全书大纲：\n${outline}\n本章「${input.selected.title}」概述：${input.selected.synopsis}\n原正文：\n${String(input.selected.body).slice(0,30000)}\n请根据要求重写整章，保留人物、事实、伏笔和相邻章节连续性，写成完整小说正文，不要解释。修改要求：${instruction||"改善场景与节奏，避免重复叙述"}`;
    } else if (kind === "projectField") {
      const field = input.field;
      const operation = input.operation;
      if (field !== "summary" && field !== "important_notes") return error("未知作品字段");
      if (operation !== "generate" && operation !== "expand" && operation !== "rewrite") return error("未知修改方式");
      const current = String(input[field] || "").slice(0, field === "summary" ? 8000 : 6000);
      if (operation !== "generate" && !current.trim()) return error("请先填写内容，再扩写或重写");
      const label = field === "summary" ? "小说概要" : "重要提示";
      const goal = field === "summary"
        ? "写成一段清楚的故事概要，交代主要人物、核心冲突、故事发展和吸引读者的悬念；避免提前定死尚未确定的结局。"
        : "写成便于后续写作遵守的具体提示，逐条列出人物设定、世界规则、时间线、伏笔或写作禁忌；仅提炼已有信息，不凭空宣布新设定。";
      const action = operation === "generate"
        ? "根据已有作品资料生成"
        : operation === "expand"
          ? "保留原有事实与约束，在其基础上补充细节并扩写"
          : "根据修改要求重写，保留原有关键事实与约束";
      prompt = `${context}\n已写章节大纲：\n${outline}\n当前${label}：\n${current || "（暂无）"}\n请${action}${label}。${goal}\n修改要求：${instruction || "无"}\n只输出可直接填入「${label}」的正文，不要标题、解释或 Markdown 代码块。`;
    } else if (kind === "selection" && input.selected && input.selection?.trim()) {
      const operation=String(input.operation||"rewrite");
      const goals:Record<string,string>={expand:"保留原意并补足动作、感官、对话与细节",rewrite:"根据要求重写，保留关键事实",shorten:"精简重复和冗余描写",polish:"改善语句节奏和文风，不改变事实"};
      if(!goals[operation])return error("未知修订方式");
      prompt=`${context}\n本章：${input.selected.title}。概述：${input.selected.synopsis}\n请对以下选中片段进行修订：\n${input.selection.slice(0,12000)}\n任务：${goals[operation]}。补充要求：${instruction||"无"}\n只输出替换片段，不要解释。`;
    } else if (kind === "memory" && input.selected) {
      prompt=`将下列章节正文整理为供后续章节使用的简短事实记忆（人物状态、时间、地点、已揭示信息、未回收伏笔），最多500字，不要编造：\n${String(input.selected.body||"").slice(0,30000)}`;
    } else if (kind === "test") prompt = "只回复：连接成功";
    else return error("未知生成类型");
    if(useHostedDeepSeek){
      if(!env.DB)return error("默认模型额度暂不可用",503);
      const database=env.DB;
      const day=new Date().toISOString().slice(0,10);
      for(const [scope,limit] of [["global",30],[session.id,10]] as const){
        await database.prepare("INSERT OR IGNORE INTO generation_quota (day,workspace_id,calls) VALUES (?,?,0)").bind(day,scope).run();
        const quota=await database.prepare("UPDATE generation_quota SET calls=calls+1 WHERE day=? AND workspace_id=? AND calls<?").bind(day,scope,limit).run();
        if(!quota.meta.changes)return error(scope==="global"?"默认模型今日额度已用完，请使用自定义模型":"本工作区今日默认模型额度已用完，请使用自定义模型",429);
      }
    }
    const controller = new AbortController(); const timer = setTimeout(()=>controller.abort(),110000);
    let response:Response;
    try { response = await fetch(url,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${key}`},body:JSON.stringify({model:input.model,messages:[{role:"system",content:"你是专业中文小说编辑与写作助手。严格遵守用户的输出格式要求。"},{role:"user",content:prompt}],temperature:Math.min(1.5,Math.max(0,Number(input.temperature) || 0.8)),max_tokens:["body","bodyRewrite"].includes(kind)?6000:4000,...(useHostedDeepSeek?{thinking:{type:"disabled"}}:{}),...(input.stream?{stream:true}:{})}),signal:controller.signal}); }
    catch(e){clearTimeout(timer);throw e;}
    if (!response.ok){clearTimeout(timer);return error(`模型服务返回 ${response.status}。请检查地址、密钥和模型名称。`,502);}
    if(input.stream){
      if(!response.headers.get("Content-Type")?.includes("text/event-stream")){
        let fallback:{choices?:Array<{message?:{content?:string}}>};
        try{fallback=await response.json() as typeof fallback;}finally{clearTimeout(timer);}
        const text=fallback.choices?.[0]?.message?.content||"";
        if(!text)return error("模型没有返回内容",502);
        const result=json?{chapters:parseChapters(text)}:{text};
        return new Response(`data: ${JSON.stringify({delta:text})}\n\ndata: ${JSON.stringify({done:true,...result})}\n\n`,{headers:{"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"no-cache"}});
      }
      if(!response.body){clearTimeout(timer);return error("模型不支持流式输出",502);}
      const reader=response.body.getReader(),decoder=new TextDecoder(),encoder=new TextEncoder();
      let buffer="",full="";
      const stream=new ReadableStream({
        start(out){void (async()=>{
          try{
            while(true){
              const {done,value}=await reader.read();
              if(done){clearTimeout(timer);out.enqueue(encoder.encode(`data: ${JSON.stringify({done:true,...(json?{chapters:parseChapters(full)}:{text:full})})}\n\n`));out.close();return;}
              buffer+=decoder.decode(value,{stream:true});
              const lines=buffer.split("\n");buffer=lines.pop()||"";
              for(const line of lines){
                if(!line.startsWith("data:"))continue;
                const raw=line.slice(5).trim();if(raw==="[DONE]")continue;
                try{const delta=(JSON.parse(raw) as {choices?:Array<{delta?:{content?:string}}>}).choices?.[0]?.delta?.content||"";
                  if(delta){full+=delta;out.enqueue(encoder.encode(`data: ${JSON.stringify({delta})}\n\n`));}
                }catch{/* Ignore non-content SSE events. */}
              }
            }
          }catch(e){clearTimeout(timer);out.enqueue(encoder.encode(`data: ${JSON.stringify({error:e instanceof Error?e.message:"生成中断"})}\n\n`));out.close();}
        })();},
        cancel(){clearTimeout(timer);void reader.cancel();controller.abort();}
      });
      return new Response(stream,{headers:{"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"no-cache","X-Accel-Buffering":"no"}});
    }
    let result:{choices?:Array<{message?:{content?:string}}>;error?:{message?:string}};
    try{result=await response.json() as typeof result;}finally{clearTimeout(timer);}
    const content = result.choices?.[0]?.message?.content;
    if (!content) return error(result.error?.message || "模型没有返回内容",502);
    if (json) return Response.json({chapters:parseChapters(content)});
    return Response.json({text:content});
  } catch(e) {
    console.error("generation",e);
    return error(e instanceof Error ? e.message : "生成失败，请稍后重试",502);
  }
}
