const { exec } = require('child_process');

// Allowlist of safe commands/patterns
const ALLOWED_PATTERNS = [
  /^start\s+\w+/i,           // open apps
  /^notepad/i,
  /^calc/i,
  /^explorer/i,
  /^tasklist/i,
  /^systeminfo/i,
  /^echo\s+/i,
  /^dir\s+/i,
];

function isSafe(command) {
  return ALLOWED_PATTERNS.some((pattern) => pattern.test(command.trim()));
}

async function execute(command) {
  if (!isSafe(command)) {
    return { success: false, error: 'Command not allowed for safety reasons' };
  }

  return new Promise((resolve) => {
    exec(command, { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ success: false, error: stderr || err.message });
      } else {
        resolve({ success: true, output: stdout.trim() });
      }
    });
  });
}

module.exports = { execute };
