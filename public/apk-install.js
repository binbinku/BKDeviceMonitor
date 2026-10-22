import { request, apkRequest, isDesktop } from './transport.js';

export function initApkInstall({ events, toast }) {
  if (!isDesktop) return;
  const $ = id => document.getElementById(id);
  const dialog = $('apk-dialog');
  const entry = $('install-apk-button');
  entry.hidden = false;
  let state = { revision: -1, phase: 'idle', file: null }, pending = false, refreshing = false, devices = [], desiredSerial = null;
  const busy = () => ['checking', 'installing'].includes(state.phase);
  const locked = () => pending || busy();
  const bytes = size => size >= 1024 ** 3 ? `${(size / 1024 ** 3).toFixed(2)} GiB` : size >= 1024 ** 2 ? `${(size / 1024 ** 2).toFixed(2)} MiB` : size >= 1024 ? `${(size / 1024).toFixed(1)} KiB` : `${size} B`;
  const selectedDevice = () => devices.find(device => device.serial === $('apk-device').value && device.state === 'device');
  function render(next = state) {
    if (next.revision < state.revision) return;
    state = next;
    if (desiredSerial === null && state.device) desiredSerial = state.device.serial;
    $('apk-filename').textContent = state.file?.name || '尚未选择文件';
    $('apk-filesize').textContent = state.file ? bytes(state.file.size) : '支持独立 .apk 安装包';
    $('apk-message').textContent = state.message || '选择 APK，然后选择需要安装的设备。';
    $('apk-status').dataset.phase = state.phase;
    $('apk-progress').hidden = !busy();
    $('apk-choose').disabled = locked();
    $('apk-device').disabled = locked() || refreshing;
    $('apk-refresh').disabled = locked() || refreshing;
    $('apk-start').disabled = locked() || !state.file || !selectedDevice();
    $('apk-start').querySelector('span').textContent = busy() ? '安装中…' : state.phase === 'success' ? '再次安装' : '开始安装';
    entry.querySelector('span').textContent = busy() ? 'APK 安装中…' : '安装 APK';
    $('apk-footer-note').textContent = busy() ? '可收起面板，安装会在后台继续。' : '安装前请确认文件和目标设备。';
    $('apk-details').hidden = !state.details;
    $('apk-output').textContent = state.details || '';
    if (busy() && state.device) {
      desiredSerial = state.device.serial;
      if (![...$('apk-device').options].some(option => option.value === state.device.serial)) $('apk-device').add(new Option(`${state.device.model} · ${state.device.serial}`, state.device.serial));
      $('apk-device').value = state.device.serial;
    }
  }
  async function refreshDevices() {
    if (refreshing || busy()) return;
    refreshing = true; render();
    try {
      const response = await request('/api/devices');
      if (!response.ok) throw new Error('无法获取设备列表，请检查 ADB 连接。');
      const data = await response.json();
      devices = data.devices;
      // An in-flight refresh must never replace the pinned installation target.
      if (busy()) return;
      const options = devices.map(device => {
        const suffix = device.state === 'device' ? '' : device.state === 'unauthorized' ? ' · 未授权' : ' · 离线';
        const option = new Option(`${device.model} · ${device.serial}${suffix}`, device.serial);
        option.disabled = device.state !== 'device'; return option;
      });
      const usable = devices.filter(device => device.state === 'device');
      $('apk-device').replaceChildren(new Option(usable.length ? '请选择目标设备' : '没有已授权的连接设备', ''), ...options);
      const preferred = desiredSerial ?? data.selected;
      // Keep an explicit selection; a lost device must not redirect an install.
      $('apk-device').value = usable.some(device => device.serial === preferred) ? preferred : desiredSerial === null && usable.length === 1 ? usable[0].serial : '';
      if (desiredSerial === null && $('apk-device').value) desiredSerial = $('apk-device').value;
      $('apk-device-note').textContent = usable.length ? '请确认设备型号和序列号；不会改变当前性能监测目标。' : devices.some(device => device.state === 'unauthorized') ? '请在手机上允许 USB 调试，然后刷新设备列表。' : '请通过 USB 连接手机并开启 USB 调试。';
    } catch (error) {
      devices = [];
      if (!busy()) $('apk-device').replaceChildren(new Option('设备检测失败，请刷新重试', ''));
      $('apk-device-note').textContent = error.message;
    } finally { refreshing = false; render(); }
  }
  async function sync() {
    try { render((await apkRequest({ action: 'state' })).state); }
    catch (error) { toast(error.message); }
  }
  entry.addEventListener('click', () => {
    if (!dialog.open) dialog.showModal();
    void sync().then(refreshDevices);
  });
  $('apk-close').addEventListener('click', () => dialog.close());
  $('apk-refresh').addEventListener('click', refreshDevices);
  $('apk-device').addEventListener('change', () => { desiredSerial = $('apk-device').value; render(); });
  $('apk-choose').addEventListener('click', async () => {
    pending = true; render();
    try { render((await apkRequest({ action: 'choose' })).state); }
    catch (error) { toast(error.message); }
    finally { pending = false; render(); }
  });
  $('apk-start').addEventListener('click', async () => {
    const device = selectedDevice();
    if (locked() || !state.file || !device) return;
    pending = true; render();
    try {
      const result = await apkRequest({ action: 'install', fileId: state.file.id, serial: device.serial });
      render(result.state);
    } catch (error) { toast(error.message); }
    finally { pending = false; render(); if (dialog.open) void refreshDevices(); }
  });
  events.addEventListener('apk-install', event => {
    const next = JSON.parse(event.data);
    render(next);
    if (['success', 'error'].includes(next.phase)) toast(next.phase === 'success' ? 'APK 安装成功' : next.message);
  });
  // Jobs belong to the main process and survive page reloads and panel closure.
  void sync();
  setInterval(() => { if (dialog.open && !locked() && document.activeElement !== $('apk-device')) void refreshDevices(); }, 4000);
}
