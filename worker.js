/* ============================================================
   枝间 BRANCHES · AI Proxy (Cloudflare Worker)

   部署方式（二选一）：
   A. Dashboard：Workers & Pages → Create → Worker，把默认代码
      全部删掉，粘贴本文件全部内容 → Deploy。
   B. wrangler：npx wrangler deploy worker.js

   部署后必须设置 3 个变量（Settings → Variables and Secrets）：
     API_KEY   （类型选 Secret）你的模型供应商 API Key
     API_BASE  https://api.deepseek.com/v1/chat/completions
     MODEL     deepseek-v4-flash   ← 必须填平台真实的模型 ID

   注意：这个 Worker 没有鉴权，任何知道地址的人都能消耗你的额度。
   上线前建议加一层来源校验或 Cloudflare Rate Limiting。
============================================================ */

const BRANCHES = [
  "teach-me-like-this",
  "training-branch",
  "less-ai-more-me",
  "morning-trend-radar",
  "what-do-i-need-today",
  "friends-anon-question-box"
];

/* 只允许你自己的站点调用 */
const ALLOWED_ORIGINS = [
  "https://branches.dearjenniflora.com",   /* 线上站点（CNAME） */
  "https://dearjenniflora.github.io",      /* GitHub Pages 备用 */
  "http://localhost:8000",
  "http://127.0.0.1:8000"
];

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const corsHeaders = {
      "Access-Control-Allow-Origin": corsHeaders_for(origin),
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, corsHeaders);
    }

    try {
      const body = await request.json();

      if (body.action === "match") {
        return await matchBranch(body.need, env, corsHeaders);
      }

      if (body.action === "run") {
        return await runBranch(body.slug, body.inputs || {}, env, corsHeaders);
      }

      return json({ error: "Unknown action" }, 400, corsHeaders);

    } catch (error) {
      return json(
        { error: "AI request failed", detail: error.message },
        500,
        corsHeaders
      );
    }
  }
};

function corsHeaders_for(origin) {
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

/* 说明：CORS 只影响浏览器是否接受响应，不等于鉴权。
   真正的保护是 Cloudflare 侧的 Rate Limiting / Turnstile。 */

async function matchBranch(need, env, corsHeaders) {
  const systemPrompt = `
你是「枝间 BRANCHES」的需求理解与 Branch 匹配器。

枝间不是 App Builder。
你不生成新应用。
你的任务只有一个：

理解用户真实需求，并从已有 Branch 中找到最匹配的一个。

目前只有以下六个 Branch：

1.
slug: teach-me-like-this
类型: Knowledge Branch
适合：
看不懂论文、文章、教材；
希望换一种理解方式；
希望用角色口吻、比喻、RPG、地图等方式学习。

2.
slug: training-branch
类型: Persona Branch
适合：
希望按照某个健身创作者公开的训练理念，
结合当天状态得到训练建议。

3.
slug: less-ai-more-me
类型: Skill Branch
适合：
AI 写出来的文字 AI 味太重；
需要改写得自然、像人、像自己。

4.
slug: morning-trend-radar
类型: Workflow Branch
适合：
追踪热点、行业信息、资讯；
自动整理、分类、摘要和推送。

5.
slug: what-do-i-need-today
类型: App Branch
适合：
出门、旅行、会议、上课等场景；
担心忘东西；
需要动态物品清单或 Belonging Check。

6.
slug: friends-anon-question-box
类型: Link Branch
适合：
朋友匿名提问、真心话、夸夸、爆料、整活；
生成匿名入口、链接或二维码。

判断规则：

- 不要因为关键词相似就强行匹配。
- 优先理解用户真正想解决的问题。
- 如果六个都明显不合适，就返回 null。
- 不要创造第七种 Branch。
- 不要推荐工具。
- 不要解释 AI 技术。

只输出 JSON，不要 Markdown，不要代码块：

{
  "slug": "branch-slug 或 null",
  "confidence": 0到1之间的小数,
  "reason": "一句非常简短的中文解释"
}
`;

  const text = await callAI(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: `我的需求是：${need}` }
    ],
    env
  );

  let parsed;

  try {
    const cleaned = text
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("AI 返回的匹配结果不是有效 JSON");
  }

  if (parsed.slug && !BRANCHES.includes(parsed.slug)) {
    parsed.slug = null;
  }

  return json(parsed, 200, corsHeaders);
}

async function runBranch(slug, inputs, env, corsHeaders) {
  if (!BRANCHES.includes(slug)) {
    return json({ error: "Unknown Branch" }, 400, corsHeaders);
  }

  const definitions = {

    "teach-me-like-this": `
你正在运行 Knowledge Branch：Teach Me Like This。

用户会提供一段论文、文章或知识内容，
以及希望采用的理解方式。

你的任务：
按照用户指定的理解方式重新解释内容。

要求：
- 中文为主。
- 关键英文术语保留英文原文。
- 不歪曲原文。
- 可以使用 RPG、地图、角色口吻、比喻等。
- 核心目标是降低理解门槛。
`,

    "training-branch": `
你正在运行 Persona Branch：Training Branch。

根据用户填写的：
睡眠、酸痛程度、可用时间、器械等状态，
生成一份今天的训练建议。

要求：
- 强调状态判断，而不是强迫完成训练。
- 内容简洁。
- 不进行诊断。
- 结尾注明：非医疗建议。
`,

    "less-ai-more-me": `
你正在运行 Skill Branch：Less AI. More Me.

用户会提供一段 AI 味很重的文字。

你的任务：
在不改变核心意思的前提下，
把它改得更自然、更具体、更像真实的人写的。

避免：
- 首先、其次、最后
- 值得注意的是
- 不仅……而且……
- 过多总结
- 空泛拔高
- 对称句堆叠

直接输出修改后的版本，
不要写长篇分析。
`,

    "morning-trend-radar": `
你正在运行 Workflow Branch：Morning Trend Radar。

这是 MVP 演示，不需要真的联网抓取新闻。

根据用户填写的领域、时间和推送位置，
生成一份非常逼真的 Workflow 运行结果。

格式类似：

抓取 →
去重 →
分类 →
摘要 →
生成文档 →
推送

同时提供 3-5 条虚构但明确标注为 Demo 的热点条目。

绝对不要冒充真实实时新闻。
`,

    "what-do-i-need-today": `
你正在运行 App Branch：What Do I Need Today?

根据用户今天的场景、目的地和活动，
生成一份动态 Belonging Check。

要求：
不要只输出通用清单。

分成：
一定要带
视情况带
很容易忘

每项尽可能具体、短。
`,

    "friends-anon-question-box": `
你正在运行 Link Branch：Friends’ Anonymous Question Box。

根据用户选择的玩法、开放对象和群暗号，
生成一次匿名提问箱创建结果。

这是 Demo。

需要包含：

房间创建成功
一个虚构链接
随机匿名昵称示例
一个匿名问题示例
箱主回答卡示例
隐私提示

不要生成真实可访问服务链接，
必须注明 Demo。
`
  };

  const messages = [
    {
      role: "system",
      content: `
你是枝间 BRANCHES 中正在被调用的一个 Branch。

${definitions[slug]}

整个产品的理念是：
普通用户不需要知道模型、Agent、Prompt、Workflow。
用户只需要感觉自己正在使用一个适合当前需求的数字单元。

回答要自然、有产品感。
不要解释你是 AI。
`
    },
    {
      role: "user",
      content: "用户输入：" + JSON.stringify(inputs, null, 2)
    }
  ];

  const result = await callAI(messages, env);

  return json({ result }, 200, corsHeaders);
}

async function callAI(messages, env) {
  if (!env.API_KEY) {
    throw new Error("API_KEY 未配置");
  }

  if (!env.API_BASE) {
    throw new Error("API_BASE 未配置");
  }

  if (!env.MODEL) {
    throw new Error("MODEL 未配置");
  }

  const response = await fetch(env.API_BASE, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.API_KEY}`
    },

    body: JSON.stringify({
      model: env.MODEL,
      messages,
      temperature: 0.35,
      max_tokens: 1200
    })
  });

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(`${response.status}: ${errorText}`);
  }

  const data = await response.json();

  const content = data?.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("API 没有返回正文");
  }

  return content;
}

function json(data, status, headers) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        ...headers,
        "Content-Type": "application/json; charset=utf-8"
      }
    }
  );
}
