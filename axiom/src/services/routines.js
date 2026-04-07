const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const ROUTINES_FILE = path.join(app.getPath('userData'), 'routines.json');

const DEFAULT_DATA = {
  routines: [
    {
      name: 'morning setup',
      trigger: 'startup',
      actions: [
        { type: 'speak', text: 'Opening your dev environment.' },
        { type: 'open_app', app: 'vscode' },
        { type: 'open_url', url: 'https://github.com' },
        { type: 'speak', text: "You're ready to build." },
      ],
    },
    {
      name: 'focus mode',
      trigger: 'voice',
      phrase: 'focus mode',
      actions: [
        { type: 'speak', text: 'Focus mode activated.' },
        { type: 'open_app', app: 'spotify' },
        { type: 'speak', text: "Lo-fi is on. Let's get to work." },
      ],
    },
  ],
};

let cache = null;

function load() {
  if (cache) return cache;
  try {
    if (fs.existsSync(ROUTINES_FILE)) {
      cache = JSON.parse(fs.readFileSync(ROUTINES_FILE, 'utf-8'));
      if (!cache.routines) cache.routines = [];
    } else {
      cache = structuredClone(DEFAULT_DATA);
      save();
    }
  } catch (err) {
    console.error('[AXIOM routines] load failed:', err.message);
    cache = structuredClone(DEFAULT_DATA);
  }
  return cache;
}

function save() {
  try {
    const dir = path.dirname(ROUTINES_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ROUTINES_FILE, JSON.stringify(cache, null, 2), 'utf-8');
  } catch (err) {
    console.error('[AXIOM routines] save failed:', err.message);
  }
}

function list() {
  return load().routines;
}

function findByName(name) {
  if (!name) return null;
  const target = name.toLowerCase().trim();
  return list().find((r) => r.name.toLowerCase() === target) || null;
}

function findByPhrase(phrase) {
  if (!phrase) return null;
  const text = phrase.toLowerCase();
  return list().find(
    (r) => r.trigger === 'voice' && r.phrase && text.includes(r.phrase.toLowerCase())
  ) || null;
}

function findByTrigger(trigger) {
  return list().filter((r) => r.trigger === trigger);
}

function add(routine) {
  if (!routine || !routine.name || !Array.isArray(routine.actions)) {
    throw new Error('Invalid routine: needs name and actions[]');
  }
  load();
  // Replace if exists
  cache.routines = cache.routines.filter(
    (r) => r.name.toLowerCase() !== routine.name.toLowerCase()
  );
  cache.routines.push({
    name: routine.name,
    trigger: routine.trigger || 'voice',
    phrase: routine.phrase || routine.name,
    actions: routine.actions,
  });
  save();
}

function remove(name) {
  load();
  const before = cache.routines.length;
  cache.routines = cache.routines.filter(
    (r) => r.name.toLowerCase() !== name.toLowerCase()
  );
  save();
  return cache.routines.length < before;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(routineOrName, deps) {
  const routine = typeof routineOrName === 'string' ? findByName(routineOrName) : routineOrName;
  if (!routine) {
    return { success: false, error: `Routine not found: ${routineOrName}` };
  }

  const { speak, executeAction } = deps;
  console.log(`[AXIOM routines] running "${routine.name}" (${routine.actions.length} actions)`);

  for (const action of routine.actions) {
    try {
      if (action.type === 'speak') {
        await speak(action.text || '');
      } else if (action.type === 'open_url') {
        await executeAction({ type: 'open_url', url: action.url });
      } else if (action.type === 'wait') {
        await sleep((action.seconds || 1) * 1000);
        continue; // skip the natural delay below
      } else {
        await executeAction(action);
      }
    } catch (err) {
      console.error(`[AXIOM routines] action failed:`, action, err.message);
    }

    // Natural pacing between actions (0.5–1s)
    await sleep(500 + Math.floor(Math.random() * 500));
  }

  return { success: true };
}

module.exports = { load, list, findByName, findByPhrase, findByTrigger, add, remove, run };
