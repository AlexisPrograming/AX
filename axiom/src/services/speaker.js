const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

let tts = null;
let speaking = false;
let playbackProcess = null;

const VOICE = 'en-US-GuyNeural';
const FORMAT = OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3;

const PLAY_SCRIPT = `
param([string]$FilePath)
Add-Type -AssemblyName presentationCore
$player = New-Object System.Windows.Media.MediaPlayer
$player.Open([Uri]$FilePath)
Start-Sleep -Milliseconds 300
$player.Play()
$waited = 0
while (-not $player.NaturalDuration.HasTimeSpan -and $waited -lt 5000) {
    Start-Sleep -Milliseconds 50
    $waited += 50
}
if ($player.NaturalDuration.HasTimeSpan) {
    $ms = [int]$player.NaturalDuration.TimeSpan.TotalMilliseconds + 200
    Start-Sleep -Milliseconds $ms
}
$player.Stop()
$player.Close()
`;

const playScriptPath = path.join(os.tmpdir(), 'axiom-play.ps1');
fs.writeFileSync(playScriptPath, PLAY_SCRIPT, 'utf8');

async function ensureTTS() {
  if (!tts) {
    tts = new MsEdgeTTS();
    await tts.setMetadata(VOICE, FORMAT);
  }
  return tts;
}

async function speak(text) {
  if (!text || !text.trim()) return;
  if (speaking) return;
  speaking = true;

  try {
    const engine = await ensureTTS();
    const tmpDir = path.join(os.tmpdir(), `axiom-tts-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const result = await engine.toFile(tmpDir, text);
    const filePath = typeof result === 'string' ? result : result.audioFilePath;

    await playAudio(filePath);

    fs.unlink(filePath, () => {
      fs.rmdir(tmpDir, () => {});
    });
  } catch (err) {
    tts = null;
    if (err.killed || err.signal) return; // Interrupted by stop() — not an error
    throw err;
  } finally {
    speaking = false;
    playbackProcess = null;
  }
}

function playAudio(filePath) {
  return new Promise((resolve, reject) => {
    playbackProcess = execFile(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', playScriptPath, '-FilePath', filePath],
      { timeout: 30000, windowsHide: true },
      (err) => {
        playbackProcess = null;
        if (err && err.killed) return resolve(); // Killed by stop()
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

function stop() {
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
