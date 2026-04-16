// Voice notes — persistent, categorized, date-organized
// Stored in: %APPDATA%/axiom/notes.json

const fs       = require('fs');
const path     = require('path');
const { app }  = require('electron');
const obsidian = require('./obsidian-sync.js');

const NOTES_FILE = path.join(app.getPath('userData'), 'notes.json');

// ── Persistence ───────────────────────────────────────────────

function load() {
  try {
    if (fs.existsSync(NOTES_FILE)) {
      const raw = fs.readFileSync(NOTES_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch {}
  return { notes: [] };
}

function save(data) {
  fs.writeFileSync(NOTES_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ── Helpers ───────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ── Public API ────────────────────────────────────────────────

/**
 * Add a note. category must be one of: idea | reminder | todo | random
 * Returns the saved note object.
 */
function add(content, category = 'random') {
  const data = load();
  const note = {
    id:        Date.now(),
    timestamp: new Date().toISOString(),
    date:      todayStr(),
    content:   content.trim(),
    category:  ['idea', 'reminder', 'todo', 'random'].includes(category) ? category : 'random',
  };
  data.notes.push(note);
  save(data);
  // Mirror today's notes to Obsidian vault
  obsidian.syncNotes(data.notes.filter(n => n.date === note.date), note.date);
  return note;
}

/** All notes for today, sorted chronologically. */
function getToday() {
  const { notes } = load();
  const today = todayStr();
  return notes.filter((n) => n.date === today).sort((a, b) => a.id - b.id);
}

/** All notes for yesterday. */
function getYesterday() {
  const { notes } = load();
  const yesterday = yesterdayStr();
  return notes.filter((n) => n.date === yesterday);
}

/** All notes ever, sorted newest first. */
function getAll() {
  const { notes } = load();
  return [...notes].sort((a, b) => b.id - a.id);
}

/** Total count. */
function count() {
  return load().notes.length;
}

/** Count for a specific date string (YYYY-MM-DD). */
function countForDate(dateStr) {
  return load().notes.filter((n) => n.date === dateStr).length;
}

/** Delete all notes for today. Returns how many were removed. */
function clearToday() {
  const data  = load();
  const today = todayStr();
  const before = data.notes.length;
  data.notes = data.notes.filter((n) => n.date !== today);
  save(data);
  return before - data.notes.length;
}

/** Delete every note. */
function clearAll() {
  save({ notes: [] });
}

/**
 * Format a list of notes into a spoken string.
 * Groups by category, reads content naturally.
 */
function formatForSpeech(notes) {
  if (!notes.length) return null;

  // Group by category
  const groups = {};
  for (const n of notes) {
    (groups[n.category] || (groups[n.category] = [])).push(n);
  }

  const parts = [];
  const ORDER = ['todo', 'reminder', 'idea', 'random'];
  for (const cat of ORDER) {
    if (!groups[cat]) continue;
    const label = cat === 'todo' ? 'to-dos' : cat + 's';
    const items = groups[cat].map((n) => `"${n.content}" at ${formatTime(n.timestamp)}`);
    if (items.length === 1) {
      parts.push(`One ${cat === 'todo' ? 'to-do' : cat}: ${items[0]}.`);
    } else {
      parts.push(`${items.length} ${label}: ${items.join('; ')}.`);
    }
  }

  return parts.join(' ');
}

module.exports = {
  add,
  getToday,
  getYesterday,
  getAll,
  count,
  countForDate,
  clearToday,
  clearAll,
  formatForSpeech,
  todayStr,
  yesterdayStr,
};
