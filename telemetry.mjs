export const shellQuote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
export const validPackage = value => typeof value === 'string' && /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(value);
export const extractSection = (text, name) => text.replaceAll('\r', '').split(`__${name}__\n`)[1]?.split(/__\w+__\n/)[0]?.trim() || '';

export function parseRunningApps(text) {
  return text.split('\n').map(line => {
    const match = line.trim().match(/^(\d+)\s+(\S+)$/);
    return match && validPackage(match[2].split(':')[0]) ? { pid: Number(match[1]), name: match[2], packageName: match[2].split(':')[0] } : null;
  }).filter(Boolean);
}
export function parseForeground(text) { return text.match(/(?:topResumedActivity|mResumedActivity)[^\n]*?\bu\d+\s+([\w.]+)\//)?.[1] || null; }

export function parseNetwork(text, previous, timestamp) {
  const counters = {};
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*((?:wlan|eth)\d+|rmnet_data\d+):\s*(.*)$/);
    if (!match) continue;
    const values = match[2].trim().split(/\s+/).map(Number);
    if (values.length >= 9 && Number.isFinite(values[0]) && Number.isFinite(values[8])) counters[match[1]] = { rx: values[0], tx: values[8] };
  }
  let rx = 0, tx = 0, comparable = 0;
  const seconds = previous ? (timestamp - previous.timestamp) / 1000 : 0;
  for (const [name, now] of Object.entries(counters)) {
    const old = previous?.counters[name];
    if (old && now.rx >= old.rx && now.tx >= old.tx) { rx += now.rx - old.rx; tx += now.tx - old.tx; comparable++; }
  }
  return { timestamp, counters, interfaces: Object.keys(counters), downloadBps: seconds > 0 && comparable ? rx / seconds : null, uploadBps: seconds > 0 && comparable ? tx / seconds : null };
}
export function parsePressure(text, vmText, previous, timestamp) {
  const psi = {};
  for (const line of text.split('\n')) {
    const match = line.match(/^(some|full)\s+avg10=([\d.]+)\s+avg60=([\d.]+)/);
    if (match) psi[match[1]] = { avg10: Number(match[2]), avg60: Number(match[3]) };
  }
  const counters = Object.fromEntries([...vmText.matchAll(/^(pswpin|pswpout|pgmajfault|oom_kill)\s+(\d+)/gm)].map(m => [m[1], Number(m[2])]));
  const seconds = previous ? (timestamp - previous.timestamp) / 1000 : 0;
  const rate = key => seconds > 0 && counters[key] != null && previous.counters[key] != null && counters[key] >= previous.counters[key] ? (counters[key] - previous.counters[key]) / seconds : null;
  return { timestamp, counters, some: psi.some || null, full: psi.full || null, swapInPagesPerSec: rate('pswpin'), swapOutPagesPerSec: rate('pswpout'), majorFaultsPerSec: rate('pgmajfault'), oomKills: counters.oom_kill ?? null };
}
export function parseThermal(service, sensors) {
  const level = service.match(/Thermal Status:\s*(\d+)/)?.[1];
  const temperatures = sensors.split('\n').map(line => {
    const [name, value] = line.trim().split(/\s+/), raw = Number(value);
    if (!value || !Number.isFinite(raw) || raw <= 0 || raw >= 150000) return null;
    return { name, celsius: raw / 1000, category: /^cpuss|^cpu/.test(name) ? 'cpu' : /^gpu/.test(name) ? 'gpu' : /skin/.test(name) ? 'skin' : /battery/.test(name) ? 'battery' : 'other' };
  }).filter(Boolean);
  const max = category => { const values = temperatures.filter(t => t.category === category).map(t => t.celsius); return values.length ? Math.max(...values) : null; };
  return { level: level == null ? null : Number(level), cpu: max('cpu'), gpu: max('gpu'), skin: max('skin'), temperatures,
    coolingDevices: [...service.matchAll(/CoolingDevice\{mValue=([\d.]+), mType=(\d+), mName=([^}]+)\}/g)].map(m => ({ value: Number(m[1]), type: Number(m[2]), name: m[3] })) };
}
export function parseAppStat(text, previous, totalCpuTicks, packageName) {
  const match = text.trim().match(/^(\d+)\s+\((.*)\)\s+(.+)$/);
  if (!match) return { cpu: null, threads: null, counter: null };
  const fields = match[3].split(/\s+/), ticks = Number(fields[11]) + Number(fields[12]);
  const counter = { pid: Number(match[1]), start: fields[19], ticks, totalCpuTicks, packageName };
  const elapsed = previous ? totalCpuTicks - previous.totalCpuTicks : 0;
  const comparable = previous && previous.pid === counter.pid && previous.start === counter.start && previous.packageName === packageName;
  return { cpu: comparable && elapsed > 0 && ticks >= previous.ticks ? Math.min(100, (ticks - previous.ticks) / elapsed * 100) : null,
    threads: Number(fields[17]) || null, counter: Number.isFinite(ticks) ? counter : null };
}
export function parseAppMemory(text) {
  const pss = text.match(/TOTAL PSS:\s*(\d+)/), rss = text.match(/TOTAL RSS:\s*(\d+)/);
  return { pssBytes: pss ? Number(pss[1]) * 1024 : null, rssBytes: rss ? Number(rss[1]) * 1024 : null };
}
export function countOnline(text) {
  if (!/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(text.trim())) return null;
  return text.trim().split(',').reduce((count, part) => { const [a, b = a] = part.split('-').map(Number); return count + Math.max(0, b - a + 1); }, 0);
}
