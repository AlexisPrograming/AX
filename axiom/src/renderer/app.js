const messagesEl = document.getElementById('messages');
const waveformEl = document.getElementById('waveform');
const statusBar = document.getElementById('statusbar');
const statusText = document.getElementById('status-text');
const micBtn = document.getElementById('mic-btn');
const closeBtn = document.getElementById('close-btn');
const recDot = document.getElementById('rec-dot');

let busy = false;
let cancelled = false;

// ── Whisper recording state ──────────────────────────────
let mediaRecorder = null;
let mediaStream = null;
let audioCtx = null;
let analyser = null;
let sourceNode = null;
let rafId = null;
let audioChunks = [];

const SILENCE_MS = 1500;
const SILENCE_THRESHOLD = 0.012;
const MIN_SPEECH_MS = 400;

function stopRecorder() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  try { sourceNode && sourceNode.disconnect(); } catch {}
  try { analyser && analyser.disconnect(); } catch {}
  try { audioCtx && audioCtx.close(); } catch {}
  audioCtx = analyser = sourceNode = null;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try { mediaRecorder.stop(); } catch {}
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }
}

function recordUntilSilence() {
  return new Promise(async (resolve, reject) => {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      return reject(err);
    }

    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    audioChunks = [];
    mediaRecorder = new MediaRecorder(mediaStream, { mimeType: mime });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      const blob = new Blob(audioChunks, { type: mime });
      const buf = await blob.arrayBuffer();
      resolve(buf);
    };

    mediaRecorder.onerror = (e) => reject(e.error || new Error('recorder error'));
    mediaRecorder.start(250);

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    sourceNode = audioCtx.createMediaStreamSource(mediaStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    sourceNode.connect(analyser);

    const data = new Float32Array(analyser.fftSize);
    const startedAt = performance.now();
    let lastVoiceAt = performance.now();
    let everSpoke = false;

    const tick = () => {
      if (cancelled) {
        stopRecorder();
        return;
      }
      analyser.getFloatTimeDomainData(data);
      let sumSq = 0;
      for (let i = 0; i < data.length; i++) sumSq += data[i] * data[i];
      const rms = Math.sqrt(sumSq / data.length);

      if (rms > SILENCE_THRESHOLD) {
        lastVoiceAt = performance.now();
        if (performance.now() - startedAt > MIN_SPEECH_MS) everSpoke = true;
      }

      const silentFor = performance.now() - lastVoiceAt;
      const totalFor = performance.now() - startedAt;

      // Hard cap at 30s; or stop after silence (only if we heard speech, or after 6s of nothing)
      if (totalFor > 30000 || (silentFor > SILENCE_MS && (everSpoke || totalFor > 6000))) {
        stopRecorder();
        return;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  });
}

const MIC_ICON = `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="9" y="1" width="6" height="12" rx="3"></rect>
  <path d="M19 10v1a7 7 0 0 1-14 0v-1"></path>
  <line x1="12" y1="19" x2="12" y2="23"></line>
  <line x1="8" y1="23" x2="16" y2="23"></line>
</svg>`;

const STOP_ICON = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <line x1="6" y1="6" x2="18" y2="18"></line>
  <line x1="6" y1="18" x2="18" y2="6"></line>
</svg>`;

// ── State Management ─────────────────────────────────────

function setState(state) {
  waveformEl.className = '';
  statusBar.className = '';
  micBtn.classList.remove('listening', 'cancel');
  if (recDot) recDot.classList.toggle('recording', state === 'listening');

  switch (state) {
    case 'listening':
      waveformEl.classList.add('waveform-active');
      statusBar.classList.add('listening');
      micBtn.classList.add('listening', 'cancel');
      micBtn.innerHTML = STOP_ICON;
      statusText.textContent = 'Listening — tap to cancel';
      break;
    case 'thinking':
      waveformEl.classList.add('waveform-thinking');
      statusBar.classList.add('thinking');
      micBtn.classList.add('cancel');
      micBtn.innerHTML = STOP_ICON;
      statusText.textContent = 'Thinking';
      break;
    case 'speaking':
      waveformEl.classList.add('waveform-active');
      statusBar.classList.add('speaking');
      micBtn.classList.add('cancel');
      micBtn.innerHTML = STOP_ICON;
      statusText.textContent = 'Speaking — tap to stop';
      break;
    case 'error':
      statusBar.classList.add('error');
      micBtn.innerHTML = MIC_ICON;
      statusText.textContent = 'Error';
      break;
    default:
      micBtn.innerHTML = MIC_ICON;
      statusText.textContent = 'Ready';
  }
}

// ── Messages ─────────────────────────────────────────────

function addMessage(role, text) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;

  if (role === 'user' || role === 'assistant') {
    const label = document.createElement('div');
    label.className = 'msg-label';
    label.textContent = role === 'user' ? 'You' : 'AXIOM';
    div.appendChild(label);
  }

  const body = document.createElement('div');
  body.className = 'msg-body';
  body.textContent = text;
  div.appendChild(body);

  messagesEl.appendChild(div);
  messagesEl.parentElement.scrollTop = messagesEl.parentElement.scrollHeight;
}

// ── Cancel ───────────────────────────────────────────────

function cancelAll() {
  cancelled = true;
  window.axiom.stopSpeaking();
  stopRecorder();
  busy = false;
  setState('ready');
}

// ── Listen → Think → Speak pipeline ─────────────────────

async function listen() {
  if (busy) return;
  busy = true;
  cancelled = false;
  setState('listening');

  try {
    const audioBuffer = await recordUntilSilence();

    if (cancelled) return;

    setState('thinking');
    const result = await window.axiom.transcribeAudio(audioBuffer);

    if (cancelled) return;

    if (result.error === 'no-speech') {
      addMessage('system', 'No speech detected. Tap the mic to try again.');
      setState('ready');
      busy = false;
      return;
    }

    if (result.error) {
      addMessage('system', `Whisper error: ${result.error}`);
      setState('error');
      setTimeout(() => setState('ready'), 3000);
      busy = false;
      return;
    }

    if (!result.text || !result.text.trim()) {
      addMessage('system', 'No speech detected. Tap the mic to try again.');
      setState('ready');
      busy = false;
      return;
    }

    addMessage('user', result.text);
    setState('thinking');

    const reply = await window.axiom.sendToClaude(result.text);

    if (cancelled) return;

    addMessage('assistant', reply);

    setState('speaking');
    await window.axiom.speakText(reply);

    if (cancelled) return;

    setState('ready');
  } catch (err) {
    if (cancelled) return;
    addMessage('system', err.message || 'Something went wrong.');
    setState('error');
    setTimeout(() => setState('ready'), 3000);
  }

  busy = false;
}

// ── Event Listeners ──────────────────────────────────────

micBtn.addEventListener('click', () => {
  if (busy) {
    cancelAll();
  } else {
    listen();
  }
});

closeBtn.addEventListener('click', () => {
  cancelAll();
  window.axiom.minimize();
});

// ── Init ─────────────────────────────────────────────────

setState('ready');

// Daily briefing arrives from main on startup
if (window.axiom.onBriefing) {
  window.axiom.onBriefing((text) => {
    addMessage('assistant', text);
    setState('speaking');
    // The main process is already speaking via the speaker service;
    // we just reflect the state here.
    setTimeout(() => setState('ready'), Math.min(15000, 2000 + text.length * 60));
  });
}
