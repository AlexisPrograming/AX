const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const MEMORY_FILE = path.join(app.getPath('userData'), 'memory.json');
const MAX_HISTORY = 10;

const DEFAULT_MEMORY = {
  user: {
    name: 'Alexis',
    projects: ['PULSE health app', 'AXIOM'],
    stack: ['Next.js', 'Supabase', 'TypeScript', 'Tailwind', 'Vercel', 'Anthropic API'],
  },
  facts: [],
  history: [],
  session: {
    mood: 'neutral',
    moodUpdatedAt: 0,
    quietMode: false,
    sessionStart: 0,
    lastInteractionAt: 0,
    lastProactiveAt: 0,
    lastBreakSuggestedAt: 0,
    lastMorningMotivationDate: '',
    lastOpenedDate: '',
  },
  activity: {}, // date (YYYY-MM-DD) → [topic strings pulled from user messages]
};

let memory = null;

function load() {
  if (memory) return memory;

  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const raw = fs.readFileSync(MEMORY_FILE, 'utf-8');
      memory = JSON.parse(raw);
      // Backfill missing keys from defaults
      memory.user = { ...DEFAULT_MEMORY.user, ...memory.user };
      memory.facts = memory.facts || [];
      memory.history = memory.history || [];
      memory.session = { ...DEFAULT_MEMORY.session, ...(memory.session || {}) };
      memory.activity = memory.activity || {};
    } else {
      memory = structuredClone(DEFAULT_MEMORY);
      save();
    }
  } catch {
    memory = structuredClone(DEFAULT_MEMORY);
  }

  return memory;
}

function save() {
  try {
    const dir = path.dirname(MEMORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2), 'utf-8');
  } catch (err) {
    console.error('[AXIOM memory] Failed to save:', err.message);
  }
}

function addExchange(userMsg, assistantMsg) {
  load();
  memory.history.push({
    user: userMsg,
    assistant: assistantMsg,
    ts: Date.now(),
  });
  // Keep only the last N exchanges
  if (memory.history.length > MAX_HISTORY) {
    memory.history = memory.history.slice(-MAX_HISTORY);
  }
  save();
}

function addFact(fact) {
  load();
  const lower = fact.toLowerCase();
  if (!memory.facts.some((f) => f.toLowerCase() === lower)) {
    memory.facts.push(fact);
    save();
  }
}

function getRecentHistory() {
  load();
  return memory.history;
}

function getContextBlock() {
  load();
  const parts = [];

  // User profile
  const u = memory.user;
  parts.push(`USER PROFILE:\n- Name: ${u.name}\n- Projects: ${u.projects.join(', ')}\n- Stack: ${u.stack.join(', ')}`);

  // Stored facts
  if (memory.facts.length > 0) {
    parts.push(`REMEMBERED FACTS:\n${memory.facts.map((f) => `- ${f}`).join('\n')}`);
  }

  // Recent conversation summary
  if (memory.history.length > 0) {
    const recent = memory.history.slice(-5).map((h) =>
      `User: ${h.user}\nAXIOM: ${h.assistant}`
    );
    parts.push(`RECENT CONVERSATION:\n${recent.join('\n\n')}`);
  }

  return parts.join('\n\n');
}

function clear() {
  memory = structuredClone(DEFAULT_MEMORY);
  save();
}

function updateUser(updates) {
  load();
  Object.assign(memory.user, updates);
  save();
}

function setMood(mood) {
  load();
  memory.session.mood = mood;
  memory.session.moodUpdatedAt = Date.now();
  save();
}

function getMood() {
  load();
  return memory.session.mood || 'neutral';
}

// ── Session + activity tracking ───────────────────────────
function startSession() {
  load();
  memory.session.sessionStart = Date.now();
  memory.session.lastInteractionAt = Date.now();
  memory.session.lastBreakSuggestedAt = 0;
  save();
}

function recordInteraction() {
  load();
  memory.session.lastInteractionAt = Date.now();
  save();
}

function markProactive(kind) {
  load();
  memory.session.lastProactiveAt = Date.now();
  if (kind === 'break') memory.session.lastBreakSuggestedAt = Date.now();
  save();
}

function getSession() {
  load();
  return memory.session;
}

function setQuietMode(on) {
  load();
  memory.session.quietMode = !!on;
  save();
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const STOPWORDS = new Set(['the','a','an','and','or','to','of','on','in','for','with','this','that','is','it','i','my','me','do','you','can','ax','axiom','hey','please','just','then','now','okay']);

function extractTopics(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
    .slice(0, 6);
}

function recordActivity(userText) {
  load();
  const key = todayKey();
  const bag = new Set(memory.activity[key] || []);
  for (const t of extractTopics(userText)) bag.add(t);
  memory.activity[key] = [...bag].slice(-30);

  // Prune old days (keep last 14)
  const keys = Object.keys(memory.activity).sort();
  while (keys.length > 14) {
    delete memory.activity[keys.shift()];
  }
  save();
}

// Return topics that appear on the last N consecutive days including today
function getRecurringTopics(days = 3) {
  load();
  const dates = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  const sets = dates.map((k) => new Set(memory.activity[k] || []));
  if (sets.some((s) => s.size === 0)) return [];
  const [first, ...rest] = sets;
  return [...first].filter((t) => rest.every((s) => s.has(t)));
}

// ── Opened-today tracking (skips repeated briefing) ──────────
function wasOpenedToday() {
  load();
  return memory.session.lastOpenedDate === todayKey();
}

function markOpenedToday() {
  load();
  memory.session.lastOpenedDate = todayKey();
  save();
}

module.exports = {
  load, addExchange, addFact, getRecentHistory, getContextBlock, clear, updateUser,
  setMood, getMood,
  startSession, recordInteraction, markProactive, getSession, setQuietMode,
  recordActivity, getRecurringTopics,
  wasOpenedToday, markOpenedToday,
};
