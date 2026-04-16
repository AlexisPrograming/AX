// Quick test for Obsidian sync — run with:
//   node scripts/test-obsidian.js

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const sync = require('../src/services/obsidian-sync.js');

console.log('\n── AXIOM Obsidian Sync Test ──────────────────');
const s = sync.status();
console.log('Enabled:   ', s.enabled);
console.log('Vault:     ', s.vaultPath);
console.log('AXIOM dir: ', s.axiomDir);
console.log('──────────────────────────────────────────────\n');

if (!s.enabled) {
  console.error('❌  OBSIDIAN_VAULT_PATH not set in .env — nothing to test.');
  process.exit(1);
}

// 1. Test: short command → should be SKIPPED (< 35 words)
console.log('Test 1 — short command (should be SKIPPED):');
sync.logExchange('Open Chrome', 'Opening Chrome.');
console.log('  → logged (check: no file should appear for this)\n');

// 2. Test: long conversation → should be SAVED to Conversations/
console.log('Test 2 — long conversation (should be SAVED):');
sync.logExchange(
  'Can you explain how AXIOM\'s brain works?',
  'Sure! AXIOM\'s brain lives in brain.js. It builds a system prompt with your personality config, recent conversation history, remembered facts, and app usage summary. Every time you speak, that full context gets sent to Claude Sonnet along with your message. Claude returns either a plain spoken reply or a JSON action line followed by the reply. The action line is what triggers things like opening apps, searching the web, or controlling your PC. The conversation is then saved to memory.json and trimmed to the last 25 exchanges so the context window stays manageable.',
  Date.now()
);
console.log('  → check: AXIOM/Conversations/' + new Date().toISOString().slice(0,10) + '.md\n');

// 3. Test: very long → should ALSO appear in highlights.md
console.log('Test 3 — very long reply (should go to highlights.md too):');
sync.logExchange(
  'Give me a full breakdown of the PULSE app project.',
  'PULSE is Alexis\'s health app built on Supabase. The core idea is giving users a real-time view of their physical and mental health metrics through a clean, minimal interface. The tech stack uses Next.js on the frontend with TypeScript and Tailwind for styling, Supabase for the database and auth, and edge functions for the backend logic. The app is live on Vercel. Key features include a daily check-in flow where users log mood, energy, sleep, and water intake. There\'s a dashboard that visualizes trends over time using charting components. The ORBIT feature — which Alexis has been deep into recently — adds habit tracking with streaks and reminders. The notification system uses Supabase realtime to push gentle nudges. The auth flow handles email/password and OAuth via Supabase\'s built-in providers. Deployment is fully automated through GitHub Actions connected to Vercel. The biggest current challenge is optimizing the database queries for the trend visualization so they don\'t slow down the dashboard on users with large datasets.',
  Date.now()
);
console.log('  → check: AXIOM/Conversations/ AND AXIOM/Memory/highlights.md\n');

// 4. Test: facts
console.log('Test 4 — facts sync:');
sync.syncFacts([
  'Alexis prefers dark mode in all apps',
  'PULSE API uses Supabase edge functions',
  'Working on ORBIT feature for habit tracking',
]);
console.log('  → check: AXIOM/Memory/facts.md\n');

// 5. Test: voice note
console.log('Test 5 — voice note:');
const today = new Date().toISOString().slice(0, 10);
sync.syncNotes([
  { id: 1, timestamp: new Date().toISOString(), date: today, content: 'Add dark mode toggle to PULSE settings page', category: 'todo' },
  { id: 2, timestamp: new Date().toISOString(), date: today, content: 'Idea: use Supabase realtime for live habit streak updates', category: 'idea' },
  { id: 3, timestamp: new Date().toISOString(), date: today, content: 'Check ORBIT feature PR before end of day', category: 'reminder' },
], today);
console.log('  → check: AXIOM/Notes/' + today + '.md\n');

console.log('✅  All tests ran. Open Obsidian and look inside the AXIOM folder.');
