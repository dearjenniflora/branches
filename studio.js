/* Goal workflow: transcribe → human review → three drafts → simple video → role notice. */
let studioRun = 0;
let studioReviewedField = null;
let studioReviewedText = '';
const STUDIO_GOAL_KEY = 'branches.goal.audio-everywhere';
const STUDIO_SESSION_KEY = 'branches.studio.handoff';
const STUDIO_ROLE_KEY = 'branches.studio.role';

function studioSessionValue(key) {
  try { return JSON.parse(sessionStorage.getItem(STUDIO_SESSION_KEY) || '{}')[key] || ''; }
  catch { return ''; }
}
function studioSessionSet(key, value) {
  try {
    const previous = JSON.parse(sessionStorage.getItem(STUDIO_SESSION_KEY) || '{}');
    sessionStorage.setItem(STUDIO_SESSION_KEY, JSON.stringify({ ...previous, [key]: value }));
  } catch { /* The handoff can still be done by copying text. */ }
}
function studioHandoffReviewed() {
  const transcript = studioSessionValue('transcript');
  return Boolean(transcript && studioSessionValue('approvedTranscript') === transcript);
}
function studioRoleSetting(key) {
  try { return JSON.parse(localStorage.getItem(STUDIO_ROLE_KEY) || '{}')[key] || (key === 'name' ? '小枝' : 'gentle'); }
  catch { return key === 'name' ? '小枝' : 'gentle'; }
}

function studioGoalState() {
  try { return JSON.parse(localStorage.getItem(STUDIO_GOAL_KEY)) || {}; }
  catch { return {}; }
}
function saveStudioGoal(stage, options = {}) {
  try {
    const previous = options.reset ? {} : studioGoalState();
    localStorage.setItem(STUDIO_GOAL_KEY, JSON.stringify({
      ...previous, stage: Math.max(options.reset ? 0 : (previous.stage || 0), stage),
      roleName: options.roleName || previous.roleName || '小枝',
      draftCount: options.draftCount ?? previous.draftCount ?? 0,
      noticeSent: options.noticeSent ?? previous.noticeSent ?? false, updatedAt: Date.now()
    }));
  } catch { /* Private browsing must not block the workflow. */ }
}
function studioGoalCard() {
  const goal = studioGoalState();
  const stage = goal.stage || 0;
  const rows = [
    ['录音接收与转写数字枝', stage >= 2 ? '转写稿已确认' : stage >= 1 ? '转写稿待校对' : '待开始'],
    ['文案生成数字枝', stage >= 3 ? '口播 / 博客 / 图文笔记已生成' : goal.draftCount ? `${goal.draftCount}/3 份文案已生成` : stage >= 2 ? '转写稿已确认' : '等待确认转写稿'],
    ['视频生成数字枝', stage >= 4 ? '配音视频已生成' : '等待口播文案'],
    ['消息通知数字枝', goal.noticeSent ? `${goal.roleName || '小枝'}已发送站内提醒` : '可自定义角色']
  ];
  return `<article class="studio-goal">
    <h2>将一段录音生成不同的传播形式</h2>
    <ol class="studio-goal-list">${rows.map(([name, status], index) => `<li><button type="button" class="studio-goal-link" onclick="go('branch','${['studio-transcriber','studio-copywriter','studio-video','studio-notifier'][index]}')"><strong>${escapeHTML(name)}</strong><small>${escapeHTML(status)}</small><span aria-hidden="true">↗</span></button></li>`).join('')}</ol>
    <button class="btn btn-primary" onclick="go('branch','audio-to-everywhere')">打开这个目标 →</button>
  </article>`;
}
function invalidateStudioReview() {
  studioReviewedField = null;
  studioReviewedText = '';
  const status = document.querySelector('#studioReviewStatus');
  if (status) status.textContent = '转写稿有修改，请重新确认。';
}
function confirmStudioTranscript() {
  const field = document.querySelector('#studioTranscript');
  const text = field?.value.trim() || '';
  if (!text) return showToast('请先转写录音或粘贴文字。');
  if (text.length > 12000) return showToast('转写稿请控制在 12000 字以内。');
  studioReviewedField = field;
  studioReviewedText = text;
  studioSessionSet('approvedTranscript', text);
  document.querySelector('#studioReviewStatus').textContent = '已确认。现在可以生成三种文案。';
  saveStudioGoal(2);
  showToast('转写稿已确认。');
}
function handoffStudioTranscript() {
  const field = document.querySelector('#studioTranscript');
  const text = field?.value.trim() || '';
  if (!text || studioReviewedField !== field || studioReviewedText !== text) return showToast('请先核对并确认转写稿。');
  studioSessionSet('transcript', text);
  go('branch', 'studio-copywriter');
}
function handoffStudioNarration() {
  const text = document.querySelector('[data-studio-result="video"]')?.value || '';
  if (!text.trim()) return showToast('请先生成口播文案。');
  studioSessionSet('narration', studioNarration(text));
  go('branch', 'studio-video');
}
function sendStudioNotice(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const name = form.querySelector('#studioRoleName').value.trim() || '小枝';
  const tone = form.querySelector('#studioRoleTone').value;
  const message = form.querySelector('#studioNoticeText').value.trim();
  if (!message) return showToast('先写下提醒内容。');
  try { localStorage.setItem(STUDIO_ROLE_KEY, JSON.stringify({ name, tone })); } catch {}
  saveStudioGoal(0, { roleName: name, noticeSent: true });
  const notice = `${name}：${message}`;
  const output = document.querySelector('#mockOutput');
  output.classList.remove('hidden');
  output.innerHTML = `<div class="mock-output" role="status">${escapeHTML(notice)}</div>`;
  showToast(notice);
}
async function transcribeStudio() {
  const form = document.querySelector('#branchForm');
  const file = form?.querySelector('#studioAudio')?.files[0];
  if (!file) return showToast('请先选择录音文件。');
  if (file.size > 25 * 1024 * 1024) return showToast('录音文件请控制在 25 MB 以内。');
  const run = ++studioRun;
  const output = document.querySelector('#mockOutput');
  const stage = message => {
    if (run !== studioRun || !output?.isConnected) return;
    output.classList.remove('hidden');
    output.innerHTML = `<div class="mock-output" role="status">${escapeHTML(message)}</div>`;
  };
  try {
    invalidateStudioReview();
    stage('正在读取录音…');
    const transcript = await transcribeStudioAudio(file, (done, total) => stage(`正在转写录音 · ${done}/${total}`), run);
    if (run !== studioRun || !output.isConnected) return;
    const field = form.querySelector('#studioTranscript');
    field.value = transcript;
    form.querySelector('#studioAudio').value = '';
    saveStudioGoal(1, { reset: true });
    stage('转写完成。请在右侧核对并修改转写稿，然后点击“确认转写稿”。');
    field.focus();
  } catch (error) {
    if (run === studioRun && output?.isConnected) stage(studioFriendlyError(error, '转写暂时中断，请重试。'));
  }
}
async function runStudio(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const field = form.querySelector('#studioTranscript');
  const transcript = field.value.trim();
  if (form.querySelector('#studioAudio')?.files.length) return showToast('请先点击“转写录音”，再核对转写稿。');
  const reviewed = studioReviewedField === field && studioReviewedText === transcript;
  const approvedHandoff = state.currentSlug === 'studio-copywriter' && studioSessionValue('approvedTranscript') === transcript;
  if (!transcript || (!reviewed && !approvedHandoff)) {
    return showToast('请先核对并确认转写稿。');
  }
  const run = ++studioRun;
  const output = document.querySelector('#mockOutput');
  const setStage = message => {
    if (run !== studioRun || !output?.isConnected) return;
    output.classList.remove('hidden');
    output.innerHTML = `<div class="mock-output"><div class="studio-stage" role="status">${escapeHTML(message)}</div></div>`;
  };
  try {
    setStage('正在提取要点，并分别生成口播、博客与图文笔记…');
    const response = await fetch(AI_PROXY, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'studio', transcript,
        audience: form.querySelector('#studioAudience').value.trim(),
        preference: form.querySelector('#studioPreference').value.trim() })
    });
    const data = await response.json();
    if (!response.ok) {
      console.error('Studio generation failed:', data);
      throw new Error('生成暂时中断，请再试一次。转写稿已经保留。');
    }
    if (run !== studioRun || !output.isConnected) return;
    const integrated = state.currentSlug === 'audio-to-everywhere';
    const roleName = form.querySelector('#studioRoleName')?.value.trim() || studioRoleSetting('name');
    const tone = form.querySelector('#studioRoleTone')?.value || studioRoleSetting('tone');
    saveStudioGoal(data.failed?.length ? 2 : 3, { roleName, draftCount: 3 - (data.failed?.length || 0), noticeSent: integrated });
    const noticeMessage = data.failed?.length
      ? `${roleName}：有 ${3 - data.failed.length} 份文案已完成，其余可重试。`
      : studioRoleMessage(roleName, tone, false);
    const sections = [
      ['analysis', '核心要点'], ['video', '短视频口播文案'],
      ['blog', '博客长文'], ['note', '图文笔记']
    ];
    output.innerHTML = `<div class="studio-results">
      ${sections.map(([key, title]) => `<section class="studio-result"><h3>${title}</h3>
        ${data.failed?.includes(key) ? '<p class="muted">这一份暂时没有生成，请再次点击生成文案重试。</p>' :
          `<textarea class="field inset-field" data-studio-result="${key}" aria-label="${title}">${escapeHTML(data[key] || '')}</textarea>
          <div class="studio-result-actions"><button type="button" class="btn btn-secondary" onclick="copyStudioResult('${key}')">复制</button></div>`}
      </section>`).join('')}
      ${integrated && data.video ? `<section class="studio-result"><h3>视频生成数字枝</h3>
        <label class="field-label" for="studioNarration">配音文字</label>
        <textarea id="studioNarration" class="field inset-field" maxlength="1000">${escapeHTML(studioNarration(data.video))}</textarea>
        <small class="studio-hint">免费本地配音；首次使用需下载约 50 MB 运行文件。</small>
        <div class="studio-result-actions"><button type="button" class="btn btn-primary" onclick="makeStudioVideo()">生成配音与简单视频</button></div>
        <div id="studioVideoOutput" aria-live="polite"></div></section>` : ''}
      ${!integrated && data.video ? '<button type="button" class="btn btn-secondary" onclick="handoffStudioNarration()">交给视频生成枝 →</button>' : ''}
      ${integrated ? `<section class="studio-result"><h3>消息通知数字枝</h3><p id="studioNotice">${escapeHTML(noticeMessage)}</p></section>` : ''}
      <button type="button" class="btn btn-primary" onclick="downloadStudioResults()">下载全部文字</button>
    </div>`;
    if (integrated) showToast(noticeMessage);
    else showToast('三种文案已生成。');
  } catch (error) {
    if (run === studioRun && output?.isConnected) setStage(studioFriendlyError(error, '处理暂时中断，请重试。'));
  }
}
function studioFriendlyError(error, fallback, networkMessage = '网络连接暂时中断，请重试。已确认的转写稿仍在当前页面。') {
  if (error instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(error?.message || '')) {
    return networkMessage;
  }
  return error?.message || fallback;
}
function studioNarration(text) {
  return String(text).split('【口播正文】').pop().split('【镜头建议】')[0].trim().slice(0, 1000);
}
function studioRoleMessage(name, tone, videoReady) {
  const work = videoReady ? '配音视频也准备好了' : '三种文案已经准备好了';
  if (tone === 'playful') return `${name}：好耶，${work}！来看看吧。`;
  if (tone === 'brief') return `${name}：${work}。`;
  return `${name}：${work}，慢慢看，有需要再改。`;
}

async function transcribeStudioAudio(file, onProgress, run) {
  const context = new (window.AudioContext || window.webkitAudioContext)();
  let decoded;
  try { decoded = await context.decodeAudioData(await file.arrayBuffer()); }
  finally { await context.close(); }
  if (decoded.duration > 15 * 60) throw new Error('当前演示支持最长 15 分钟录音。');
  const chunks = Math.ceil(decoded.duration / 45);
  if (!chunks) throw new Error('录音中没有可读取的内容。');
  const parts = [];
  for (let index = 0; index < chunks; index++) {
    if (run !== studioRun) throw new Error('处理已取消。');
    onProgress(index + 1, chunks);
    const wav = studioWavChunk(decoded, index * 45, Math.min(decoded.duration, (index + 1) * 45));
    const response = await fetch(`${AI_PROXY}/transcribe`, {
      method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || data.error || `第 ${index + 1} 段转写失败。`);
    if (data.text?.trim()) parts.push(data.text.trim());
  }
  if (!parts.length) throw new Error('没有识别到语音，请检查录音后重试。');
  return parts.join('\n');
}

function studioWavChunk(audio, startSeconds, endSeconds) {
  const sampleRate = 16000;
  const count = Math.ceil((endSeconds - startSeconds) * sampleRate);
  const bytes = new ArrayBuffer(44 + count * 2);
  const view = new DataView(bytes);
  const write = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  write(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); write(8, 'WAVE');
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, count * 2, true);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, channel) => audio.getChannelData(channel));
  for (let i = 0; i < count; i++) {
    const at = (startSeconds + i / sampleRate) * audio.sampleRate;
    const left = Math.floor(at), ratio = at - left;
    let sample = 0;
    for (const values of channels) {
      sample += (values[left] || 0) * (1 - ratio) + (values[left + 1] || 0) * ratio;
    }
    sample = Math.max(-1, Math.min(1, sample / audio.numberOfChannels));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

async function copyStudioResult(key) {
  const field = document.querySelector(`[data-studio-result="${key}"]`);
  if (field) { await navigator.clipboard.writeText(field.value); showToast('已复制。'); }
}

function downloadStudioResults() {
  const sections = [...document.querySelectorAll('[data-studio-result]')];
  const transcript = document.querySelector('#studioTranscript')?.value || '';
  const text = `转写稿\n\n${transcript}\n\n──────────\n\n` + sections.map(field => `${field.getAttribute('aria-label')}\n\n${field.value}`).join('\n\n──────────\n\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = '枝间-多平台内容.txt'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let studioVideoUrl = null;
async function makeStudioVideo() {
  const narration = document.querySelector('#studioNarration')?.value.trim();
  const root = document.querySelector('#studioVideoOutput');
  if (!root || !narration) return showToast('请先确认配音文字。');
  if (narration.length > 1000) return showToast('配音文字请控制在 1000 字以内。');
  if (!HTMLCanvasElement.prototype.captureStream || !window.MediaRecorder) {
    root.textContent = '当前浏览器暂不支持视频导出，请换用最新版 Chrome 或 Edge。';
    return;
  }
  root.textContent = '正在准备免费中文配音，首次使用需要下载语音模型…';
  let audioContext;
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    await audioContext.resume();
    const { predict } = await import('./assets/tts/vits-web.js');
    const segments = studioVoiceSegments(narration);
    const audioParts = [];
    for (const [index, segment] of segments.entries()) {
      root.textContent = `正在合成中文配音 · ${index + 1}/${segments.length}`;
      const wav = await predict({ text: segment, voiceId: 'zh_CN-huayan-x_low' }, progress => {
        if (!root.isConnected || index > 0) return;
        const percent = progress.total ? Math.round(progress.loaded / progress.total * 100) : 0;
        root.textContent = percent < 100 ? `正在下载免费语音模型 · ${percent}%` : `正在合成中文配音 · 1/${segments.length}`;
      });
      audioParts.push(await audioContext.decodeAudioData(await wav.arrayBuffer()));
    }
    const audioBuffer = studioJoinAudio(audioContext, audioParts);
    root.textContent = '正在合成字幕视频…';
    const canvas = document.createElement('canvas');
    canvas.width = 720; canvas.height = 1280;
    const context = canvas.getContext('2d');
    const artwork = new Image();
    artwork.src = 'assets/monet/monet-antibes.jpg';
    await artwork.decode();
    const captions = narration.match(/[^。！？!?；;]+[。！？!?；;]?/g)?.map(x => x.trim()).filter(Boolean) || [narration];
    const destination = audioContext.createMediaStreamDestination();
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(destination);
    const stream = new MediaStream([...canvas.captureStream(24).getVideoTracks(), ...destination.stream.getAudioTracks()]);
    const mime = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type));
    if (!mime) throw new Error('当前浏览器暂不支持视频录制。');
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    const chunks = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    const finished = new Promise((resolve, reject) => {
      recorder.onerror = () => reject(new Error('视频合成失败。'));
      recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
    });
    let active = true;
    const startedAt = audioContext.currentTime;
    const draw = () => {
      if (!active) return;
      const elapsed = Math.max(0, audioContext.currentTime - startedAt);
      drawStudioFrame(context, artwork, captions, elapsed, audioBuffer.duration);
      requestAnimationFrame(draw);
    };
    draw();
    recorder.start(1000);
    source.onended = () => { active = false; if (recorder.state !== 'inactive') recorder.stop(); };
    source.start();
    const video = await finished;
    stream.getTracks().forEach(track => track.stop());
    if (studioVideoUrl) URL.revokeObjectURL(studioVideoUrl);
    studioVideoUrl = URL.createObjectURL(video);
    if (root.isConnected) {
      const extension = mime.includes('mp4') ? 'mp4' : 'webm';
      root.innerHTML = `<video controls playsinline style="width:100%;max-height:480px;margin-top:14px;border-radius:18px" src="${studioVideoUrl}"></video>
        <div class="studio-result-actions"><a class="btn btn-secondary" href="${studioVideoUrl}" download="枝间-短视频.${extension}">下载视频</a></div>`;
      const form = document.querySelector('#branchForm');
      const roleName = form?.querySelector('#studioRoleName')?.value.trim() || studioRoleSetting('name');
      const tone = form?.querySelector('#studioRoleTone')?.value || studioRoleSetting('tone');
      saveStudioGoal(4, { roleName, noticeSent: true });
      const notice = document.querySelector('#studioNotice');
      if (notice) notice.textContent = studioRoleMessage(roleName, tone, true);
      showToast(studioRoleMessage(roleName, tone, true));
    }
  } catch (error) {
    if (root.isConnected) root.textContent = studioFriendlyError(error, '免费配音暂时无法完成，请检查网络后重试。', '语音模型下载中断，请检查网络后重试。');
  } finally { await audioContext?.close().catch(() => {}); }
}

function studioVoiceSegments(text) {
  const sentences = text.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [text];
  const segments = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > 140) { segments.push(current.trim()); current = ''; }
    for (let start = 0; start < sentence.length; start += 140) {
      const part = sentence.slice(start, start + 140);
      if (current.length + part.length > 140) { segments.push(current.trim()); current = ''; }
      current += part;
    }
  }
  if (current.trim()) segments.push(current.trim());
  return segments;
}

function studioJoinAudio(context, parts) {
  const gap = Math.round(context.sampleRate * .12);
  const length = parts.reduce((sum, part) => sum + part.length, 0) + gap * Math.max(0, parts.length - 1);
  const joined = context.createBuffer(1, length, context.sampleRate);
  const samples = joined.getChannelData(0);
  let offset = 0;
  for (const part of parts) {
    samples.set(part.getChannelData(0), offset);
    offset += part.length + gap;
  }
  return joined;
}

function drawStudioFrame(context, artwork, captions, elapsed, duration) {
  const { width, height } = context.canvas;
  const scale = Math.max(width / artwork.width, height / artwork.height);
  context.drawImage(artwork, (width - artwork.width * scale) / 2, (height - artwork.height * scale) / 2, artwork.width * scale, artwork.height * scale);
  const shade = context.createLinearGradient(0, 0, 0, height);
  shade.addColorStop(0, 'rgba(20,35,48,.12)'); shade.addColorStop(1, 'rgba(15,31,45,.72)');
  context.fillStyle = shade; context.fillRect(0, 0, width, height);
  context.fillStyle = 'rgba(255,255,255,.93)';
  context.font = 'bold 43px sans-serif'; context.textAlign = 'center';
  const index = Math.min(captions.length - 1, Math.floor(elapsed / Math.max(duration, .1) * captions.length));
  const words = captions[index];
  const lines = [];
  let line = '';
  for (const character of words) {
    if (context.measureText(line + character).width > width - 110) { lines.push(line); line = character; }
    else line += character;
  }
  if (line) lines.push(line);
  const top = height * .72 - lines.length * 30;
  lines.forEach((value, i) => context.fillText(value, width / 2, top + i * 62));
  context.font = '24px sans-serif'; context.fillText('枝间 · BRANCHES', width / 2, height - 72);
}
