import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNetwork, parsePressure, parseThermal, parseAppStat, parseAppMemory, countOnline, parseForeground, validPackage, shellQuote } from '../telemetry.mjs';

test('network rates use elapsed time, exclude loopback/VPN duplicates and reject reset counters', () => {
  const text = (rx, tx) => ` wlan0: ${rx} 0 0 0 0 0 0 0 ${tx} 0 0 0 0 0 0 0\n lo: 999999 0 0 0 0 0 0 0 999999\n tun0: 999999 0 0 0 0 0 0 0 999999`;
  const first = parseNetwork(text(100, 50), null, 1000);
  assert.equal(first.downloadBps, null);
  const next = parseNetwork(text(1100, 250), first, 3000);
  assert.equal(next.downloadBps, 500); assert.equal(next.uploadBps, 100);
  assert.deepEqual(next.interfaces, ['wlan0']); assert.equal(parseNetwork(text(1, 1), next, 4000).downloadBps, null);
});
test('memory pressure separates unavailable PSI from available paging counters', () => {
  const a = parsePressure('', 'pswpin 100\npswpout 200\npgmajfault 20\noom_kill 2', null, 1000);
  const b = parsePressure('some avg10=3.12 avg60=1.00 avg300=0.10 total=1\nfull avg10=0.50 avg60=0.20 avg300=0 total=1', 'pswpin 110\npswpout 220\npgmajfault 22\noom_kill 2', a, 3000);
  assert.equal(a.some, null); assert.equal(b.some.avg10, 3.12); assert.equal(b.full.avg10, .5);
  assert.equal(b.swapInPagesPerSec, 5); assert.equal(b.swapOutPagesPerSec, 10); assert.equal(b.majorFaultsPerSec, 1);
});
test('thermal categories use named sensors and reject invalid readings', () => {
  const result = parseThermal('Thermal Status: 0\nCoolingDevice{mValue=3, mType=2, mName=thermal-cpu}', 'cpuss-0-usr 65800\ncpuss-1-usr 69100\ngpuss-0-usr 77000\nmodem-skin-usr 39000\nsocd -274000\nbattery unavailable');
  assert.equal(result.level, 0); assert.equal(result.cpu, 69.1); assert.equal(result.gpu, 77); assert.equal(result.skin, 39);
  assert.equal(result.temperatures.length, 4); assert.equal(result.coolingDevices[0].value, 3);
});
test('application CPU uses interval deltas and resets on process restart', () => {
  const stat = (utime, start) => { const fields = Array(30).fill('0'); fields[0] = 'S'; fields[11] = String(utime); fields[12] = '10'; fields[17] = '94'; fields[19] = String(start); return `3570 (app (render)) ${fields.join(' ')}`; };
  const first = parseAppStat(stat(100, 1), null, 1000, 'com.example.app');
  assert.equal(first.cpu, null); assert.equal(first.threads, 94);
  assert.equal(parseAppStat(stat(110, 1), first.counter, 1200, 'com.example.app').cpu, 5);
  assert.equal(parseAppStat(stat(110, 2), first.counter, 1200, 'com.example.app').cpu, null);
  assert.equal(parseAppStat('Permission denied', null, 100, 'com.example.app').cpu, null);
  assert.deepEqual(parseAppMemory('TOTAL PSS: 1024 TOTAL RSS: 2048'), { pssBytes: 1048576, rssBytes: 2097152 });
});
test('online cores, foreground identity and shell input handling are strict', () => {
  assert.equal(countOnline('0-3,6-7'), 6); assert.equal(countOnline('unavailable'), null);
  assert.equal(parseForeground('topResumedActivity=ActivityRecord{abc u0 com.miui.home/.Launcher t2}'), 'com.miui.home');
  assert.equal(validPackage('com.example.app'), true); assert.equal(validPackage('com.app;id'), false);
  assert.equal(shellQuote("a'b"), "'a'\\''b'");
});
