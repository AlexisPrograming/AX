// Custom wake word detection — no Picovoice needed.
// Uses PvRecorder (already installed) for raw PCM capture, then a simple
// VAD loop: when the mic energy exceeds a threshold for a few consecutive
// frames, we buffer the audio, write a WAV, and transcribe it with Whisper.
// If the transcript contains a wake phrase we fire the callback.

const path = require('path');
const fs   = require('fs');
const os   = require('os');

let PvRecorder = null;
try {
  ({ PvRecorder } = require('@picovoice/pvrecorder-node'));
} catch (err) {
  console.warn('[AXIOM wakeword] PvRecorder not available:', err.message);
}

// ── Tuning constants ──────────────────────────────────────────
const SAMPLE_RATE          = 16000;
const FRAME_LENGTH         = 512;               // ~32 ms per frame
const ENERGY_THRESHOLD     = 280;               // RMS threshold to consider as speech
const VOICE_ONSET_FRAMES   = 5;                 // consecutive loud frames before capture starts
const SILENCE_END_FRAMES   = 28;                // ~900 ms of quiet ends the segment
const MAX_BUFFER_FRAMES    = Math.floor(SAMPLE_RATE * 4 / FRAME_LENGTH); // 4s hard cap
const COOLDOWN_MS          = 2500;              // ignore detections within this window

// ── Wake phrases (Whisper variant-tolerant) ───────────────────
const WAKE_PHRASES = [
  'hey ax', 'hey axiom', 'axiom', 'wake up ax', 'wake ax',
  'a-x', 'hey acts', 'hey axis', 'heyax', // common Whisper mishearings
];

// ── State ─────────────────────────────────────────────────────
let recorder        = null;
let running         = false;
let stopRequested   = false;
let lastDetectedAt  = 0;

// ── Helpers ───────────────────────────────────────────────────

function rms(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

function isWakePhrase(text) {
  const t = text.toLowerCase().trim();
  return WAKE_PHRASES.some(p => t.includes(p));
}

// Build a minimal WAV from accumulated Int16 PCM frames
function buildWav(frames) {
  const samples  = [].concat(...frames.map(f => Array.from(f)));
  const dataSize = samples.length * 2;
  const buf      = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);                      // PCM
  buf.writeUInt16LE(1, 22);                      // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28);        // byte rate
  buf.writeUInt16LE(2, 32);                      // block align
  buf.writeUInt16LE(16, 34);                     // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, samples[i])), 44 + i * 2);
  }
  return buf;
}

async function transcribe(wavBuf) {
  const tmpFile = path.join(os.tmpdir(), `axiom-ww-${Date.now()}.wav`);
  fs.writeFileSync(tmpFile, wavBuf);
  try {
    const OpenAI   = require('openai');
    const { toFile } = require('openai/uploads');
    const client   = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const stream   = fs.createReadStream(tmpFile);
    const resp     = await client.audio.transcriptions.create({
      model:    'whisper-1',
      file:     await toFile(stream, 'ww.wav', { type: 'audio/wav' }),
      language: 'en',
    });
    return resp.text || '';
  } catch (err) {
    console.error('[AXIOM wakeword] transcription error:', err.message);
    return '';
  } finally {
    fs.unlink(tmpFile, () => {});
  }
}

// ── Main VAD loop ─────────────────────────────────────────────

async function detectLoop(onDetected) {
  let buffer       = [];
  let speechFrames = 0;
  let silenceFrames = 0;
  let capturing    = false;
  let processing   = false;

  while (running && !stopRequested) {
    try {
      const frame  = await recorder.read();
      const energy = rms(frame);
      const loud   = energy > ENERGY_THRESHOLD;

      if (loud) {
        silenceFrames = 0;
        speechFrames++;
        if (!capturing && speechFrames >= VOICE_ONSET_FRAMES) {
          capturing = true;
          buffer = [];
        }
      } else {
        speechFrames = 0;
        if (capturing) silenceFrames++;
      }

      if (capturing) {
        buffer.push(frame);

        const done = silenceFrames >= SILENCE_END_FRAMES || buffer.length >= MAX_BUFFER_FRAMES;

        if (done && !processing) {
          capturing     = false;
          silenceFrames = 0;

          // Cooldown guard
          if (Date.now() - lastDetectedAt < COOLDOWN_MS) {
            buffer = [];
            continue;
          }

          processing = true;
          const captured = buffer.slice();
          buffer = [];

          // Transcribe asynchronously — don't block the loop
          (async () => {
            try {
              const wav  = buildWav(captured);
              const text = await transcribe(wav);
              console.log('[AXIOM wakeword] heard:', JSON.stringify(text));

              if (text && isWakePhrase(text)) {
                lastDetectedAt = Date.now();
                console.log('[AXIOM wakeword] WAKE WORD DETECTED');
                onDetected && onDetected();
              }
            } catch (err) {
              console.error('[AXIOM wakeword] process error:', err.message);
            } finally {
              processing = false;
            }
          })();
        }
      }
    } catch (err) {
      if (stopRequested) break;
      console.error('[AXIOM wakeword] loop error:', err.message);
      await new Promise(r => setTimeout(r, 300));
    }
  }
}

// ── Public API ────────────────────────────────────────────────

async function start(onDetected) {
  if (running) return { ok: true, alreadyRunning: true };

  if (!PvRecorder) {
    console.warn('[AXIOM wakeword] PvRecorder not available — wake word disabled.');
    return { ok: false, error: 'pvrecorder-not-available' };
  }
  if (!process.env.OPENAI_API_KEY) {
    console.warn('[AXIOM wakeword] OPENAI_API_KEY missing — wake word disabled.');
    return { ok: false, error: 'no-openai-key' };
  }

  try {
    recorder      = new PvRecorder(FRAME_LENGTH, -1);
    recorder.start();
    running       = true;
    stopRequested = false;

    console.log(`[AXIOM wakeword] custom VAD listening on "${recorder.getSelectedDevice()}"`);
    detectLoop(onDetected);
    return { ok: true };
  } catch (err) {
    console.error('[AXIOM wakeword] start error:', err);
    await stop();
    return { ok: false, error: err.message };
  }
}

async function stop() {
  stopRequested = true;
  running       = false;
  try {
    if (recorder) {
      try { recorder.stop();    } catch {}
      try { recorder.release(); } catch {}
      recorder = null;
    }
  } catch {}
}

async function restart(onDetected) {
  await stop();
  return start(onDetected);
}

function isRunning() { return running; }

module.exports = { start, stop, restart, isRunning };
