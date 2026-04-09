'use strict';

/**
 * AXIOM Voice Auth Client
 * Sends audio to the local Python speaker-verification server and returns
 * true if the voice matches the enrolled user, false otherwise.
 *
 * Server must be running:  cd D:\AX\voice-auth && python server.py
 */

const http = require('http');

const SERVER_HOST = '127.0.0.1';
const SERVER_PORT = 8080;

// Cache the server status so we don't block every command on a dead server
let serverAvailable = null;        // null = unknown, true/false = checked
let lastCheckAt     = 0;
const CHECK_TTL_MS  = 30_000;      // re-check every 30 s

// ── Internal helpers ────────────────────────────────────────────

function httpPost(path, body, contentType = 'application/octet-stream') {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: SERVER_HOST,
      port:     SERVER_PORT,
      path,
      method:   'POST',
      headers:  {
        'Content-Type':   contentType,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error(`Bad JSON from voice-auth server: ${raw}`)); }
      });
    });

    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Voice-auth request timeout')); });
    req.write(body);
    req.end();
  });
}

async function pingServer() {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: SERVER_HOST, port: SERVER_PORT, path: '/health' },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on('error', () => resolve(false));
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
  });
}

async function isServerUp() {
  const now = Date.now();
  if (serverAvailable !== null && now - lastCheckAt < CHECK_TTL_MS) {
    return serverAvailable;
  }
  serverAvailable = await pingServer();
  lastCheckAt     = now;
  return serverAvailable;
}

// ── Public API ──────────────────────────────────────────────────

/**
 * verify(audioBuffer)
 * @param {Buffer} audioBuffer  WAV audio bytes
 * @returns {Promise<{ verified: boolean, score: number, available: boolean }>}
 *   available = false means the server is not running (fail-open by default)
 */
async function verify(audioBuffer) {
  const up = await isServerUp();
  if (!up) {
    return { verified: true, score: null, available: false };
  }

  try {
    const result = await httpPost('/verify', audioBuffer, 'audio/wav');
    return {
      verified:  result.verified ?? false,
      score:     result.score    ?? 0,
      available: true,
    };
  } catch (err) {
    console.error('[VoiceAuth] verify error:', err.message);
    serverAvailable = null; // force re-check next time
    return { verified: true, score: null, available: false }; // fail-open
  }
}

/**
 * isAvailable()
 * Quick check — use before showing any voice-auth UI.
 */
async function isAvailable() {
  return isServerUp();
}

module.exports = { verify, isAvailable };
