// Spotify / media player control via Windows media key commands
// No API, no OAuth — controls whatever media player is active (Spotify, YT Music, etc.)

const { exec } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const VK = {
  PLAY_PAUSE: 0xB3,
  NEXT:       0xB0,
  PREVIOUS:   0xB1,
  STOP:       0xB2,
};

function sendMediaKey(vk) {
  return new Promise((resolve) => {
    // Write to a temp .ps1 file so DllImport quotes are never mangled by shell escaping
    const script = `Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
public class MediaKey {
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte vk, byte sc, uint fl, int ex);
    public static void Send(byte vk) { keybd_event(vk, 0, 1, 0); keybd_event(vk, 0, 3, 0); }
}
"@
[MediaKey]::Send(${vk})
`;
    const tmp = path.join(os.tmpdir(), `axiom-mk-${Date.now()}.ps1`);
    fs.writeFile(tmp, script, (writeErr) => {
      if (writeErr) return resolve({ ok: false, error: writeErr.message });
      exec(
        `powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${tmp}"`,
        { windowsHide: true },
        (err) => {
          fs.unlink(tmp, () => {});
          resolve(err ? { ok: false, error: err.message } : { ok: true });
        }
      );
    });
  });
}

function play()     { return sendMediaKey(VK.PLAY_PAUSE); }
function pause()    { return sendMediaKey(VK.PLAY_PAUSE); }
function stop()     { return sendMediaKey(VK.STOP); }
function next()     { return sendMediaKey(VK.NEXT); }
function previous() { return sendMediaKey(VK.PREVIOUS); }

// Read the current track from Spotify's window title ("Artist - Song")
function getCurrentTrack() {
  return new Promise((resolve) => {
    const ps = `(Get-Process -Name Spotify -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowTitle -ne '' -and $_.MainWindowTitle -notmatch '^Spotify'}).MainWindowTitle | Select-Object -First 1`;
    exec(`powershell -NoProfile -WindowStyle Hidden -Command "${ps}"`, { windowsHide: true }, (err, stdout) => {
      if (err || !stdout.trim()) return resolve(null);
      const title = stdout.trim();
      // Window title format: "Artist - Song Title"
      const dashIdx = title.indexOf(' - ');
      if (dashIdx !== -1) {
        resolve({ artist: title.slice(0, dashIdx), name: title.slice(dashIdx + 3) });
      } else {
        resolve({ name: title, artist: null });
      }
    });
  });
}

module.exports = { play, pause, stop, next, previous, getCurrentTrack };
