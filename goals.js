/* A goal is the user's desired outcome. Branches are capabilities attached to it. */
const GOALS_STORAGE_KEY = 'branches.goals';
let goalAnalysisSequence = 0;
const goalAnalysisRuns = new Map();

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
  if (goal.status === 'unverified') return '匹配暂时中断 · 待重试';
  if (goal.status === 'error') return '能力分析暂时中断 · 待重试';
  const available = goal.steps.filter(step => step.slug).length;
  const missing = goal.steps.length - available;
  return `已有 ${available} 枝 · 待补足 ${missing} 枝`;
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
  const pending = goal.status !== 'ready';
  return `${navbar()}<main class="page"><div class="shell">
    <button class="text-action back" onclick="go('goals')">← 返回目标</button>
    <div class="page-head"><h1 class="editorial">${escapeHTML(goal.title || goal.need)}</h1></div>
    <section class="goal-detail">
      ${goal.title !== goal.need ? `<p class="goal-original">${escapeHTML(goal.need)}</p>` : ''}
      ${pending ? `<div class="goal-analysis-state" role="status">${escapeHTML(goalProgress(goal))}
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

async function analyzeGoal(id) {
  const goal = findGoal(id);
  if (!goal) return;
  const run = ++goalAnalysisSequence;
  goalAnalysisRuns.set(id, run);
  updateGoal(id, { status: 'analyzing' });
  try {
    const response = await fetch(AI_PROXY, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'analyzeGoal', need: goal.need })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
    updateGoal(id, { title: String(result.title || goal.need).slice(0, 40), steps, status: 'ready' });
  } catch (error) {
    console.error('Goal analysis failed:', error);
    if (goalAnalysisRuns.get(id) === run) {
      goalAnalysisRuns.delete(id);
      updateGoal(id, { status: 'error' });
    }
  }
}

async function retryGoal(id) {
  const goal = findGoal(id);
  if (!goal) return;
  if (goal.status !== 'unverified') return analyzeGoal(id);
  updateGoal(id, { status: 'analyzing' });
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
    updateGoal(id, { status: 'unverified' });
  }
}
