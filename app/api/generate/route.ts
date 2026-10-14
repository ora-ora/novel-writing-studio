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
  return value.map((item:Record<string,unknown>)=>({title:String(item.title || "未命名章节").slice(0,180),synopsis:String(item.synopsis || "").slice(0,15000)}));
}
export async function POST(request:Request) {
  try {
    const input = await request.json() as {kind:string; endpoint:string; key:string; model:string; title:string; premise:string; summary:string; important_notes:string; genre:string; style:string; chapters:Chapter[]; selected?:Chapter; instruction?:string; count?:number; temperature?:number; field?:string; operation?:string};
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
    const chapters = Array.isArray(input.chapters) ? input.chapters.slice(0,150) : [];
    const outline = chapters.map((c,i)=>`第${i+1}章 ${c.title}：${c.synopsis}`).join("\n").slice(0,30000);
    const base = `书名：${String(input.title || "").slice(0,120)}\n题材：${String(input.genre || "").slice(0,200)}\n小说概要：${String(input.summary || "").slice(0,8000)}\n世界设定与核心冲突：${String(input.premise || "").slice(0,12000)}\n这本小说的重要提示（人物设定、禁忌、必须遵守的写作要求）：${String(input.important_notes || "").slice(0,6000)}\n文风：${String(input.style || "").slice(0,2000)}`;
    const instruction = String(input.instruction || "").slice(0,3000);
    const count = Math.min(30,Math.max(1,Number(input.count)||8));
    let prompt = ""; let json = false;
    if (kind === "outline") { json = true; prompt = `${base}\n请规划${count}章小说大纲。每章有具体标题与120到250字的剧情概述，推进人物动机、冲突与伏笔，结尾有发展空间。附加要求：${instruction}\n只返回 JSON 数组：[ {\"title\":\"章节标题\",\"synopsis\":\"章节概述\"} ]，不要其他文字。`; }
    else if (kind === "append") { json = true; prompt = `${base}\n当前章节大纲：\n${outline}\n请紧接当前结局追加${count}章，保持人物和时间线连贯，不重复旧章节。附加要求：${instruction}\n只返回 JSON 数组：[ {\"title\":\"章节标题\",\"synopsis\":\"章节概述\"} ]。`; }
    else if (kind === "rewrite" && input.selected) { json = true; prompt = `${base}\n全书已有大纲：\n${outline}\n仅重写目标章节「${input.selected.title}」的标题和概述，保持相邻剧情衔接。修改要求：${instruction || "增强情节张力与连贯性"}\n只返回一个元素的 JSON 数组：[ {\"title\":\"章节标题\",\"synopsis\":\"章节概述\"} ]。`; }
    else if (kind === "body" && input.selected) {
      const index = chapters.findIndex(c=>c.id===input.selected?.id);
      const previous = chapters.slice(Math.max(0,index-3),index).map((c,i)=>`前文第${i+1}章 ${c.title}：${c.synopsis}\n正文末段：${(c.body||"").slice(-1400)}`).join("\n");
      prompt = `${base}\n全书大纲：\n${outline}\n前文参考：\n${previous}\n现在创作「${input.selected.title}」正文，章节概述：${input.selected.synopsis}\n写出完整有场景、动作、对话与细节的小说正文，约2000到3000汉字。遵守大纲但自然展开，避免总结式叙述，不要重复书名或输出说明。附加要求：${instruction}`;
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
      prompt = `${base}\n已写章节大纲：\n${outline}\n当前${label}：\n${current || "（暂无）"}\n请${action}${label}。${goal}\n修改要求：${instruction || "无"}\n只输出可直接填入「${label}」的正文，不要标题、解释或 Markdown 代码块。`;
    } else if (kind === "test") prompt = "只回复：连接成功";
    else return error("未知生成类型");
    const controller = new AbortController(); const timer = setTimeout(()=>controller.abort(),110000);
    let response:Response;
    try { response = await fetch(url,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${key}`},body:JSON.stringify({model:input.model,messages:[{role:"system",content:"你是专业中文小说编辑与写作助手。严格遵守用户的输出格式要求。"},{role:"user",content:prompt}],temperature:Math.min(1.5,Math.max(0,Number(input.temperature) || 0.8)),max_tokens:kind==="body"?6000:4000}),signal:controller.signal}); }
    finally {clearTimeout(timer);}
    if (!response.ok) return error(`模型服务返回 ${response.status}。请检查地址、密钥和模型名称。`,502);
    const result = await response.json() as {choices?:Array<{message?:{content?:string}}>;error?:{message?:string}};
    const content = result.choices?.[0]?.message?.content;
    if (!content) return error(result.error?.message || "模型没有返回内容",502);
    if (json) return Response.json({chapters:parseChapters(content)});
    return Response.json({text:content});
  } catch(e) {
    console.error("generation",e);
    return error(e instanceof Error ? e.message : "生成失败，请稍后重试",502);
  }
}
