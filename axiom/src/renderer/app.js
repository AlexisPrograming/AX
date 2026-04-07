const messagesEl = document.getElementById('messages');
const waveformEl = document.getElementById('waveform');
const statusBar = document.getElementById('statusbar');
const statusText = document.getElementById('status-text');
const micBtn = document.getElementById('mic-btn');
const closeBtn = document.getElementById('close-btn');

let busy = false;
let cancelled = false;

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
  window.axiom.stopListening();
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
    const result = await window.axiom.startListening();

    if (cancelled) return;

    if (result.error === 'no-speech' || result.error === 'timeout') {
      addMessage('system', 'No speech detected. Tap the mic to try again.');
      setState('ready');
      busy = false;
      return;
    }

    if (result.error) {
      addMessage('system', `Speech error: ${result.error}`);
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
