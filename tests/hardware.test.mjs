import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHardware, parseStorage } from '../hardware.mjs';

const data = `__PROPS__
ro.product.model=M2102K1C
ro.product.marketname=Mi 11 Ultra
ro.product.manufacturer=Xiaomi
ro.product.device=star
ro.product.board=star
ro.board.platform=lahaina
ro.soc.model=SM8350
ro.product.cpu.abilist=arm64-v8a,armeabi-v7a
ro.build.version.release=14
ro.build.version.sdk=34
ro.build.version.incremental=OS2.0.7.0.UKACNXM
ro.build.version.security_patch=2025-04-01
__DISPLAY__
Physical size: 1440x3200
Physical density: 560
__MODES__
DisplayModeRecord{mMode={id=1, width=1440, height=3200, fps=120.00001}}
DisplayModeRecord{mMode={id=2, width=1440, height=3200, fps=90.0}}
DisplayModeRecord{mMode={id=3, width=1440, height=3200, fps=60.000004}}
DisplayModeRecord{mMode={id=4, width=126, height=294, fps=30.0}}
__GPU__
GLES: Qualcomm, Adreno (TM) 660, OpenGL ES 3.2 V@0530.49 (GIT@example)
__KERNEL__
5.4.274-qgki
__CPUMAX__
cpu0 1804800
cpu4 2419200
cpu7 2841600
__BATTERY__
 technology: Li-poly
__MEM__
MemTotal: 1000 kB
MemAvailable: 400 kB
__STORAGE__
Filesystem 1K-blocks Used Available Use% Mounted on
/dev/block/dm-50 1000 600 400 60% /data
__FEATURES__
feature:android.hardware.nfc
feature:android.hardware.sensor.gyroscope
feature:android.hardware.vulkan.level=1
__UPTIME__
12345.00 56789.00
`;

test('hardware parses real identity, GPU driver and CPU maximum frequencies', () => {
  const info = parseHardware(data.replaceAll('\n', '\r\n'), 'example');
  assert.equal(info.model, 'M2102K1C'); assert.equal(info.gpu, 'Adreno 660');
  assert.equal(info.hardware.graphics.openGles, '3.2'); assert.equal(info.hardware.maxCpuMHz, 2841.6);
  assert.equal(info.hardware.system.incremental, 'OS2.0.7.0.UKACNXM');
  assert.equal(info.hardware.memory.total, 1000 * 1024); assert.equal(info.hardware.batteryTechnology, 'Li-poly');
  assert.ok(info.hardware.features.includes('android.hardware.vulkan.level'));
});

test('main display refresh rates exclude secondary displays and keep logical density separate', () => {
  const h = parseHardware(data, 'example').hardware;
  assert.deepEqual(h.display.rates, [60, 90, 120]); assert.equal(h.display.density, 560);
  assert.equal(h.profile.display.ppi, '515 PPI'); assert.equal(h.display.physical, '1440 × 3200');
  const overridden = parseHardware(data.replace('Physical density: 560', 'Physical density: 560\nOverride size: 1080x2400\nOverride density: 420'), 'example').hardware;
  assert.equal(overridden.display.override, '1080 × 2400'); assert.equal(overridden.display.overrideDensity, 420);
});

test('official profile is applied only to the matched phone, never to other Snapdragon 888 devices', () => {
  assert.equal(parseHardware(data, 'example').hardware.profile.name, 'Mi 11 Ultra');
  assert.equal(parseHardware(data.replace('Xiaomi', 'Other'), 'example').hardware.profile, null);
  assert.equal(parseHardware(data.replace('M2102K1C', 'Other').replace('ro.product.device=star', 'ro.product.device=other'), 'example').hardware.profile, null);
});

test('unavailable hardware is left unknown and storage zero values remain valid', () => {
  const h = parseHardware('__PROPS__\nro.product.model=Generic\n__GPU__\nPermission denied\n__CPUMAX__\ncpu0 unavailable\n', 'example').hardware;
  assert.equal(h.graphics.renderer, null); assert.equal(h.maxCpuMHz, null); assert.equal(h.profile, null);
  assert.equal(h.storage, null); assert.deepEqual(h.display.rates, []);
  assert.deepEqual(parseStorage('/dev/test 100 100 0 100% /data'), { total: 102400, used: 102400, available: 0 });
  assert.equal(parseStorage('Permission denied'), null);
});
