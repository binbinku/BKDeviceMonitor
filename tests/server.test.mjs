import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

async function withServer(deviceOutput, check) {
  const dir = await mkdtemp(join(tmpdir(), 'bkdm-test-'));
  const fake = join(dir, 'adb.mjs');
  const deviceFile = join(dir, 'devices.txt');
  await writeFile(deviceFile, deviceOutput);
  const mockSample = '__PROPS__\nro.product.model=TestPhone\nro.product.manufacturer=Test\nro.product.cpu.abilist=arm64-v8a\n__CPUMAX__\ncpu0 1000000\n__CPU__\ncpu 100 0 50 850 0 0 0 0\ncpu0 100 0 50 850 0 0 0 0\n__MEM__\nMemTotal: 1000 kB\nMemAvailable: 400 kB\n__GPU__\n1 100\n__FREQ__\ncpu0 500000\n';
  await writeFile(fake, `#!${process.execPath}\nimport {readFileSync} from 'node:fs';\nif (process.argv[2] === 'devices') process.stdout.write(readFileSync(process.env.FAKE_ADB_DEVICE_FILE,'utf8'));\nelse if(process.argv.includes('shell')) process.stdout.write(${JSON.stringify(mockSample)});\n`);
  await chmod(fake, 0o700);
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, PORT: String(port), ADB_PATH: fake, FAKE_ADB_DEVICE_FILE: deviceFile },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 5000);
      child.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
      child.once('error', error => { clearTimeout(timeout); reject(error); });
    });
    const base = `http://127.0.0.1:${port}`;
    // The device endpoint must await an already-running discovery operation.
    await fetch(base + '/api/devices');
    await check(base, deviceFile);
  } finally {
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM'); await exited;
    }
    await rm(dir, { recursive: true, force: true });
  }
}

test('server reports no device and rejects invalid selection and foreign origins', async () => {
  await withServer('List of devices attached\n\n', async base => {
    const state = await (await fetch(base + '/api/state')).json();
    assert.equal(state.connected, false); assert.match(state.message, /未连接设备/);
    assert.equal(state.latest, null); assert.deepEqual(state.history, []);
    assert.equal((await fetch(base + '/api/device?serial=unknown', { method: 'POST' })).status, 400);
    assert.equal((await fetch(base + '/api/device?serial=unknown', { method: 'POST', headers: { Origin: 'https://example.com' } })).status, 403);
    assert.equal((await fetch(base + '/missing-file')).status, 404);
    assert.equal((await fetch(base + '/')).status, 200);
    assert.equal(await (await fetch(base + '/api/session')).json(), null);
    assert.equal((await fetch(base + '/api/session/report')).status, 404);
    assert.equal((await fetch(base + '/api/session?action=start', { method: 'POST' })).status, 409);
    assert.equal((await fetch(base + '/api/target?package=com.app%3Bid', { method: 'POST' })).status, 400);
    assert.equal((await fetch(base + '/api/session?action=invalid', { method: 'POST' })).status, 400);
  });
});

test('unauthorized device gives an actionable USB authorization message', async () => {
  await withServer('List of devices attached\nexample unauthorized usb:1\n', async base => {
    const state = await (await fetch(base + '/api/state')).json();
    assert.equal(state.connected, false); assert.match(state.message, /允许 USB 调试/);
    assert.equal(state.devices[0].state, 'unauthorized'); assert.equal(state.selected, null);
  });
});

test('active session automatically ends when its selected device disconnects', async () => {
  await withServer('List of devices attached\nmockserial device model:TestPhone\n', async (base, deviceFile) => {
    const events = await fetch(base + '/api/events', { signal: AbortSignal.timeout(5000) });
    const reader = events.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error('SSE ended before a sample');
      const text = new TextDecoder().decode(value);
      if (text.includes('event: sample') || text.includes('"connected":true')) break;
    }
    await reader.cancel();
    const start = await fetch(base + '/api/session?action=start', { method: 'POST' });
    assert.equal(start.status, 200); assert.equal((await start.json()).active, true);
    await writeFile(deviceFile, 'List of devices attached\n\n');
    await fetch(base + '/api/devices');
    const session = await (await fetch(base + '/api/session')).json();
    assert.equal(session.active, false); assert.equal(session.events.at(-1).message, '设备连接中断');
    const report = await (await fetch(base + '/api/session/report')).json();
    assert.equal(report.device.serial, 'mockserial'); assert.ok(Array.isArray(report.samples));
  });
});
