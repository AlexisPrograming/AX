const messagesEl = document.getElementById('messages');
const waveformEl = document.getElementById('waveform');
const statusBar = document.getElementById('statusbar');
const statusText = document.getElementById('status-text');
const micBtn = document.getElementById('mic-btn');
const closeBtn = document.getElementById('close-btn');
const recDot = document.getElementById('rec-dot');

let busy = false;
let cancelled = false;
let pendingScreenshot = null; // base64 PNG captured by the Alt+S hotkey, consumed by the next listen()

// Screen-intent phrases — same regex list as brain.needsScreen so the renderer
// can decide whether to capture before asking.
const SCREEN_INTENT = [
  /\bwhat'?s on (my|the) screen\b/i,
  /\blook at (this|my screen|the screen)\b/i,
  /\bwhat'?s wrong (here|with this)\b/i,
  /\bwhat do you see\b/i,
  /\bsee (this|my screen|the screen)\b/i,
  /\bcheck (this|my screen|the screen)\b/i,
  /\bread (this|my screen|the screen)\b/i,
  /\bthis error\b/i,
  /\bwhat does (this|it) say\b/i,
  /\bhelp me (fix|debug) this\b/i,
  /\bon my screen\b/i,
];
function needsScreen(text) {
  return !!text && SCREEN_INTENT.some((re) => re.test(text));
}

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

// Brainstorm mode constants
const BS_SILENCE_MS  = 5000;   // 5s silence ends brainstorm
const BS_MAX_MS      = 180000; // 3 minute hard cap
const BS_MIN_MS      = 1000;

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

// Extended recorder for brainstorm mode (longer silence + max duration)
function recordBrainstormAudio() {
  return new Promise(async (resolve, reject) => {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) { return reject(err); }

    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus' : 'audio/webm';

    audioChunks = [];
    mediaRecorder = new MediaRecorder(mediaStream, { mimeType: mime });
    mediaRecorder.ondataavailable = (e) => { if (e.data?.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      const blob = new Blob(audioChunks, { type: mime });
      resolve(await blob.arrayBuffer());
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
      if (cancelled) { stopRecorder(); return; }
      analyser.getFloatTimeDomainData(data);
      let sumSq = 0;
      for (let i = 0; i < data.length; i++) sumSq += data[i] * data[i];
      const rms = Math.sqrt(sumSq / data.length);

      if (rms > SILENCE_THRESHOLD) {
        lastVoiceAt = performance.now();
        if (performance.now() - startedAt > BS_MIN_MS) everSpoke = true;
      }

      const silentFor = performance.now() - lastVoiceAt;
      const totalFor  = performance.now() - startedAt;

      if (totalFor > BS_MAX_MS || (silentFor > BS_SILENCE_MS && (everSpoke || totalFor > 10000))) {
        stopRecorder(); return;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  });
}

// ── Brainstorm listen pipeline ───────────────────────────────

let brainstormMode = null;

async function listenBrainstorm(mode) {
  if (busy) return;
  busy = true;
  cancelled = false;
  brainstormMode = mode || 'general';

  // Override status text for brainstorm
  waveformEl.className = '';
  statusBar.className = 'listening';
  waveformEl.classList.add('waveform-active');
  micBtn.classList.add('listening', 'cancel');
  micBtn.innerHTML = STOP_ICON;
  statusText.textContent = 'Brainstorm — speak freely, 5s silence to finish';
  if (recDot) recDot.classList.add('recording');

  try {
    const audioBuffer = await recordBrainstormAudio();
    if (cancelled) return;

    setState('thinking');
    statusText.textContent = 'Organizing your thoughts...';

    const result = await window.axiom.processBrainstorm(audioBuffer, brainstormMode);
    if (cancelled) return;

    addMessage('assistant', result);
    setState('speaking');
    await window.axiom.speakText(result);

    if (cancelled) return;
    setState('ready');
  } catch (err) {
    if (cancelled) return;
    addMessage('system', err.message || 'Brainstorm failed.');
    setState('error');
    setTimeout(() => setState('ready'), 3000);
  }

  busy = false;
  brainstormMode = null;
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

    // Decide whether this turn needs vision:
    //  - Alt+S already pre-captured a screenshot → use it
    //  - Or the phrase triggers the screen intent → capture now
    let reply;
    if (pendingScreenshot) {
      const shot = pendingScreenshot;
      pendingScreenshot = null;
      reply = await window.axiom.sendToClaudeWithScreen(result.text, shot);
    } else if (needsScreen(result.text)) {
      const cap = await window.axiom.captureScreen();
      if (cap && cap.ok) {
        reply = await window.axiom.sendToClaudeWithScreen(result.text, cap.base64);
      } else {
        reply = await window.axiom.sendToClaude(result.text);
      }
    } else {
      reply = await window.axiom.sendToClaude(result.text);
    }

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
  window.axiom.userActive && window.axiom.userActive();
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

// Wake word "Hey AX" — auto-start the listening pipeline
if (window.axiom.onWakeWord) {
  window.axiom.onWakeWord(() => {
    if (!busy) listen();
  });
}

// Alt+S hotkey — screenshot already captured in main, stash it and start listening
if (window.axiom.onScreenHotkey) {
  window.axiom.onScreenHotkey((base64) => {
    pendingScreenshot = base64 || null;
    addMessage('system', 'Screenshot captured. Ask me about it.');
    if (!busy) listen();
  });
}

// Brainstorm mode — extended listening triggered by brain.js action
if (window.axiom.onBrainstormStart) {
  window.axiom.onBrainstormStart((mode) => {
    if (!busy) listenBrainstorm(mode);
  });
}

// Proactive messages from AXIOM (silence check-ins, break nudges, etc.)
if (window.axiom.onProactive) {
  window.axiom.onProactive((text) => {
    addMessage('assistant', text);
  });
}

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
