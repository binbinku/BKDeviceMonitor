import { isDesktop, request, filesRequest } from './transport.js';

const activePhases = new Set(['preparing', 'transferring', 'finishing']);
const phases = { preparing: '准备中', transferring: '下载中', finishing: '正在保存', completed: '已完成', failed: '失败', canceled: '已取消' };
const formatBytes = value => value == null ? '—' : value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(2)} GiB` : value >= 1024 ** 2 ? `${(value / 1024 ** 2).toFixed(1)} MiB` : value >= 1024 ? `${(value / 1024).toFixed(1)} KiB` : `${value} B`;
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
const parentOf = path => path === '/sdcard' ? path : path.slice(0, path.lastIndexOf('/')) || '/sdcard';
function fileType(item) {
  if (item.type === 'directory') return '文件夹';
  if (item.type === 'symlink') return '符号链接';
  if (item.type !== 'file') return '特殊 / 不可读';
  const ext = item.name.split('.').at(-1).toLowerCase();
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic'].includes(ext)) return '图片';
  if (['mp4', 'mkv', 'mov', 'webm'].includes(ext)) return '视频';
  if (['mp3', 'flac', 'wav', 'm4a', 'ogg'].includes(ext)) return '音频';
  return ext === 'apk' ? 'APK 安装包' : '文件';
}
export function initDeviceFiles({ events, toast }) {
  if (!isDesktop) return { setView() {} };
  const $ = id => document.getElementById(id);
  document.querySelectorAll('[data-view="files"]').forEach(button => { button.hidden = false; });
  let visible = false, desiredSerial = null, serial = '', currentPath = '/sdcard', listing = null, selected = new Set(), backStack = [];
  let loading = false, picking = false, refreshing = false, sequence = 0, error = '', transferState = { revision: -1, jobs: [] };
  const taskRows = new Map();
  const busyTransfer = () => transferState.jobs.some(job => activePhases.has(job.phase) && !job.finishedAt);
  const supported = item => ['file', 'directory'].includes(item.type);
  function shown() {
    const query = $('files-search').value.toLocaleLowerCase();
    return (listing?.entries || []).filter(item => ($('files-hidden').checked || !item.hidden) && item.name.toLocaleLowerCase().includes(query)).sort((a, b) => {
      if ((a.type === 'directory') !== (b.type === 'directory')) return a.type === 'directory' ? -1 : 1;
      const mode = $('files-sort').value;
      return (mode === 'size' ? (b.type === 'file' ? b.size || 0 : 0) - (a.type === 'file' ? a.size || 0 : 0) : mode === 'date' ? (b.modifiedAt || 0) - (a.modifiedAt || 0) : 0) || collator.compare(a.name, b.name);
    });
  }
  function controls() {
    const unavailable = loading || picking || !serial || !listing;
    $('files-download').disabled = unavailable || busyTransfer() || !selected.size;
    $('files-download-folder').disabled = unavailable || busyTransfer();
    $('files-refresh').disabled = loading || picking || !serial;
    $('files-back').disabled = loading || picking || !backStack.length;
    $('files-up').disabled = loading || picking || currentPath === '/sdcard';
    $('files-go').disabled = loading || picking || !serial;
    $('files-device').disabled = picking || refreshing;
    $('files-devices-refresh').disabled = picking || refreshing;
    $('files-all').disabled = unavailable || !shown().some(supported);
    document.querySelectorAll('[data-file-path]').forEach(button => { button.disabled = loading || picking || !serial; button.classList.toggle('active', button.dataset.filePath === currentPath); });
    const items = (listing?.entries || []).filter(item => selected.has(item.path));
    const files = items.filter(item => item.type === 'file'), folders = items.length - files.length;
    $('files-selection').textContent = items.length ? `已选 ${items.length} 项 · ${formatBytes(files.reduce((sum, item) => sum + (item.size || 0), 0))}${folders ? ` + ${folders} 个文件夹` : ''}` : listing ? `显示 ${shown().length} / ${listing.entries.length} 项` : '未选择文件';
    const candidates = shown().filter(supported), checked = candidates.filter(item => selected.has(item.path)).length;
    $('files-all').checked = !!candidates.length && checked === candidates.length;
    $('files-all').indeterminate = checked > 0 && checked < candidates.length;
    $('files-message').hidden = !!listing && !!shown().length && !loading && !error;
    $('files-message').dataset.error = String(!!error);
    $('files-message').textContent = error || (loading ? '正在读取手机目录…' : !serial ? '请连接并选择已授权的设备。' : !listing ? '选择快捷目录或输入路径开始浏览。' : listing.entries.length ? '没有匹配的文件，请调整筛选条件或显示隐藏项。' : '此文件夹为空。');
  }
  function breadcrumbs() {
    $('files-path').value = currentPath;
    const parts = currentPath.replace(/^\/sdcard\/?/, '').split('/').filter(Boolean);
    const root = document.createElement('button'); root.type = 'button'; root.textContent = '内部存储'; root.addEventListener('click', () => void navigate('/sdcard'));
    const nodes = [root]; let path = '/sdcard';
    for (const part of parts) {
      path += '/' + part; const target = path;
      const slash = document.createElement('span'); slash.textContent = '/';
      const button = document.createElement('button'); button.type = 'button'; button.textContent = part; button.addEventListener('click', () => void navigate(target));
      nodes.push(slash, button);
    }
    $('files-breadcrumbs').replaceChildren(...nodes);
  }
  function renderRows() {
    $('files-body').replaceChildren(...shown().map(item => {
      const row = document.createElement('tr'); row.classList.toggle('selected', selected.has(item.path));
      row.innerHTML = '<td><input type="checkbox"></td><td><button class="files-name"><svg><use/></svg><span></span></button></td><td></td><td></td><td></td>';
      const checkbox = row.querySelector('input'), name = row.querySelector('.files-name');
      checkbox.setAttribute('aria-label', `选择 ${item.name}`); checkbox.checked = selected.has(item.path); checkbox.disabled = !supported(item) || loading;
      const toggle = () => { if (selected.has(item.path)) selected.delete(item.path); else selected.add(item.path); checkbox.checked = selected.has(item.path); row.classList.toggle('selected', checkbox.checked); controls(); };
      checkbox.addEventListener('change', toggle);
      name.querySelector('use').setAttribute('href', item.type === 'directory' ? '#i-folder' : '#i-file');
      name.querySelector('span').textContent = item.name; name.title = item.name; name.disabled = loading || !supported(item);
      name.addEventListener('click', () => item.type === 'directory' ? void navigate(item.path) : toggle());
      row.cells[2].textContent = fileType(item); row.cells[3].textContent = item.type === 'file' ? formatBytes(item.size) : '—';
      row.cells[4].textContent = item.modifiedAt != null && !Number.isNaN(new Date(item.modifiedAt).getTime()) ? new Date(item.modifiedAt).toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
      return row;
    }));
    controls();
  }
  async function navigate(path, { remember = true } = {}) {
    if (!serial || picking) return;
    const previous = currentPath, id = ++sequence, device = serial;
    currentPath = path; loading = true; error = ''; listing = null; selected.clear(); breadcrumbs(); renderRows();
    try {
      const result = await filesRequest({ action: 'list', serial: device, path });
      if (id !== sequence || device !== serial) return;
      listing = result.listing; currentPath = listing.path;
      if (remember && previous !== currentPath) backStack.push(previous);
      breadcrumbs();
    } catch (failure) { if (id === sequence) error = failure.message; }
    finally { if (id === sequence) { loading = false; renderRows(); } }
  }
  async function devices() {
    if (refreshing || picking) return;
    refreshing = true; controls();
    try {
      const response = await request('/api/devices');
      if (!response.ok) throw new Error('无法检测设备，请检查 ADB。');
      const result = await response.json(), usable = result.devices.filter(device => device.state === 'device');
      const preferred = desiredSerial ?? result.selected ?? (usable.length === 1 ? usable[0].serial : '');
      const options = result.devices.map(device => { const option = new Option(`${device.model} · ${device.serial}${device.state === 'device' ? '' : device.state === 'unauthorized' ? ' · 未授权' : ' · 离线'}`, device.serial); option.disabled = device.state !== 'device'; return option; });
      $('files-device').replaceChildren(new Option(usable.length ? '请选择设备' : '没有已授权的连接设备', ''), ...options);
      const next = usable.some(device => device.serial === preferred) ? preferred : '';
      $('files-device').value = next;
      if (desiredSerial === null && next) desiredSerial = next;
      if (serial !== next) {
        sequence++; loading = false; listing = null; selected.clear(); serial = next;
        if (serial) void navigate(currentPath, { remember: false }); else { error = '设备已断开或尚未授权，请连接手机并允许 USB 调试。'; renderRows(); }
      }
    } catch (failure) { sequence++; serial = ''; loading = false; listing = null; selected.clear(); error = failure.message; renderRows(); }
    finally { refreshing = false; controls(); }
  }
  function tasks(next) {
    if (next.revision < transferState.revision) return;
    const previous = new Map(transferState.jobs.map(job => [job.id, job])); transferState = next;
    if (next.jobs.length) $('files-jobs').querySelector('.files-task-empty')?.remove();
    for (const job of [...next.jobs].reverse()) {
      let row = taskRows.get(job.id);
      if (!row) {
        row = document.createElement('article'); row.className = 'files-task';
        row.innerHTML = '<div class="files-task-top"><strong class="files-task-name"></strong><span class="files-task-status" role="status"></span></div><p class="files-task-device"></p><div class="files-task-progress" role="progressbar"><i></i></div><div class="files-task-bottom"><span class="files-task-metrics"></span><button class="files-task-button files-cancel">取消下载</button><button class="files-task-button files-reveal">打开所在文件夹</button></div><p class="files-task-message"></p>';
        const cancel = row.querySelector('.files-cancel'), reveal = row.querySelector('.files-reveal');
        cancel.addEventListener('click', async () => { try { tasks((await filesRequest({ action: 'cancel', id: job.id })).state); } catch (failure) { toast(failure.message); } });
        reveal.addEventListener('click', async () => { try { await filesRequest({ action: 'reveal', id: job.id }); } catch (failure) { toast(failure.message); } });
        taskRows.set(job.id, row); $('files-jobs').prepend(row);
      }
      row.dataset.phase = job.phase;
      row.querySelector('.files-task-name').textContent = job.names.length === 1 ? job.names[0] : `${job.selectedCount} 项文件与文件夹`;
      row.querySelector('.files-task-status').textContent = job.cancelRequested && !job.finishedAt ? '正在取消…' : phases[job.phase];
      row.querySelector('.files-task-device').textContent = `${job.deviceName} · ${job.serial} → ${job.destinationName}`;
      const progress = row.querySelector('.files-task-progress'), percent = job.phase === 'completed' ? 100 : job.totalBytes > 0 ? Math.min(100, job.transferredBytes / job.totalBytes * 100) : null;
      progress.classList.toggle('indeterminate', percent === null && activePhases.has(job.phase));
      progress.querySelector('i').style.width = percent === null ? '' : `${percent}%`;
      progress.setAttribute('aria-label', `${job.names.join('、')} 下载进度`);
      if (percent === null) progress.removeAttribute('aria-valuenow'); else progress.setAttribute('aria-valuenow', String(Math.round(percent)));
      progress.setAttribute('aria-valuetext', phases[job.phase]);
      row.querySelector('.files-task-metrics').textContent = job.totalBytes === null ? '正在读取文件大小…' : `${formatBytes(job.transferredBytes)} / ${formatBytes(job.totalBytes)} · ${job.completedFiles}/${job.totalFiles} 个文件${job.speedBps > 0 ? ` · ${formatBytes(Math.round(job.speedBps))}/s` : ''}`;
      row.querySelector('.files-task-message').textContent = job.finishedAt ? job.message : job.phase === 'finishing' ? '正在保存正式文件，同名文件会自动编号…' : job.phase === 'preparing' ? '正在检查设备权限和文件列表…' : job.currentPath;
      const cancel = row.querySelector('.files-cancel'); cancel.hidden = !activePhases.has(job.phase) || !!job.finishedAt; cancel.disabled = job.phase === 'finishing' || !!job.cancelRequested;
      row.querySelector('.files-reveal').hidden = job.phase !== 'completed' || !job.finishedAt;
      if (job.finishedAt && previous.has(job.id) && !previous.get(job.id).finishedAt) toast(job.phase === 'completed' ? '文件已下载到电脑' : job.message);
    }
    for (const [id, row] of taskRows) if (!next.jobs.some(job => job.id === id)) { row.remove(); taskRows.delete(id); }
    $('files-transfer-summary').textContent = next.jobs.length ? `${next.jobs.filter(job => activePhases.has(job.phase) && !job.finishedAt).length} 个进行中 · ${next.jobs.filter(job => job.phase === 'completed').length} 个已完成` : '尚无下载任务';
    controls();
  }
  async function download(paths) {
    if (picking || busyTransfer() || !serial || !paths.length) return;
    picking = true; controls();
    try { const result = await filesRequest({ action: 'download', serial, paths }); tasks(result.state); }
    catch (failure) { toast(failure.message); }
    finally { picking = false; controls(); }
  }
  $('files-device').addEventListener('change', () => { desiredSerial = $('files-device').value; serial = desiredSerial; sequence++; loading = false; currentPath = '/sdcard'; backStack = []; listing = null; selected.clear(); error = ''; if (serial) void navigate('/sdcard', { remember: false }); else renderRows(); });
  $('files-devices-refresh').addEventListener('click', devices);
  document.querySelectorAll('[data-file-path]').forEach(button => button.addEventListener('click', () => void navigate(button.dataset.filePath)));
  $('files-path-form').addEventListener('submit', event => { event.preventDefault(); if (!loading) void navigate($('files-path').value); });
  $('files-back').addEventListener('click', () => { const path = backStack.pop(); if (path) void navigate(path, { remember: false }); });
  $('files-up').addEventListener('click', () => void navigate(parentOf(currentPath)));
  $('files-refresh').addEventListener('click', () => void navigate(currentPath, { remember: false }));
  for (const id of ['files-search', 'files-hidden', 'files-sort']) $(id).addEventListener(id === 'files-search' ? 'input' : 'change', renderRows);
  $('files-all').addEventListener('change', () => { for (const item of shown().filter(supported)) { if ($('files-all').checked) selected.add(item.path); else selected.delete(item.path); } renderRows(); });
  $('files-download').addEventListener('click', () => void download([...selected]));
  $('files-download-folder').addEventListener('click', () => void download([currentPath]));
  events.addEventListener('file-transfers', event => tasks(JSON.parse(event.data)));
  void filesRequest({ action: 'state' }).then(result => tasks(result.state)).catch(failure => toast(failure.message));
  setInterval(() => { if (visible && !picking && document.activeElement !== $('files-device')) void devices(); }, 8000);
  breadcrumbs(); controls();
  return { setView(active) { visible = active; if (active) { void devices(); if (serial && !listing && !loading) void navigate(currentPath, { remember: false }); } } };
}
