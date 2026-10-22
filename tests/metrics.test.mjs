import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCpu, parseMemory, parseGpu, parseBattery, parseProcesses } from '../metrics.mjs';

test('CPU uses interval deltas, excludes guest double counting, and treats first sample as unknown', () => {
  const first = parseCpu('cpu  100 0 50 850 0 0 0 0 10 0\ncpu0 100 0 50 850 0 0 0 0 10 0');
  assert.equal(first.total, null);
  const second = parseCpu('cpu 120 0 60 920 0 0 0 0 15 0\ncpu0 120 0 60 920 0 0 0 0 15 0', first.counters);
  assert.ok(Math.abs(second.total - 30) < .0001);
  assert.equal(second.cores.length, 1);
  assert.equal(parseCpu('cpu 1 0 0 2', first.counters).total, null);
});
test('memory uses MemAvailable, rather than counting reclaimable cache as occupied', () => {
  const mem = parseMemory('MemTotal: 1000 kB\nMemFree: 100 kB\nMemAvailable: 400 kB\nCached: 300 kB\nSwapTotal: 500 kB\nSwapFree: 200 kB');
  assert.equal(mem.usage, 60); assert.equal(mem.used, 600 * 1024); assert.equal(mem.swapUsed, 300 * 1024);
  assert.equal(parseMemory('').usage, null);
});
test('GPU rejects inaccessible and zero windows without fabricating a measurement', () => {
  assert.equal(parseGpu(' 403823 1007011'), 403823 / 1007011 * 100);
  assert.equal(parseGpu('Permission denied'), null); assert.equal(parseGpu('0 0'), null);
  assert.equal(parseGpu('0 100'), 0);
});
test('battery uses tenths of a degree and honors battery scale', () => {
  assert.deepEqual(parseBattery(' level: 87\n scale: 100\n temperature: 350\n status: 2\n voltage: 4336'), { level: 87, temperature: 35, charging: true, voltage: 4.336 });
  assert.equal(parseBattery('').temperature, null);
});
test('process CPU is normalized and sampler itself is omitted', () => {
  const top = '  PID USER PR NI VIRT RES SHR S[%CPU] %MEM TIME+ ARGS\n 123 system 20 0 1G 50M 2M S 80.0 0.4 0:01.0 system_server\n 124 shell 20 0 1G 5M 2M R 20.0 0.1 0:01.0 top -b -n 1\n 125 shell 20 0 1G 5M 2M R 20.0 0.1 0:01.0 sh -c echo __CPU__; head -n 10 /proc/stat';
  const rows = parseProcesses(top, 8); assert.equal(rows.length, 1); assert.equal(rows[0].cpu, 10); assert.equal(rows[0].name, 'system_server');
});
