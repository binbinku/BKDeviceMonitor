import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeProto, parseTrace, percentile } from '../trace.mjs';

const varint = value => { let n = BigInt.asUintN(64, BigInt(value)); const bytes = []; while (n > 127n) { bytes.push(Number(n & 127n) | 128); n >>= 7n; } bytes.push(Number(n)); return Buffer.from(bytes); };
const field = (id, value) => Buffer.isBuffer(value) ? Buffer.concat([varint(id * 8 + 2), varint(value.length), value]) : Buffer.concat([varint(id * 8), varint(value)]);
const message = (...fields) => Buffer.concat(fields);
const packet = (ts, type, fields) => field(1, message(field(8, ts), field(76, field(type, message(...fields)))));

test('FrameTimeline correlates presentation timestamps and never sums duplicate app surfaces', () => {
  const packets = [], base = 2n ** 60n, interval = 16666667n;
  for (let i = 0; i < 10; i++) {
    const t = base + BigInt(i) * interval, token = 1000 + i;
    packets.push(packet(t, 2, [field(1, 100 + i), field(2, token), field(3, 10)]));
    packets.push(packet(t + interval, 5, [field(1, 100 + i)]));
    for (const [offset, layer] of [[200, 'SurfaceView[com.example.app/.Main]'], [300, 'com.example.app/.Main']]) {
      packets.push(packet(t, 4, [field(1, offset + i), field(2, i + 1), field(3, token), field(4, 42), field(5, Buffer.from(layer)), field(6, 1), field(9, i === 5 ? 64 : 1)]));
      packets.push(packet(t + interval, 5, [field(1, offset + i)]));
    }
  }
  const result = parseTrace(message(...packets), { pids: [42], packageName: 'com.example.app', windowMs: 2000 });
  assert.equal(result.status, 'ok'); assert.equal(result.frameCount, 10); assert.equal(result.fps, 5);
  assert.equal(result.jankCount, 1); assert.ok(result.layer.startsWith('SurfaceView'));
  assert.ok(Math.abs(result.intervalP95 - 16.666667) < 1e-6);
  assert.equal(parseTrace(message(...packets), { pids: [99], packageName: 'com.other.app' }).fps, null);
});
test('trace power supports signed int64 values and empty traces do not fabricate FPS', () => {
  const data = field(1, message(field(8, 1000), field(38, field(3, -250000n))));
  const result = parseTrace(data, { packageName: 'com.example.app' });
  assert.equal(result.currentMA, 250); assert.equal(result.rawCurrentMA, -250); assert.equal(result.fps, null);
  assert.equal(result.jankCount, null); assert.equal(parseTrace(Buffer.alloc(0)).fps, null);
});
test('malformed protobuf is rejected and percentile ignores no data', () => {
  assert.throws(() => decodeProto(Buffer.from([10, 99, 1])), /length/);
  assert.throws(() => decodeProto(Buffer.from([8, 128])), /Truncated/);
  assert.equal(percentile([], .95), null); assert.equal(percentile([3, 1, 2], .95), 3);
});
