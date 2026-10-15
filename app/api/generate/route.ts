import { cleanAIChapterTitle } from "../../../lib/chapter-title";
import { mergeCreativeStyle } from "../../../lib/creative-style";
import { env } from "cloudflare:workers";

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
  return value.map((item:Record<string,unknown>)=>({title:cleanAIChapterTitle(item.title),synopsis:String(item.synopsis || "").slice(0,15000)}));
}
export async function POST(request:Request) {
  try {
    const input = await request.json() as {kind:string; endpoint:string; key:string; model:string; title:string; summary:string; story_bible:string; genre:string; style:string; chapters:Chapter[]; selected?:Chapter; instruction?:string; count?:number; temperature?:number; field?:string; operation?:string; stream?:boolean; projectId?:string; selection?:string; afterChapterId?:string; cursor?:number; fieldSelection?:string};
    const defaultEndpoint = "https://api.deepseek.com/chat/completions";
    const defaultModel = "deepseek-flash";
    const useHostedDeepSeek =
      !input.key && String(input.endpoint || "") === defaultEndpoint &&
      String(input.model || "") === defaultModel;
    const url = endpoint(String(input.endpoint || ""));
    if (!input.model?.trim()) return error("请填写模型名称");
    const key = useHostedDeepSeek ? env.DEEPSEEK_API_KEY : input.key;
    if (!key) return error("请填写自定义模型密钥，或选择已配置的 DeepSeek");
    const kind = input.kind;
    let chapters: Chapter[] = Array.isArray(input.chapters) ? input.chapters.slice(0,150) : [];
    if(input.projectId){
      const database=env.DB;
      if(!database)return error("数据库暂不可用",503);
      const active=await database.prepare("SELECT id FROM projects WHERE id=? AND deleted_at IS NULL").bind(input.projectId).first();
      if(!active)return error("作品不存在或已删除",403);
      // Reading pages are lazy. Build AI context from the selected database work,
      // independently of which chapters happen to be loaded in the browser.
      const rows = await database.prepare("SELECT id,title,synopsis,memory,position FROM chapters WHERE project_id=? AND deleted_at IS NULL ORDER BY position,id").bind(input.projectId).all<Chapter & { memory: string; position: number }>();
      chapters = rows.results;
      if (input.selected?.id) {
        const selected = await database.prepare("SELECT id,title,synopsis,body FROM chapters WHERE id=? AND project_id=? AND deleted_at IS NULL").bind(input.selected.id,input.projectId).first<Chapter>();
        if (!selected) return error("目标章节不存在或已删除",404);
        input.selected = selected;
        if (kind === "body") {
          const at = chapters.findIndex(c => c.id === selected.id);
          const previousIds = chapters.slice(Math.max(0,at-3),at).map(c=>c.id!);
          if (previousIds.length) {
            const previous = await database.prepare(`SELECT id,SUBSTR(body,-1400) AS body FROM chapters WHERE project_id=? AND deleted_at IS NULL AND id IN (${previousIds.map(()=>"?").join(",")})`).bind(input.projectId,...previousIds).all<{id:string;body:string}>();
            const endings = new Map(previous.results.map(c=>[c.id,c.body]));
            chapters = chapters.map(c=>({...c,body:endings.get(c.id!)||""}));
          }
        }
      }
    }
    const outline = chapters.map((c,i)=>`第${i+1}章 ${c.title}：${c.synopsis}`).join("\n").slice(0,30000);
    const context = `书名：${String(input.title||"").slice(0,120)}\n小说概要：${String(input.summary||"").slice(0,8000)}\n创作风格：${mergeCreativeStyle(input.genre,input.style).slice(0,8000)}\n故事资料（作者自定标签；尚未揭露的秘密只在章节大纲明确要求时写出）：\n${String(input.story_bible||"").slice(0,40000)}`;
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
      if (field !== "summary" && field !== "story_bible" && field !== "style") return error("未知作品字段");
      if (operation !== "generate" && operation !== "expand" && operation !== "rewrite") return error("未知修改方式");
      const current = (field === "style" ? mergeCreativeStyle(input.genre,input.style) : String(input[field] || "")).slice(0, field === "story_bible" ? 40000 : 8000);
      if (operation !== "generate" && !current.trim()) return error("请先填写内容，再扩写或重写");
      const label = field === "summary" ? "小说概要" : field === "style" ? "创作风格" : "故事资料";
      const goal = field === "summary"
        ? "写成一段清楚的故事概要，交代主要人物、核心冲突、故事发展和吸引读者的悬念；避免提前定死尚未确定的结局。"
        : field === "style" ? "整理为作者可自由编辑的创作风格说明，可用题材、视角、文风、节奏、避免等标签。遵守已有偏好，未确定的部分可留空，不编造剧情或人物事实。全文不超过8000字。"
        : "用作者自定的 # 标题或标签组织主线、人物、世界规则、时间线、伏笔与禁忌。保留已有确定事实与标签，不强迫填写固定字段。";
      const action = operation === "generate"
        ? "根据已有作品资料生成"
        : operation === "expand"
          ? "保留原有事实与约束，在其基础上补充细节并扩写"
          : "根据修改要求重写，保留原有关键事实与约束";
      const selected=field==="story_bible"&&operation!=="generate"?String(input.fieldSelection||"").slice(0,12000):"";
      prompt = `${context}\n已写章节大纲：\n${outline}\n当前${label}：\n${current || "（暂无）"}\n${selected?`只${operation==="expand"?"扩写":"重写"}下面选中的资料片段，保留它原有的标签，只输出替换该片段的文字；资料其他部分不在输出中：\n${selected}`:`请${action}${label}。${goal}`}\n修改要求：${instruction || "无"}\n只输出可直接填入「${label}」的文字，不要解释或 Markdown 代码块围栏。`;
    } else if(kind==="reviewSettings"){
      const memories=chapters.map((c,i)=>`第${i+1}章：${(c as Chapter & {memory?:string}).memory||c.synopsis}`).join("\n").slice(0,16000);
      prompt=`${context}\n当前章节大纲：\n${outline}\n已写事实记忆：\n${memories}\n对照故事资料中的主线、人物与规则和已写章节，列出明确的矛盾及受影响章节，并给出可选修订建议。区分“确定矛盾”和“需要作者确认”；没有证据的地方不要臆造。不要直接改写大纲或正文。附加要求：${instruction}`;
    } else if (kind === "selection" && input.selected && input.selection?.trim()) {
      const operation=String(input.operation||"rewrite");
      const goals:Record<string,string>={expand:"保留原意并补足动作、感官、对话与细节",rewrite:"根据要求重写，保留关键事实",shorten:"精简重复和冗余描写",polish:"改善语句节奏和文风，不改变事实"};
      if(!goals[operation])return error("未知修订方式");
      prompt=`${context}\n本章：${input.selected.title}。概述：${input.selected.synopsis}\n请对以下选中片段进行修订：\n${input.selection.slice(0,12000)}\n任务：${goals[operation]}。补充要求：${instruction||"无"}\n只输出替换片段，不要解释。`;
    } else if (kind === "memory" && input.selected) {
      prompt=`将下列章节正文整理为供后续章节使用的简短事实记忆（人物状态、时间、地点、已揭示信息、未回收伏笔），最多500字，不要编造：\n${String(input.selected.body||"").slice(0,30000)}`;
    } else if (kind === "test") prompt = "只回复：连接成功";
    else return error("未知生成类型");
    if(json)prompt += '\n章节 title 只写标题本身，不包含“第几章”等章序前缀；章序由系统按插入、追加或排序后的实际位置显示。示例：title 为“午夜警报”，不要写“第十二章 午夜警报”。';
    if(useHostedDeepSeek){
      if(!env.DB)return error("默认模型额度暂不可用",503);
      const database=env.DB;
      const day=new Date().toISOString().slice(0,10);
      await database.prepare("INSERT OR IGNORE INTO generation_quota (day,workspace_id,calls) VALUES (?,?,0)").bind(day,"global").run();
      const quota=await database.prepare("UPDATE generation_quota SET calls=calls+1 WHERE day=? AND workspace_id=? AND calls<?").bind(day,"global",30).run();
      if(!quota.meta.changes)return error("默认模型今日全站额度已用完，请使用自定义模型",429);
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
      let buffer="",full="",cancelled=false;
      const stream=new ReadableStream({
        start(out){void (async()=>{
          try{
            while(true){
              const {done,value}=await reader.read();
              if(done){clearTimeout(timer);if(!cancelled){out.enqueue(encoder.encode(`data: ${JSON.stringify({done:true,...(json?{chapters:parseChapters(full)}:{text:full})})}\n\n`));out.close();}return;}
              buffer+=decoder.decode(value,{stream:true});
              const lines=buffer.split("\n");buffer=lines.pop()||"";
              for(const line of lines){
                if(!line.startsWith("data:"))continue;
                const raw=line.slice(5).trim();if(raw==="[DONE]")continue;
                try{const delta=(JSON.parse(raw) as {choices?:Array<{delta?:{content?:string}}>}).choices?.[0]?.delta?.content||"";
                  if(delta&&!cancelled){full+=delta;out.enqueue(encoder.encode(`data: ${JSON.stringify({delta})}\n\n`));}
                }catch{/* Ignore non-content SSE events. */}
              }
            }
          }catch(e){clearTimeout(timer);if(!cancelled){try{out.enqueue(encoder.encode(`data: ${JSON.stringify({error:e instanceof Error?e.message:"生成中断"})}\n\n`));out.close();}catch{/* Client disconnected. */}}}
        })();},
        cancel(){cancelled=true;clearTimeout(timer);void reader.cancel();controller.abort();}
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
