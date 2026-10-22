import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseCpu, parseMemory, parseGpu, parseBattery, parseProcesses } from './metrics.mjs';
import { HARDWARE_COMMAND, parseHardware, parseStorage } from './hardware.mjs';
import { extractSection, shellQuote, validPackage, parseRunningApps, parseForeground, parseNetwork, parsePressure, parseThermal, parseAppStat, parseAppMemory, countOnline } from './telemetry.mjs';
import { TRACE_CONFIG, parseTrace } from './trace.mjs';
import { SessionRecorder } from './session.mjs';

// Shared in-process ADB engine. No sockets, HTTP server or renderer privileges.
export function createMonitor({ adbPath = 'adb' } = {}) {
const adb = adbPath;
const abort = new AbortController();
const exec = promisify(execFile);
const run = args => exec(adb, args, { signal: abort.signal, windowsHide: true, timeout: 6500, maxBuffer: 2 * 1024 * 1024 }).then(r => r.stdout);
let stopped = false, started = false;
const timers = [];
const clients = new Set();
let devices = [], selected = null, info = null, latest = null, counters = new Map(), history = [];
let processes = [], battery = {}, storage = null, tick = 0, busy = false, refreshing = null;
let status = { connected: false, message: '正在查找 ADB 设备…' };
const recorder = new SessionRecorder();
let networkPrevious = null, pressurePrevious = null, appPrevious = null, thermalService = '';
let appRows = [], appChoices = [], selectedPackage = null, foregroundPackage = null, appMemory = {};
let targetApp = { packageName: null, pid: null, pids: [], mode: 'auto' }, targetEpoch = 0, frameBusy = false;
let frames = { status: 'collecting', fps: null, currentMA: null };
const section = (text, name) => text.split(`__${name}__\n`)[1]?.split(/__\w+__\n/)[0]?.trim() || '';
const broadcast = (event, data) => { if (!stopped) for (const client of clients) client(event, data); };
const state = () => ({ ...status, devices, selected, info, latest, history, apps: appChoices, target: targetApp, session: recorder.state() });

function resolveTarget() {
  const packageName = selectedPackage || foregroundPackage;
  const matches = appRows.filter(p => p.packageName === packageName);
  const pid = matches.find(p => p.name === packageName)?.pid || null;
  if (targetApp.packageName !== packageName || targetApp.pid !== pid) {
    if (recorder.record?.active) recorder.event('app', `监测目标：${targetApp.packageName || '无'} → ${packageName || '无'}`);
    targetEpoch++; appPrevious = null; appMemory = {};
    frames = { status: pid ? 'collecting' : 'no-target', fps: null, currentMA: frames.currentMA ?? null, collectedAt: frames.collectedAt };
  }
  targetApp = { packageName, pid, pids: matches.map(p => p.pid), mode: selectedPackage ? 'selected' : 'auto', foreground: !!packageName && packageName === foregroundPackage };
}
function updateApps(text) {
  appRows = parseRunningApps(text);
  appChoices = [...new Set(appRows.map(p => p.packageName))].sort();
}
function resetTelemetry() {
  networkPrevious = null; pressurePrevious = null; appPrevious = null; appMemory = {}; thermalService = '';
  appRows = []; appChoices = []; selectedPackage = null; foregroundPackage = null;
  targetApp = { packageName: null, pid: null, pids: [], mode: 'auto' }; targetEpoch++;
  frames = { status: 'collecting', fps: null, currentMA: null };
}
async function collectFrames() {
  if (stopped || frameBusy || !clients.size || !status.connected || !selected) return;
  frameBusy = true;
  const serial = selected, epoch = targetEpoch, target = { ...targetApp }, startedAt = Date.now();
  try {
    const { stdout } = await exec(adb, ['-s', serial, 'exec-out', `printf %s ${shellQuote(TRACE_CONFIG)} | perfetto --txt -c - -o - 2>/dev/null`], { signal: abort.signal, windowsHide: true, encoding: 'buffer', timeout: 7500, maxBuffer: 8 * 1024 * 1024 });
    const result = parseTrace(stdout, { pids: target.pids, packageName: target.packageName || '' });
    if (selected === serial && targetEpoch === epoch) frames = { ...result, id: `${serial}:${startedAt}`, startedAt, collectedAt: Date.now(), packageName: target.packageName };
  } catch {
    if (selected === serial && targetEpoch === epoch) frames = { status: 'unavailable', fps: null, currentMA: null, collectedAt: Date.now() };
  } finally { frameBusy = false; }
}

async function refreshDevices() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
  try {
    const text = await run(['devices', '-l']);
    devices = text.split('\n').slice(1).filter(l => l.trim() && !l.startsWith('*')).map(l => {
      const [serial, state] = l.trim().split(/\s+/);
      return { serial, state, model: l.match(/model:(\S+)/)?.[1]?.replaceAll('_', ' ') || serial };
    });
    const usable = devices.filter(d => d.state === 'device');
    if (!selected && usable[0]) { selected = usable[0].serial; info = null; counters = new Map(); }
    if (!usable.some(d => d.serial === selected)) {
      if (status.connected) recorder.stop('设备连接中断');
      status = { connected: false, message: devices.some(d => d.state === 'unauthorized') ? '请在手机上允许 USB 调试' : '未连接设备，请通过 USB 连接手机' };
      counters = new Map();
      networkPrevious = null; pressurePrevious = null; appPrevious = null;
      broadcast('status', state());
    }
  } catch (error) {
    status = { connected: false, message: error.code === 'ENOENT' ? '未找到 ADB，请安装 Android Platform Tools' : 'ADB 连接失败，请检查 USB 连接' };
    broadcast('status', state());
  } finally { refreshing = null; }
  })();
  return refreshing;
}

async function readInfo(serial) {
  const text = await run(['-s', serial, 'shell', HARDWARE_COMMAND]);
  return parseHardware(text, serial);
}

async function sample() {
  if (stopped || busy || !selected || !devices.some(d => d.serial === selected && d.state === 'device')) return;
  busy = true;
  const serial = selected;
  try {
    if (!info) {
      const nextInfo = await readInfo(serial);
      if (selected !== serial) return;
      info = nextInfo;
    }
    const slow = tick % 5 === 0;
    const coreIds = info.hardware.cores.map(c => c.id).filter(id => /^cpu\d+$/.test(id));
    const sensorCommand = info.hardware.thermalSensors.map(s => `printf '%s ' ${shellQuote(s.name)}; cat ${shellQuote(s.path)} 2>/dev/null || echo unavailable`).join('; ');
    const command = [
      "echo __CPU__; grep -E '^cpu' /proc/stat",
      'echo __MEM__; cat /proc/meminfo',
      'echo __GPU__; cat /sys/class/kgsl/kgsl-3d0/gpubusy 2>/dev/null',
      `echo __FREQ__; for c in ${coreIds.length ? coreIds.join(' ') : 'cpu0 cpu1 cpu2 cpu3 cpu4 cpu5 cpu6 cpu7'}; do printf "$c "; cat /sys/devices/system/cpu/$c/cpufreq/scaling_cur_freq 2>/dev/null || echo unavailable; done`,
      'echo __ONLINE__; cat /sys/devices/system/cpu/online 2>/dev/null',
      'echo __NETWORK__; cat /proc/net/dev 2>/dev/null',
      'echo __PSI__; cat /proc/pressure/memory 2>/dev/null',
      "echo __VMSTAT__; grep -E '^pswp|^pgmajfault|^oom_kill' /proc/vmstat 2>/dev/null",
      `echo __SENSORS__; ${sensorCommand || ':'}`,
      ...(slow ? ['echo __BATTERY__; dumpsys battery', 'echo __PROCESSES__; top -b -n 1 -m 12', 'echo __STORAGE__; df -k /data',
        'echo __THERMAL__; dumpsys thermalservice', 'echo __PS__; ps -A -o PID,NAME',
        'echo __FOREGROUND__; dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity" || true'] : [])
    ].join('; ');
    const text = (await run(['-s', serial, 'shell', command])).replaceAll('\r', '');
    if (serial !== selected) return;
    const cpu = parseCpu(section(text, 'CPU'), counters);
    if (!cpu.cores.length) throw new Error('CPU statistics unavailable');
    counters = cpu.counters;
    const frequencies = new Map(section(text, 'FREQ').split('\n').map(l => l.trim().split(/\s+/)).map(([id, freq]) => [id, /^\d+$/.test(freq || '') ? Number(freq) / 1000 : null]));
    if (slow) {
      battery = parseBattery(section(text, 'BATTERY'));
      processes = parseProcesses(section(text, 'PROCESSES'), cpu.cores.length);
      storage = parseStorage(section(text, 'STORAGE'));
      thermalService = section(text, 'THERMAL');
      updateApps(section(text, 'PS')); foregroundPackage = parseForeground(section(text, 'FOREGROUND')); resolveTarget();
    }
    let appCpu = null, threads = null;
    if (targetApp.pid && validPackage(targetApp.packageName)) {
      const appEpoch = targetEpoch;
      const details = await run(['-s', serial, 'shell', `echo __APPSTAT__; cat /proc/${targetApp.pid}/stat 2>/dev/null; ${slow ? `echo __APPMEM__; dumpsys meminfo ${shellQuote(targetApp.packageName)} 2>/dev/null || true` : ':'}`]);
      if (selected !== serial || appEpoch !== targetEpoch) return;
      const parsed = parseAppStat(extractSection(details, 'APPSTAT'), appPrevious, cpu.counters.get('cpu').total, targetApp.packageName);
      appPrevious = parsed.counter; appCpu = parsed.cpu; threads = parsed.threads;
      if (slow) appMemory = parseAppMemory(extractSection(details, 'APPMEM'));
    }
    tick++;
    const gpuRaw = section(text, 'GPU');
    const gpu = parseGpu(gpuRaw);
    const timestamp = Date.now();
    const network = parseNetwork(section(text, 'NETWORK'), networkPrevious, timestamp); networkPrevious = network;
    const pressure = parsePressure(section(text, 'PSI'), section(text, 'VMSTAT'), pressurePrevious, timestamp); pressurePrevious = pressure;
    const currentMA = frames.currentMA != null && timestamp - frames.collectedAt < 8000 ? frames.currentMA : null;
    latest = { timestamp, cpu: cpu.total, cores: cpu.cores.map(c => ({ ...c, frequency: frequencies.get(c.id) ?? null })),
      gpu, gpuStatus: gpu != null ? 'active' : /^\d+\s+0$/.test(gpuRaw) ? 'empty-window' : 'unavailable',
      memory: parseMemory(section(text, 'MEM')), battery, processes, storage,
      onlineCores: countOnline(section(text, 'ONLINE')), thermal: parseThermal(thermalService, section(text, 'SENSORS')),
      network: { downloadBps: network.downloadBps, uploadBps: network.uploadBps, interfaces: network.interfaces }, pressure,
      app: { ...targetApp, cpu: appCpu, threads, ...appMemory }, frames,
      power: { currentMA, watts: currentMA != null && battery.voltage != null ? currentMA / 1000 * battery.voltage : null, source: 'Perfetto android.power' } };
    recorder.add(latest);
    history.push({ timestamp: latest.timestamp, cpu: latest.cpu, gpu: latest.gpu, memory: latest.memory.usage,
      fps: frames.fps ?? null, cpuTemp: latest.thermal.cpu, gpuTemp: latest.thermal.gpu,
      powerW: latest.power.watts, downloadBps: network.downloadBps, uploadBps: network.uploadBps,
      frequencies: Object.fromEntries(latest.cores.map(c => [c.id, c.frequency])), app: targetApp.packageName, appCpu });
    if (history.length > 900) history.shift();
    status = { connected: true, message: '设备已连接' };
    broadcast('sample', { ...latest, info, selected, session: recorder.state(), apps: appChoices });
  } catch {
    counters = new Map();
    appPrevious = null; networkPrevious = null; pressurePrevious = null;
    recorder.stop('采集连接中断');
    status = { connected: false, message: '连接中断，正在重新连接…' };
    broadcast('status', state());
  } finally { busy = false; }
}


async function request(path, method = 'GET') {
  if (typeof path !== 'string' || path.length > 2048 || !/^\/api\/[a-z/?]/.test(path) || !['GET', 'POST'].includes(method)) return { status: 400, data: { error: '无效请求' } };
  const url = new URL(path, 'bkdevicemonitor://app');
  const json = (data, status = 200) => ({ status, data });
  if (url.pathname === '/api/state') return json(state());
  if (url.pathname === '/api/devices') { await refreshDevices(); return json({ devices, selected }); }
  if (url.pathname === '/api/apps' && method === 'GET') {
    if (selected && status.connected) { updateApps(await run(['-s', selected, 'shell', 'ps -A -o PID,NAME']).catch(() => '')); }
    return json({ apps: appChoices, target: targetApp });
  }
  if (url.pathname === '/api/target' && method === 'POST') {
    const value = url.searchParams.get('package');
    if (value !== 'auto' && (!validPackage(value) || !appChoices.includes(value))) return json({ error: '请选择列表中正在运行的应用' }, 400);
    const nextPackage = value === 'auto' ? null : value;
    if (selectedPackage !== nextPackage) recorder.stop('切换监测目标');
    selectedPackage = nextPackage; resolveTarget();
    broadcast('target', { target: targetApp, session: recorder.state() });
    return json({ target: targetApp, session: recorder.state() });
  }
  if (url.pathname === '/api/session/report' && method === 'GET') {
    const report = recorder.report(); return report ? json(report) : json({ error: '尚无测试会话' }, 404);
  }
  if (url.pathname === '/api/session' && method === 'GET') return json(recorder.state());
  if (url.pathname === '/api/session' && method === 'POST') {
    const action = url.searchParams.get('action');
    if (action === 'start') {
      if (!status.connected) return json({ error: '请先连接设备' }, 409);
      try { recorder.start({ name: info?.name, serial: selected }, selectedPackage || 'auto', url.searchParams.get('label') || ''); }
      catch (error) { return json({ error: error.message }, 409); }
    } else if (action === 'stop') recorder.stop();
    else return json({ error: '无效的会话操作' }, 400);
    broadcast('session', recorder.state()); return json(recorder.state());
  }
  if (url.pathname === '/api/device' && method === 'POST') {
    const serial = url.searchParams.get('serial');
    await refreshDevices();
    if (!devices.some(d => d.serial === serial && d.state === 'device')) return json({ error: '设备未连接或尚未授权' }, 400);
    if (selected !== serial) {
      recorder.stop('切换设备'); resetTelemetry();
      selected = serial; info = null; latest = null; counters = new Map(); history = []; tick = 0; processes = []; battery = {}; storage = null;
      status = { connected: false, message: '正在读取设备…' }; broadcast('reset', state());
    }
    return json({ selected });
  }
  return json({ error: 'Unknown operation' }, 404);
}
return {
  state, request,
  subscribe(listener) { clients.add(listener); return () => clients.delete(listener); },
  async start() {
    if (started || stopped) return;
    started = true;
    timers.push(setInterval(() => void sample(), 1000), setInterval(() => void refreshDevices(), 4000), setInterval(() => void collectFrames(), 3000));
    await refreshDevices(); if (!stopped) await sample();
  },
  stop() { stopped = true; recorder.stop('应用已关闭'); timers.forEach(clearInterval); clients.clear(); abort.abort(); }
};
}
