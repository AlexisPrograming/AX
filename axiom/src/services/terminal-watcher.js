// Terminal error watcher — two detection modes:
//  1. Log file: watches a file the user pipes terminal output into
//  2. Clipboard: polls clipboard for copied errors (zero setup)
//
// Deps injected via init({ speak, explainError, onError })

const fs   = require('fs');
const path = require('path');
const { app, clipboard } = require('electron');

// ── Config ────────────────────────────────────────────────────

const DEFAULT_LOG = path.join(app.getPath('userData'), 'terminal.log');
const LOG_PATH    = process.env.TERMINAL_LOG_PATH || DEFAULT_LOG;

const DEBOUNCE_MS      = 2000;   // wait 2s for error cascade to settle
const CLIPBOARD_MS     = 1500;   // poll clipboard every 1.5s
const DEDUP_WINDOW_MS  = 30000;  // ignore same error for 30s

// ── Error patterns ────────────────────────────────────────────

const ERROR_PATTERNS = [
  /\bTypeError\b/,
  /\bSyntaxError\b/,
  /\bReferenceError\b/,
  /\bRangeError\b/,
  /\bError:/,
  /\bCannot find module\b/,
  /\bis not defined\b/,
  /\bENOENT\b/,
  /\bECONNREFUSED\b/,
  /\bEACCES\b/,
  /\bEADDRINUSE\b/,
  /\bnpm ERR!\b/,
  /\bfailed with exit code\b/i,
  /\bUncaughtException\b/,
  /\bUnhandledPromiseRejection\b/i,
  /\bSEGFAULT\b/i,
  // ANSI red foreground codes (\x1b[31m or \x1b[91m)
  /\x1b\[(?:31|91)m/,
];

function looksLikeError(text) {
  if (!text || text.length < 10) return false;
  return ERROR_PATTERNS.some((re) => re.test(text));
}

// Strip ANSI escape codes for clean text to send to Claude
function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\[[0-9]*[A-Za-z]/g, '');
}

// Extract the most relevant lines (error line + up to 8 lines of context)
function extractErrorBlock(text) {
  const lines  = stripAnsi(text).split('\n').map((l) => l.trim()).filter(Boolean);
  const errors = [];

  for (let i = 0; i < lines.length; i++) {
    if (ERROR_PATTERNS.some((re) => re.test(lines[i]))) {
      const start = Math.max(0, i - 1);
      const end   = Math.min(lines.length, i + 8);
      errors.push(lines.slice(start, end).join('\n'));
    }
  }

  return errors.length ? errors[errors.length - 1] : lines.slice(-6).join('\n');
}

// Simple hash for deduplication
function hashError(text) {
  let h = 0;
  for (const c of text.slice(0, 200)) h = ((h << 5) - h + c.charCodeAt(0)) | 0;
  return h.toString(36);
}

// ── State ─────────────────────────────────────────────────────

let deps           = null;
let watching       = false;
let fileWatcher    = null;
let clipboardTimer = null;
let debounceTimer  = null;
let filePosition   = 0;
let lastErrorHash  = null;
let lastErrorTime  = 0;
let lastErrorText  = null;
let lastClipboard  = '';

// ── Core dispatch ─────────────────────────────────────────────

function scheduleError(rawText) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const block = extractErrorBlock(rawText);
    const hash  = hashError(block);

    // Deduplicate — skip if same error within 30s
    if (hash === lastErrorHash && Date.now() - lastErrorTime < DEDUP_WINDOW_MS) return;
    lastErrorHash = hash;
    lastErrorTime = Date.now();
    lastErrorText = block;

    deps?.onError && deps.onError(block);
  }, DEBOUNCE_MS);
}

// ── Log file watcher ──────────────────────────────────────────

function startFileWatch() {
  // Create the file if it doesn't exist
  if (!fs.existsSync(LOG_PATH)) {
    try { fs.writeFileSync(LOG_PATH, ''); } catch {}
  }

  try {
    filePosition = fs.statSync(LOG_PATH).size; // start at end
  } catch { filePosition = 0; }

  fileWatcher = fs.watch(LOG_PATH, () => {
    try {
      const stat = fs.statSync(LOG_PATH);
      if (stat.size <= filePosition) return; // truncated — reset
      const fd  = fs.openSync(LOG_PATH, 'r');
      const len = stat.size - filePosition;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, filePosition);
      fs.closeSync(fd);
      filePosition = stat.size;

      const chunk = buf.toString('utf8');
      if (looksLikeError(chunk)) scheduleError(chunk);
    } catch {}
  });

  console.log(`[AXIOM terminal] watching log file: ${LOG_PATH}`);
}

function stopFileWatch() {
  if (fileWatcher) { fileWatcher.close(); fileWatcher = null; }
}

// ── Clipboard watcher ─────────────────────────────────────────

function startClipboardWatch() {
  lastClipboard = clipboard.readText();
  clipboardTimer = setInterval(() => {
    try {
      const text = clipboard.readText();
      if (text === lastClipboard) return;
      lastClipboard = text;
      if (text.length > 20 && looksLikeError(text)) {
        scheduleError(text);
      }
    } catch {}
  }, CLIPBOARD_MS);
}

function stopClipboardWatch() {
  if (clipboardTimer) { clearInterval(clipboardTimer); clipboardTimer = null; }
}

// ── Public API ────────────────────────────────────────────────

function init(injected) {
  deps = injected;
}

function start() {
  if (watching) return;
  watching = true;
  startFileWatch();
  startClipboardWatch();
  console.log('[AXIOM terminal] error watching started');
}

function stop() {
  if (!watching) return;
  watching = false;
  stopFileWatch();
  stopClipboardWatch();
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  console.log('[AXIOM terminal] error watching stopped');
}

function isWatching() { return watching; }

function getLastError() { return lastErrorText; }

function getLogPath() { return LOG_PATH; }

function shutdown() { stop(); }

module.exports = { init, start, stop, isWatching, getLastError, getLogPath, shutdown };
