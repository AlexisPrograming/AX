// Offline wake word detection using Picovoice Porcupine + PvRecorder.
// Runs a background loop that reads 16 kHz PCM frames from the default
// microphone and feeds them to Porcupine. When the wake word fires,
// the provided callback is invoked.

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let Porcupine = null;
let PvRecorder = null;

try {
  ({ Porcupine } = require('@picovoice/porcupine-node'));
  ({ PvRecorder } = require('@picovoice/pvrecorder-node'));
} catch (err) {
  console.warn('[AXIOM wakeword] Porcupine packages not available:', err.message);
}

let porcupine = null;
let recorder = null;
let running = false;
let stopRequested = false;
let loopPromise = null;

function getKeywordPath() {
  // Bundle-friendly lookup — dev vs packaged
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '..', '..', 'assets');

  // Accept a few likely filenames
  const candidates = [
    'hey-ax_windows.ppn',
    'hey-ax.ppn',
    'Hey-AX_en_windows.ppn',
    'hey_ax_windows.ppn',
  ];
  for (const name of candidates) {
    const full = path.join(base, name);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

async function start(onDetected) {
  if (running) return { ok: true, alreadyRunning: true };
  if (!Porcupine || !PvRecorder) {
    return { ok: false, error: 'porcupine-not-installed' };
  }

  const accessKey = process.env.PICOVOICE_ACCESS_KEY;
  if (!accessKey) {
    console.warn('[AXIOM wakeword] PICOVOICE_ACCESS_KEY missing from .env — wake word disabled.');
    return { ok: false, error: 'no-access-key' };
  }

  const keywordPath = getKeywordPath();
  if (!keywordPath) {
    console.warn('[AXIOM wakeword] No .ppn model found in assets/ — wake word disabled.');
    return { ok: false, error: 'no-model-file' };
  }

  try {
    // Sensitivity 0.6 is a good balance between misses and false positives.
    porcupine = new Porcupine(accessKey, [keywordPath], [0.6]);

    // -1 = default audio input device; frameLength from Porcupine = 512 @ 16 kHz
    recorder = new PvRecorder(porcupine.frameLength, -1);
    recorder.start();

    running = true;
    stopRequested = false;

    console.log(`[AXIOM wakeword] listening on "${recorder.getSelectedDevice()}" (${porcupine.frameLength} frame)`);
    loopPromise = detectLoop(onDetected);
    return { ok: true };
  } catch (err) {
    console.error('[AXIOM wakeword] start failed:', err);
    await stop();
    return { ok: false, error: err.message };
  }
}

async function detectLoop(onDetected) {
  while (running && !stopRequested) {
    try {
      const frame = await recorder.read();
      const idx = porcupine.process(frame);
      if (idx >= 0) {
        console.log('[AXIOM wakeword] detected!');
        try {
          onDetected && onDetected();
        } catch (err) {
          console.error('[AXIOM wakeword] callback error:', err);
        }
        // Short cool-down so one utterance doesn't re-trigger repeatedly
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch (err) {
      if (stopRequested) break;
      console.error('[AXIOM wakeword] loop error:', err.message);
      // Brief pause then continue — survives transient device hiccups
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

async function stop() {
  stopRequested = true;
  running = false;
  try {
    if (recorder) {
      try { recorder.stop(); } catch {}
      try { recorder.release(); } catch {}
    }
  } finally {
    recorder = null;
  }
  try {
    if (porcupine) porcupine.release();
  } finally {
    porcupine = null;
  }
  if (loopPromise) {
    try { await loopPromise; } catch {}
    loopPromise = null;
  }
}

async function restart(onDetected) {
  await stop();
  return start(onDetected);
}

function isRunning() {
  return running;
}

module.exports = { start, stop, restart, isRunning };
