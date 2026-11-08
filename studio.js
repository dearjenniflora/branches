/* One recording → editable transcript → shared analysis → three channel drafts. */
let studioRun = 0;

async function runStudio(event) {
  event.preventDefault();
  const run = ++studioRun;
  const form = event.currentTarget;
  const output = document.querySelector('#mockOutput');
  const transcriptField = form.querySelector('#studioTranscript');
  const audio = form.querySelector('#studioAudio').files[0];
  const setStage = message => {
    if (run !== studioRun || !output?.isConnected) return;
    output.classList.remove('hidden');
    output.innerHTML = `<div class="mock-output"><div class="studio-stage" role="status">${escapeHTML(message)}</div></div>`;
  };
  try {
    let transcript = transcriptField.value.trim();
    if (audio) {
      if (audio.size > 25 * 1024 * 1024) throw new Error('录音文件请控制在 25 MB 以内。');
      setStage('正在读取录音…');
      transcript = await transcribeStudioAudio(audio, (done, total) => setStage(`正在转写录音 · ${done}/${total}`), run);
      if (run !== studioRun || !output.isConnected) return;
      transcriptField.value = transcript;
      form.querySelector('#studioAudio').value = ''; // Regeneration uses the edited transcript.
    }
    if (!transcript) throw new Error('请上传录音，或先粘贴一段转写稿。');
    if (transcript.length > 12000) throw new Error('转写稿请控制在 12000 字以内。');
    setStage('正在提取要点，并生成三种传播形式…');
    const response = await fetch(AI_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'studio',
        transcript,
        audience: form.querySelector('#studioAudience').value.trim(),
        preference: form.querySelector('#studioPreference').value.trim()
      })
    });
    const data = await response.json();
    if (!response.ok) {
      console.error('Studio generation failed:', data);
      throw new Error('生成暂时中断，请再试一次。转写稿已经保留。');
    }
    if (run !== studioRun || !output.isConnected) return;
    const sections = [
      ['analysis', '核心要点'], ['video', '短视频口播与镜头'],
      ['podcast', '播客标题与章节'], ['article', '图文标题与正文']
    ];
    output.innerHTML = `<div class="studio-results">${sections.map(([key, title]) => `
      <section class="studio-result"><h3>${title}</h3>
        ${data.failed?.includes(key)
          ? '<p class="muted">这一份暂时没有生成，请再次点击“生成三种内容”重试。</p>'
          : `<textarea class="field inset-field" data-studio-result="${key}" aria-label="${title}">${escapeHTML(data[key] || '')}</textarea>
             <div class="studio-result-actions"><button type="button" class="btn btn-secondary" onclick="copyStudioResult('${key}')">复制</button></div>`}
      </section>`).join('')}
      <button type="button" class="btn btn-primary" onclick="downloadStudioResults()">下载全部文字</button>
    </div>`;
  } catch (error) {
    if (run === studioRun && output?.isConnected) setStage(error.message || '处理失败，请重试。');
  }
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
