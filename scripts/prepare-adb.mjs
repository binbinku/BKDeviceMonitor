import { mkdir, readFile, writeFile, copyFile, chmod, rm, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import extract from '@electron-internal/extract-zip';

const platforms = process.argv.slice(2).length ? process.argv.slice(2) : ['darwin', 'win32'];
for (const platform of platforms) {
  if (!['darwin', 'win32'].includes(platform)) throw new Error('Supported platforms: darwin, win32');
  const suffix = platform === 'win32' ? 'windows' : 'darwin';
  const source = `https://dl.google.com/android/repository/platform-tools-latest-${suffix}.zip`;
  const destination = fileURLToPath(new URL(`../resources/${platform}/platform-tools/`, import.meta.url));
  const temporary = await mkdtemp(join(tmpdir(), 'bkdm-platform-tools-'));
  try {
    console.log(`Downloading official Android Platform Tools (${platform})…`);
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const archive = join(temporary, 'tools.zip');
    await writeFile(archive, bytes); await extract(archive, { dir: temporary });
    const unpacked = join(temporary, 'platform-tools');
    const entries = await readdir(unpacked);
    const required = platform === 'win32' ? ['adb.exe', 'AdbWinApi.dll', 'AdbWinUsbApi.dll'] : ['adb'];
    // Retain upstream attribution and version metadata. No fastboot/flashing tools.
    const files = entries.filter(name => required.includes(name) || /notice|license|source\.properties/i.test(name));
    for (const name of required) if (!files.includes(name)) throw new Error(`Missing ${name}`);
    await mkdir(destination, { recursive: true });
    for (const name of files) await copyFile(join(unpacked, name), join(destination, name));
    if (platform === 'darwin') await chmod(join(destination, 'adb'), 0o755);
    await writeFile(join(destination, 'bkdevicemonitor-source.json'), JSON.stringify({ source, archiveSha256: createHash('sha256').update(bytes).digest('hex'), retrievedAt: new Date().toISOString(), properties: await readFile(join(unpacked, 'source.properties'), 'utf8') }, null, 2));
    console.log(`Prepared ${platform}: ${files.join(', ')}`);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
