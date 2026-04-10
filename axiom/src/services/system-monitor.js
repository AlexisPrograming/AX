'use strict';

/**
 * AXIOM System Monitor
 * Gathers CPU, RAM, disk, temps, and connected devices via PowerShell/WMI.
 * All queries are fire-and-forget with a 10s timeout so they never block AXIOM.
 */

const { exec } = require('child_process');

function ps(script, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const proc = exec(
      `powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "${script.replace(/"/g, '\\"')}"`,
      { windowsHide: true, timeout: timeoutMs },
      (err, stdout) => resolve(err ? '' : stdout.trim())
    );
    proc.on('error', () => resolve(''));
  });
}

// ── CPU usage (%) ─────────────────────────────────────────────
async function getCpuUsage() {
  const out = await ps(`(Get-Counter '\\\\Processor(_Total)\\\\% Processor Time' -SampleInterval 1 -MaxSamples 1).CounterSamples.CookedValue`);
  const val = parseFloat(out);
  return isNaN(val) ? null : Math.round(val);
}

// ── RAM (used / total in GB) ──────────────────────────────────
async function getRam() {
  const out = await ps(`
$os = Get-CimInstance Win32_OperatingSystem;
$total = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1);
$free  = [math]::Round($os.FreePhysicalMemory     / 1MB, 1);
$used  = [math]::Round($total - $free, 1);
"$used/$total"
  `.trim());
  if (!out || !out.includes('/')) return null;
  const [used, total] = out.split('/').map(Number);
  return { usedGB: used, totalGB: total, pct: Math.round((used / total) * 100) };
}

// ── Disk (C: drive usage) ─────────────────────────────────────
async function getDisk() {
  const out = await ps(`
$d = Get-PSDrive C;
$used  = [math]::Round($d.Used  / 1GB, 1);
$free  = [math]::Round($d.Free  / 1GB, 1);
$total = [math]::Round(($d.Used + $d.Free) / 1GB, 1);
"$used/$total"
  `.trim());
  if (!out || !out.includes('/')) return null;
  const [used, total] = out.split('/').map(Number);
  return { usedGB: used, totalGB: total, pct: Math.round((used / total) * 100) };
}

// ── CPU temperature (requires WMI thermal zone — may need admin) ─
async function getCpuTemp() {
  const out = await ps(`
try {
  $t = Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -EA Stop;
  $celsius = [math]::Round(($t[0].CurrentTemperature / 10) - 273.15, 1);
  "$celsius"
} catch { "unavailable" }
  `.trim());
  if (!out || out === 'unavailable') return null;
  const val = parseFloat(out);
  return isNaN(val) ? null : val;
}

// ── GPU info ──────────────────────────────────────────────────
async function getGpu() {
  const out = await ps(`
$g = Get-CimInstance Win32_VideoController | Select-Object -First 1;
if ($g) { "$($g.Name)|$([math]::Round($g.AdapterRAM/1MB))MB" } else { '' }
  `.trim());
  if (!out || !out.includes('|')) return null;
  const [name, vram] = out.split('|');
  return { name: name.trim(), vram: vram.trim() };
}

// ── Connected USB/HID devices ─────────────────────────────────
async function getConnectedDevices() {
  const out = await ps(`
Get-PnpDevice -Status OK |
  Where-Object { $_.Class -in @('HIDClass','USB','AudioEndpoint','Keyboard','Mouse','Image','Media') } |
  Select-Object -ExpandProperty FriendlyName |
  Sort-Object -Unique
  `.trim());
  if (!out) return [];
  return out.split('\n').map(l => l.trim()).filter(Boolean);
}

// ── Network adapters (active) ─────────────────────────────────
async function getNetwork() {
  const out = await ps(`
Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } |
  ForEach-Object { "$($_.Name): $($_.LinkSpeed)" } |
  Out-String -Width 200
  `.trim());
  if (!out) return [];
  return out.split('\n').map(l => l.trim()).filter(Boolean);
}

// ── Full stats snapshot ───────────────────────────────────────
async function getFullStats() {
  const [cpu, ram, disk, temp, gpu, devices, net] = await Promise.all([
    getCpuUsage(),
    getRam(),
    getDisk(),
    getCpuTemp(),
    getGpu(),
    getConnectedDevices(),
    getNetwork(),
  ]);

  return { cpu, ram, disk, temp, gpu, devices, net, timestamp: Date.now() };
}

// ── Human-readable summary for AXIOM to speak ────────────────
function formatStats(stats) {
  const parts = [];

  if (stats.cpu !== null) parts.push(`CPU at ${stats.cpu}%`);
  if (stats.ram) parts.push(`RAM ${stats.ram.usedGB}GB of ${stats.ram.totalGB}GB used`);
  if (stats.disk) parts.push(`Disk ${stats.disk.usedGB}GB of ${stats.disk.totalGB}GB used`);
  if (stats.temp !== null) parts.push(`CPU temp ${stats.temp}°C`);
  if (stats.gpu) parts.push(`GPU: ${stats.gpu.name}`);
  if (stats.devices?.length) parts.push(`Devices: ${stats.devices.slice(0, 5).join(', ')}`);

  // Proactive warnings
  const warnings = [];
  if (stats.cpu > 85) warnings.push(`CPU is pretty high at ${stats.cpu}%`);
  if (stats.ram?.pct > 85) warnings.push(`RAM is running low — ${stats.ram.pct}% used`);
  if (stats.disk?.pct > 90) warnings.push(`Disk is almost full — ${stats.disk.pct}% used`);
  if (stats.temp > 85) warnings.push(`CPU temperature is high at ${stats.temp}°C`);

  return { summary: parts.join('. '), warnings };
}

module.exports = { getFullStats, getCpuUsage, getRam, getDisk, getCpuTemp, getGpu, getConnectedDevices, getNetwork, formatStats };
