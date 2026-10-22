import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApkInstaller } from '../desktop/apk-installer.mjs';

async function fixture(t, script = "console.log('Performing Streamed Install\\nSuccess');", options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'bkdm-apk-'));
  const file = join(root, '示例 app $(not-a-command).apk');
  // Only the ZIP marker is needed here; Android validates APK contents in real installs.
  await writeFile(file, Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]));
  const adb = join(root, 'fake-adb.mjs'), log = join(root, 'argv.json');
  await writeFile(adb, `#!${process.execPath}\nimport {writeFileSync} from 'node:fs';\nwriteFileSync(${JSON.stringify(log)},JSON.stringify(process.argv.slice(2)));\n${script}\n`);
  await chmod(adb, 0o700);
  const events = [], devices = [{ serial: 'first-device', state: 'device', model: 'Phone One' }, { serial: 'target-device', state: 'device', model: 'Phone Two' }];
  const installer = createApkInstaller({ adbPath: adb, getDevices: async () => devices, onChange: state => events.push(state), ...options });
  t.after(async () => { installer.stop(); await rm(root, { recursive: true, force: true }); });
  return { installer, file, root, log, events, devices };
}

test('APK installation targets the explicit device with argv, keeps paths private, and only succeeds on ADB Success', async t => {
  const { installer, file, log, events } = await fixture(t);
  const state = await installer.select(file);
  assert.equal(state.phase, 'ready');
  assert.equal(state.file.name, '示例 app $(not-a-command).apk');
  assert.equal(JSON.stringify(state).includes(file), false);
  const result = await installer.install({ fileId: state.file.id, serial: 'target-device' });
  assert.equal(result.phase, 'success');
  assert.equal(result.device.model, 'Phone Two');
  assert.deepEqual(JSON.parse(await readFile(log, 'utf8')), ['-s', 'target-device', 'install', '-r', file]);
  assert.deepEqual(events.map(event => event.phase), ['ready', 'checking', 'installing', 'success']);
  assert.ok(events.every((event, index) => event.revision === index + 1));
  const snapshot = installer.state(); snapshot.file.name = 'tampered';
  assert.notEqual(installer.state().file.name, 'tampered');
});

test('APK selection validates extension, ZIP marker, missing files, and empty files', async t => {
  const { installer, root } = await fixture(t);
  for (const name of ['not-an-apk.txt', 'empty.apk', 'invalid.apk']) await writeFile(join(root, name), name === 'invalid.apk' ? 'not a zip' : '');
  await assert.rejects(installer.select(join(root, 'not-an-apk.txt')), /\.apk/);
  await assert.rejects(installer.select(join(root, 'empty.apk')), /非空/);
  await assert.rejects(installer.select(join(root, 'invalid.apk')), /APK \/ ZIP/);
  await assert.rejects(installer.select(join(root, 'missing.apk')), /移动或删除/);
  await assert.rejects(installer.select('relative.apk'), /本地/);
  assert.equal(installer.state().phase, 'idle');
});

test('APK installation revalidates authorization and never falls back to another connected device', async t => {
  const { installer, file, devices, log } = await fixture(t);
  const { file: selected } = await installer.select(file);
  devices[1].state = 'unauthorized';
  let result = await installer.install({ fileId: selected.id, serial: 'target-device' });
  assert.equal(result.phase, 'error'); assert.match(result.message, /未连接或尚未授权/);
  devices.pop();
  result = await installer.install({ fileId: selected.id, serial: 'target-device' });
  assert.equal(result.phase, 'error');
  await assert.rejects(readFile(log), { code: 'ENOENT' });
  await assert.rejects(installer.install({ fileId: 'arbitrary-path.apk', serial: 'first-device' }), /选择已失效/);
  await assert.rejects(installer.install({ fileId: selected.id, serial: '' }), /已授权/);
});

test('APK selection tokens expire and file changes or deletion prevent installation', async t => {
  const { installer, file, log } = await fixture(t);
  const first = await installer.select(file);
  const second = await installer.select(file);
  await assert.rejects(installer.install({ fileId: first.file.id, serial: 'target-device' }), /选择已失效/);
  await writeFile(file, Buffer.from([0x50, 0x4b, 0x03, 0x04, 8, 9, 10, 11, 12]));
  const changed = await installer.install({ fileId: second.file.id, serial: 'target-device' });
  assert.equal(changed.phase, 'error'); assert.match(changed.message, /发生了变化/);
  const current = await installer.select(file); await rm(file);
  const removed = await installer.install({ fileId: current.file.id, serial: 'target-device' });
  assert.equal(removed.phase, 'error'); assert.match(removed.message, /移动或删除/);
  await assert.rejects(readFile(log), { code: 'ENOENT' });
});

test('APK installation refuses concurrent starts and file reselection while checking a device', async t => {
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  const { installer, file, devices } = await fixture(t, undefined, { getDevices: () => ready });
  const selected = await installer.select(file);
  const installing = installer.install({ fileId: selected.file.id, serial: 'target-device' });
  assert.equal(installer.state().phase, 'checking');
  await assert.rejects(installer.install({ fileId: selected.file.id, serial: 'first-device' }), /正在安装/);
  await assert.rejects(installer.select(file), /正在安装/);
  release(devices);
  assert.equal((await installing).phase, 'success');
});

for (const [code, message, exit] of [
  ['INSTALL_FAILED_UPDATE_INCOMPATIBLE', /签名/, 1],
  ['INSTALL_FAILED_VERSION_DOWNGRADE', /版本低于/, 1],
  ['INSTALL_FAILED_USER_RESTRICTED', /设备拒绝/, 1],
  ['INSTALL_FAILED_INSUFFICIENT_STORAGE', /存储空间不足/, 0],
  ['INSTALL_FAILED_MISSING_SPLIT', /拆分 APK/, 1]
]) {
  test(`APK installer explains ${code} without claiming success`, async t => {
    const { installer, file } = await fixture(t, `console.error('Failure [${code}: detail]'); process.exit(${exit});`);
    const selected = await installer.select(file);
    const result = await installer.install({ fileId: selected.file.id, serial: 'target-device' });
    assert.equal(result.phase, 'error'); assert.equal(result.code, code); assert.match(result.message, message); assert.match(result.details, /Failure/);
  });
}

test('APK installer handles disconnects and missing ADB success output', async t => {
  for (const script of ["console.error(\"adb: device 'target-device' not found\"); process.exit(1);", "console.log('Performing Streamed Install');"]) {
    const { installer, file } = await fixture(t, script);
    const selected = await installer.select(file);
    const result = await installer.install({ fileId: selected.file.id, serial: 'target-device' });
    assert.equal(result.phase, 'error'); assert.match(result.message, /连接中断|安装失败/);
  }
});

test('APK installer reports timeouts as uncertain and aborts owned processes when stopping', async t => {
  const { installer, file } = await fixture(t, 'setTimeout(() => console.log("Success"), 5000);', { timeoutMs: 150 });
  const selected = await installer.select(file);
  const result = await installer.install({ fileId: selected.file.id, serial: 'target-device' });
  assert.equal(result.phase, 'error'); assert.match(result.message, /超时/);
  const again = installer.install({ fileId: selected.file.id, serial: 'target-device' });
  installer.stop();
  assert.equal((await again).phase, 'error');
  await assert.rejects(installer.select(file), /已停止/);
});
