import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { posix, join, basename, extname, isAbsolute } from 'node:path';
import { stat, lstat, mkdtemp, mkdir, link, unlink, rmdir, rm, readdir, utimes, copyFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { shellQuote } from '../telemetry.mjs';

const execute = promisify(execFile);
const ACTIVE = new Set(['preparing', 'transferring', 'finishing']);
export function devicePath(value) {
  if (typeof value !== 'string' || value.length > 4096 || value.includes('\0')) throw new Error('无效的手机路径。');
  const path = posix.normalize(value.replace(/^\/storage\/emulated\/0(?=\/|$)/, '/sdcard')).replace(/\/+$/, '');
  if (path !== '/sdcard' && !path.startsWith('/sdcard/')) throw new Error('当前仅支持内部共享存储 /sdcard。');
  return path;
}
function remoteGuard(path) {
  return `p=${shellQuote(path)}; base=$(realpath /sdcard) || exit 12; resolved=$(realpath "$p") || exit 12; case "$resolved" in "$base"|"$base"/*) ;; *) echo 'BKFM_OUTSIDE_STORAGE' >&2; exit 14;; esac; `;
}
export function listingCommand(path) {
  return remoteGuard(devicePath(path)) + `cd "$p" && ls -a . >/dev/null || exit 13; printf 'BKFM1\\0'; n=0; for f in .[!.]* ..?* *; do [ -e "$f" ] || [ -L "$f" ] || continue; n=$((n+1)); if [ "$n" -gt 20000 ]; then echo 'BKFM_TOO_MANY' >&2; exit 15; fi; printf '%s\\0' "$f"; stat -c '%f %s %Y' "./$f" 2>/dev/null || printf '? ? ?\\n'; printf '\\0'; done`;
}
function metadata(text) {
  const [hex, size, seconds] = text.trim().split(/\s+/);
  const mode = /^[0-9a-f]+$/i.test(hex || '') ? parseInt(hex, 16) & 0xf000 : 0;
  const bytes = /^\d+$/.test(size || '') && Number.isSafeInteger(Number(size)) ? Number(size) : null;
  const modified = /^-?\d+$/.test(seconds || '') && Number.isFinite(Number(seconds)) ? Number(seconds) * 1000 : null;
  return { type: mode === 0x4000 ? 'directory' : mode === 0x8000 ? 'file' : mode === 0xa000 ? 'symlink' : 'other', size: bytes, modifiedAt: modified };
}
export function parseListing(output, parent) {
  const parts = output.toString('utf8').split('\0');
  if (parts.shift() !== 'BKFM1' || parts.pop() !== '' || parts.length % 2) throw new Error('手机目录数据不完整，请刷新重试。');
  const seen = new Set(), entries = [];
  for (let i = 0; i < parts.length; i += 2) {
    const name = parts[i];
    if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\ufffd') || seen.has(name)) throw new Error('手机返回了无效或不支持编码的文件名。');
    seen.add(name);
    entries.push({ name, path: devicePath(posix.join(parent, name)), ...metadata(parts[i + 1]), hidden: name.startsWith('.') });
  }
  return entries;
}
export function portableName(value) {
  let name = value.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '');
  if (!name || name === '.' || name === '..') name = '未命名';
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
  while (Buffer.byteLength(name) > 200) name = [...name].slice(0, -1).join('');
  return name;
}
function numbered(name, index) {
  if (!index) return name;
  const extension = extname(name), stem = extension ? name.slice(0, -extension.length) : name;
  return `${stem} (${index})${extension}`;
}
function allocate(name, used) {
  const safe = portableName(name);
  let i = 0, result;
  do { result = numbered(safe, i++); } while (used.has(result.toLocaleLowerCase('en-US')));
  used.add(result.toLocaleLowerCase('en-US')); return result;
}
function friendly(error) {
  const details = [error.stderr, error.stdout].filter(Boolean).map(String).join('\n');
  if (/BKFM_OUTSIDE_STORAGE/.test(details)) return '该路径指向共享存储以外的位置，当前不支持访问。';
  if (/BKFM_TOO_MANY/.test(details)) return '目录超过 20,000 项，请选择更小的子目录。';
  if (/permission denied|operation not permitted/i.test(details)) return '手机系统不允许访问此目录或文件。部分 Android/data、Android/obb 目录可能受限。';
  if (/no such file|does not exist/i.test(details)) return '手机上的文件或目录已不存在，请刷新后重试。';
  if (/unauthorized|device.*(?:not found|offline)|no devices|disconnected|transport error/i.test(details)) return '设备已断开或未授权，请检查 USB 连接。';
  if (error.code === 'ENOENT') return '找不到 ADB 或本地保存目录，请检查后重试。';
  if (error.code === 'ENOSPC') return '电脑可用空间不足，请清理空间后重试。';
  if (error.killed) return '设备操作超时，请检查 USB 连接后重试。';
  return error.message || '文件操作失败。';
}

export function createDeviceFiles({ adbPath, getDevices, onChange = () => {} }) {
  let stopped = false, active = null, revision = 0;
  const lifetime = new AbortController(), jobs = [], records = new Map();
  const state = () => ({ revision, jobs: structuredClone(jobs) });
  const emit = () => { revision++; if (!stopped) onChange(state()); };
  async function authorized(serial) {
    if (stopped) throw new Error('文件服务已停止。');
    if (typeof serial !== 'string' || !serial || serial.length > 256) throw new Error('请选择已授权的连接设备。');
    const device = (await getDevices()).find(item => item.serial === serial && item.state === 'device');
    if (!device) throw new Error('设备未连接或尚未授权，请刷新设备列表。');
    return device;
  }
  async function shell(serial, command, signal = lifetime.signal) {
    try { return (await execute(adbPath, ['-s', serial, 'shell', command], { signal, windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024 })).stdout; }
    catch (error) { if (signal.aborted) throw error; throw new Error(friendly(error)); }
  }
  const listRaw = async (serial, path, signal) => parseListing(await shell(serial, listingCommand(path), signal), path);
  const inspect = async (serial, path, signal) => metadata(await shell(serial, remoteGuard(path) + `stat ${path === '/sdcard' ? '-L ' : ''}-c '%f %s %Y' "$p"`, signal));
  async function rollback(links, directories) {
    for (const item of links.reverse()) {
      try { const target = await lstat(item.target); if (target.ino === item.identity.ino && target.dev === item.identity.dev && target.birthtimeMs === item.identity.birthtimeMs && target.size === item.identity.size) await unlink(item.target); } catch {}
    }
    // Never recursively erase published directories: another app may have added files.
    for (const path of directories.reverse()) await rmdir(path).catch(() => {});
  }
  async function publish(stage, destination, roots, job) {
    const links = [], directories = [], outputs = [];
    async function saveFile(source, target) {
      try { await link(source, target); }
      catch (error) {
        // FAT/exFAT and some network shares do not support hard links.
        if (!['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) throw error;
        await copyFile(source, target, constants.COPYFILE_EXCL);
      }
      links.push({ target, identity: await lstat(target) });
    }
    async function contents(source, target) {
      for (const entry of await readdir(source, { withFileTypes: true })) {
        const from = join(source, entry.name), to = join(target, entry.name);
        if (entry.isDirectory()) { await mkdir(to); directories.push(to); await contents(from, to); }
        else await saveFile(from, to);
      }
    }
    try {
      for (const root of roots) {
        const source = join(stage, root.localName);
        for (let i = 0; ; i++) {
          if (i > 10000) throw new Error('同名文件过多，请选择其他保存目录。');
          const target = join(destination, numbered(root.localName, i));
          try { await lstat(target); continue; } catch (error) { if (error.code !== 'ENOENT') throw error; }
          try {
            if (root.type === 'directory') { await mkdir(target); directories.push(target); await contents(source, target); }
            else await saveFile(source, target);
            outputs.push(target); break;
          } catch (error) { if (error.code === 'EEXIST' && !outputs.includes(target) && !directories.includes(target)) continue; throw error; }
        }
      }
      job.savedNames = outputs.map(path => basename(path));
      return outputs;
    } catch (error) { await rollback(links, directories); throw error; }
  }
  async function run(job, record) {
    let stage, timer, currentFile = null, lastBytes = 0, lastAt = Date.now();
    const { serial, paths, destination, controller } = record;
    const signal = controller.signal;
    const check = () => { if (signal.aborted || stopped) throw Object.assign(new Error('已取消下载。'), { code: 'ABORT_ERR' }); };
    try {
      const device = await authorized(serial); check(); job.deviceName = device.model || serial; emit();
      const destinationInfo = await stat(destination);
      if (!destinationInfo.isDirectory()) throw new Error('请选择电脑上的保存文件夹。');
      const files = [], folders = [], roots = [], rootNames = new Set(); let count = 0;
      async function walk(path, relative, info, depth = 0) {
        check(); if (++count > 20000 || depth > 64) throw new Error('下载范围过大，请选择更小的子目录（最多 20,000 项、64 层）。');
        if (info.type === 'directory') {
          folders.push(relative);
          const children = await listRaw(serial, path, signal); check(); const names = new Set();
          for (const item of children) {
            if (!['file', 'directory'].includes(item.type)) { job.skipped++; continue; }
            await walk(item.path, join(relative, allocate(item.name, names)), item, depth + 1);
          }
        } else if (info.type === 'file' && info.size !== null) files.push({ path, relative, ...info });
        else throw new Error('不支持下载符号链接、特殊文件或无法读取大小的文件。');
      }
      for (const path of paths) {
        const info = await inspect(serial, path, signal); check();
        const localName = allocate(path === '/sdcard' ? '内部存储' : posix.basename(path), rootNames);
        roots.push({ localName, type: info.type }); await walk(path, localName, info);
      }
      check();
      job.totalBytes = files.reduce((sum, file) => sum + file.size, 0); job.totalFiles = files.length;
      if (!Number.isSafeInteger(job.totalBytes)) throw new Error('文件总大小超过支持范围。');
      stage = await mkdtemp(join(destination, '.BKDeviceMonitor-partial-'));
      for (const folder of folders) await mkdir(join(stage, folder), { recursive: true });
      job.phase = 'transferring'; emit();
      let completedBytes = 0, probing = false;
      timer = setInterval(async () => {
        if (probing || !currentFile || signal.aborted) return;
        probing = true;
        try {
          const current = currentFile, info = await stat(current.local);
          if (currentFile !== current || job.phase !== 'transferring') return;
          job.transferredBytes = completedBytes + Math.min(current.size, info.isFile() ? info.size : 0);
          const now = Date.now(); job.speedBps = Math.max(0, (job.transferredBytes - lastBytes) * 1000 / Math.max(1, now - lastAt));
          lastBytes = job.transferredBytes; lastAt = now; emit();
        } catch {} finally { probing = false; }
      }, 400);
      for (const file of files) {
        check(); const local = join(stage, file.relative);
        // Recheck containment and file type before every pull; never follow selected links.
        const current = await inspect(serial, file.path, signal); check();
        if (current.type !== 'file' || current.size !== file.size || current.modifiedAt !== file.modifiedAt) throw new Error('手机文件在下载准备后发生了变化，请刷新后重试。');
        currentFile = { local, size: file.size }; job.currentPath = file.path; emit();
        try { await execute(adbPath, ['-s', serial, 'pull', file.path, local], { signal, windowsHide: true, timeout: 30 * 60 * 1000, maxBuffer: 256 * 1024 }); }
        catch (error) { if (signal.aborted) throw error; throw new Error(friendly(error)); }
        check(); const localInfo = await lstat(local);
        if (!localInfo.isFile() || localInfo.size !== file.size) throw new Error('下载文件大小与手机记录不一致，未保存为正式文件。');
        if (file.modifiedAt !== null) await utimes(local, new Date(), new Date(file.modifiedAt)).catch(() => {});
        completedBytes += file.size; job.transferredBytes = completedBytes; job.completedFiles++; currentFile = null; emit();
      }
      clearInterval(timer); check();
      job.phase = 'finishing'; job.speedBps = 0; emit();
      record.outputs = await publish(stage, destination, roots, job);
      job.phase = 'completed'; job.message = `已保存 ${roots.length} 项到电脑${job.skipped ? `，跳过 ${job.skipped} 个链接或特殊文件` : ''}。`;
    } catch (error) {
      job.phase = signal.aborted || stopped ? 'canceled' : 'failed';
      job.message = job.phase === 'canceled' ? '下载已取消，未完成的临时文件将被清理。' : friendly(error);
    } finally {
      clearInterval(timer); currentFile = null;
      if (stage) { try { await rm(stage, { recursive: true, force: true }); } catch { job.message += ` 临时目录清理失败，请在保存位置检查 ${basename(stage)}。`; } }
      job.speedBps = 0; job.finishedAt = Date.now(); active = null; emit();
    }
  }
  return {
    state,
    async list({ serial, path = '/sdcard' } = {}) {
      path = devicePath(path); await authorized(serial);
      return { serial, path, entries: await listRaw(serial, path), readAt: Date.now() };
    },
    download({ serial, paths, destination } = {}) {
      if (stopped) throw new Error('文件服务已停止。');
      if (active) throw new Error('已有下载任务进行中，请等待完成或取消后重试。');
      if (typeof serial !== 'string' || !serial || serial.length > 256) throw new Error('请选择已授权的连接设备。');
      if (typeof destination !== 'string' || !isAbsolute(destination)) throw new Error('请选择本地保存文件夹。');
      if (!Array.isArray(paths) || !paths.length || paths.length > 200) throw new Error('每次请选择 1–200 个文件或文件夹。');
      const unique = [...new Set(paths.map(devicePath))].sort((a, b) => a.length - b.length);
      const selected = unique.filter((path, i) => !unique.slice(0, i).some(parent => path.startsWith(parent + '/')));
      const job = { id: randomUUID(), serial, deviceName: serial, phase: 'preparing', names: selected.map(path => posix.basename(path)), selectedCount: selected.length, totalBytes: null, transferredBytes: 0, totalFiles: 0, completedFiles: 0, skipped: 0, speedBps: 0, currentPath: '', destinationName: basename(destination), savedNames: [], message: '正在读取目录并准备下载…', startedAt: Date.now() };
      const record = { serial, paths: selected, destination, controller: new AbortController(), outputs: [] };
      active = job.id; jobs.unshift(job); records.set(job.id, record);
      if (jobs.length > 20) { const old = jobs.pop(); records.delete(old.id); }
      emit(); record.done = run(job, record); return state();
    },
    cancel(id) {
      const job = jobs.find(item => item.id === id);
      if (!job || !ACTIVE.has(job.phase)) return state();
      if (job.phase === 'finishing') throw new Error('正在保存已完成的文件，请稍候。');
      job.cancelRequested = true; records.get(id).controller.abort(); emit(); return state();
    },
    async reveal(id) {
      const job = jobs.find(item => item.id === id), record = records.get(id);
      if (!job || job.phase !== 'completed' || !record?.outputs.length) throw new Error('下载尚未完成。');
      await lstat(record.outputs[0]).catch(() => { throw new Error('下载文件已被移动或删除。'); });
      return record.outputs[0];
    },
    async settled(id) { await records.get(id)?.done; return state(); },
    isBusy: () => active !== null,
    stop() { stopped = true; lifetime.abort(); for (const record of records.values()) record.controller.abort(); return Promise.allSettled([...records.values()].map(record => record.done)); }
  };
}
