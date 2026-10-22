export function parseCpu(text, previous = new Map()) {
  const counters = new Map();
  const usage = {};
  for (const line of text.split('\n')) {
    if (!/^cpu\d*\s/.test(line)) continue;
    const [name, ...raw] = line.trim().split(/\s+/);
    // Guest time is already included in user/nice by the kernel.
    const values = raw.slice(0, 8).map(Number);
    const total = values.reduce((a, b) => a + b, 0);
    const idle = (values[3] || 0) + (values[4] || 0);
    const old = previous.get(name);
    counters.set(name, { total, idle });
    const elapsed = old ? total - old.total : 0;
    usage[name] = elapsed > 0 ? Math.max(0, Math.min(100, (1 - (idle - old.idle) / elapsed) * 100)) : null;
  }
  return { counters, total: usage.cpu ?? null, cores: Object.entries(usage).filter(([name]) => name !== 'cpu').map(([id, usage]) => ({ id, usage })) };
}

export function parseMemory(text) {
  const values = Object.fromEntries([...text.matchAll(/^(\w+):\s+(\d+)/gm)].map(m => [m[1], Number(m[2]) * 1024]));
  const total = values.MemTotal || 0;
  const available = values.MemAvailable ?? values.MemFree ?? 0;
  return { total, available, used: Math.max(0, total - available), free: values.MemFree || 0,
    cached: values.Cached || 0, buffers: values.Buffers || 0,
    usage: total ? (total - available) / total * 100 : null,
    swapTotal: values.SwapTotal || 0, swapUsed: Math.max(0, (values.SwapTotal || 0) - (values.SwapFree || 0)) };
}

export function parseGpu(text) {
  const match = text.trim().match(/^(\d+)\s+(\d+)$/);
  if (!match || Number(match[2]) === 0) return null;
  return Math.max(0, Math.min(100, Number(match[1]) / Number(match[2]) * 100));
}

export function parseBattery(text) {
  const value = key => Number(text.match(new RegExp(`^\\s*${key}:\\s*(-?\\d+)`, 'm'))?.[1]);
  const level = value('level'), scale = value('scale'), temp = value('temperature');
  return { level: Number.isFinite(level) && scale > 0 ? level / scale * 100 : null,
    temperature: Number.isFinite(temp) ? temp / 10 : null, charging: value('status') === 2,
    voltage: Number.isFinite(value('voltage')) ? value('voltage') / 1000 : null };
}

export function parseProcesses(text, coreCount = 8) {
  const lines = text.split('\n');
  const header = lines.findIndex(l => /\bPID\s+USER/.test(l));
  if (header < 0) return [];
  return lines.slice(header + 1).map(line => {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 12 || !/^\d+$/.test(cols[0])) return null;
    const name = cols.slice(11).join(' ');
    if (/^top(?:\s|$)/.test(name) || name.includes('echo __CPU__')) return null;
    return { pid: Number(cols[0]), user: cols[1], memory: cols[5], cpu: Number(cols[8]) / coreCount,
      memoryPercent: Number(cols[9]), name };
  }).filter(Boolean).sort((a, b) => b.cpu - a.cpu).slice(0, 6);
}
