import { request, openEvents, saveDownload, isDesktop } from './transport.js';
import { renderHardware, resetHardware } from './hardware-view.js';
import { initInsights, hydrateInsights, sampleInsights, updateInsightSession, updateInsightTarget, setInsightConnection, setInsightPaused, resetInsights, exportInsights } from './insights.js';

if (window.bkDeviceMonitor?.platform === 'darwin') document.documentElement.classList.add('desktop-mac');

const $ = id => document.getElementById(id);
const colors = { cpu: '#91c5a1', gpu: '#b2a0cf', memory: '#8faed0' };
const labels = { cpu: 'CPU', gpu: 'GPU', memory: '内存' };
const viewNames = { overview: '性能总览', cpu: 'CPU 处理器', gpu: 'GPU 图形', memory: '内存分析', hardware: '硬件信息', insights: '深度监测' };
const descriptions = { overview: '实时查看设备负载、内存和温度。', cpu: '查看各核心负载、实时频率与调度变化。', gpu: '查看图形负载与应用渲染表现。', memory: '查看内存分配、可用空间与进程占用。' };
descriptions.hardware = '设备配置、系统版本与硬件能力。';
descriptions.insights = '跟踪应用帧率、温控与功率，记录测试会话。';
let history = [], latest = null, deviceInfo = null, connected = false, paused = false, pauseTime = 0;
let range = 60, view = 'overview', visible = new Set(['cpu', 'gpu', 'memory']), hover = null, pausedHistory = [];
let toastTimer, selectedSerial = null, renderFrame = 0;
const value = (n, decimals = 1) => Number.isFinite(n) ? n.toFixed(decimals) : '—';
const gib = n => Number.isFinite(n) ? (n / 1024 ** 3).toFixed(2) : '—';
const text = (id, content) => { $(id).textContent = content; };
const time = timestamp => new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false });
const stateLabel = n => n == null ? '暂不可读' : n < 30 ? '低负载' : n < 70 ? '运行中' : '高负载';

function toast(message) {
  clearTimeout(toastTimer); text('toast', message); $('toast').classList.add('show');
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3200);
}
function updateConnection(isConnected, message = '') {
  connected = isConnected;
  setInsightConnection(connected);
  document.body.classList.toggle('connected', connected);
  document.body.classList.toggle('offline', !connected);
  $('connection-alert').hidden = connected;
  text('connection-message', message || '正在查找设备…');
  $('connection-badge').replaceChildren(Object.assign(document.createElement('i')), document.createTextNode(connected ? '已连接' : '未连接'));
  text('sidebar-status', connected ? 'ADB · 设备在线' : 'ADB · 未连接');
  if (!connected) {
    text('chart-status', latest ? '连接中断 · 保留最后一次采样' : '正在等待首个采样');
    text('sample-summary', '等待设备连接');
  } else text('sample-summary', '1 秒采样 · 实时同步');
}
function updateDevice(info, sample) {
  if (!info) return;
  deviceInfo = info;
  text('device-name', info.name); text('sidebar-name', info.name);
  text('chipset', info.chipset); text('android-version', `Android ${info.android}`);
  text('serial', info.serial); text('gpu-name', info.gpu); text('gpu-detail-name', info.gpu);
  if (sample?.memory?.total) text('device-ram', `${Math.round(sample.memory.total / 1e9)} GB RAM`);
  renderHardware(info, sample);
}
function renderMetrics(sample) {
  if (!sample) return;
  const { cpu, gpu, memory: mem, battery = {}, cores = [] } = sample;
  text('cpu-value', value(cpu)); text('gpu-value', value(gpu)); text('memory-value', value(mem.usage));
  text('temp-value', value(battery.temperature));
  text('cpu-state', stateLabel(cpu)); text('gpu-state', sample.gpuStatus === 'empty-window' ? '暂无窗口' : stateLabel(gpu));
  text('gpu-footnote', sample.gpuStatus === 'empty-window' ? '驱动返回 0 / 0' : gpu == null ? '接口暂不可读' : '图形处理器');
  text('memory-state', mem.usage == null ? '等待数据' : mem.usage < 80 ? '空间充足' : '使用较多');
  text('temp-state', battery.temperature == null ? '暂不可读' : battery.temperature < 40 ? '温度正常' : battery.temperature < 45 ? '温度偏高' : '高温');
  $('temp-state').dataset.level = battery.temperature == null || battery.temperature < 40 ? 'normal' : battery.temperature < 45 ? 'warm' : 'hot';
  text('cpu-core-count', `${cores.length} 核心`);
  const frequencies = cores.map(c => c.frequency).filter(Number.isFinite);
  text('cpu-frequency', frequencies.length ? `最高 ${value(Math.max(...frequencies) / 1000, 2)} GHz` : '频率暂不可读');
  text('memory-used', `${gib(mem.used)} GiB 已用`); text('memory-total', `共 ${gib(mem.total)} GiB`);
  text('battery-level', `${value(battery.level, 0)}%`);
  text('charging-status', battery.charging ? '正在充电' : '使用电池');
  $('battery-fill').style.width = `${battery.level || 0}%`;
  text('battery-voltage', `${value(battery.voltage, 2)} V`);
  $('temp-bar').style.width = `${Math.max(0, Math.min(100, ((battery.temperature || 20) - 20) / 30 * 100))}%`;
  for (const key of Object.keys(colors)) text(`legend-${key}`, `${value(key === 'memory' ? mem.usage : sample[key])}%`);
  const donut = $('donut-value'); donut.replaceChildren(document.createTextNode(value(mem.usage)), Object.assign(document.createElement('small'), { textContent: '%' }));
  text('donut-total', `共 ${gib(mem.total)} GiB`);
  $('memory-ring').style.strokeDashoffset = 452.39 * (1 - (mem.usage || 0) / 100);
  text('allocation-used', `${gib(mem.used)} GiB`); text('allocation-available', `${gib(mem.available)} GiB`); text('allocation-cached', `${gib(mem.cached)} GiB`);
  text('core-badge', `${cores.length} 核`);
  text('cpu-architecture', deviceInfo?.soc === 'SM8350' ? '4 + 3 + 1 架构' : `${cores.length} CORES`);
  renderCores(cores); renderProcesses(sample.processes || []);
  text('last-updated', `最后更新 ${time(sample.timestamp)}`);
  text('chart-status', paused ? '显示已暂停 · 采集仍在后台继续' : '正在接收实时数据');
  text('sample-count', `${visibleHistory().length} 个数据点`);
  $('chart-empty').hidden = history.length > 0;
}
function renderCores(cores) {
  const root = $('cores-grid');
  if (root.children.length !== cores.length) root.replaceChildren(...cores.map((core, index) => {
    const card = document.createElement('div');
    const kind = deviceInfo?.soc === 'SM8350' ? (index < 4 ? 'little' : index < 7 ? 'big' : 'prime') : 'little';
    card.className = `core-card ${kind}`;
    card.innerHTML = '<div class="core-top"><span></span><i></i></div><div class="core-freq"><span></span><small>MHz</small></div><div class="core-bar"><i></i></div><div class="core-load"></div>';
    return card;
  }));
  cores.forEach((core, i) => {
    const card = root.children[i];
    card.querySelector('.core-top span').textContent = core.id.toUpperCase();
    card.querySelector('.core-freq span').textContent = value(core.frequency, 0);
    card.querySelector('.core-bar i').style.width = `${core.usage || 0}%`;
    card.querySelector('.core-load').textContent = `${value(core.usage, 0)}%`;
  });
}
function renderProcesses(processes) {
  const root = $('processes-body');
  if (!processes.length) {
    root.innerHTML = '<tr><td colspan="3" class="empty-table">暂无可读取的进程数据</td></tr>'; return;
  }
  root.replaceChildren(...processes.map(process => {
    const row = document.createElement('tr');
    row.innerHTML = '<td><div class="process-name"><span class="process-icon"></span><span class="process-text"><span class="process-title"></span><span class="process-meta"></span></span></div></td><td></td><td></td>';
    const shortName = process.name.split('/').pop();
    row.querySelector('.process-icon').textContent = shortName.replace(/^com\./, '').slice(0, 2).toUpperCase();
    row.querySelector('.process-title').textContent = process.name;
    row.querySelector('.process-title').title = process.name;
    row.querySelector('.process-meta').textContent = `PID ${process.pid} · ${process.user}`;
    row.children[1].textContent = `${value(process.cpu)}%`;
    row.children[2].textContent = process.memory;
    return row;
  }));
  text('process-count', `TOP ${processes.length}`);
}
function visibleHistory() {
  const end = paused ? pauseTime : (history.at(-1)?.timestamp || Date.now());
  return (paused ? pausedHistory : history).filter(s => s.timestamp >= end - range * 1000 && s.timestamp <= end);
}
function canvasContext(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
    canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  return { ctx, width: rect.width, height: rect.height };
}
function line(ctx, points, color, bottom, fill = true, lineWidth = 1.6) {
  let segment = [];
  function draw() {
    if (!segment.length) return;
    ctx.beginPath(); ctx.moveTo(segment[0].x, segment[0].y);
    for (const point of segment.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.lineJoin = 'round'; ctx.stroke();
    if (segment.length === 1) { ctx.beginPath(); ctx.arc(segment[0].x, segment[0].y, 2, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); }
    if (fill) {
      ctx.lineTo(segment.at(-1).x, bottom); ctx.lineTo(segment[0].x, bottom); ctx.closePath();
      ctx.fillStyle = color + '0c'; ctx.fill();
    }
    segment = [];
  }
  for (const point of points) { if (point == null) draw(); else segment.push(point); } draw();
}
function drawCharts() {
  renderFrame = 0;
  const points = visibleHistory();
  const { ctx, width, height } = canvasContext($('main-chart'));
  if (!width || !height) return;
  const left = 31, right = width - 9, top = 9, bottom = height - 26;
  const end = paused ? pauseTime : (history.at(-1)?.timestamp || Date.now()), start = end - range * 1000;
  ctx.font = '9px "SFMono-Regular", Consolas, monospace'; ctx.fillStyle = '#858585'; ctx.textAlign = 'right';
  for (let n = 0; n <= 100; n += 25) {
    const y = bottom - n / 100 * (bottom - top);
    ctx.fillText(`${n}`, left - 9, y + 3);
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.strokeStyle = '#383838'; ctx.lineWidth = .6; ctx.setLineDash([3, 4]); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.textAlign = 'center';
  for (let i = 0; i <= 5; i++) {
    const x = left + i / 5 * (right - left), timestamp = start + i / 5 * range * 1000;
    ctx.fillStyle = '#858585';
    ctx.textAlign = i === 0 ? 'left' : i === 5 ? 'right' : 'center';
    ctx.fillText(new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false, minute: '2-digit', second: '2-digit' }), x, height - 6);
    if (i > 0 && i < 5) { ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.strokeStyle = '#282828'; ctx.lineWidth = .6; ctx.stroke(); }
  }
  for (const key of ['memory', 'gpu', 'cpu']) {
    if (!visible.has(key)) continue;
    line(ctx, points.map(point => Number.isFinite(point[key]) ? { x: left + (point.timestamp - start) / (end - start) * (right - left), y: bottom - point[key] / 100 * (bottom - top) } : null), colors[key], bottom);
  }
  if (hover != null && points.length) {
    const timestamp = start + Math.max(0, Math.min(1, (hover - left) / (right - left))) * (end - start);
    const point = points.reduce((best, p) => Math.abs(p.timestamp - timestamp) < Math.abs(best.timestamp - timestamp) ? p : best, points[0]);
    const x = left + (point.timestamp - start) / (end - start) * (right - left);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.strokeStyle = '#999999'; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
    const tooltip = $('chart-tooltip'); tooltip.replaceChildren();
    const when = document.createElement('time'); when.textContent = time(point.timestamp); tooltip.append(when);
    for (const key of visible) {
      const row = document.createElement('span'); row.style.color = colors[key];
      row.append(document.createTextNode(labels[key]), Object.assign(document.createElement('b'), { textContent: `${value(point[key])}%` })); tooltip.append(row);
      if (Number.isFinite(point[key])) { ctx.beginPath(); ctx.arc(x, bottom - point[key] / 100 * (bottom - top), 3, 0, Math.PI * 2); ctx.fillStyle = colors[key]; ctx.fill(); }
    }
    tooltip.style.display = 'block'; tooltip.style.left = `${Math.max(0, Math.min(width - 125, x + 13))}px`; tooltip.style.top = '14px';
  } else $('chart-tooltip').style.display = 'none';
  for (const key of Object.keys(colors)) {
    const { ctx: spark, width: w, height: h } = canvasContext($(`spark-${key}`));
    const samples = (paused ? pausedHistory : history).filter(p => p.timestamp <= end).slice(-40);
    const sparkStart = end - 39000;
    line(spark, samples.map(p => Number.isFinite(p[key]) ? { x: Math.max(0, (p.timestamp - sparkStart) / 39000 * w), y: h - 3 - p[key] / 100 * (h - 6) } : null), colors[key], h, true, 1.2);
  }
  text('sample-count', `${points.length} 个数据点`);
}
function requestDraw() { if (!renderFrame) renderFrame = requestAnimationFrame(drawCharts); }
function appendSample(sample) {
  latest = sample;
  history.push({ timestamp: sample.timestamp, cpu: sample.cpu, gpu: sample.gpu, memory: sample.memory.usage });
  if (history.length > 900) history.shift();
  updateConnection(true); updateDevice(sample.info, sample);
  sampleInsights(sample, sample.info);
  if (!paused) { renderMetrics(sample); requestDraw(); }
}
function applyState(state, reset = false) {
  selectedSerial = state.selected;
  if (reset) {
    history = []; latest = null; deviceInfo = null; paused = false; hover = null; pausedHistory = [];
    resetHardware();
    resetInsights(); setInsightPaused(false);
    document.body.classList.remove('paused'); $('pause-button').querySelector('use').setAttribute('href', '#i-pause');
    for (const id of ['cpu-value', 'gpu-value', 'memory-value', 'temp-value', 'serial', 'allocation-used', 'allocation-available', 'allocation-cached', 'battery-level']) text(id, '—');
    for (const id of ['cpu-state', 'gpu-state', 'memory-state', 'temp-state']) text(id, '等待数据');
    text('device-name', '正在读取设备'); text('sidebar-name', '正在读取设备');
    text('chipset', '—'); text('android-version', 'Android —'); text('device-ram', '— RAM');
    text('gpu-name', 'GPU'); text('gpu-footnote', '图形处理器');
    text('cpu-frequency', '— GHz'); text('cpu-core-count', '— 核心');
    text('memory-used', '— GiB 已用'); text('memory-total', '共 — GiB');
    text('charging-status', '电池状态'); text('battery-voltage', '— V');
    text('donut-total', '共 — GiB'); text('donut-value', '—%');
    text('last-updated', '等待数据更新'); text('chart-status', '正在读取新设备');
    for (const key of Object.keys(colors)) text(`legend-${key}`, '—');
    $('battery-fill').style.width = '0%'; $('temp-bar').style.width = '0%';
    $('memory-ring').style.strokeDashoffset = 452.39;
    $('processes-body').innerHTML = '<tr><td colspan="3" class="empty-table">正在读取进程数据</td></tr>';
    $('cores-grid').replaceChildren(); $('chart-empty').hidden = false;
  } else history = state.history || [];
  latest = state.latest;
  hydrateInsights(state);
  updateConnection(state.connected, state.message); updateDevice(state.info, latest);
  text('device-count', String(state.devices?.filter(d => d.state === 'device').length || 0));
  if (latest && !paused) renderMetrics(latest);
  requestDraw();
}

const events = openEvents();
events.addEventListener('init', event => applyState(JSON.parse(event.data)));
events.addEventListener('reset', event => applyState(JSON.parse(event.data), true));
events.addEventListener('sample', event => appendSample(JSON.parse(event.data)));
events.addEventListener('status', event => {
  const state = JSON.parse(event.data); updateConnection(state.connected, state.message);
  text('device-count', String(state.devices?.filter(d => d.state === 'device').length || 0));
});
events.onerror = () => updateConnection(false, isDesktop ? '采集连接中断，请重新检测设备' : '本地采集服务已断开，正在尝试重新连接…');
events.addEventListener('session', event => updateInsightSession(JSON.parse(event.data)));
events.addEventListener('target', event => updateInsightTarget(JSON.parse(event.data)));

function changeView(next) {
  if (!Object.hasOwn(viewNames, next)) return;
  view = next; document.body.dataset.view = next;
  $('hardware-view').hidden = next !== 'hardware';
  $('insights-view').hidden = next !== 'insights';
  window.history.replaceState(null, '', `#${next}`);
  document.querySelectorAll('button[data-view]').forEach(button => {
    button.classList.toggle('active', button.dataset.view === next);
    button.setAttribute('aria-pressed', String(button.dataset.view === next));
  });
  text('page-title', viewNames[next]);
  const live = document.createElement('span'); live.className = next === 'hardware' ? 'live-label hardware-label' : 'live-label'; live.innerHTML = next === 'hardware' ? '设备配置' : '<i></i>实时'; $('page-title').append(live);
  text('breadcrumb', viewNames[next]); text('page-description', descriptions[next]);
  visible = new Set(['overview', 'hardware', 'insights'].includes(next) ? ['cpu', 'gpu', 'memory'] : [next]);
  $('export-button').innerHTML = `<svg><use href="#i-arrow"/></svg>${next === 'hardware' ? '导出配置' : next === 'insights' ? '导出采样' : '导出数据'}`;
  document.querySelectorAll('[data-series]').forEach(b => { b.classList.toggle('disabled', !visible.has(b.dataset.series)); b.setAttribute('aria-pressed', String(visible.has(b.dataset.series))); });
  text('chart-title', ['overview', 'hardware', 'insights'].includes(next) ? '实时性能趋势' : `${labels[next]} 使用率趋势`);
  const liveChart = document.createElement('span'); liveChart.id = 'chart-live'; liveChart.className = 'tiny-live'; liveChart.innerHTML = `<i></i>${paused ? '暂停' : '实时'}`; $('chart-title').append(liveChart);
  text('chart-subtitle', next === 'overview' ? 'CPU、GPU 与内存使用率的连续采样' : next === 'cpu' ? '整机负载按所有核心归一化至 0–100%' : next === 'gpu' ? '来自 KGSL 驱动的真实图形负载' : '使用率 = 1 − 可用内存 / 物理内存');
  $('gpu-detail').hidden = next !== 'gpu';
  requestDraw();
  requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
}
document.querySelectorAll('button[data-view]').forEach(button => {
  button.setAttribute('aria-pressed', String(button.dataset.view === 'overview'));
  button.addEventListener('click', () => changeView(button.dataset.view));
});
document.querySelectorAll('[data-range]').forEach(button => {
  button.setAttribute('aria-pressed', String(button.classList.contains('active')));
  button.addEventListener('click', () => {
    range = Number(button.dataset.range);
    document.querySelectorAll('[data-range]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); });
    requestDraw();
  });
});
document.querySelectorAll('[data-series]').forEach(button => {
  button.setAttribute('aria-pressed', 'true');
  button.addEventListener('click', () => {
  const key = button.dataset.series;
  if (visible.has(key) && visible.size === 1) { toast('至少保留一项指标'); return; }
  visible.has(key) ? visible.delete(key) : visible.add(key);
  button.classList.toggle('disabled', !visible.has(key)); button.setAttribute('aria-pressed', String(visible.has(key))); requestDraw();
  });
});
$('pause-button').addEventListener('click', () => {
  paused = !paused; pauseTime = history.at(-1)?.timestamp || Date.now();
  setInsightPaused(paused);
  pausedHistory = paused ? history.slice() : [];
  document.body.classList.toggle('paused', paused);
  $('pause-button').querySelector('use').setAttribute('href', paused ? '#i-play' : '#i-pause');
  $('pause-button').setAttribute('aria-label', paused ? '恢复图表' : '暂停图表');
  $('pause-button').title = paused ? '恢复实时显示' : '暂停显示';
  $('chart-live').innerHTML = `<i></i>${paused ? '暂停' : '实时'}`;
  if (!paused && latest) renderMetrics(latest);
  text('chart-status', paused ? '显示已暂停 · 采集仍在后台继续' : connected ? '正在接收实时数据' : '连接中断 · 保留最后一次采样'); requestDraw();
});
$('main-chart').addEventListener('pointermove', event => { hover = event.clientX - $('main-chart').getBoundingClientRect().left; requestDraw(); });
$('main-chart').addEventListener('pointerleave', () => { hover = null; requestDraw(); });
new ResizeObserver(requestDraw).observe($('performance-panel'));
window.addEventListener('resize', requestDraw);

async function refreshDevices() {
  const root = $('dialog-devices'); root.replaceChildren(Object.assign(document.createElement('div'), { className: 'no-devices', textContent: '正在检测设备…' }));
  try {
    const response = await request('/api/devices');
    if (!response.ok) throw new Error();
    const data = await response.json(); selectedSerial = data.selected;
    text('device-count', String(data.devices.filter(d => d.state === 'device').length));
    if (!data.devices.length) {
      root.replaceChildren(Object.assign(document.createElement('div'), { className: 'no-devices', textContent: '未发现设备，请检查 USB 连接与调试授权。' })); return;
    }
    root.replaceChildren(...data.devices.map(device => {
      const button = document.createElement('button'); button.className = 'dialog-device';
      button.innerHTML = '<svg><use href="#i-phone"/></svg><span><strong></strong><small></small></span><span></span>';
      button.querySelector('strong').textContent = device.model;
      button.querySelector('small').textContent = device.serial;
      button.lastChild.textContent = device.state === 'device' ? device.serial === selectedSerial ? '当前设备 ✓' : '连接 →' : device.state === 'unauthorized' ? '请在手机上授权' : '设备离线';
      button.disabled = device.state !== 'device';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const response = await request(`/api/device?serial=${encodeURIComponent(device.serial)}`, { method: 'POST' });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || '连接失败');
          selectedSerial = device.serial; $('connection-dialog').close(); toast('已连接设备，正在采集性能数据');
        } catch (error) { toast(error.message); button.disabled = false; }
      });
      return button;
    }));
  } catch { root.replaceChildren(Object.assign(document.createElement('div'), { className: 'no-devices', textContent: isDesktop ? '无法检测设备，请重新启动 BKDeviceMonitor 并检查 USB 连接。' : '本地服务不可用，请在项目目录运行 npm start。' })); }
}
function openConnection() { $('connection-dialog').showModal(); void refreshDevices(); }
for (const id of ['connect-button', 'sidebar-device', 'help-button']) $(id).addEventListener('click', openConnection);
$('close-dialog').addEventListener('click', () => $('connection-dialog').close());
$('connection-dialog').addEventListener('click', event => { const r = $('connection-dialog').getBoundingClientRect(); if (event.target === $('connection-dialog') && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) $('connection-dialog').close(); });
$('refresh-devices').addEventListener('click', refreshDevices);
$('retry-button').addEventListener('click', async () => { try { await request('/api/devices'); toast('已重新检测设备，请确认手机已允许 USB 调试'); } catch { toast(isDesktop ? '无法检测设备，请重启 BKDeviceMonitor' : '采集服务未运行，请执行 npm start'); } });
$('export-button').addEventListener('click', async () => {
  try {
  if (view === 'insights') { exportInsights(); return; }
  if (view === 'hardware') {
    if (!deviceInfo?.hardware) { toast('请先连接设备以读取硬件信息'); return; }
    const report = { exportedAt: new Date().toISOString(), device: deviceInfo, latest: { memory: latest?.memory, storage: latest?.storage, battery: latest?.battery }, note: 'profile 为官方型号参考规格，其余字段为设备读取；静态配置在连接时采集。' };
    if (await saveDownload(JSON.stringify(report, null, 2), `BKDeviceMonitor-hardware-${deviceInfo.model || 'android'}.json`)) toast('已导出设备硬件配置与来源信息'); return;
  }
  const data = paused ? pausedHistory : history;
  if (!data.length) { toast('暂无可导出的数据，请先连接设备'); return; }
  const rows = [['时间', '设备序列号', 'CPU使用率(%)', 'GPU使用率(%)', '内存使用率(%)'], ...data.map(p => [new Date(p.timestamp).toISOString(), selectedSerial || deviceInfo?.serial || '', ...['cpu', 'gpu', 'memory'].map(key => Number.isFinite(p[key]) ? p[key].toFixed(2) : '')])];
  const csv = '\uFEFF' + rows.map(row => row.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n');
  if (await saveDownload(csv, `BKDeviceMonitor-${new Date().toISOString().replaceAll(':', '-').slice(0, 19)}.csv`, 'text/csv;charset=utf-8')) toast(`已导出 ${data.length} 条真实性能采样`);
  } catch (error) { toast(`导出失败：${error.message}`); }
});
setInterval(() => text('clock', time(Date.now())), 1000); text('clock', time(Date.now()));
renderCores(Array.from({ length: 8 }, (_, i) => ({ id: `cpu${i}`, usage: null, frequency: null })));
initInsights({ toast, onPause: () => $('pause-button').click() });
window.addEventListener('hashchange', () => changeView(location.hash.slice(1) || 'overview'));
if (Object.hasOwn(viewNames, location.hash.slice(1))) changeView(location.hash.slice(1));
requestDraw();

if (isDesktop) {
  document.querySelector('.workspace small').textContent = 'USB 设备监测';
  document.querySelector('.local-chip').replaceChildren(Object.assign(document.createElement('span')), document.createTextNode('本地采集'));
  document.querySelector('.sidebar-footer span:last-child').textContent = 'v1.2.1';
  document.querySelector('.workspace-dots').textContent = '•';
}
