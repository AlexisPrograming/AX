// Pomodoro focus mode — timer logic, session tracking, spoken cues
// Deps injected via start({ speak, onTrayUpdate })

const WORK_MINUTES      = 25;
const SHORT_BREAK_MIN   = 5;
const LONG_BREAK_MIN    = 15;
const SESSIONS_PER_LONG = 4;      // long break after this many work sessions
const WARN_AT_SECONDS   = 10 * 60; // 10-minute warning

let deps         = null;
let tickTimer    = null;

// ── State ─────────────────────────────────────────────────────
const state = {
  phase:          'idle',   // 'idle' | 'work' | 'break' | 'long_break'
  remaining:      0,        // seconds
  totalSeconds:   0,        // total seconds for current phase
  paused:         false,
  warnedAt10:     false,
  sessionsToday:  0,        // completed work sessions today
  sessionDate:    null,     // YYYY-MM-DD — resets counter on new day
};

// ── Helpers ───────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function checkDayRollover() {
  const today = todayStr();
  if (state.sessionDate !== today) {
    state.sessionsToday = 0;
    state.sessionDate   = today;
  }
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function minuteWord(n) {
  return `${n} minute${n !== 1 ? 's' : ''}`;
}

async function say(text) {
  if (!deps?.speak || !text) return;
  try { await deps.speak(text); } catch {}
}

function updateTray() {
  if (!deps?.onTrayUpdate) return;
  try {
    if (state.phase === 'idle') {
      deps.onTrayUpdate(null);
    } else {
      const label = state.phase === 'work' ? 'Focus' : 'Break';
      const paused = state.paused ? ' ⏸' : '';
      deps.onTrayUpdate(`${label}: ${formatTime(state.remaining)}${paused}`);
    }
  } catch {}
}

// ── Tick ─────────────────────────────────────────────────────

function tick() {
  if (state.paused || state.phase === 'idle') return;

  state.remaining -= 1;
  updateTray();

  // 10-minute warning during work phase
  if (state.phase === 'work' && !state.warnedAt10 && state.remaining === WARN_AT_SECONDS) {
    state.warnedAt10 = true;
    say("10 minutes left. You're doing great, keep going.");
    return;
  }

  if (state.remaining <= 0) {
    onPhaseEnd();
  }
}

async function onPhaseEnd() {
  stopTick();

  if (state.phase === 'work') {
    checkDayRollover();
    state.sessionsToday += 1;
    const count = state.sessionsToday;

    if (count % SESSIONS_PER_LONG === 0) {
      // Long break
      await say(`${count} sessions done. Take ${minuteWord(LONG_BREAK_MIN)}. Seriously, step away from the screen.`);
      startPhase('long_break', LONG_BREAK_MIN);
    } else {
      await say(`Time's up! Take a ${minuteWord(SHORT_BREAK_MIN)} break. You earned it.`);
      startPhase('break', SHORT_BREAK_MIN);
    }
  } else if (state.phase === 'break' || state.phase === 'long_break') {
    await say("Break's over. Ready for another round?");
    // Don't auto-start — wait for user to say "focus mode" again
    state.phase   = 'idle';
    state.remaining = 0;
    updateTray();
  }
}

function startTick() {
  stopTick();
  tickTimer = setInterval(tick, 1000);
}

function stopTick() {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
}

function startPhase(phase, minutes) {
  state.phase       = phase;
  state.remaining   = minutes * 60;
  state.totalSeconds = state.remaining;
  state.paused      = false;
  state.warnedAt10  = false;
  updateTray();
  startTick();
}

// ── Public API ────────────────────────────────────────────────

function init(injected) {
  deps = injected;
  checkDayRollover();
}

/**
 * Start a work session.
 * Returns the spoken confirmation string.
 */
async function start(minutes = WORK_MINUTES) {
  const mins = Math.max(1, Math.min(120, parseInt(minutes) || WORK_MINUTES));
  checkDayRollover();
  startPhase('work', mins);
  const line = `Focus mode activated. ${minuteWord(mins)}. Let's get it.`;
  await say(line);
  return line;
}

function stop() {
  stopTick();
  const was = state.phase;
  state.phase     = 'idle';
  state.remaining = 0;
  state.paused    = false;
  updateTray();
  return was !== 'idle';
}

function pause() {
  if (state.phase === 'idle' || state.paused) return false;
  state.paused = true;
  updateTray();
  return true;
}

function resume() {
  if (state.phase === 'idle' || !state.paused) return false;
  state.paused = false;
  updateTray();
  return true;
}

function isActive() {
  return state.phase !== 'idle';
}

/** Returns true specifically during a work phase (not break) — used to suppress proactive. */
function isFocusing() {
  return state.phase === 'work' && !state.paused;
}

function timeLeftText() {
  if (state.phase === 'idle') return null;
  const label = state.phase === 'work' ? 'work session' : 'break';
  const paused = state.paused ? ' (paused)' : '';
  return `${formatTime(state.remaining)} left in your ${label}${paused}.`;
}

function sessionsSummary() {
  checkDayRollover();
  const n = state.sessionsToday;
  if (n === 0) return "No focus sessions completed yet today.";
  return `You've completed ${n} focus session${n > 1 ? 's' : ''} today.`;
}

function shutdown() {
  stopTick();
}

module.exports = {
  init,
  start,
  stop,
  pause,
  resume,
  isActive,
  isFocusing,
  timeLeftText,
  sessionsSummary,
  shutdown,
};
