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
// CONNECTIONS (graph view):
//   • Each exchange gets topic links → [[AXIOM/Topics/topicname]]
//   • Topic index files link back   → [[AXIOM/Conversations/YYYY-MM-DD]]
//   • Related past dates added as   → See also: [[AXIOM/Conversations/YYYY-MM-DD]]
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
//     Topics/{topic}.md             — index of all conversations per topic

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Thresholds ────────────────────────────────────────────────
const MIN_WORDS_TO_LOG        = 35;   // skip short command confirmations
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

// ── Topic extraction ──────────────────────────────────────────
// Pulls meaningful keywords from an exchange so Obsidian can graph-connect
// related conversations through topic index files.

const TOPIC_STOPWORDS = new Set([
  'what','when','where','that','this','with','from','have','about','were',
  'talk','talked','last','week','time','remember','back','tell','said',
  'your','our','the','and','for','are','was','but','not','any','all',
  'can','just','some','did','you','tell','asked','asking','axiom','alexi',
  'also','then','more','like','will','been','they','them','there','would',
  'going','want','need','make','think','know','actually','really','okay',
  'could','should','something','everything','nothing','working','getting',
  'open','close','start','stop','play','pause','next','done','yeah','right',
  'good','great','nice','cool','sure','well','here','over','down','into',
  'before','after','while','through','their','because','though','might',
  'gonna','wanna','kinda','sorta','gotta','alexis','thing','things','looks',
  'feel','feels','felt','looked','seems','using','used','uses','much','many',
  'most','these','those','other','another','every','each','even','still',
  'already','again','yet','always','never','sometimes','often','usually',
  'probably','maybe','perhaps','that\'s','it\'s','i\'m','don\'t','didn\'t',
  'isn\'t','aren\'t','wasn\'t','weren\'t','haven\'t','hasn\'t','hadn\'t',
  'won\'t','wouldn\'t','can\'t','couldn\'t','shouldn\'t','okay','alright',
]);

// Known project / app / tech keywords — relevant even if they appear only once
const KNOWN_TOPICS = new Set([
  'pulse','axiom','obsidian','blender','supabase','vercel','github',
  'typescript','nextjs','tailwind','python','javascript','react','cursor',
  'claude','openai','spotify','youtube','notion','figma','unity','godot',
  'electron','sqlite','postgres','redis','docker','windows','android','ios',
  'claude','anthropic','elevenlabs','picovoice','porcupine','whisper',
]);

function extractTopics(userMsg, assistantMsg) {
  const combined = ((userMsg || '') + ' ' + stripActionJson(assistantMsg || '')).toLowerCase();
  const words = combined
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !TOPIC_STOPWORDS.has(w));

  // Count frequency
  const freq = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;

  // Keep: known topics (1+ occurrence) OR high-freq words (2+ occurrences, length ≥ 5)
  const selected = Object.entries(freq)
    .filter(([w, c]) => KNOWN_TOPICS.has(w) || (c >= 2 && w.length >= 5))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([w]) => w);

  return selected;
}

function topicSlug(word) {
  return word.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '');
}

// ── Topic index files ─────────────────────────────────────────
// AXIOM/Topics/{slug}.md — hub that links to every conversation date
// where this topic appeared. Creates the spoke connections in graph view.

function updateTopicIndex(topic, dateStr) {
  try {
    const slug  = topicSlug(topic);
    const dir   = path.join(axiomDir(), 'Topics');
    ensure(dir);
    const file  = path.join(dir, `${slug}.md`);
    const label = topic.charAt(0).toUpperCase() + topic.slice(1);
    const link  = `[[AXIOM/Conversations/${dateStr}]]`;

    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, [
        '---',
        `tags: [axiom, topic, ${slug}]`,
        '---',
        '',
        `# ${label}`,
        `_All AXIOM conversations mentioning **${label}**_`,
        '',
      ].join('\n'), 'utf8');
    }

    // Only append if this date link isn't already there
    const content = fs.readFileSync(file, 'utf8');
    if (!content.includes(link)) {
      fs.appendFileSync(file, `- ${link}\n`, 'utf8');
    }
  } catch (err) {
    console.error('[AXIOM obsidian] updateTopicIndex failed:', err.message);
  }
}

// ── Related conversation finder ───────────────────────────────
// Scans the last 90 days of conversation files for keyword overlap.
// Returns the top matching dates (excluding today's file).

function findRelatedDates(keywords, excludeDate, limit = 3) {
  if (!keywords.length) return [];
  try {
    const convDir = path.join(axiomDir(), 'Conversations');
    if (!fs.existsSync(convDir)) return [];

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const files = fs.readdirSync(convDir)
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse()
      .filter(f => f.replace('.md', '') >= cutoffStr);

    const scores = [];
    for (const file of files) {
      const dateStr = file.replace('.md', '');
      if (dateStr === excludeDate) continue;

      const content = fs.readFileSync(path.join(convDir, file), 'utf8').toLowerCase();
      const score   = keywords.filter(kw => content.includes(kw)).length;
      if (score > 0) scores.push({ dateStr, score });
    }

    return scores
      .sort((a, b) => b.score - a.score || b.dateStr.localeCompare(a.dateStr))
      .slice(0, limit)
      .map(s => s.dateStr);
  } catch (err) {
    console.error('[AXIOM obsidian] findRelatedDates failed:', err.message);
    return [];
  }
}

// ── Conversation log ──────────────────────────────────────────
// Writes to:  AXIOM/Conversations/YYYY-MM-DD.md
// Skips:      exchanges where AXIOM said < MIN_WORDS_TO_LOG words
// Highlights: exchanges > MIN_WORDS_FOR_HIGHLIGHT words also go to highlights.md
// Links:      adds [[topic]] and [[related date]] wiki-links for graph view

function logExchange(userMsg, assistantMsg, ts = Date.now()) {
  if (!isEnabled()) return;

  const cleanResponse = stripActionJson(assistantMsg);
  const words         = wordCount(assistantMsg);

  // Skip trivial command confirmations
  if (words < MIN_WORDS_TO_LOG) return;

  try {
    const today = todayStr();
    const time  = timeStr(ts);

    // ── Extract topics & build connections ────────────────────
    const topics  = extractTopics(userMsg, assistantMsg);
    for (const topic of topics) updateTopicIndex(topic, today);
    const related = findRelatedDates(topics, today);

    // ── Daily conversation file ───────────────────────────────
    const convDir  = path.join(axiomDir(), 'Conversations');
    ensure(convDir);
    const convFile = path.join(convDir, `${today}.md`);

    if (!fs.existsSync(convFile)) {
      const topicTagStr = topics.length
        ? ', ' + topics.map(topicSlug).join(', ')
        : '';
      fs.writeFileSync(convFile, [
        '---',
        `date: ${today}`,
        `tags: [axiom, conversation${topicTagStr}]`,
        '---',
        '',
        `# AXIOM Conversations — ${today}`,
        '',
      ].join('\n'), 'utf8');
    }

    const userLine = (userMsg || '').replace(/\n+/g, ' ').trim();

    // Wiki-link lines (only included when there's something to link)
    const topicLinks = topics.length
      ? `> 🔗 ${topics.map(t => `[[AXIOM/Topics/${topicSlug(t)}]]`).join(' · ')}`
      : '';
    const relatedLinks = related.length
      ? `> 📌 See also: ${related.map(d => `[[AXIOM/Conversations/${d}]]`).join(' · ')}`
      : '';

    const block = [
      `### ${time}`,
      '',
      `**Alexis:** ${userLine}`,
      '',
      `**AXIOM:** ${cleanResponse.replace(/\n+/g, ' ')}`,
      '',
      ...(topicLinks   ? [topicLinks]   : []),
      ...(relatedLinks ? [relatedLinks] : []),
      ...(topicLinks || relatedLinks ? [''] : []),
      '---',
      '',
    ].join('\n');

    fs.appendFileSync(convFile, block, 'utf8');

    // ── Highlights file (long conversations only) ─────────────
    if (words >= MIN_WORDS_FOR_HIGHLIGHT) {
      appendHighlight(today, time, userLine, cleanResponse, topics, related);
    }
  } catch (err) {
    console.error('[AXIOM obsidian] logExchange failed:', err.message);
  }
}

// Appends a summary block to AXIOM/Memory/highlights.md
function appendHighlight(date, time, userLine, cleanResponse, topics = [], related = []) {
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

    const topicLinks   = topics.length
      ? `> 🔗 ${topics.map(t => `[[AXIOM/Topics/${topicSlug(t)}]]`).join(' · ')}`
      : '';
    const relatedLinks = related.length
      ? `> 📌 See also: ${related.map(d => `[[AXIOM/Conversations/${d}]]`).join(' · ')}`
      : '';

    const block = [
      `## ${date} · ${time}`,
      '',
      `> **Alexis:** ${userLine}`,
      '',
      cleanResponse,
      '',
      ...(topicLinks   ? [topicLinks]   : []),
      ...(relatedLinks ? [relatedLinks] : []),
      ...(topicLinks || relatedLinks ? [''] : []),
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
        const axiomLine  = block.match(/\*\*AXIOM:\*\*\s*([\s\S]+?)(?=\n>|\n---|\n##|$)/);

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
