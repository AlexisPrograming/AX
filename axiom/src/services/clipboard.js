const { clipboard } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_HISTORY = 5;
let history = [];

// Read current clipboard text and track it in history
function read() {
  const text = clipboard.readText();
  if (text && text.trim()) {
    _track(text.trim());
  }
  return text;
}

// Write text to clipboard
function write(text) {
  clipboard.writeText(text || '');
}

// Internal: add text to front of history, no duplicates of consecutive entries
function _track(text) {
  if (!text) return;
  if (history.length > 0 && history[0] === text) return;
  history.unshift(text);
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
}

// Returns a copy of the history array (newest first)
function getHistory() {
  return [...history];
}

// Returns the second-most-recent clipboard item, or null if only one exists
function getPrevious() {
  return history.length > 1 ? history[1] : null;
}

// Save text to Documents/AXIOM/<timestamp>.txt
// Returns the full file path on success
function saveToFile(text) {
  const dir = path.join(os.homedir(), 'Documents', 'AXIOM');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(dir, `AXIOM_${stamp}.txt`);
  fs.writeFileSync(file, text, 'utf8');
  return file;
}

module.exports = { read, write, getHistory, getPrevious, saveToFile };
