export const isDesktop = !!window.bkDeviceMonitor;

export async function request(path, options = {}) {
  if (!isDesktop) return fetch(path, options);
  const { status, data } = await window.bkDeviceMonitor.request(path, options.method || 'GET');
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

export function openEvents() {
  if (!isDesktop) return new EventSource('/api/events');
  const events = new EventTarget();
  let ready = false, pending = [];
  const dispatch = (name, data) => events.dispatchEvent(new MessageEvent(name, { data: JSON.stringify(data) }));
  const unsubscribe = window.bkDeviceMonitor.onEvent((name, data) => { if (ready) dispatch(name, data); else pending.push([name, data]); });
  // Wait one microtask so the caller has installed its handlers.
  queueMicrotask(async () => {
    try {
      const response = await request('/api/state'); dispatch('init', await response.json());
      ready = true; for (const [name, data] of pending) dispatch(name, data); pending = [];
    } catch { events.onerror?.(); }
  });
  window.addEventListener('beforeunload', unsubscribe, { once: true });
  return events;
}

export async function saveDownload(content, filename, type = 'application/json') {
  if (isDesktop) return (await window.bkDeviceMonitor.saveFile({ content, filename })).saved;
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); return true;
}

export async function apkRequest(input) {
  if (!isDesktop) throw new Error('APK 安装仅在桌面版中提供。');
  const result = await window.bkDeviceMonitor.apk(input);
  if (result.error) throw new Error(result.error);
  return result;
}

export async function filesRequest(input) {
  if (!isDesktop) throw new Error('设备文件功能仅在桌面版中提供。');
  const result = await window.bkDeviceMonitor.files(input);
  if (result.error) throw new Error(result.error);
  return result;
}
