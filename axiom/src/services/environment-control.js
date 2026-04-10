'use strict';

/**
 * AXIOM Environment Control
 * Hardware/device control via PowerShell — Bluetooth, keyboard, mouse,
 * WiFi, display brightness, audio output switching, USB eject.
 *
 * Note: Disable/Enable device operations require admin.
 * AXIOM requests elevation automatically via RunAs when needed.
 */

const { exec } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

// ── PowerShell helpers ────────────────────────────────────────

/** Run a PS script string, resolve with stdout (or '' on error). */
function ps(script, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const tmp = path.join(os.tmpdir(), `axiom-env-${Date.now()}.ps1`);
    fs.writeFile(tmp, script, 'utf8', (writeErr) => {
      if (writeErr) { resolve(''); return; }
      exec(
        `powershell -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${tmp}"`,
        { windowsHide: true, timeout: timeoutMs },
        (err, stdout) => {
          fs.unlink(tmp, () => {});
          resolve(err ? '' : stdout.trim());
        }
      );
    });
  });
}

/** Run a PS script elevated (UAC prompt). */
function psElevated(script, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const tmp = path.join(os.tmpdir(), `axiom-elev-${Date.now()}.ps1`);
    fs.writeFile(tmp, script, 'utf8', (writeErr) => {
      if (writeErr) { resolve({ ok: false, error: 'Could not write script' }); return; }
      const cmd = `powershell -NoProfile -WindowStyle Hidden -Command "Start-Process powershell -ArgumentList '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \\"${tmp}\\"' -Verb RunAs -Wait"`;
      exec(cmd, { windowsHide: true, timeout: timeoutMs }, (err) => {
        fs.unlink(tmp, () => {});
        resolve(err ? { ok: false, error: err.message } : { ok: true });
      });
    });
  });
}

function ok()  { return { success: true }; }
function fail(e) { return { success: false, error: e }; }

// ── Bluetooth ─────────────────────────────────────────────────

/** List all paired/connected Bluetooth devices. */
async function listBluetoothDevices() {
  const out = await ps(`
Get-PnpDevice | Where-Object {
  $_.Class -in @('Bluetooth','BTHLEDevice') -and
  $_.FriendlyName -notlike '*Bluetooth*Adapter*' -and
  $_.FriendlyName -notlike '*Radio*'
} | Select-Object FriendlyName, Status, InstanceId |
  ForEach-Object { "$($_.FriendlyName)|$($_.Status)|$($_.InstanceId)" }
  `);
  if (!out) return [];
  return out.split('\n').map(l => {
    const [name, status, id] = l.trim().split('|');
    return { name: name?.trim(), status: status?.trim(), id: id?.trim() };
  }).filter(d => d.name);
}

/** Find a device by partial name (case-insensitive). */
async function findDevice(nameQuery) {
  const out = await ps(`
Get-PnpDevice | Where-Object {
  $_.FriendlyName -like '*${nameQuery.replace(/'/g, '')}*'
} | Select-Object -First 1 |
  ForEach-Object { "$($_.FriendlyName)|$($_.Status)|$($_.InstanceId)|$($_.Class)" }
  `);
  if (!out || !out.includes('|')) return null;
  const [name, status, id, cls] = out.trim().split('|');
  return { name: name?.trim(), status: status?.trim(), id: id?.trim(), class: cls?.trim() };
}

/** Disable a device by name (elevates if needed). */
async function disableDevice(nameQuery) {
  const device = await findDevice(nameQuery);
  if (!device) return fail(`Device "${nameQuery}" not found`);
  if (device.status === 'Error' || device.status === 'Unknown') return fail(`Device not available`);

  const result = await psElevated(`
Disable-PnpDevice -InstanceId '${device.id.replace(/'/g, "''")}' -Confirm:$false -ErrorAction Stop
  `);
  return result.ok ? ok() : fail(result.error);
}

/** Enable a device by name (elevates if needed). */
async function enableDevice(nameQuery) {
  const device = await findDevice(nameQuery);
  if (!device) return fail(`Device "${nameQuery}" not found`);

  const result = await psElevated(`
Enable-PnpDevice -InstanceId '${device.id.replace(/'/g, "''")}' -Confirm:$false -ErrorAction Stop
  `);
  return result.ok ? ok() : fail(result.error);
}

/** Disable the Bluetooth adapter entirely. */
async function bluetoothOff() {
  const result = await psElevated(`
Get-PnpDevice | Where-Object {
  $_.Class -eq 'Bluetooth' -and
  ($_.FriendlyName -like '*Adapter*' -or $_.FriendlyName -like '*Radio*')
} | ForEach-Object { Disable-PnpDevice -InstanceId $_.InstanceId -Confirm:$false }
  `);
  return result.ok ? ok() : fail(result.error);
}

/** Enable the Bluetooth adapter. */
async function bluetoothOn() {
  const result = await psElevated(`
Get-PnpDevice | Where-Object {
  $_.Class -eq 'Bluetooth' -and
  ($_.FriendlyName -like '*Adapter*' -or $_.FriendlyName -like '*Radio*')
} | ForEach-Object { Enable-PnpDevice -InstanceId $_.InstanceId -Confirm:$false }
  `);
  return result.ok ? ok() : fail(result.error);
}

// ── WiFi ──────────────────────────────────────────────────────

async function wifiOn() {
  const out = await ps(`netsh interface set interface "Wi-Fi" enabled; "ok"`);
  return out.includes('ok') || out === '' ? ok() : fail(out);
}

async function wifiOff() {
  const out = await ps(`netsh interface set interface "Wi-Fi" disabled; "ok"`);
  return out.includes('ok') || out === '' ? ok() : fail(out);
}

async function listWifiNetworks() {
  const out = await ps(`netsh wlan show networks mode=bssid | Select-String 'SSID' | ForEach-Object { $_.Line.Trim() }`);
  if (!out) return [];
  return out.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('BSSID'));
}

async function connectWifi(ssid, password = '') {
  // Add profile and connect
  const profileXml = `<?xml version="1.0"?><WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1"><name>${ssid}</name><SSIDConfig><SSID><name>${ssid}</name></SSID></SSIDConfig><connectionType>ESS</connectionType><connectionMode>auto</connectionMode><MSM><security><authEncryption><authentication>${password ? 'WPA2PSK' : 'open'}</authentication><encryption>${password ? 'AES' : 'none'}</encryption></authEncryption>${password ? `<sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>${password}</keyMaterial></sharedKey>` : ''}</security></MSM></WLANProfile>`;
  const tmpXml = path.join(os.tmpdir(), 'axiom-wifi.xml');
  fs.writeFileSync(tmpXml, profileXml, 'utf8');
  const out = await ps(`netsh wlan add profile filename="${tmpXml}" user=current; netsh wlan connect name="${ssid}"; "ok"`);
  fs.unlink(tmpXml, () => {});
  return out.includes('ok') ? ok() : fail('Could not connect to Wi-Fi network');
}

// ── Display ───────────────────────────────────────────────────

async function displayOff() {
  // Send monitor-off message via Windows API
  await ps(`
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Display {
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, int Msg, IntPtr wParam, IntPtr lParam);
  public static void Off() { SendMessage((IntPtr)0xFFFF, 0x0112, (IntPtr)0xF170, (IntPtr)2); }
}
"@
[Display]::Off()
  `);
  return ok();
}

async function setBrightness(level) {
  const pct = Math.max(0, Math.min(100, parseInt(level) || 50));
  const out = await ps(`
(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1, ${pct})
"ok"
  `);
  return out.includes('ok') ? ok() : fail('Brightness change not supported on this display');
}

// ── Audio output device switching ────────────────────────────

async function listAudioDevices() {
  const out = await ps(`
Get-CimInstance -Namespace root/cimv2 -ClassName Win32_SoundDevice |
  Where-Object { $_.Status -eq 'OK' } |
  Select-Object -ExpandProperty Name
  `);
  if (!out) return [];
  return out.split('\n').map(l => l.trim()).filter(Boolean);
}

async function setDefaultAudio(deviceName) {
  // Uses PowerShell AudioDeviceCmdlets if installed, otherwise nircmd approach
  const out = await ps(`
$devices = Get-CimInstance -Namespace root/cimv2 -ClassName Win32_SoundDevice
$match = $devices | Where-Object { $_.Name -like '*${deviceName.replace(/'/g, '')}*' } | Select-Object -First 1
if ($match) { "found: $($match.Name)" } else { "not found" }
  `);
  if (!out || out.includes('not found')) return fail(`Audio device "${deviceName}" not found`);
  // Windows doesn't expose easy API for default device switching without external tools
  // Open sound settings as fallback
  await ps(`Start-Process ms-settings:sound`);
  return { success: true, note: 'Opened sound settings — please select the device manually' };
}

// ── USB Eject ─────────────────────────────────────────────────

async function ejectUsb(driveLetter) {
  const drive = driveLetter.replace(':', '').toUpperCase();
  const out = await ps(`
$shell = New-Object -ComObject Shell.Application
$drive = $shell.Namespace(17).ParseName("${drive}:")
if ($drive) { $drive.InvokeVerb("Eject"); "ok" } else { "not found" }
  `);
  return out.includes('ok') ? ok() : fail(`Drive ${drive}: not found or already ejected`);
}

// ── Main dispatcher ───────────────────────────────────────────

async function executeEnvironmentAction(action) {
  switch (action.type) {
    case 'bt_on':           return bluetoothOn();
    case 'bt_off':          return bluetoothOff();
    case 'bt_list':         return { success: true, devices: await listBluetoothDevices() };
    case 'device_disable':  return disableDevice(action.device);
    case 'device_enable':   return enableDevice(action.device);
    case 'wifi_on':         return wifiOn();
    case 'wifi_off':        return wifiOff();
    case 'wifi_list':       return { success: true, networks: await listWifiNetworks() };
    case 'wifi_connect':    return connectWifi(action.ssid, action.password);
    case 'display_off':     return displayOff();
    case 'brightness':      return setBrightness(action.level);
    case 'audio_list':      return { success: true, devices: await listAudioDevices() };
    case 'audio_switch':    return setDefaultAudio(action.device);
    case 'usb_eject':       return ejectUsb(action.drive);
    default:                return fail(`Unknown environment action: ${action.type}`);
  }
}

module.exports = { executeEnvironmentAction, listBluetoothDevices, findDevice, listAudioDevices, listWifiNetworks };
