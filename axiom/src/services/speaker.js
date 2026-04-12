const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

let client = null;
let speaking = false;
let playbackProcess = null;
let cancelled = false;

// "Adam" — natural warm male voice (ElevenLabs default voice ID)
const VOICE_ID = 'TX3LPaxmHKxFdv7VOQHJ';
const MODEL_ID = 'eleven_turbo_v2_5';

const PLAY_SCRIPT = `
param([string]$FilePath)
Add-Type -AssemblyName presentationCore
$player = New-Object System.Windows.Media.MediaPlayer
$player.Open([Uri]$FilePath)
Start-Sleep -Milliseconds 400
$player.Play()
$waited = 0
while (-not $player.NaturalDuration.HasTimeSpan -and $waited -lt 15000) {
    Start-Sleep -Milliseconds 100
    $waited += 100
}
if ($player.NaturalDuration.HasTimeSpan) {
    $ms = [int]$player.NaturalDuration.TimeSpan.TotalMilliseconds + 500
    Start-Sleep -Milliseconds $ms
} else {
    # Duration never resolved — wait a safe fallback based on file size
    $size = (Get-Item $FilePath).Length
    $fallbackMs = [int]($size / 16000 * 1000) + 2000
    Start-Sleep -Milliseconds $fallbackMs
}
$player.Stop()
$player.Close()
`;

const playScriptPath = path.join(os.tmpdir(), 'axiom-play.ps1');
fs.writeFileSync(playScriptPath, PLAY_SCRIPT, 'utf8');

function getClient() {
  if (!client) {
    if (!process.env.ELEVENLABS_API_KEY) {
      throw new Error('ELEVENLABS_API_KEY is missing from .env');
    }
    client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
  }
  return client;
}

async function speak(text) {
  if (!text || !text.trim()) return;
  if (speaking) return;
  speaking = true;
  cancelled = false;

  const tmpDir = path.join(os.tmpdir(), `axiom-tts-${Date.now()}`);
  const filePath = path.join(tmpDir, 'speech.mp3');

  try {
    fs.mkdirSync(tmpDir, { recursive: true });

    // Stream MP3 from ElevenLabs into a temp file
    const audioStream = await getClient().textToSpeech.stream(VOICE_ID, {
      text,
      modelId: MODEL_ID,
      outputFormat: 'mp3_44100_128',
      voiceSettings: {
        stability: 0.45,        // a touch of variation for emotion
        similarityBoost: 0.8,
        style: 0.35,            // expressive, but not over the top
        useSpeakerBoost: true,
      },
    });

    await streamToFile(audioStream, filePath);
    if (cancelled) return;

    await playAudio(filePath);
  } catch (err) {
    if (err && (err.killed || err.signal)) return; // interrupted by stop()
    if (cancelled) return;
    throw err;
  } finally {
    speaking = false;
    playbackProcess = null;
    fs.unlink(filePath, () => {
      fs.rmdir(tmpDir, () => {});
    });
  }
}

async function streamToFile(stream, filePath) {
  // Support web ReadableStream, Node Readable, or AsyncIterable<Buffer|Uint8Array>
  const out = fs.createWriteStream(filePath);
  try {
    if (stream && typeof stream.getReader === 'function') {
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) out.write(Buffer.from(value));
      }
    } else if (stream && typeof stream[Symbol.asyncIterator] === 'function') {
      for await (const chunk of stream) {
        out.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
    } else if (stream && typeof stream.pipe === 'function') {
      await new Promise((resolve, reject) => {
        stream.pipe(out);
        stream.on('end', resolve);
        stream.on('error', reject);
        out.on('error', reject);
      });
      return;
    } else {
      throw new Error('Unknown audio stream type from ElevenLabs');
    }
  } finally {
    await new Promise((resolve) => out.end(resolve));
  }
}

function playAudio(filePath) {
  return new Promise((resolve, reject) => {
    playbackProcess = execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', playScriptPath, '-FilePath', filePath],
      { timeout: 600000, windowsHide: true },
      (err) => {
        playbackProcess = null;
        if (err && err.killed) return resolve(); // killed by stop()
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

function stop() {
  cancelled = true;
  if (playbackProcess && !playbackProcess.killed) {
    playbackProcess.kill();
    playbackProcess = null;
  }
  speaking = false;
}

function isSpeaking() {
  return speaking;
}

module.exports = { speak, stop, isSpeaking };
