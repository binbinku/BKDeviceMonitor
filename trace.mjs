// Field IDs follow AOSP Android 14 FrameTimelineEvent / BatteryCounters.
// https://android.googlesource.com/platform/external/perfetto/+/refs/heads/android14-release/protos/perfetto/trace/android/frame_timeline_event.proto
export const TRACE_CONFIG = `buffers { size_kb: 4096 fill_policy: RING_BUFFER }
duration_ms: 2000
data_sources { config { name: "android.surfaceflinger.frametimeline" } }
data_sources { config { name: "android.power" android_power_config {
  battery_poll_ms: 500 battery_counters: BATTERY_COUNTER_CURRENT
  battery_counters: BATTERY_COUNTER_CAPACITY_PERCENT collect_power_rails: false
} } }
`;

export function decodeProto(buffer) {
  let offset = 0;
  const fields = new Map();
  const varint = () => {
    let value = 0n;
    for (let i = 0; i < 10; i++) {
      if (offset >= buffer.length) throw new Error('Truncated protobuf');
      const b = buffer[offset++]; value |= BigInt(b & 127) << BigInt(i * 7);
      if (!(b & 128)) return value;
    }
    throw new Error('Invalid varint');
  };
  while (offset < buffer.length) {
    const tag = Number(varint()), field = tag >>> 3, wire = tag & 7;
    if (!field) throw new Error('Invalid protobuf field');
    let value;
    if (wire === 0) value = varint();
    else if (wire === 2) {
      const length = Number(varint());
      if (!Number.isSafeInteger(length) || length < 0 || offset + length > buffer.length) throw new Error('Invalid protobuf length');
      value = buffer.subarray(offset, offset + length); offset += length;
    } else if (wire === 1 || wire === 5) {
      const length = wire === 1 ? 8 : 4;
      if (offset + length > buffer.length) throw new Error('Truncated fixed field');
      value = buffer.subarray(offset, offset + length); offset += length;
    } else throw new Error('Unsupported protobuf wire type');
    const list = fields.get(field) || []; list.push(value); fields.set(field, list);
  }
  return fields;
}
const first = (fields, n) => fields.get(n)?.[0];
const integer = (fields, n) => typeof first(fields, n) === 'bigint' ? first(fields, n) : null;
const string = (fields, n) => Buffer.isBuffer(first(fields, n)) ? first(fields, n).toString('utf8') : '';
export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
}

export function parseTrace(buffer, { pids = [], packageName = '', windowMs = 2000 } = {}) {
  const starts = new Map(), ends = new Map(), displayEnds = new Map(), batteries = [];
  const pidSet = new Set(pids);
  let timelineEvents = 0, packetCount = 0;
  for (const packet of decodeProto(buffer).get(1) || []) {
    if (!Buffer.isBuffer(packet)) continue;
    packetCount++;
    const data = decodeProto(packet), ts = integer(data, 8);
    const batteryData = first(data, 38);
    if (Buffer.isBuffer(batteryData)) {
      const b = decodeProto(batteryData), current = integer(b, 3);
      if (current != null) {
        const rawMA = Number(BigInt.asIntN(64, current)) / 1000;
        if (Math.abs(rawMA) < 30000) batteries.push(rawMA);
      }
    }
    const rawEvent = first(data, 76);
    if (!Buffer.isBuffer(rawEvent) || ts == null) continue;
    timelineEvents++;
    const event = decodeProto(rawEvent);
    for (const type of [2, 4, 5]) {
      const raw = first(event, type);
      if (!Buffer.isBuffer(raw)) continue;
      const item = decodeProto(raw), cookie = integer(item, 1);
      if (cookie == null) continue;
      if (type === 5) ends.set(cookie.toString(), ts);
      else starts.set(cookie.toString(), {
        type, timestamp: ts, token: integer(item, 2)?.toString(), displayToken: integer(item, 3)?.toString(),
        pid: type === 4 ? Number(integer(item, 4)) : null, layer: type === 4 ? string(item, 5) : null,
        present: Number(integer(item, type === 4 ? 6 : 4)), jank: Number(integer(item, type === 4 ? 9 : 7))
      });
    }
  }
  for (const [cookie, start] of starts) if (start.type === 2 && ends.has(cookie)) displayEnds.set(start.token, ends.get(cookie));
  const layers = new Map();
  for (const [cookie, frame] of starts) {
    if (frame.type !== 4 || !ends.has(cookie)) continue;
    if (!pidSet.has(frame.pid) && !(packageName && frame.layer?.includes(packageName + '/'))) continue;
    const frames = layers.get(frame.layer) || [];
    frames.push({ ...frame, end: ends.get(cookie), presentAt: displayEnds.get(frame.displayToken) ?? null });
    layers.set(frame.layer, frames);
  }
  // Never sum multiple surfaces: one dominant app layer avoids double-counted FPS.
  const ordered = [...layers].sort((a, b) => b[1].length - a[1].length || Number(/SurfaceView/.test(b[0])) - Number(/SurfaceView/.test(a[0])));
  const [layer, allFrames] = ordered[0] || [null, []];
  const presented = [...new Map(allFrames.filter(f => f.present !== 4 && f.presentAt != null).map(f => [f.displayToken, f])).values()].sort((a, b) => a.presentAt < b.presentAt ? -1 : 1);
  const intervals = presented.slice(1).map((f, i) => Number(f.presentAt - presented[i].presentAt) / 1e6).filter(v => v > 0);
  const frameDurations = allFrames.map(f => Number(f.end - f.timestamp) / 1e6).filter(v => v >= 0);
  return {
    status: !packageName ? 'no-target' : presented.length ? 'ok' : packetCount ? 'no-frames' : 'unavailable',
    source: 'Perfetto FrameTimeline', windowMs, layer, timelineEvents,
    frameCount: presented.length, fps: presented.length ? presented.length / (windowMs / 1000) : null,
    intervalP95: percentile(intervals, .95), intervalP99: percentile(intervals, .99),
    durationP95: percentile(frameDurations, .95),
    jankCount: allFrames.some(f => f.jank > 0) ? allFrames.filter(f => f.jank > 1).length : null,
    droppedCount: allFrames.some(f => f.present > 0) ? allFrames.filter(f => f.present === 4).length : null,
    intervalSamples: intervals,
    currentMA: batteries.length ? Math.abs(batteries.reduce((a, b) => a + b, 0) / batteries.length) : null,
    rawCurrentMA: batteries.length ? batteries.at(-1) : null
  };
}
