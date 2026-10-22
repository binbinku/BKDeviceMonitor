import { randomUUID } from 'node:crypto';
import { percentile } from './trace.mjs';

export class SessionRecorder {
  constructor() { this.record = null; this.frameIds = new Set(); this.intervals = []; }
  start(device, target = 'auto', label = '') {
    if (this.record?.active) throw new Error('已有进行中的测试会话');
    this.frameIds.clear(); this.intervals = [];
    this.record = { id: randomUUID(), label: label.trim().slice(0, 80) || '性能测试', device, target, startedAt: Date.now(), endedAt: null, active: true, sampleCount: 0, samples: [], events: [],
      summary: { cpuSum: 0, cpuSamples: 0, cpuPeak: null, gpuPeak: null, memoryPeak: null, batteryTempPeak: null, cpuTempPeak: null, gpuTempPeak: null, frameCount: 0, frameWindowMs: 0, jankCount: 0, droppedCount: 0, frameWindows: 0, jankWindows: 0, dropWindows: 0 } };
    return this.state();
  }
  stop(reason = '手动结束') {
    if (this.record?.active) { this.record.active = false; this.record.endedAt = Date.now(); this.event('stop', reason); }
    return this.state();
  }
  event(type, message) { if (this.record) this.record.events.push({ timestamp: Date.now(), type, message }); }
  add(sample) {
    const r = this.record; if (!r?.active || sample.timestamp < r.startedAt) return;
    const s = r.summary;
    r.sampleCount++;
    if (Number.isFinite(sample.cpu)) { s.cpuSum += sample.cpu; s.cpuSamples++; }
    const peak = (key, value) => { if (Number.isFinite(value)) s[key] = s[key] == null ? value : Math.max(s[key], value); };
    peak('cpuPeak', sample.cpu); peak('gpuPeak', sample.gpu); peak('memoryPeak', sample.memory?.usage);
    peak('batteryTempPeak', sample.battery?.temperature); peak('cpuTempPeak', sample.thermal?.cpu); peak('gpuTempPeak', sample.thermal?.gpu);
    const f = sample.frames;
    if (f?.id && !this.frameIds.has(f.id) && f.startedAt >= r.startedAt && f.status === 'ok') {
      this.frameIds.add(f.id); s.frameCount += f.frameCount; s.frameWindowMs += f.windowMs;
      if (f.jankCount != null) { s.jankCount += f.jankCount; s.jankWindows++; }
      if (f.droppedCount != null) { s.droppedCount += f.droppedCount; s.dropWindows++; }
      s.frameWindows++;
      this.intervals.push(...(f.intervalSamples || []));
      if (this.intervals.length > 100000) this.intervals.splice(0, this.intervals.length - 100000);
    }
    r.samples.push({ timestamp: sample.timestamp, cpu: sample.cpu, gpu: sample.gpu, memory: sample.memory?.usage,
      cpuTemp: sample.thermal?.cpu, gpuTemp: sample.thermal?.gpu, batteryTemp: sample.battery?.temperature,
      thermalLevel: sample.thermal?.level, fps: f?.fps, frameWindowId: f?.id, app: sample.app?.packageName,
      appCpu: sample.app?.cpu, appPss: sample.app?.pssBytes, downloadBps: sample.network?.downloadBps,
      uploadBps: sample.network?.uploadBps, currentMA: sample.power?.currentMA, batteryPowerW: sample.power?.watts });
    if (r.samples.length > 20000) r.samples.shift();
  }
  state() {
    const r = this.record; if (!r) return null;
    const s = r.summary;
    return { id: r.id, label: r.label, active: r.active, device: r.device, target: r.target, startedAt: r.startedAt, endedAt: r.endedAt, sampleCount: r.sampleCount,
      retainedSamples: r.samples.length, events: r.events.slice(-100), summary: { cpuAverage: s.cpuSamples ? s.cpuSum / s.cpuSamples : null,
        cpuPeak: s.cpuPeak, gpuPeak: s.gpuPeak, memoryPeak: s.memoryPeak, batteryTempPeak: s.batteryTempPeak, cpuTempPeak: s.cpuTempPeak, gpuTempPeak: s.gpuTempPeak,
        averageFps: s.frameWindowMs ? s.frameCount / (s.frameWindowMs / 1000) : null, frameCount: s.frameCount,
        jankCount: s.jankWindows ? s.jankCount : null, droppedCount: s.dropWindows ? s.droppedCount : null,
        intervalP95: percentile(this.intervals, .95), intervalP99: percentile(this.intervals, .99), frameWindowMs: s.frameWindowMs,
        frameWindows: s.frameWindows, percentileFrames: this.intervals.length } };
  }
  report() { return this.record ? { ...this.state(), samples: this.record.samples, notes: ['帧率按有效 FrameTimeline 窗口加权，重复窗口不重复累计；未覆盖时间不计入帧率。', 'CPU 使用率以整机 0–100% 为口径；应用指标仅对应主进程。', '电流和功率为电池端幅值，不代表充电器输入功率或整机耗电。', '保留最近 20000 个采样，分位数使用最近 100000 个有效帧间隔；峰值和 CPU 平均使用整场采样。'] } : null; }
}
