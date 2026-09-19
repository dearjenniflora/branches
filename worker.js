/* ============================================================
   枝间 BRANCHES · AI Proxy (Cloudflare Worker) · Humanizer-zh 版

   这一版把 Skill Branch「Less AI. More Me.」从写死的 Demo prompt
   升级为真实开源 Skill：
   Worker 在服务端读取 op7418/Humanizer-zh 的 SKILL.md（MIT），
   缓存 1 小时后作为该 Branch 的执行指令。
   访客不需要安装任何 Skill。

   部署方式（二选一）：
   A. Dashboard：Workers & Pages → branchesai → Edit code，
      把默认代码全部删掉，粘贴本文件全部内容 → Deploy。
   B. wrangler：npx wrangler deploy worker-humanizer.js

   部署后需要保留的变量（Settings → Variables and Secrets）：
     API_KEY   （类型选 Secret）你的模型供应商 API Key
     API_BASE  https://api.deepseek.com/v1/chat/completions
     MODEL     deepseek-v4-flash   ← 必须填平台真实的模型 ID

   可选变量：
     HUMANIZER_SKILL_URL  覆盖上游 SKILL.md 地址
                          （例如固定到已审核的 commit SHA）

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

/* ------------------------------------------------------------
   真实 Skill 来源（Less AI. More Me. = Humanizer-zh）
   ------------------------------------------------------------ */

const HUMANIZER = {
  slug: "less-ai-more-me",
  name: "Humanizer-zh",
  repo: "https://github.com/op7418/Humanizer-zh",
  license: "MIT",
  defaultUrl:
    "https://raw.githubusercontent.com/op7418/Humanizer-zh/main/SKILL.md",
  ttlSeconds: 3600,
  maxChars: 12000
};

/* 同一个 Worker 实例内的热缓存（Cache API 之外的兜底） */
let skillMemoryCache = { url: "", text: "", expiresAt: 0 };

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

  /* Skill Branch：真正加载 GitHub 上的开源 Skill，而不是本地 demo prompt */
  if (slug === HUMANIZER.slug) {
    return await runHumanizerBranch(inputs, env, corsHeaders);
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

/* ------------------------------------------------------------
   Skill Branch: Less AI. More Me.
   执行指令来自上游开源 Skill（Humanizer-zh, MIT），
   失败时直接报错 —— 绝不返回一个「看起来成功」的假改写。
   ------------------------------------------------------------ */

async function runHumanizerBranch(inputs, env, corsHeaders) {
  const text = (inputs.text || "").toString();

  if (!text.trim()) {
    return json({ error: "缺少要改写的文本" }, 400, corsHeaders);
  }

  if (text.length > HUMANIZER.maxChars) {
    return json(
      { error: `文本超过 ${HUMANIZER.maxChars} 字上限` },
      400,
      corsHeaders
    );
  }

  const skill = await loadHumanizerSkill(env);

  const tone = (inputs.tone || "").toString().trim();
  const voiceSample = (inputs.voiceSample || "").toString().trim();

  const lines = [
    "你是枝间 BRANCHES 中正在被调用的 Skill Branch：Less AI. More Me.（去 AI 味）。",
    "",
    `===== 以下是从开源仓库加载的 Skill 完整说明（${HUMANIZER.name} · op7418 · ${HUMANIZER.license}）=====`,
    skill,
    "===== Skill 说明结束 =====",
    "",
    "补充要求（优先级高于 Skill 说明中与输出格式相关的部分）：",
    "- 只输出改写后的正文本身：不要解释、不要分析、不要加前后缀、不要用代码块包裹。",
    "- 保留原文的事实、数字、专有名词与核心意思，不新增信息。",
    "- 不要声称能绕过任何 AI 检测工具。",
    "- 用户文本多为中文，输出也用中文；英文术语、代码保持原样。",
    tone
      ? `- 用户希望的语气：${tone}。`
      : "- 用户没有指定语气，保持自然、具体、像真人写的那样。"
  ];

  if (voiceSample) {
    lines.push(
      `- 用户提供了自己平时说话的样本，请贴近这种口吻：${voiceSample}`
    );
  }

  const messages = [
    { role: "system", content: lines.join("\n") },
    { role: "user", content: text }
  ];

  const result = await callAI(messages, env, {
    temperature: 0.5,
    maxTokens: 4000
  });

  return json(
    {
      result,
      source: {
        name: HUMANIZER.name,
        repo: HUMANIZER.repo,
        license: HUMANIZER.license
      }
    },
    200,
    corsHeaders
  );
}

async function loadHumanizerSkill(env) {
  const url = env.HUMANIZER_SKILL_URL || HUMANIZER.defaultUrl;
  const now = Date.now();

  if (
    skillMemoryCache.url === url &&
    skillMemoryCache.text &&
    skillMemoryCache.expiresAt > now
  ) {
    return skillMemoryCache.text;
  }

  /* 1. Cloudflare Cache API（跨实例、跨 colo 更省上游请求） */
  const cacheKey = new Request(url, { method: "GET" });
  try {
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      const cachedText = await cached.text();
      if (cachedText && cachedText.trim()) {
        rememberSkill(url, cachedText, now);
        return cachedText;
      }
    }
  } catch (error) {
    /* 缓存不可用时忽略，继续走上游 */
  }

  /* 2. 上游 GitHub raw */
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  let response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "zhijian-branches-worker" }
    });
  } catch (error) {
    throw new Error(`无法加载 Humanizer-zh SKILL.md：${error.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`无法加载 Humanizer-zh SKILL.md：HTTP ${response.status}`);
  }

  const text = await response.text();

  if (!text || !text.trim()) {
    throw new Error("Humanizer-zh SKILL.md 内容为空");
  }

  rememberSkill(url, text, now);

  try {
    await caches.default.put(
      cacheKey,
      new Response(text, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": `max-age=${HUMANIZER.ttlSeconds}`
        }
      })
    );
  } catch (error) {
    /* 缓存写入失败不影响本次运行 */
  }

  return text;
}

function rememberSkill(url, text, now) {
  skillMemoryCache = {
    url,
    text,
    expiresAt: now + HUMANIZER.ttlSeconds * 1000
  };
}

async function callAI(messages, env, options = {}) {
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
      temperature: options.temperature ?? 0.35,
      max_tokens: options.maxTokens ?? 1200
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
