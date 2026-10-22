import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { open, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';

const execute = promisify(execFile);
const messages = {
  INSTALL_FAILED_UPDATE_INCOMPATIBLE: 'APK 签名与已安装应用不一致。请使用相同签名的安装包；本工具不会自动卸载应用。',
  INSTALL_FAILED_VERSION_DOWNGRADE: 'APK 版本低于已安装版本。请选择相同或更新版本的安装包。',
  INSTALL_FAILED_INSUFFICIENT_STORAGE: '设备存储空间不足，请清理空间后重试。',
  INSTALL_FAILED_USER_RESTRICTED: '设备拒绝了安装。请检查手机上的安装确认、USB 安装设置或设备管理限制。',
  INSTALL_FAILED_ABORTED: '设备取消了安装，请查看手机上的安装提示后重试。',
  INSTALL_FAILED_NO_MATCHING_ABIS: 'APK 不支持此设备的 CPU 架构，请选择兼容的安装包。',
  INSTALL_FAILED_OLDER_SDK: '设备的 Android 版本过低，无法安装此 APK。',
  INSTALL_FAILED_MISSING_SPLIT: '此文件是拆分 APK 的一部分，请使用完整的独立 APK。',
  INSTALL_PARSE_FAILED_NOT_APK: '文件不是有效的 APK，请重新选择安装包。',
  INSTALL_PARSE_FAILED_NO_CERTIFICATES: 'APK 缺少有效签名或文件已损坏，请重新获取安装包。',
  INSTALL_FAILED_INVALID_APK: 'APK 无效或已损坏，请重新获取安装包。',
  INSTALL_FAILED_TEST_ONLY: '这是仅供测试的 APK，当前安装方式不允许安装。请使用普通安装包。'
};

function installationError(error) {
  const details = [error.stdout, error.stderr].filter(Boolean).join('\n').trim().slice(-16000);
  const code = details.match(/(?:Failure\s*\[)?(INSTALL_(?:FAILED|PARSE_FAILED)_[A-Z_]+)/)?.[1];
  let message = messages[code];
  if (!message && /unauthorized/i.test(details)) message = '设备尚未授权，请在手机上允许 USB 调试后重试。';
  if (!message && /device.*(?:not found|offline)|no devices|disconnected|closed|transport error/i.test(details)) message = '设备连接中断，请检查 USB 连接并重新安装。';
  if (!message && error.code === 'ENOENT') message = '未找到 ADB，请检查应用内置 ADB 或 ADB_PATH 设置。';
  if (!message && error.killed) message = '安装等待超时。设备端可能仍在处理，请检查手机上的结果后再重试。';
  if (!message && error.code === 'ABORT_ERR') message = '安装命令已停止，请在手机上检查实际安装结果。';
  return { message: message || (details ? `安装失败${code ? `（${code}）` : ''}，请展开 ADB 安装详情。` : error.message) || '安装失败，请查看详细信息。', details, code: code || String(error.code || 'INSTALL_ERROR') };
}

async function inspectFile(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || extname(path).toLowerCase() !== '.apk') throw new Error('请选择本地 .apk 文件。');
  const file = await stat(path).catch(() => { throw new Error('APK 已被移动或删除，请重新选择。'); });
  if (!file.isFile() || file.size < 4) throw new Error('请选择有效且非空的 APK 文件。');
  const handle = await open(path, 'r');
  try {
    const header = Buffer.alloc(4);
    await handle.read(header, 0, 4, 0);
    if (!header.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw new Error('文件不是有效的 APK / ZIP 格式。');
  } finally { await handle.close(); }
  return { size: file.size, modifiedAt: file.mtimeMs };
}

// Paths stay in the main process. The renderer gets only a selection token.
export function createApkInstaller({ adbPath, getDevices, onChange = () => {}, timeoutMs = 600000 }) {
  let selected = null, stopped = false;
  let state = { revision: 0, phase: 'idle', file: null, device: null, message: '选择 APK，然后选择需要安装的设备。', details: '', code: null };
  const controller = new AbortController();
  const snapshot = () => structuredClone(state);
  const busy = () => ['checking', 'installing'].includes(state.phase);
  const update = values => { state = { ...state, ...values, revision: state.revision + 1 }; onChange(snapshot()); };
  const assertAvailable = () => {
    if (stopped) throw new Error('安装服务已停止，请重新启动应用。');
    if (busy()) throw new Error('已有 APK 正在安装，请等待完成。');
  };
  return {
    state: snapshot,
    async select(path) {
      assertAvailable();
      const metadata = await inspectFile(path);
      assertAvailable();
      selected = { path, ...metadata, id: randomUUID() };
      update({ phase: 'ready', file: { id: selected.id, name: basename(path), size: metadata.size }, device: null, message: '已选择安装包，确认设备后开始安装。', details: '', code: null });
      return snapshot();
    },
    async install({ fileId, serial } = {}) {
      assertAvailable();
      if (!selected || typeof fileId !== 'string' || fileId !== selected.id) throw new Error('APK 选择已失效，请重新选择文件。');
      if (typeof serial !== 'string' || !serial || serial.length > 256) throw new Error('请选择已授权的连接设备。');
      const file = { ...selected };
      update({ phase: 'checking', device: { serial, model: serial }, message: '正在检查安装包与设备连接…', details: '', code: null });
      try {
        const devices = await getDevices();
        const device = devices.find(item => item.serial === serial && item.state === 'device');
        if (!device) throw new Error('设备未连接或尚未授权，请检查 USB 调试后重试。');
        const metadata = await inspectFile(file.path);
        if (metadata.size !== file.size || metadata.modifiedAt !== file.modifiedAt) throw new Error('安装包在选择后发生了变化，请重新选择。');
        if (stopped) throw new Error('安装服务已停止。');
        update({ phase: 'installing', device: { serial, model: device.model || serial }, message: '正在传输并安装 APK，请保持 USB 连接，并留意手机上的确认提示。' });
        const result = await execute(adbPath, ['-s', serial, 'install', '-r', file.path], { signal: controller.signal, timeout: timeoutMs, windowsHide: true, maxBuffer: 128 * 1024 });
        if (/Failure\s*\[/.test(result.stdout + result.stderr) || !/^Success\s*$/m.test(result.stdout.replaceAll('\r', ''))) throw Object.assign(new Error('ADB 未返回安装成功，请查看详细信息。'), result);
        update({ phase: 'success', message: `已安装到 ${device.model || serial}（${serial}），可在手机上打开应用。`, details: [result.stdout, result.stderr].filter(Boolean).join('\n').trim().slice(-16000), code: null });
      } catch (error) {
        update({ phase: 'error', ...installationError(error) });
      }
      return snapshot();
    },
    stop() { stopped = true; controller.abort(); }
  };
}
