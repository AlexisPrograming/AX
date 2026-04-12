// ── DOM refs ─────────────────────────────────────────────────
const canvas = document.getElementById('orb-canvas');

// ── Particle Orb ─────────────────────────────────────────────

class ParticleOrb {
  constructor(cvs) {
    this.cvs = cvs;
    this.ctx = cvs.getContext('2d');
    this.W   = cvs.width;
    this.H   = cvs.height;
    this.cx  = this.W / 2;
    this.cy  = this.H / 2;

    this.N          = 240;        // dot count
    this.BASE_R     = 55;         // base sphere radius (px)
    this.FOV        = 280;
    this.rotY       = 0;
    this.rotX       = 0.42;       // slight tilt
    this.rotSpeed   = 0.004;
    this.amplitude  = 0;          // smoothed 0–1
    this.targetAmp  = 0;
    this.state      = 'idle';
    this.speakT     = 0;
    this.rafId      = null;

    // Fibonacci-lattice sphere points
    const gr = (1 + Math.sqrt(5)) / 2;
    this.pts = Array.from({ length: this.N }, (_, i) => {
      const theta = Math.acos(1 - 2 * (i + 0.5) / this.N);
      const phi   = 2 * Math.PI * i / gr;
      return {
        ox:    Math.sin(theta) * Math.cos(phi),
        oy:    Math.sin(theta) * Math.sin(phi),
        oz:    Math.cos(theta),
        phase: Math.random() * Math.PI * 2,
        freq:  0.7 + Math.random() * 0.6,
      };
    });
  }

  setState(s) {
    this.state = s;
    this.rotSpeed = { idle: 0.004, listening: 0.007, thinking: 0.014, speaking: 0.005 }[s] ?? 0.004;
    if (s !== 'speaking') this.speakT = 0;
  }

  setAmplitude(a) { this.targetAmp = Math.min(1, Math.max(0, a)); }

  setPaused(p) {
    this.paused = p;
    // Resume immediately — the loop checks this flag each frame
    if (!p && !this.rafId) this.start();
  }

  start() {
    this.paused = false;
    let last = 0;
    const loop = (t) => {
      if (this.paused) {
        // While dragging: stop requesting frames, draw one frozen frame
        this.rafId = null;
        return;
      }
      const dt = Math.min((t - last) / 1000, 0.05);
      last = t;
      this._update(dt);
      this._draw();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop() { if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; } }

  _update(dt) {
    // Smooth amplitude
    this.amplitude += (this.targetAmp - this.amplitude) * 10 * dt;

    // Rotate
    this.rotY += this.rotSpeed;

    // Auto-generate target amplitude per state
    const t = performance.now() / 1000;
    if (this.state === 'idle') {
      this.targetAmp = 0.03 + Math.sin(t * 0.7) * 0.02;
    } else if (this.state === 'thinking') {
      this.targetAmp = 0.12 + Math.abs(Math.sin(t * 3.5)) * 0.18;
      this.rotY += this.rotSpeed * 0.4; // extra spin
    } else if (this.state === 'speaking') {
      this.speakT += dt;
      // Overlapping sinusoids mimic speech cadence
      this.targetAmp =
        Math.abs(Math.sin(this.speakT * 8.3))  * 0.28 +
        Math.abs(Math.sin(this.speakT * 13.7)) * 0.18 +
        Math.abs(Math.sin(this.speakT * 5.1))  * 0.14 +
        0.08;
    }
    // 'listening' → amplitude set externally from mic RMS
  }

  _draw() {
    const { ctx, cx, cy, W, H, amplitude: amp, rotY, rotX, FOV, BASE_R } = this;
    ctx.clearRect(0, 0, W, H);

    const t   = performance.now() / 1000;
    const r   = BASE_R * (1 + amp * 0.38);
    const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
    const cosX = Math.cos(rotX), sinX = Math.sin(rotX);

    // Project + displace all points
    const proj = this.pts.map((p) => {
      let disp = 1;
      if (this.state === 'speaking' || this.state === 'listening') {
        disp = 1 + Math.sin(t * p.freq * (this.state === 'speaking' ? 9 : 5) + p.phase) * amp * 0.45;
      } else if (this.state === 'thinking') {
        disp = 1 + Math.sin(t * p.freq * 4 + p.phase) * amp * 0.3;
      }

      const x = p.ox * disp, y = p.oy * disp, z = p.oz * disp;

      // Rotate Y
      const x1 = x * cosY - z * sinY;
      const z1 = x * sinY + z * cosY;
      // Rotate X
      const y2 = y * cosX - z1 * sinX;
      const z2 = y * sinX + z1 * cosX;

      const scale = FOV / (FOV + z2 * r);
      return {
        x: cx + x1 * r * scale,
        y: cy + y2 * r * scale,
        depth: (z2 + 1) / 2,
      };
    });

    // Back-to-front sort
    proj.sort((a, b) => a.depth - b.depth);

    // Draw phosphorescent dots with glow
    ctx.shadowColor = 'rgba(0,255,120,0.7)';
    ctx.shadowBlur  = 6 + amp * 10;
    proj.forEach(({ x, y, depth }) => {
      const alpha   = 0.25 + depth * 0.75;
      const dotSize = 0.8 + depth * 1.6 + amp * 1.4;
      ctx.beginPath();
      ctx.arc(x, y, dotSize, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,255,120,${alpha.toFixed(2)})`;
      ctx.fill();
    });
    ctx.shadowBlur = 0;

    // Core glow when active
    if (amp > 0.06) {
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.7);
      grd.addColorStop(0, `rgba(0,255,120,${(amp * 0.13).toFixed(3)})`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, W, H);
    }
  }
}

const orb = new ParticleOrb(canvas);
orb.start();

// ── State management ─────────────────────────────────────────

function setState(state) {
  orb.setState(state === 'ready' ? 'idle' : state);
}

// subtitle is gone — keep stub so call-sites don't throw
function showSubtitle() {}

// ── Audio recording state ─────────────────────────────────────

let busy         = false;
let cancelled    = false;
let pendingShot  = null;
let mediaRecorder = null;
let mediaStream   = null;
let audioCtx      = null;
let analyser      = null;
let sourceNode    = null;
let rafId         = null;
let audioChunks   = [];

const SILENCE_MS        = 1500;
const SILENCE_THRESHOLD = 0.012;
const MIN_SPEECH_MS     = 400;
const BS_SILENCE_MS     = 5000;
const BS_MAX_MS         = 180000;
const BS_MIN_MS         = 1000;

// Screen-intent mirror (same as brain.js)
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
  /\bclick (this|that|it|the|here|there|play|pause|on)\b/i,
  /\bclick (on )?(?!.*\bapp\b)/i,
  /\bright.?click\b/i,
  /\bdouble.?click\b/i,
  /\bscroll (down|up|left|right)\b/i,
  /\bscroll (a )?(little|bit|lot)\b/i,
];
function needsScreen(t) { return !!t && SCREEN_INTENT.some(re => re.test(t)); }

function stopRecorder() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  try { sourceNode && sourceNode.disconnect(); } catch {}
  try { analyser  && analyser.disconnect();  } catch {}
  try { audioCtx  && audioCtx.close();       } catch {}
  audioCtx = analyser = sourceNode = null;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try { mediaRecorder.stop(); } catch {}
  }
  if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
  orb.setAmplitude(0);
}

// ── WAV encoder ───────────────────────────────────────────────
// Converts an ArrayBuffer (webm/ogg from MediaRecorder) to a 16-bit mono WAV
// at 16 kHz — the format Whisper handles most reliably.
function buildWav(float32, sampleRate) {
  const numSamples = float32.length;
  const out = new DataView(new ArrayBuffer(44 + numSamples * 2));
  const str = (off, s) => { for (let i = 0; i < s.length; i++) out.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + numSamples * 2, true);
  str(8, 'WAVE'); str(12, 'fmt ');
  out.setUint32(16, 16, true);   // PCM chunk size
  out.setUint16(20, 1, true);    // PCM format
  out.setUint16(22, 1, true);    // mono
  out.setUint32(24, sampleRate, true);
  out.setUint32(28, sampleRate * 2, true); // byte rate
  out.setUint16(32, 2, true);    // block align
  out.setUint16(34, 16, true);   // bits per sample
  str(36, 'data'); out.setUint32(40, numSamples * 2, true);
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return out.buffer;
}

async function toWav(rawArrayBuffer) {
  // Decode the compressed audio (webm/opus) into PCM via Web Audio API
  const decodeCtx = new AudioContext();
  let decoded;
  try {
    decoded = await decodeCtx.decodeAudioData(rawArrayBuffer.slice(0));
  } finally {
    decodeCtx.close().catch(() => {});
  }
  // Resample to 16 kHz mono (optimal for Whisper)
  const TARGET_SR = 16000;
  const offCtx = new OfflineAudioContext(1, Math.ceil(decoded.duration * TARGET_SR), TARGET_SR);
  const src = offCtx.createBufferSource();
  src.buffer = decoded;
  src.connect(offCtx.destination);
  src.start(0);
  const rendered = await offCtx.startRendering();
  return buildWav(rendered.getChannelData(0), TARGET_SR);
}

function recordUntilSilence() {
  return new Promise(async (resolve, reject) => {
    try { mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (err) { return reject(err); }

    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    audioChunks = [];
    mediaRecorder = new MediaRecorder(mediaStream, { mimeType: mime });
    mediaRecorder.ondataavailable = (e) => { if (e.data?.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = async () => resolve(await new Blob(audioChunks, { type: mime }).arrayBuffer());
    mediaRecorder.onerror = (e) => reject(e.error || new Error('recorder error'));
    mediaRecorder.start(250);

    audioCtx   = new (window.AudioContext || window.webkitAudioContext)();
    sourceNode = audioCtx.createMediaStreamSource(mediaStream);
    analyser   = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    sourceNode.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    const startedAt = performance.now();
    let lastVoiceAt = performance.now();
    let everSpoke   = false;

    const tick = () => {
      if (cancelled) { stopRecorder(); return; }
      analyser.getFloatTimeDomainData(data);
      let sumSq = 0;
      for (let i = 0; i < data.length; i++) sumSq += data[i] * data[i];
      const rms = Math.sqrt(sumSq / data.length);

      // Drive orb with mic amplitude
      orb.setAmplitude(rms * 12);

      if (rms > SILENCE_THRESHOLD) {
        lastVoiceAt = performance.now();
        if (performance.now() - startedAt > MIN_SPEECH_MS) everSpoke = true;
      }
      const silent = performance.now() - lastVoiceAt;
      const total  = performance.now() - startedAt;
      if (total > 30000 || (silent > SILENCE_MS && (everSpoke || total > 6000))) {
        stopRecorder(); return;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  });
}

function recordBrainstormAudio() {
  return new Promise(async (resolve, reject) => {
    try { mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (err) { return reject(err); }

    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    audioChunks = [];
    mediaRecorder = new MediaRecorder(mediaStream, { mimeType: mime });
    mediaRecorder.ondataavailable = (e) => { if (e.data?.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = async () => resolve(await new Blob(audioChunks, { type: mime }).arrayBuffer());
    mediaRecorder.onerror = (e) => reject(e.error || new Error('recorder error'));
    mediaRecorder.start(250);

    audioCtx   = new (window.AudioContext || window.webkitAudioContext)();
    sourceNode = audioCtx.createMediaStreamSource(mediaStream);
    analyser   = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    sourceNode.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    const startedAt = performance.now();
    let lastVoiceAt = performance.now();
    let everSpoke   = false;

    const tick = () => {
      if (cancelled) { stopRecorder(); return; }
      analyser.getFloatTimeDomainData(data);
      let sumSq = 0;
      for (let i = 0; i < data.length; i++) sumSq += data[i] * data[i];
      const rms = Math.sqrt(sumSq / data.length);
      orb.setAmplitude(rms * 12);
      if (rms > SILENCE_THRESHOLD) {
        lastVoiceAt = performance.now();
        if (performance.now() - startedAt > BS_MIN_MS) everSpoke = true;
      }
      const silent = performance.now() - lastVoiceAt;
      const total  = performance.now() - startedAt;
      if (total > BS_MAX_MS || (silent > BS_SILENCE_MS && (everSpoke || total > 10000))) {
        stopRecorder(); return;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  });
}

// ── Cancel ────────────────────────────────────────────────────

function cancelAll() {
  cancelled = true;
  window.axiom.stopSpeaking();
  stopRecorder();
  busy = false;
  setState('ready');
}

// ── Brainstorm pipeline ───────────────────────────────────────

let brainstormMode = null;

async function listenBrainstorm(mode) {
  if (busy) return;
  busy = true;
  cancelled = false;
  brainstormMode = mode || 'general';
  setState('listening');
  // statusText removed from UI

  try {
    const rawBs = await recordBrainstormAudio();
    let buf;
    try { buf = await toWav(rawBs); }
    catch (_) { buf = rawBs; }
    if (cancelled) return;
    setState('thinking');
    const result = await window.axiom.processBrainstorm(buf, brainstormMode);
    if (cancelled) return;
    showSubtitle(result);
    setState('speaking');
    await window.axiom.speakText(result);
    if (cancelled) return;
    setState('ready');
  } catch (err) {
    if (cancelled) return;
    showSubtitle(err.message || 'Brainstorm failed.');
    setState('error');
    setTimeout(() => setState('ready'), 3000);
  }

  busy = false;
  brainstormMode = null;
}

// ── Main listen pipeline ──────────────────────────────────────

async function listen() {
  if (busy) return;
  busy = true;
  cancelled = false;
  setState('listening');

  // Flag set inside try — acted on in finally to avoid busy race condition
  let shouldRelisten = false;

  try {
    const rawBuf = await recordUntilSilence();
    if (cancelled) return;

    setState('thinking');
    // Convert to WAV before sending — Whisper rejects malformed WebM containers
    let buf, isWav = true;
    try { buf = await toWav(rawBuf); }
    catch (_) { buf = rawBuf; isWav = false; } // fall back to raw webm if decode fails
    const result = await window.axiom.transcribeAudio(buf, isWav);
    if (cancelled) return;

    if (result.error === 'no-speech' || !result.text?.trim()) {
      setState('ready');
      return;
    }
    if (result.error === 'voice-not-authorized') {
      orb.setState('error');
      await window.axiom.speakText('Voice not recognized.');
      setState('ready');
      return;
    }
    if (result.error) {
      showSubtitle(`Transcription error: ${result.error}`);
      setState('error');
      setTimeout(() => setState('ready'), 3000);
      return;
    }

    showSubtitle(result.text);

    let response;
    if (pendingShot) {
      const shot = pendingShot; pendingShot = null;
      response = await window.axiom.sendToClaudeWithScreen(result.text, shot);
    } else if (needsScreen(result.text)) {
      const cap = await window.axiom.captureScreen();
      response = (cap && cap.ok)
        ? await window.axiom.sendToClaudeWithScreen(result.text, cap.base64)
        : await window.axiom.sendToClaude(result.text);
    } else {
      response = await window.axiom.sendToClaude(result.text);
    }

    // Support both legacy string replies and new { speech, needsReply } objects
    const reply      = typeof response === 'string' ? response : response.speech;
    const needsReply = typeof response === 'object' && response.needsReply;

    if (cancelled) return;
    showSubtitle(reply);
    setState('speaking');
    await window.axiom.speakText(reply);
    if (cancelled) return;

    // Auto-reopen mic if AXIOM asked a question or needs more input
    // IMPORTANT: do NOT set busy=false here — let finally handle it exclusively
    // to avoid a race where finally overwrites the next listen()'s busy=true
    if (needsReply) {
      shouldRelisten = true;
      setState('listening');
      return;
    }

    setState('ready');
  } catch (err) {
    if (cancelled) return;
    showSubtitle(err.message || 'Something went wrong.');
    setState('error');
    setTimeout(() => setState('ready'), 3000);
  } finally {
    // Single authoritative place that clears busy
    busy = false;
    // Trigger follow-up listen AFTER busy is cleared — no race condition
    if (shouldRelisten && !cancelled) {
      setTimeout(() => { if (!busy) listen(); }, 350);
    }
  }
}

// ── Interactions ──────────────────────────────────────────────

// Hold-and-drag to move window; quick release = click
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  let startX = e.screenX;
  let startY = e.screenY;
  let dragging = false;

  const onMove = (ev) => {
    const dx = ev.screenX - startX;
    const dy = ev.screenY - startY;
    if (!dragging && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
      dragging = true;
      orb.setPaused(true);
    }
    if (dragging) {
      window.axiom.moveWindowBy(dx, dy);
      startX = ev.screenX;
      startY = ev.screenY;
    }
  };

  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    if (dragging) {
      orb.setPaused(false);
    } else {
      // Quick release = click
      window.axiom.userActive && window.axiom.userActive();
      if (busy) cancelAll(); else listen();
    }
    dragging = false;
  };

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
});


// Pause orb while the window is being dragged for smooth movement
if (window.axiom.onWindowMoving) {
  window.axiom.onWindowMoving((moving) => {
    orb.setPaused(moving);
    if (!moving) orb.start(); // restart the RAF loop after drag ends
  });
}

// ── Platform events ───────────────────────────────────────────

setState('ready');

if (window.axiom.onWakeWord) {
  window.axiom.onWakeWord(() => { if (!busy) listen(); });
}

if (window.axiom.onScreenHotkey) {
  window.axiom.onScreenHotkey((base64) => {
    pendingShot = base64 || null;
    showSubtitle('Screenshot captured — ask me about it.');
    if (!busy) listen();
  });
}

if (window.axiom.onBrainstormStart) {
  window.axiom.onBrainstormStart((mode) => { if (!busy) listenBrainstorm(mode); });
}

if (window.axiom.onProactive) {
  window.axiom.onProactive((text) => showSubtitle(text));
}

if (window.axiom.onBriefing) {
  window.axiom.onBriefing((text) => {
    showSubtitle(text);
    setState('speaking');
    setTimeout(() => setState('ready'), Math.min(15000, 2000 + text.length * 60));
  });
}

// ── Interrupt ("stop") — wakeword detected while AXIOM is speaking ──
if (window.axiom.onInterrupted) {
  window.axiom.onInterrupted(() => {
    cancelAll();
    // Short pause then start listening so user can give next command
    setTimeout(() => { if (!busy) listen(); }, 400);
  });
}
