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

module.exports = { load, addExchange, addFact, getRecentHistory, getContextBlock, clear, updateUser };
