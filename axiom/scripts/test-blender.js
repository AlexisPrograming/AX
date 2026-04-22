// Quick test: send a command to Blender MCP server and show raw response
const net = require('net');

const HOST = '127.0.0.1';
const PORT = 9876;

function test(type, params = {}) {
  return new Promise((resolve) => {
    const client = new net.Socket();
    let buffer = '';
    client.setTimeout(5000);
    client.connect(PORT, HOST, () => {
      console.log(`[CONNECT] OK — sending ${type}`);
      client.write(JSON.stringify({ type, params }) + '\n');
    });
    client.on('data', (d) => {
      buffer += d.toString();
      console.log('[RAW DATA]', d.toString().slice(0, 200));
    });
    client.on('close', () => resolve(buffer));
    client.on('timeout', () => { console.log('[TIMEOUT]'); client.destroy(); resolve(null); });
    client.on('error', (e) => { console.log('[ERROR]', e.message); resolve(null); });
  });
}

(async () => {
  console.log('=== Test 1: get_scene_info ===');
  const r1 = await test('get_scene_info');
  console.log('Response (first 400 chars):', (r1 || '').slice(0, 400));

  console.log('\n=== Test 2: execute_code (add cube) ===');
  const r2 = await test('execute_code', { code: 'import bpy; bpy.ops.mesh.primitive_cube_add(location=(0,0,3)); "ok"' });
  console.log('Response:', (r2 || '').slice(0, 400));
})();
