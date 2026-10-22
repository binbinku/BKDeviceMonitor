import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

export async function resolveAdb({ resourcesPath, platform = process.platform, env = process.env, home = homedir() } = {}) {
  const binary = platform === 'win32' ? 'adb.exe' : 'adb';
  const candidates = [
    env.ADB_PATH,
    resourcesPath && join(resourcesPath, 'platform-tools', binary),
    join(fileURLToPath(new URL('../resources/', import.meta.url)), platform, 'platform-tools', binary),
    env.ANDROID_SDK_ROOT && join(env.ANDROID_SDK_ROOT, 'platform-tools', binary),
    env.ANDROID_HOME && join(env.ANDROID_HOME, 'platform-tools', binary),
    platform === 'darwin' && join(home, 'Library/Android/sdk/platform-tools', binary),
    platform === 'win32' && env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Android/Sdk/platform-tools', binary),
    join(home, 'Android/Sdk/platform-tools', binary)
  ].filter(Boolean);
  for (const candidate of candidates) { try { await access(candidate); return candidate; } catch {} }
  return binary;
}
