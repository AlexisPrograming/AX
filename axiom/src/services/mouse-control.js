// Mouse control — click, right-click, double-click, scroll, move.
// All coordinates are LOGICAL pixels (matching screenshot resolution).
// The caller is responsible for passing scaleFactor so this service
// converts to physical pixels before calling Win32.

const { execFile } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

// Build and run a temp PowerShell script, returns { success, error }
function runScript(lines) {
  return new Promise((resolve) => {
    const tmp    = path.join(os.tmpdir(), `axiom-mouse-${Date.now()}.ps1`);
    const script = MOUSE_TYPE_DEF + '\r\n' + lines.join('\r\n');

    fs.writeFile(tmp, script, 'utf8', (writeErr) => {
      if (writeErr) return resolve({ success: false, error: writeErr.message });
      execFile(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', tmp],
        { windowsHide: true, timeout: 8000 },
        (err) => {
          fs.unlink(tmp, () => {});
          resolve(err ? { success: false, error: err.message } : { success: true });
        }
      );
    });
  });
}

// Shared C# type definition embedded in every script
const MOUSE_TYPE_DEF = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MC {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint dx,uint dy,uint d,UIntPtr e);
    public const uint LDN  = 0x0002;
    public const uint LUP  = 0x0004;
    public const uint RDN  = 0x0008;
    public const uint RUP  = 0x0010;
    public const uint WHL  = 0x0800;
    public const uint MOVE = 0x0001;
}
"@`.trim();

// Convert logical → physical pixels
function phys(logical, scale) { return Math.round(logical * scale); }

// ── Public API ────────────────────────────────────────────────

function click(lx, ly, scaleFactor = 1) {
  const x = phys(lx, scaleFactor), y = phys(ly, scaleFactor);
  return runScript([
    `[MC]::SetCursorPos(${x}, ${y})`,
    `Start-Sleep -Milliseconds 60`,
    `[MC]::mouse_event([MC]::LDN, 0, 0, 0, [UIntPtr]::Zero)`,
    `Start-Sleep -Milliseconds 50`,
    `[MC]::mouse_event([MC]::LUP, 0, 0, 0, [UIntPtr]::Zero)`,
  ]);
}

function rightClick(lx, ly, scaleFactor = 1) {
  const x = phys(lx, scaleFactor), y = phys(ly, scaleFactor);
  return runScript([
    `[MC]::SetCursorPos(${x}, ${y})`,
    `Start-Sleep -Milliseconds 60`,
    `[MC]::mouse_event([MC]::RDN, 0, 0, 0, [UIntPtr]::Zero)`,
    `Start-Sleep -Milliseconds 50`,
    `[MC]::mouse_event([MC]::RUP, 0, 0, 0, [UIntPtr]::Zero)`,
  ]);
}

function doubleClick(lx, ly, scaleFactor = 1) {
  const x = phys(lx, scaleFactor), y = phys(ly, scaleFactor);
  return runScript([
    `[MC]::SetCursorPos(${x}, ${y})`,
    `Start-Sleep -Milliseconds 60`,
    `[MC]::mouse_event([MC]::LDN, 0, 0, 0, [UIntPtr]::Zero)`,
    `Start-Sleep -Milliseconds 40`,
    `[MC]::mouse_event([MC]::LUP, 0, 0, 0, [UIntPtr]::Zero)`,
    `Start-Sleep -Milliseconds 80`,
    `[MC]::mouse_event([MC]::LDN, 0, 0, 0, [UIntPtr]::Zero)`,
    `Start-Sleep -Milliseconds 40`,
    `[MC]::mouse_event([MC]::LUP, 0, 0, 0, [UIntPtr]::Zero)`,
  ]);
}

// direction: 'up' | 'down' | 'left' | 'right'   amount: scroll clicks (default 3)
function scroll(lx, ly, direction = 'down', amount = 3, scaleFactor = 1) {
  const x = phys(lx, scaleFactor), y = phys(ly, scaleFactor);
  // Positive = up, negative = down (Windows convention)
  const delta = direction === 'up' ? amount * 120 : -amount * 120;
  return runScript([
    `[MC]::SetCursorPos(${x}, ${y})`,
    `Start-Sleep -Milliseconds 40`,
    `[MC]::mouse_event([MC]::WHL, 0, 0, ${delta}, [UIntPtr]::Zero)`,
  ]);
}

function moveTo(lx, ly, scaleFactor = 1) {
  const x = phys(lx, scaleFactor), y = phys(ly, scaleFactor);
  return runScript([
    `[MC]::SetCursorPos(${x}, ${y})`,
  ]);
}

module.exports = { click, rightClick, doubleClick, scroll, moveTo };
