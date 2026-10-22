import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionRecorder } from '../session.mjs';

test('session averages only valid samples and counts each frame window once', () => {
  const recorder = new SessionRecorder(); const started = recorder.start({ name: 'Test' });
  const frames = { id: 'one', status: 'ok', startedAt: started.startedAt + 1, windowMs: 2000, frameCount: 60, jankCount: 2, droppedCount: 1, intervalSamples: [16, 16, 33] };
  recorder.add({ timestamp: started.startedAt + 1000, cpu: 20, gpu: 50, memory: { usage: 40 }, thermal: { cpu: 60, gpu: 70 }, frames });
  recorder.add({ timestamp: started.startedAt + 2000, cpu: 40, gpu: 60, memory: { usage: 50 }, thermal: { cpu: 65, gpu: 75 }, frames });
  const summary = recorder.state().summary;
  assert.equal(summary.cpuAverage, 30); assert.equal(summary.cpuPeak, 40); assert.equal(summary.averageFps, 30);
  assert.equal(summary.frameWindows, 1); assert.equal(summary.jankCount, 2); assert.equal(summary.droppedCount, 1);
  assert.equal(summary.intervalP95, 33); assert.equal(summary.gpuTempPeak, 75);
  assert.throws(() => recorder.start({ name: 'Other' }), /进行中/);
});
test('session excludes windows crossing the start boundary and stops recording after end', () => {
  const recorder = new SessionRecorder(); const started = recorder.start({ name: 'Test' });
  recorder.add({ timestamp: started.startedAt + 1, cpu: null, frames: { id: 'old', status: 'ok', startedAt: started.startedAt - 1, windowMs: 2000, frameCount: 100 } });
  assert.equal(recorder.state().summary.averageFps, null); assert.equal(recorder.state().summary.cpuAverage, null);
  recorder.stop('设备连接中断'); recorder.add({ timestamp: Date.now() + 2, cpu: 100 });
  assert.equal(recorder.state().sampleCount, 1); assert.equal(recorder.state().active, false);
  assert.equal(recorder.report().events.at(-1).message, '设备连接中断'); assert.equal(recorder.report().samples.length, 1);
});
