import { request, saveDownload } from './transport.js';
const $ = id => document.getElementById(id);
const finite = Number.isFinite;
const n = (value, places = 1) => finite(value) ? value.toFixed(places) : '—';
const unit = (value, suffix, places = 1) => finite(value) ? `${value.toFixed(places)} ${suffix}` : '—';
const mib = value => unit(finite(value) ? value / 1024 ** 2 : null, 'MiB');
const gib = value => unit(finite(value) ? value / 1024 ** 3 : null, 'GiB', 2);
const speed = value => !finite(value) ? '—' : value >= 1024 ** 2 ? unit(value / 1024 ** 2, 'MiB/s', 2) : unit(value / 1024, 'KiB/s', 1);
let points = [], latest = null, info = null, connected = false, paused = false, frozen = [], frozenSample = null;
let range = 60, session = null, notify = () => {}, raf = 0, appSignature = '', target = null, knownApps = [];
const set = (id, value) => { $(id).textContent = value; };
const metric = (id, value, suffix) => {
  const root = $(id); root.replaceChildren(document.createTextNode(n(value)), Object.assign(document.createElement('small'), { textContent: suffix }));
};
function toPoint(s) {
  return { timestamp: s.timestamp, cpu: s.cpu, gpu: s.gpu, memory: s.memory.usage, fps: s.frames?.fps ?? null,
    cpuTemp: s.thermal?.cpu ?? null, gpuTemp: s.thermal?.gpu ?? null, powerW: s.power?.watts ?? null,
    downloadBps: s.network?.downloadBps ?? null, uploadBps: s.network?.uploadBps ?? null,
    frequencies: Object.fromEntries((s.cores || []).map(c => [c.id, c.frequency])), app: s.app?.packageName || '', appCpu: s.app?.cpu ?? null };
}
function updateApps(apps, currentTarget = target) {
  if (Array.isArray(apps)) knownApps = apps;
  if (currentTarget) target = currentTarget;
  const choices = [...new Set([...knownApps, ...(target?.packageName ? [target.packageName] : [])])].sort();
  const signature = JSON.stringify(choices);
  if (signature !== appSignature) {
    appSignature = signature;
    $('target-app').replaceChildren(new Option('自动跟随前台应用', 'auto'), ...choices.map(pkg => new Option(pkg, pkg)));
  }
  $('target-app').value = target?.mode === 'selected' && target.packageName ? target.packageName : 'auto';
}
function render(sample) {
  if (!sample) return;
  const f = sample.frames || {}, thermal = sample.thermal || {}, app = sample.app || {}, power = sample.power || {};
  const freshFrame = f.collectedAt && sample.timestamp - f.collectedAt < 8000;
  metric('insight-fps', freshFrame ? f.fps : null, 'FPS');
  metric('insight-cpu-temp', thermal.cpu, '°C'); metric('insight-gpu-temp', thermal.gpu, '°C'); metric('insight-power', power.watts, 'W');
  const frameStates = { collecting: '正在采集 2 秒追踪窗口', 'no-frames': '无新帧 · 静止、后台或应用未提供数据', 'no-target': '请选择正在运行的应用', unavailable: '当前系统未提供可用帧数据', ok: `${f.frameCount} 帧 / ${unit(f.windowMs / 1000, 's', 0)} 有效窗口` };
  set('fps-state', freshFrame ? frameStates[f.status] || '等待追踪结果' : '等待 FrameTimeline 新采样');
  set('frame-p95', freshFrame ? unit(f.intervalP95, 'ms', 2) : '—'); set('frame-p99', freshFrame ? unit(f.intervalP99, 'ms', 2) : '—');
  set('frame-jank', freshFrame && f.jankCount != null ? `${f.jankCount} / ${f.droppedCount ?? '—'}` : '—');
  $('fps-chart-empty').hidden = (paused ? frozen : points).some(p => finite(p.fps));
  set('frame-source', f.layer ? `图层：${f.layer}` : '帧率来自应用呈现帧，屏幕刷新率不等于 FPS。无新帧时保持缺失状态。');
  const cpuNames = (thermal.temperatures || []).filter(t => t.category === 'cpu').map(t => t.name);
  const gpuNames = (thermal.temperatures || []).filter(t => t.category === 'gpu').map(t => t.name);
  set('cpu-temp-source', cpuNames.length ? `${cpuNames.length} 个 CPU 温度传感器 · 取最高值` : '系统未开放 CPU 温度');
  set('gpu-temp-source', gpuNames.length ? `${gpuNames.length} 个 GPU 温度传感器 · 取最高值` : '系统未开放 GPU 温度');
  set('power-state', power.currentMA != null ? `${unit(power.currentMA, 'mA')} · 电池端幅值` : '等待系统电流数据 · 不推测功耗');
  set('online-cores', sample.onlineCores == null ? '在线核心不可读' : `${sample.onlineCores} 核在线`);
  set('target-description', app.packageName ? `${app.mode === 'auto' ? '前台跟随' : app.foreground ? '前台应用' : '后台 / 非前台'} · ${app.packageName}` : '等待识别前台应用');
  set('app-package', app.packageName || '尚未选择应用'); set('app-pid', `PID ${app.pid || '—'}`);
  set('app-cpu', unit(app.cpu, '%')); set('app-threads', app.threads ?? '—'); set('app-pss', mib(app.pssBytes)); set('app-rss', mib(app.rssBytes));
  set('network-rx', speed(sample.network?.downloadBps)); set('network-tx', speed(sample.network?.uploadBps));
  set('network-source', sample.network?.interfaces?.length ? `统计接口：${sample.network.interfaces.join(' · ')}` : '网络接口不可读或尚无差分基准');
  set('battery-current', unit(power.currentMA, 'mA')); set('battery-direction', sample.battery?.level == null ? '—' : sample.battery.charging ? '连接充电源' : '电池供电 / 未充电');
  const pressure = sample.pressure || {};
  set('psi-status', pressure.some ? 'PSI · 等待内存资源的时间比例' : 'PSI 接口未开放 · 换页与缺页数据仍可独立观察');
  set('psi-some', unit(pressure.some?.avg10, '%', 2)); set('psi-full', unit(pressure.full?.avg10, '%', 2));
  set('swap-rate', finite(pressure.swapInPagesPerSec) ? `${n(pressure.swapInPagesPerSec)} / ${n(pressure.swapOutPagesPerSec)} 页/s` : '—');
  set('swap-used', sample.memory ? `${gib(sample.memory.swapUsed)} / ${gib(sample.memory.swapTotal)}` : '—');
  set('major-faults', `重大缺页 ${n(pressure.majorFaultsPerSec)} /s`); set('oom-kills', `启动以来 OOM ${pressure.oomKills ?? '—'}`);
  const thermalLabels = ['无热告警', '轻度', '中度', '重度', '临界', '紧急', '关机保护'];
  set('thermal-status', thermal.level == null ? '等级未开放' : `L${thermal.level} · ${thermalLabels[thermal.level] || '未知'}`);
  $('thermal-status').classList.toggle('warm', thermal.level > 1);
  const sensors = $('sensor-list');
  if (thermal.temperatures?.length) sensors.replaceChildren(...thermal.temperatures.map(sensor => {
    const row = document.createElement('div'); row.className = 'sensor-row';
    const name = document.createElement('span'); name.textContent = sensor.name;
    const bar = document.createElement('div'); bar.className = 'sensor-bar'; const fill = document.createElement('i'); fill.style.width = `${Math.min(100, sensor.celsius)}%`; bar.append(fill);
    const value = document.createElement('strong'); value.textContent = unit(sensor.celsius, '°C'); row.append(name, bar, value); return row;
  })); else sensors.replaceChildren(Object.assign(document.createElement('p'), { textContent: '未读取到独立温度传感器。电池温度仍可在总览查看。' }));
  const activeCooling = (thermal.coolingDevices || []).filter(d => d.value > 0);
  set('cooling-list', activeCooling.length ? `非零冷却设备状态：${activeCooling.map(d => `${d.name} = ${d.value}`).join(' · ')}。状态值由厂商定义，不直接换算为限频百分比。` : '系统未报告非零冷却设备状态；不据此推断所有核心均未限频。');
  scheduleDraw();
}
function groupSeries(data) {
  const groups = new Map();
  for (const core of info?.hardware?.cores || []) {
    const key = core.maxMHz ?? 'unknown'; const list = groups.get(key) || []; list.push(core.id); groups.set(key, list);
  }
  const colors = ['#91c5a1', '#8faed0', '#b2a0cf', '#d6b183'];
  return [...groups].sort(([a], [b]) => Number(a) - Number(b)).map(([max, ids], i, all) => ({
    label: info?.soc === 'SM8350' && all.length === 3 ? ['能效核心', '性能核心', '超大核心'][i] : `核心组 ${i + 1}`,
    color: colors[i % colors.length], max: typeof max === 'number' ? max / 1000 : null,
    values: data.map(p => { const values = ids.map(id => p.frequencies?.[id]).filter(finite); return { timestamp: p.timestamp, value: values.length ? values.reduce((a, b) => a + b, 0) / values.length / 1000 : null }; })
  }));
}
function canvasChart(canvas, series, maximum, digits = 0) {
  const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
  const dpr = Math.min(devicePixelRatio || 1, 2); canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width, h = rect.height, left = 34, right = w - 8, top = 10, bottom = h - 26;
  const data = paused ? frozen : points, end = data.at(-1)?.timestamp || Date.now(), start = end - range * 1000;
  ctx.font = '9px Consolas, monospace'; ctx.lineWidth = .6;
  for (let i = 0; i <= 4; i++) {
    const y = bottom - i / 4 * (bottom - top); ctx.fillStyle = '#858585'; ctx.textAlign = 'right'; ctx.fillText((i / 4 * maximum).toFixed(digits), left - 8, y + 3);
    ctx.strokeStyle = '#383838'; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke(); ctx.setLineDash([]);
  }
  for (let i = 0; i <= 4; i++) {
    const timestamp = start + i / 4 * range * 1000; ctx.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center';
    ctx.fillText(new Date(timestamp).toLocaleTimeString('zh-CN', { minute: '2-digit', second: '2-digit', hour12: false }), left + i / 4 * (right - left), h - 6);
  }
  for (const item of series) {
    ctx.strokeStyle = item.color; ctx.lineWidth = 1.5; ctx.beginPath(); let drawing = false, previousTime = null;
    for (const p of item.values.filter(p => p.timestamp >= start && p.timestamp <= end)) {
      if (!finite(p.value)) { drawing = false; previousTime = null; continue; }
      const x = left + (p.timestamp - start) / (range * 1000) * (right - left), y = bottom - Math.min(maximum, p.value) / maximum * (bottom - top);
      if (drawing && p.timestamp - previousTime < 3500) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      previousTime = p.timestamp; drawing = true;
    }
    ctx.stroke();
  }
}
function draw() {
  raf = 0;
  const data = paused ? frozen : points;
  const maxFps = Math.max(60, ...(info?.hardware?.display.rates || []), ...data.map(p => p.fps || 0));
  canvasChart($('fps-chart'), [{ color: '#91c5a1', values: data.map(p => ({ timestamp: p.timestamp, value: p.fps })) }], Math.ceil(maxFps / 30) * 30);
  const groups = groupSeries(data);
  canvasChart($('frequency-chart'), groups, Math.max(1, ...groups.map(g => g.max || 0)) * 1.08, 1);
  $('frequency-legend').replaceChildren(...groups.map(g => {
    const item = document.createElement('span'), dot = document.createElement('i'); dot.style.background = g.color;
    item.append(dot, document.createTextNode(`${g.label} ${unit(g.values.at(-1)?.value, 'GHz', 2)}`)); return item;
  }));
}
function scheduleDraw() { if (!raf) raf = requestAnimationFrame(draw); }
export function updateInsightSession(next) {
  session = next;
  const active = !!session?.active, summary = session?.summary;
  $('session-start').disabled = !connected || active; $('session-stop').disabled = !active; $('session-export').disabled = !session;
  $('session-label').disabled = active;
  set('session-badge', active ? '● 记录中' : session ? '已结束' : '未开始'); $('session-badge').classList.toggle('recording', active);
  set('session-status', session ? `${session.label} · ${session.sampleCount} 个采样 · ${session.device?.name || 'Android'}` : '开始会话，记录采样、峰值、卡顿与应用切换事件。');
  set('session-fps', n(summary?.averageFps)); set('session-jank', summary?.jankCount ?? '—');
  set('session-cpu', summary ? `${n(summary.cpuAverage)} / ${n(summary.cpuPeak)} %` : '—');
  set('session-temp', summary ? `${n(summary.cpuTempPeak)} / ${n(summary.gpuTempPeak)} °C` : '—');
  set('session-coverage', summary ? `${n(summary.frameWindowMs / 1000, 0)} 秒 / ${summary.frameWindows} 窗口` : '—');
  $('session-events').replaceChildren(...(session?.events || []).slice(-6).map(event => {
    const row = document.createElement('div'); const time = document.createElement('time'); time.textContent = new Date(event.timestamp).toLocaleTimeString('zh-CN', { hour12: false }); row.append(time, document.createTextNode(event.message)); return row;
  }));
  updateDuration();
}
function updateDuration() {
  const seconds = session ? Math.max(0, Math.floor(((session.endedAt || Date.now()) - session.startedAt) / 1000)) : 0;
  set('session-duration', `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`);
}
export function updateInsightTarget(data) { target = data.target; updateApps(null, target); updateInsightSession(data.session); }
export function setInsightConnection(value) {
  connected = value;
  set('insight-stream-status', value ? paused ? '显示已暂停 · 采集与会话继续' : '设备实时采集 · 不可读指标保留缺失状态' : '设备已断开 · 等待重新连接');
  updateInsightSession(session);
}
export function setInsightPaused(value) {
  paused = value; if (paused) { frozen = points.slice(); frozenSample = latest; }
  $('insight-pause').textContent = paused ? '恢复显示' : '暂停显示';
  setInsightConnection(connected); render(paused ? frozenSample : latest);
}
export function hydrateInsights(state) {
  points = (state.history || []).map(p => ({ ...p })); latest = state.latest; info = state.info;
  target = state.target || state.latest?.app || null; updateApps(state.apps, target);
  setInsightConnection(state.connected); updateInsightSession(state.session);
  if (!paused) render(latest);
}
export function sampleInsights(sample, device) {
  info = device; latest = sample;
  if (points.at(-1)?.timestamp !== sample.timestamp) points.push(toPoint(sample));
  if (points.length > 900) points.shift();
  target = sample.app; updateApps(sample.apps, target); updateInsightSession(sample.session);
  if (!paused) render(sample);
}
export function resetInsights() {
  points = []; latest = null; info = null; target = null; appSignature = ''; knownApps = []; frozen = []; frozenSample = null;
  for (const id of ['insight-fps', 'insight-cpu-temp', 'insight-gpu-temp', 'insight-power', 'app-cpu', 'app-threads', 'app-pss', 'app-rss', 'network-rx', 'network-tx', 'battery-current', 'frame-p95', 'frame-p99', 'frame-jank']) set(id, '—');
  set('sensor-list', '等待新设备的温度数据'); set('app-package', '正在读取应用'); updateApps([], null); scheduleDraw();
}
export async function exportInsights() {
  const data = paused ? frozen : points;
  if (!data.length) { notify('暂无可导出的采样'); return; }
  const columns = ['timestamp', 'cpu', 'gpu', 'memory', 'fps', 'cpuTemp', 'gpuTemp', 'powerW', 'downloadBps', 'uploadBps', 'app', 'appCpu'];
  const safe = value => { const string = String(value ?? ''); return `"${(/^[=+@-]/.test(string) ? "'" + string : string).replaceAll('"', '""')}"`; };
  const csv = '\uFEFF' + [columns.join(','), ...data.map(p => columns.map(key => safe(key === 'timestamp' ? new Date(p[key]).toISOString() : p[key])).join(','))].join('\r\n');
  try { if (await saveDownload(csv, `BKDeviceMonitor-insights-${Date.now()}.csv`, 'text/csv;charset=utf-8')) notify(`已导出 ${data.length} 条深度监测采样`); } catch (error) { notify(`导出失败：${error.message}`); }
}
export function initInsights({ toast, onPause }) {
  notify = toast;
  $('jump-session').addEventListener('click', () => $('session-panel').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }));
  $('insight-pause').addEventListener('click', onPause);
  document.querySelectorAll('[data-insight-range]').forEach(button => button.addEventListener('click', () => {
    range = Number(button.dataset.insightRange); document.querySelectorAll('[data-insight-range]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); }); scheduleDraw();
  }));
  $('refresh-apps').addEventListener('click', async () => {
    try { const response = await request('/api/apps'); if (!response.ok) throw new Error('无法读取运行应用'); const result = await response.json(); updateApps(result.apps, result.target); notify('运行应用列表已更新'); } catch (e) { notify(e.message); }
  });
  $('target-app').addEventListener('change', async () => {
    const control = $('target-app'); control.disabled = true;
    try { const response = await request(`/api/target?${new URLSearchParams({ package: control.value })}`, { method: 'POST' }); const result = await response.json(); if (!response.ok) throw new Error(result.error); updateInsightTarget(result); notify('已更换监测目标，等待新的采样'); }
    catch (e) { notify(e.message); updateApps(null, target); } finally { control.disabled = false; }
  });
  for (const action of ['start', 'stop']) $(`session-${action}`).addEventListener('click', async () => {
    const button = $(`session-${action}`); button.disabled = true;
    try { const response = await request(`/api/session?${new URLSearchParams({ action, label: $('session-label').value })}`, { method: 'POST' }); const result = await response.json(); if (!response.ok) throw new Error(result.error); updateInsightSession(result); notify(action === 'start' ? '测试已开始，后台持续记录' : '测试已结束，可导出报告'); }
    catch (e) { notify(e.message); updateInsightSession(session); }
  });
  $('session-export').addEventListener('click', async () => {
    try { const response = await request('/api/session/report'); const report = await response.json(); if (!response.ok) throw new Error(report.error); if (await saveDownload(JSON.stringify(report, null, 2), `BKDeviceMonitor-session-${report.id}.json`)) notify('测试报告已导出'); } catch (e) { notify(e.message); }
  });
  new ResizeObserver(scheduleDraw).observe($('insights-view')); setInterval(updateDuration, 1000);
}
