/* A goal is the user's desired outcome. Branches are capabilities attached to it. */
const GOALS_STORAGE_KEY = 'branches.goals';
let goalAnalysisSequence = 0;
const goalAnalysisRuns = new Map();
const goalAutoRetry = new Set();

function resumeGoalIfNeeded(id) {
  const goal = findGoal(id);
  if (!goal || goalAutoRetry.has(id) || !['unverified', 'error'].includes(goal.status)) return;
  goalAutoRetry.add(id);
  queueMicrotask(() => retryGoal(id));
}

function readGoals() {
  try {
    const goals = JSON.parse(localStorage.getItem(GOALS_STORAGE_KEY) || '[]');
    return Array.isArray(goals) ? goals.filter(goal => goal && /^[0-9a-f-]{36}$/i.test(goal.id) && typeof goal.need === 'string').slice(0, 30) : [];
  } catch { return []; }
}

function saveGoals(goals) {
  try { localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(goals.slice(0, 30))); return true; }
  catch { showToast('当前浏览器无法保存目标，请检查存储权限。'); return false; }
}

function findGoal(id) {
  return readGoals().find(goal => goal.id === id);
}

function createGoal(need) {
  const goals = readGoals();
  const existing = goals.find(goal => goal.need.trim() === need.trim());
  if (existing) return existing;
  const goal = {
    id: crypto.randomUUID(), need, title: need.slice(0, 34),
    status: 'analyzing', steps: [], createdAt: Date.now()
  };
  return saveGoals([goal, ...goals]) ? goal : null;
}

function updateGoal(id, patch) {
  const goals = readGoals();
  const index = goals.findIndex(goal => goal.id === id);
  if (index < 0) return null;
  goals[index] = { ...goals[index], ...patch };
  if (!saveGoals(goals)) return null;
  if ((state.view === 'goal' && state.currentGoalId === id) || state.view === 'goals') render();
  return goals[index];
}

function removeGoal(id) {
  saveGoals(readGoals().filter(goal => goal.id !== id));
}

function goalProgress(goal) {
  if (goal.status === 'analyzing') return goalAnalysisRuns.has(goal.id) ? '正在分析所需数字枝…' : '分析中断 · 可重试';
  if (goal.status === 'provisional') return '初步分析 · 待智能匹配验证';
  if (goal.status === 'unverified') return '匹配暂时中断 · 待重试';
  if (goal.status === 'error') return '能力分析暂时中断 · 待重试';
  const available = goal.steps.filter(step => step.slug).length;
  const missing = goal.steps.length - available;
  return `已有 ${available} 枝 · 待补足 ${missing} 枝`;
}

function provisionalSteps(need) {
  const text = need.toLowerCase();
  const steps = [];
  const add = (name, purpose, slug) => { if (!steps.some(step => step.slug === slug)) steps.push({ name, purpose, slug }); };
  if (/录音|音频|语音|口述|转写|听写/.test(text)) add('录音转写与校对', '现有数字枝可把录音转成可修改的文字', 'studio-transcriber');
  if (/口播|博客|图文|文案|脚本|自媒体/.test(text)) add('内容文案改编', '现有数字枝可生成口播、博客和图文笔记', 'studio-copywriter');
  if (/视频|影片|配音|字幕/.test(text)) add('基础配音视频', '现有数字枝只支持免费配音和简单字幕视频', 'studio-video');
  if (/匿名|提问箱/.test(text)) add('匿名提问箱', '现有数字枝可建立匿名提问入口', 'friends-anon-question-box');
  if (/提醒|通知/.test(text)) add('站内消息提醒', '现有数字枝可发送角色化站内提醒', 'studio-notifier');
  if (/润色|改写|ai味|ai 味/.test(text)) add('文字润色', '现有数字枝可让文字更自然', 'less-ai-more-me');
  if (/出门|行李|带什么|物品清单/.test(text)) add('出门物品清单', '现有数字枝可整理要带的东西', 'what-do-i-need-today');
  steps.push({ name: '其余能力待确认', purpose: '智能分析恢复后再核对完整目标与缺失能力', slug: null });
  return steps;
}

function goalFailureMessage(error) {
  if (error?.status === 429) return '请求过于频繁，请稍后再试。';
  if (error?.status === 403) return '枝间接口拒绝了请求，请刷新页面后重试。';
  if (error?.status >= 500) return '智能服务暂时出错，请稍后重试。';
  if (error?.status) return `请求未完成（HTTP ${error.status}），请重试。`;
  return '未能连接枝间接口，请检查网络后重试。';
}

function goalCard(goal) {
  return `<article class="goal-card">
    <button type="button" class="goal-card-open" onclick="go('goal','${goal.id}')">
      <h2>${escapeHTML(goal.title || goal.need)}</h2>
      ${goal.title !== goal.need ? `<p>${escapeHTML(goal.need)}</p>` : ''}
      <small>${escapeHTML(goalProgress(goal))}</small>
      <span aria-hidden="true">↗</span>
    </button>
  </article>`;
}

function goalsView() {
  const goals = readGoals();
  return `${navbar()}<main class="page"><div class="shell">
    <div class="page-head"><h1 class="editorial">你的目标。</h1></div>
    <form class="goal-entry" onsubmit="submitNeed(event)">
      <label class="field-label" for="goalInput">你想完成什么？</label>
      <textarea id="goalInput" class="field inset-field" maxlength="500" placeholder="说出结果，枝间会先查找现有数字枝。"></textarea>
      <button class="btn btn-primary tactile" type="submit">寻找可用的枝 →</button>
    </form>
    <section class="goal-grid" aria-label="目标列表">
      ${goals.map(goalCard).join('')}
      ${studioGoalCard()}
    </section>
  </div></main>`;
}

function goalDetailView(goal) {
  if (!goal) return `${navbar()}<main class="page"><div class="shell"><button class="text-action back" onclick="go('goals')">← 返回目标</button><h1 class="editorial">没有找到这个目标。</h1></div></main>`;
  const hasSteps = goal.status === 'ready' || goal.status === 'provisional';
  return `${navbar()}<main class="page"><div class="shell">
    <button class="text-action back" onclick="go('goals')">← 返回目标</button>
    <div class="page-head"><h1 class="editorial">${escapeHTML(goal.title || goal.need)}</h1></div>
    <section class="goal-detail">
      ${goal.title !== goal.need ? `<p class="goal-original">${escapeHTML(goal.need)}</p>` : ''}
      ${goal.status === 'provisional' ? `<div class="goal-analysis-state" role="status">${escapeHTML(goalProgress(goal))}
        ${goal.failure ? `<p class="goal-failure">${escapeHTML(goal.failure)}</p>` : ''}
        <button class="btn btn-secondary" type="button" onclick="retryGoal('${goal.id}')">重新验证 →</button>
      </div>` : ''}
      ${!hasSteps ? `<div class="goal-analysis-state" role="status">${escapeHTML(goalProgress(goal))}
        ${goal.failure ? `<p class="goal-failure">${escapeHTML(goal.failure)}</p>` : ''}
        ${goal.status !== 'analyzing' || !goalAnalysisRuns.has(goal.id) ? `<button class="btn btn-secondary" type="button" onclick="retryGoal('${goal.id}')">重新分析 →</button>` : ''}
      </div>` : `<ol class="goal-steps">${goal.steps.map((step, index) => `
        <li class="goal-step"><span class="goal-step-number">${index + 1}</span><div>
          <h2>${escapeHTML(step.name)}</h2>
          ${step.purpose ? `<p>${escapeHTML(step.purpose)}</p>` : ''}
        </div><div class="goal-step-action">${step.slug
          ? `<button type="button" class="btn btn-secondary" onclick="go('branch','${step.slug}')">打开数字枝 ↗</button>`
          : '<small>待补足</small>'}</div></li>`).join('')}</ol>`}
    </section>
  </div></main>`;
}

async function analyzeGoal(id, options = {}) {
  const goal = findGoal(id);
  if (!goal) return;
  const run = ++goalAnalysisSequence;
  goalAnalysisRuns.set(id, run);
  updateGoal(id, { status: 'analyzing', failure: '' });
  try {
    const response = await fetch(AI_PROXY, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'analyzeGoal', need: goal.need })
    });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const result = await response.json();
    if (goalAnalysisRuns.get(id) !== run) return;
    if (result.matchedSlug && getBranch(result.matchedSlug) && !getBranch(result.matchedSlug).isDemo) {
      goalAnalysisRuns.delete(id);
      removeGoal(id);
      showToast('找到可以完成这个目标的数字枝。');
      go('branch', result.matchedSlug);
      return;
    }
    if (!Array.isArray(result.steps) || !result.steps.length) throw new Error('No steps');
    const steps = result.steps.slice(0, 6).map(step => ({
      name: String(step.name || '').slice(0, 40),
      purpose: String(step.purpose || '').slice(0, 120),
      slug: getBranch(step.slug) && !getBranch(step.slug).isDemo ? step.slug : null
    })).filter(step => step.name);
    if (!steps.length) throw new Error('No valid steps');
    goalAnalysisRuns.delete(id);
    updateGoal(id, { title: String(result.title || goal.need).slice(0, 40), steps, status: options.matchUnverified ? 'provisional' : 'ready', failure: options.matchUnverified ? '完整匹配尚未验证；以下能力拆解供参考。' : '' });
  } catch (error) {
    console.error('Goal analysis failed:', error);
    if (goalAnalysisRuns.get(id) === run) {
      goalAnalysisRuns.delete(id);
      updateGoal(id, { status: 'provisional', steps: provisionalSteps(goal.need), failure: goalFailureMessage(error) });
    }
  }
}

async function retryGoal(id) {
  const goal = findGoal(id);
  if (!goal) return;
  if (goal.status !== 'unverified' && goal.status !== 'provisional') return analyzeGoal(id);
  updateGoal(id, { status: 'analyzing', failure: '' });
  try {
    const result = await requestNeedMatch(goal.need);
    if (result.slug && getBranch(result.slug) && !getBranch(result.slug).isDemo) {
      removeGoal(id);
      go('branch', result.slug);
    } else {
      analyzeGoal(id);
    }
  } catch (error) {
    console.error('Goal match retry failed:', error);
    analyzeGoal(id, { matchUnverified: true });
  }
}
