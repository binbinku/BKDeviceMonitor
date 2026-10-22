import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { createMonitor } from '../monitor.mjs';
import { resolveAdb } from '../desktop/adb.mjs';

test('desktop engine streams real sampler output and records sessions without listening on a port', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bkdm-desktop-'));
  const adb = join(directory, 'adb.mjs');
  const sample = '__PROPS__\nro.product.model=DesktopPhone\n__CPUMAX__\ncpu0 1000000\n__CPU__\ncpu 100 0 50 850 0 0 0 0\ncpu0 100 0 50 850 0 0 0 0\n__MEM__\nMemTotal: 1000 kB\nMemAvailable: 400 kB\n__GPU__\n1 100\n';
  await writeFile(adb, `#!${process.execPath}\nif(process.argv[2]==='devices') console.log('List of devices attached\\nserial device model:DesktopPhone\\n'); else if(process.argv.includes('shell')) process.stdout.write(${JSON.stringify(sample)});`);
  await chmod(adb, 0o700);
  const listen = net.Server.prototype.listen;
  net.Server.prototype.listen = () => { throw new Error('Desktop must not listen on a socket'); };
  const monitor = createMonitor({ adbPath: adb });
  const events = [];
  const unsubscribe = monitor.subscribe((name, data) => events.push({ name, data }));
  try {
    await monitor.start();
    assert.equal(monitor.state().connected, true);
    assert.equal(monitor.state().selected, 'serial');
    assert.equal(events.at(-1).name, 'sample');
    assert.equal(events.at(-1).data.memory.usage, 60);
    assert.equal((await monitor.request('/api/session?action=start&label=desktop', 'POST')).status, 200);
    assert.equal((await monitor.request('/api/session?action=stop', 'POST')).data.active, false);
    const report = await monitor.request('/api/session/report');
    assert.equal(report.status, 200); assert.equal(report.data.device.serial, 'serial');
    assert.equal((await monitor.request('/api/target?package=x%3Bcmd', 'POST')).status, 400);
    assert.equal((await monitor.request('/api/device?serial=missing', 'POST')).status, 400);
    assert.equal((await monitor.request('https://example.com/api/state')).status, 400);
    assert.equal((await monitor.request('/api/state', 'DELETE')).status, 400);
    unsubscribe(); monitor.stop();
    const count = events.length;
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.equal(events.length, count);
  } finally { monitor.stop(); net.Server.prototype.listen = listen; await rm(directory, { recursive: true, force: true }); }
});

test('ADB resolution selects bundled Windows executable and honors explicit overrides', async () => {
  const resourcesPath = await mkdtemp(join(tmpdir(), 'bkdm-adb-'));
  try {
    await mkdir(join(resourcesPath, 'platform-tools'));
    const executable = join(resourcesPath, 'platform-tools', 'adb.exe');
    await writeFile(executable, 'fixture');
    assert.equal(await resolveAdb({ platform: 'win32', resourcesPath, env: {} }), executable);
    const override = join(resourcesPath, 'custom-adb.exe'); await writeFile(override, 'fixture');
    assert.equal(await resolveAdb({ platform: 'win32', resourcesPath, env: { ADB_PATH: override } }), override);
  } finally { await rm(resourcesPath, { recursive: true, force: true }); }
});
