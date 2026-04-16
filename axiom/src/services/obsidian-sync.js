// AXIOM → Obsidian sync
// Saves meaningful conversations and remembered facts to your Obsidian vault.
//
// WHAT GETS SAVED:
//   • Conversations where AXIOM replied with > 35 words   (real talk, not commands)
//   • Conversations where AXIOM replied with > 120 words  → also go to highlights.md
//   • Every time you say "remember this" or "note this"   → facts.md (always)
//   • Voice notes you dictate                             → Notes/YYYY-MM-DD.md
//
// WHAT IS SKIPPED:
//   • Short command confirmations ("Opening Chrome.", "Pausing music.", "Done.")
//
// Setup: add ONE line to your .env file:
//   OBSIDIAN_VAULT_PATH=C:\Users\alexi\Documents\MyVault
//
// Folder structure created inside the vault:
//   AXIOM/
//     Conversations/YYYY-MM-DD.md   — substantial daily exchanges
//     Memory/facts.md               — everything you told AXIOM to remember
//     Memory/highlights.md          — long / especially rich conversations
//     Notes/YYYY-MM-DD.md           — voice notes

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Thresholds ────────────────────────────────────────────────
const MIN_WORDS_TO_LOG       = 35;   // skip short command confirmations
const MIN_WORDS_FOR_HIGHLIGHT = 120;  // very long → also goes to highlights

// ── Helpers ───────────────────────────────────────────────────

function vaultPath() {
  return process.env.OBSIDIAN_VAULT_PATH || null;
}

function axiomDir() {
  const vault = vaultPath();
  return vault ? path.join(vault, 'AXIOM') : null;
}

function ensure(dir) {
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch {}
}

function isEnabled() {
  if (!vaultPath()) {
    if (!isEnabled._warned) {
      isEnabled._warned = true;
      console.log('[AXIOM obsidian] OBSIDIAN_VAULT_PATH not set — sync disabled. Add it to .env to enable.');
    }
    return false;
  }
  return true;
}
isEnabled._warned = false;

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function timeStr(ts = Date.now()) {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

// Strip the JSON action line AXIOM prepends to PC-control responses
function stripActionJson(text) {
  return (text || '').replace(/^\s*[\[{].*?[\]}]\s*/s, '').trim();
}

function wordCount(text) {
  return stripActionJson(text).split(/\s+/).filter(Boolean).length;
}

// ── Conversation log ──────────────────────────────────────────
// Writes to:  AXIOM/Conversations/YYYY-MM-DD.md
// Skips:      exchanges where AXIOM said < MIN_WORDS_TO_LOG words
// Highlights: exchanges > MIN_WORDS_FOR_HIGHLIGHT words also go to highlights.md

function logExchange(userMsg, assistantMsg, ts = Date.now()) {
  if (!isEnabled()) return;

  const cleanResponse = stripActionJson(assistantMsg);
  const words         = wordCount(assistantMsg);

  // Skip trivial command confirmations
  if (words < MIN_WORDS_TO_LOG) return;

  try {
    const today = todayStr();
    const time  = timeStr(ts);

    // ── Daily conversation file ───────────────────────────────
    const convDir  = path.join(axiomDir(), 'Conversations');
    ensure(convDir);
    const convFile = path.join(convDir, `${today}.md`);

    if (!fs.existsSync(convFile)) {
      fs.writeFileSync(convFile, [
        '---',
        `date: ${today}`,
        'tags: [axiom, conversation]',
        '---',
        '',
        `# AXIOM Conversations — ${today}`,
        '',
      ].join('\n'), 'utf8');
    }

    const userLine = (userMsg || '').replace(/\n+/g, ' ').trim();
    const block = [
      `### ${time}`,
      '',
      `**Alexis:** ${userLine}`,
      '',
      `**AXIOM:** ${cleanResponse.replace(/\n+/g, ' ')}`,
      '',
      '---',
      '',
    ].join('\n');

    fs.appendFileSync(convFile, block, 'utf8');

    // ── Highlights file (long conversations only) ─────────────
    if (words >= MIN_WORDS_FOR_HIGHLIGHT) {
      appendHighlight(today, time, userLine, cleanResponse);
    }
  } catch (err) {
    console.error('[AXIOM obsidian] logExchange failed:', err.message);
  }
}

// Appends a summary block to AXIOM/Memory/highlights.md
function appendHighlight(date, time, userLine, cleanResponse) {
  try {
    const memDir = path.join(axiomDir(), 'Memory');
    ensure(memDir);
    const hlFile = path.join(memDir, 'highlights.md');

    if (!fs.existsSync(hlFile)) {
      fs.writeFileSync(hlFile, [
        '---',
        'tags: [axiom, highlights, memory]',
        '---',
        '',
        '# AXIOM — Conversation Highlights',
        '_Long or notable conversations are saved here automatically._',
        '',
      ].join('\n'), 'utf8');
    }

    const block = [
      `## ${date} · ${time}`,
      '',
      `> **Alexis:** ${userLine}`,
      '',
      cleanResponse,
      '',
      '---',
      '',
    ].join('\n');

    fs.appendFileSync(hlFile, block, 'utf8');
  } catch (err) {
    console.error('[AXIOM obsidian] appendHighlight failed:', err.message);
  }
}

// ── Facts file ────────────────────────────────────────────────
// Called every time you say "remember this" / "note this"
// Rewrites: AXIOM/Memory/facts.md

function syncFacts(facts) {
  if (!isEnabled()) return;
  try {
    const dir  = path.join(axiomDir(), 'Memory');
    ensure(dir);
    const file = path.join(dir, 'facts.md');
    const updated = new Date().toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

    const lines = [
      '---',
      'tags: [axiom, memory, facts]',
      '---',
      '',
      '# AXIOM — Remembered Facts',
      `_Last updated: ${updated}_`,
      '',
    ];

    if (!facts || !facts.length) {
      lines.push('_Nothing remembered yet._');
    } else {
      for (const f of facts) lines.push(`- ${f}`);
    }
    lines.push('');

    fs.writeFileSync(file, lines.join('\n'), 'utf8');
  } catch (err) {
    console.error('[AXIOM obsidian] syncFacts failed:', err.message);
  }
}

// ── Voice notes ───────────────────────────────────────────────
// Called every time you add a voice note
// Rewrites: AXIOM/Notes/YYYY-MM-DD.md

function syncNotes(notes, dateStr) {
  if (!isEnabled() || !notes || !notes.length) return;
  try {
    const dir  = path.join(axiomDir(), 'Notes');
    ensure(dir);
    const file = path.join(dir, `${dateStr}.md`);

    const groups = {};
    for (const n of notes) {
      (groups[n.category] || (groups[n.category] = [])).push(n);
    }

    const ICONS  = { todo: '☑', reminder: '🔔', idea: '💡', random: '📝' };
    const ORDER  = ['todo', 'reminder', 'idea', 'random'];
    const lines  = [
      '---',
      `date: ${dateStr}`,
      'tags: [axiom, notes]',
      '---',
      '',
      `# AXIOM Notes — ${dateStr}`,
      '',
    ];

    for (const cat of ORDER) {
      if (!groups[cat]) continue;
      const label = cat.charAt(0).toUpperCase() + cat.slice(1) + 's';
      lines.push(`## ${ICONS[cat]} ${label}`, '');
      for (const n of groups[cat]) {
        const t      = timeStr(new Date(n.timestamp).getTime());
        const bullet = cat === 'todo' ? '- [ ]' : '-';
        lines.push(`${bullet} ${n.content} _(${t})_`);
      }
      lines.push('');
    }

    fs.writeFileSync(file, lines.join('\n'), 'utf8');
  } catch (err) {
    console.error('[AXIOM obsidian] syncNotes failed:', err.message);
  }
}

// ── Conversation search ───────────────────────────────────────
// Searches past conversation markdown files for relevant exchanges.
// Returns up to `limit` results, newest-first, scored by keyword overlap.

const SEARCH_STOPWORDS = new Set([
  'what','when','where','that','this','with','from','have','about','were',
  'talk','talked','last','week','time','remember','back','tell','said',
  'your','our','the','and','for','are','was','but','not','any','all',
  'can','just','some','did','you','tell','asked','asking','axiom','alexi',
  'also','then','more','like','will','been','they','them','there','would',
]);

function parseDateRange(query) {
  const q = query.toLowerCase();
  const now = new Date();
  if (/yesterday/.test(q)) return 2;
  if (/last\s*week|past\s*week/.test(q)) return 10;
  if (/last\s*month|past\s*month/.test(q)) return 35;
  if (/recently|lately|past\s*few\s*days/.test(q)) return 7;
  return 30; // default: look back 30 days
}

function searchConversations(query, limit = 6) {
  if (!isEnabled()) return [];
  try {
    const convDir = path.join(axiomDir(), 'Conversations');
    if (!fs.existsSync(convDir)) return [];

    const maxDays  = parseDateRange(query);
    const keywords = query.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 4 && !SEARCH_STOPWORDS.has(w));

    if (!keywords.length) return [];

    // Collect all .md files sorted newest → oldest
    const files = fs.readdirSync(convDir)
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse();

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - maxDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const results = [];

    for (const file of files) {
      const dateStr = file.replace('.md', '');
      if (dateStr < cutoffStr) break; // files are sorted newest→oldest

      const raw = fs.readFileSync(path.join(convDir, file), 'utf8');

      // Split into exchange blocks (each starts with "### HH:MM")
      const blocks = raw.split(/\n(?=### )/);
      for (const block of blocks) {
        if (!block.startsWith('###')) continue;
        const lower = block.toLowerCase();
        const score = keywords.filter(kw => lower.includes(kw)).length;
        if (score === 0) continue;

        const timeMatch  = block.match(/^###\s+(.+)/m);
        const alexisLine = block.match(/\*\*Alexis:\*\*\s*(.+)/);
        const axiomLine  = block.match(/\*\*AXIOM:\*\*\s*([\s\S]+?)(?=\n---|\n##|$)/);

        if (alexisLine && axiomLine) {
          results.push({
            date:  dateStr,
            time:  timeMatch ? timeMatch[1].trim() : '',
            score,
            user:  alexisLine[1].trim().slice(0, 180),
            axiom: axiomLine[1].replace(/\n/g, ' ').trim().slice(0, 300),
          });
        }
      }
    }

    return results
      .sort((a, b) => b.score - a.score || b.date.localeCompare(a.date))
      .slice(0, limit);
  } catch (err) {
    console.error('[AXIOM obsidian] searchConversations failed:', err.message);
    return [];
  }
}

// ── Status ────────────────────────────────────────────────────

function status() {
  const vault = vaultPath();
  return {
    enabled:   !!vault,
    vaultPath: vault  || '(not set — add OBSIDIAN_VAULT_PATH to .env)',
    axiomDir:  axiomDir() || '(not set)',
  };
}

module.exports = { logExchange, syncFacts, syncNotes, searchConversations, status };
