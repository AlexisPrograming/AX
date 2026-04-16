// AXIOM Evolution Layer
// AXIOM can write to this file to adjust its own behavior over time.
// Loaded on every startup and injected into the system prompt.

const path = require('path');
const fs   = require('fs');

const DATA_FILE = path.join(require('os').homedir(), 'Documents', 'AXIOM', 'evolution.json');

const MAX_PATTERNS  = 40;  // cap so prompt doesn't grow unbounded
const MAX_NOTES     = 20;

let data = null;

// data shape:
// {
//   styleNotes:    [{ note, ts }],   ← how to communicate with Alexis
//   patterns:      [{ observed, adjustment, ts }],  ← behavioral patterns
//   preferences:   { [key]: value }, ← simple key/value preferences
// }

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch {}
  if (!data) {
    data = { styleNotes: [], patterns: [], preferences: {} };
  }
  // Ensure all fields exist (backwards compat)
  if (!data.styleNotes)  data.styleNotes  = [];
  if (!data.patterns)    data.patterns    = [];
  if (!data.preferences) data.preferences = {};
}

function save() {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[AXIOM evolution] save failed:', err.message);
  }
}

// Called by brain.js when AXIOM emits an "evolve" action
function applyEvolution(entry) {
  if (!data) load();

  if (entry.type === 'style') {
    // Deduplicate similar notes
    const note = (entry.note || '').trim();
    if (!note) return;
    if (!data.styleNotes.some(n => n.note === note)) {
      data.styleNotes.push({ note, ts: Date.now() });
      if (data.styleNotes.length > MAX_NOTES) data.styleNotes.shift();
    }
  }

  if (entry.type === 'pattern') {
    const observed   = (entry.observed   || '').trim();
    const adjustment = (entry.adjustment || '').trim();
    if (!observed || !adjustment) return;
    // Overwrite if same observation already stored
    const idx = data.patterns.findIndex(p => p.observed === observed);
    if (idx >= 0) {
      data.patterns[idx] = { observed, adjustment, ts: Date.now() };
    } else {
      data.patterns.push({ observed, adjustment, ts: Date.now() });
      if (data.patterns.length > MAX_PATTERNS) data.patterns.shift();
    }
  }

  if (entry.type === 'preference') {
    const key   = (entry.key   || '').trim();
    const value = (entry.value || '').trim();
    if (key) data.preferences[key] = value;
  }

  save();
}

// Returns the block injected into the system prompt
function getEvolutionBlock() {
  if (!data) load();

  const lines = [];

  if (data.styleNotes.length) {
    lines.push('SELF-LEARNED STYLE ADJUSTMENTS (apply these):');
    data.styleNotes.forEach(n => lines.push(`- ${n.note}`));
  }

  if (data.patterns.length) {
    lines.push('SELF-LEARNED BEHAVIOR PATTERNS (apply these):');
    data.patterns.forEach(p => lines.push(`- When ${p.observed} → ${p.adjustment}`));
  }

  const prefKeys = Object.keys(data.preferences);
  if (prefKeys.length) {
    lines.push('LEARNED PREFERENCES:');
    prefKeys.forEach(k => lines.push(`- ${k}: ${data.preferences[k]}`));
  }

  if (!lines.length) return '';
  return lines.join('\n');
}

function getAll() { return data; }

module.exports = { load, applyEvolution, getEvolutionBlock, getAll };
