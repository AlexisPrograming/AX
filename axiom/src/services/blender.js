// AXIOM ↔ Blender bridge
// Connects directly to the BlenderMCP addon TCP server on port 9876.
// No Claude Desktop or uvx needed — AXIOM talks to Blender natively.

'use strict';

const net = require('net');

const HOST       = '127.0.0.1';
const PORT       = 9876;
const TIMEOUT_MS = 15000; // 15 s — heavy ops (subdivide, boolean) can be slow
const CHECK_MS   = 2000;  // quick probe timeout

// ── Low-level send/receive ────────────────────────────────────

function sendCommand(type, params = {}) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let buffer   = '';
    let settled  = false;

    function done(val) {
      if (settled) return;
      settled = true;
      client.destroy();
      resolve(val);
    }
    function fail(err) {
      if (settled) return;
      settled = true;
      client.destroy();
      reject(err);
    }

    client.setTimeout(TIMEOUT_MS);
    client.connect(PORT, HOST, () => {
      // BlenderMCP addon expects newline-terminated JSON
      const msg = JSON.stringify({ type, params }) + '\n';
      client.write(msg);
    });

    client.on('data', (chunk) => {
      buffer += chunk.toString();
      const trimmed = buffer.trim();
      // Try to parse as soon as it looks like a complete JSON object/array
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
          (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          done(JSON.parse(trimmed));
        } catch { /* keep buffering */ }
      }
    });

    client.on('close', () => {
      if (settled) return;
      const trimmed = buffer.trim();
      if (trimmed) {
        try { done(JSON.parse(trimmed)); }
        catch { fail(new Error('Invalid JSON from Blender server')); }
      } else {
        fail(new Error('Connection closed with no response'));
      }
    });

    client.on('timeout', () => fail(new Error('Blender server timed out')));
    client.on('error',   (err) => fail(err));
  });
}

// ── Public API ────────────────────────────────────────────────

/**
 * Returns true if the BlenderMCP server is up and reachable.
 */
function isRunning() {
  return new Promise((resolve) => {
    const client = new net.Socket();
    client.setTimeout(CHECK_MS);
    client.connect(PORT, HOST, () => { client.destroy(); resolve(true); });
    client.on('error',   () => resolve(false));
    client.on('timeout', () => { client.destroy(); resolve(false); });
  });
}

/**
 * Execute arbitrary Python (bpy) code inside Blender.
 * Returns { status: 'success'|'error', result, error }
 */
async function executeCode(code) {
  return sendCommand('execute_code', { code });
}

/**
 * Returns an object describing every item in the current scene.
 */
async function getSceneInfo() {
  return sendCommand('get_scene_info', {});
}

/**
 * Returns position, rotation, scale, material, and mesh info for one object.
 */
async function getObjectInfo(name) {
  return sendCommand('get_object_info', { name });
}

/**
 * Returns a readable summary of the scene for AXIOM to speak.
 */
async function describeScene() {
  try {
    const info = await getSceneInfo();
    if (!info || info.status === 'error') return 'Could not read the scene.';

    const objects = info.result?.objects || info.objects || [];
    if (!objects.length) return 'The scene is empty.';

    const names = objects.map(o => o.name || o).slice(0, 8).join(', ');
    const count = objects.length;
    return `Your scene has ${count} object${count !== 1 ? 's' : ''}: ${names}${count > 8 ? ' and more' : ''}.`;
  } catch {
    return 'Could not read the Blender scene.';
  }
}

module.exports = { isRunning, executeCode, getSceneInfo, getObjectInfo, describeScene };
