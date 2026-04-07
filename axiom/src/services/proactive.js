// Proactive companion loop — fires check-ins, break suggestions, and
// pattern references when the conditions are right.
//
// Deps injected via start({ speak, sendToRenderer, generateProactive }).

const memory = require('./memory.js');

const CHECK_INTERVAL_MS      = 60 * 1000;        // scan every minute
const SILENCE_THRESHOLD_MS   = 45 * 60 * 1000;   // 45 min of no interaction
const LONG_SESSION_MS        = 3  * 60 * 60 * 1000; // 3 hours
const BREAK_COOLDOWN_MS      = 90 * 60 * 1000;   // don't nag more than every 90 min
const PROACTIVE_COOLDOWN_MS  = 25 * 60 * 1000;   // at least 25 min between any two proactive lines

let checkTimer = null;
let deps = null;
let running = false;

// ── Quiet hours ─────────────────────────────────────────────
function parseHour(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 && n <= 23 ? n : fallback;
}

function inQuietHours() {
  const start = parseHour(process.env.QUIET_HOURS_START, 23);
  const end   = parseHour(process.env.QUIET_HOURS_END, 8);
  const h = new Date().getHours();
  // Wrap-around support (e.g. 23 → 8)
  if (start === end) return false;
  if (start < end) return h >= start && h < end;
  return h >= start || h < end;
}

function isQuietMode() {
  return !!memory.getSession().quietMode;
}

function canFire(kind) {
  if (!running) return false;
  if (isQuietMode()) return false;
  if (inQuietHours()) return false;
  // Don't interrupt during active focus sessions
  try {
    const pomodoro = require('./pomodoro.js');
    if (pomodoro.isFocusing()) return false;
  } catch {}


  const s = memory.getSession();
  const now = Date.now();

  if (kind !== 'morning' && now - (s.lastProactiveAt || 0) < PROACTIVE_COOLDOWN_MS) return false;
  if (kind === 'break' && now - (s.lastBreakSuggestedAt || 0) < BREAK_COOLDOWN_MS) return false;
  return true;
}

// ── Speaking helper ─────────────────────────────────────────
async function say(kind, text) {
  if (!text) return;
  memory.markProactive(kind);
  try {
    deps.sendToRenderer && deps.sendToRenderer(text);
  } catch (err) {
    console.error('[AXIOM proactive] renderer send failed:', err.message);
  }
  try {
    await deps.speak(text);
  } catch (err) {
    console.error('[AXIOM proactive] speak failed:', err.message);
  }
}

// ── Generation ──────────────────────────────────────────────
async function generate(kind, extra) {
  try {
    return await deps.generateProactive(kind, extra);
  } catch (err) {
    console.error('[AXIOM proactive] generation failed:', err.message);
    // Fallback lines so it's never silent if Claude is unreachable
    const fallbacks = {
      silence: "Hey, just checking in. Still going?",
      break:   "You've been at this a while. Maybe step away for ten minutes?",
      morning: "Alright, let's make today a good one.",
      pattern: "You've been deep in this one all week. How's it shaping up?",
    };
    return fallbacks[kind] || fallbacks.silence;
  }
}

// ── Scan loop ───────────────────────────────────────────────
async function scan() {
  if (!running) return;
  const s = memory.getSession();
  const now = Date.now();

  // 1) Long session → break suggestion
  if (s.sessionStart && now - s.sessionStart > LONG_SESSION_MS && canFire('break')) {
    const hrs = Math.floor((now - s.sessionStart) / (60 * 60 * 1000));
    const line = await generate('break', { hours: hrs });
    await say('break', line);
    return;
  }

  // 2) Silence → check-in
  if (s.lastInteractionAt && now - s.lastInteractionAt > SILENCE_THRESHOLD_MS && canFire('silence')) {
    const mins = Math.floor((now - s.lastInteractionAt) / 60000);
    const line = await generate('silence', { minutes: mins });
    await say('silence', line);
    return;
  }
}

// ── Public API ──────────────────────────────────────────────
function start(injected) {
  if (running) return;
  deps = injected;
  running = true;
  memory.startSession();
  checkTimer = setInterval(() => {
    scan().catch((err) => console.error('[AXIOM proactive] scan error:', err));
  }, CHECK_INTERVAL_MS);
  console.log('[AXIOM proactive] started');
}

function stop() {
  running = false;
  if (checkTimer) { clearInterval(checkTimer); checkTimer = null; }
  deps = null;
}

function recordInteraction() {
  memory.recordInteraction();
}

function setQuietMode(on) {
  memory.setQuietMode(on);
}

async function morningMotivation() {
  if (!running) return;
  const session = memory.getSession();
  const today = new Date().toDateString();
  if (session.lastMorningMotivationDate === today) return;
  if (!canFire('morning')) return;

  const line = await generate('morning', {});
  await say('morning', line);

  // Mark as done for today
  memory.getSession().lastMorningMotivationDate = today;
  memory.setMood(memory.getMood()); // triggers a save
}

async function checkRecurringPattern() {
  if (!running) return;
  if (!canFire('pattern')) return;
  const topics = memory.getRecurringTopics(3);
  if (!topics.length) return;
  const line = await generate('pattern', { topics });
  await say('pattern', line);
}

module.exports = {
  start, stop,
  recordInteraction, setQuietMode,
  morningMotivation, checkRecurringPattern,
};
