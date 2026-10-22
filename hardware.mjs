import { parseMemory } from './metrics.mjs';

export const HARDWARE_COMMAND = [
  'echo __PROPS__; for p in ro.product.model ro.product.marketname ro.product.manufacturer ro.product.device ro.product.board ro.board.platform ro.soc.model ro.soc.manufacturer ro.hardware ro.product.cpu.abilist ro.build.version.release ro.build.version.sdk ro.build.version.security_patch ro.build.display.id ro.build.version.incremental ro.mi.os.version.name ro.miui.ui.version.name; do echo "$p=$(getprop $p)"; done',
  'echo __DISPLAY__; wm size; wm density',
  'echo __MODES__; dumpsys display | grep -E "DisplayModeRecord|supportedModes="',
  'echo __GPU__; dumpsys SurfaceFlinger | grep -E "^GLES:"',
  'echo __KERNEL__; uname -r',
  'echo __CPUMAX__; for p in /sys/devices/system/cpu/cpu[0-9]*; do printf "%s " "${p##*/}"; cat "$p/cpufreq/cpuinfo_max_freq" 2>/dev/null || echo unavailable; done',
  'echo __BATTERY__; dumpsys battery',
  'echo __MEM__; cat /proc/meminfo',
  'echo __STORAGE__; df -k /data',
  'echo __FEATURES__; pm list features',
  'echo __THERMALPATHS__; for p in /sys/class/thermal/thermal_zone*; do if [ -r "$p/type" ]; then t=$(cat "$p/type" 2>/dev/null); case "$t" in cpuss-*-usr|gpuss-*-usr|*skin*|battery) printf "%s %s/temp\\n" "$t" "$p";; esac; fi; done',
  'echo __UPTIME__; cat /proc/uptime'
].join('; ');

const mi11Ultra = {
  name: 'Mi 11 Ultra', process: '5 nm', cpu: 'Qualcomm Kryo 680', gpu: 'Adreno 660',
  memoryType: 'LPDDR5', storageType: 'UFS 3.1',
  display: { size: '6.81 英寸', type: 'AMOLED · WQHD+', ppi: '515 PPI', refresh: '最高 120 Hz', touch: '最高 480 Hz', hdr: 'HDR10+ · Dolby Vision' },
  battery: { capacity: '5000 mAh（典型值）', wired: '最高 67 W', wireless: '最高 67 W' },
  cameras: [ ['主摄', '5000 万像素 · 1/1.12 英寸 · OIS'], ['超广角', '4800 万像素 · 128° 视野'], ['潜望长焦', '4800 万像素 · 5 倍光学变焦 · OIS'], ['前置', '2000 万像素'] ],
  body: { dimensions: '164.3 × 74.6 × 8.38 mm', weight: '234 g' },
  connectivity: { cellular: '5G · 双 SIM', wifi: 'Wi-Fi 6（6E 因地区而异）', bluetooth: 'Bluetooth 5.2', audio: 'Harman Kardon 调音' },
  sources: [
    { title: '小米官方 · Mi 11 Ultra 规格（印度站）', url: 'https://www.mi.com/in/mi-11-ultra/specs/' },
    { title: 'Qualcomm · Snapdragon 888 产品简介', url: 'https://www.qualcomm.com/content/dam/qcomm-martech/dm-assets/documents/prod_brief_qcom_sd888_5g_1.pdf' }
  ]
};

const section = (text, name) => text.split(`__${name}__\n`)[1]?.split(/__\w+__\n/)[0]?.trim() || '';

export function parseStorage(text) {
  const row = text.split('\n').find(line => /^\//.test(line.trim()))?.trim().split(/\s+/);
  if (!row || row.length < 4 || !row.slice(1, 4).every(v => /^\d+$/.test(v))) return null;
  return { total: Number(row[1]) * 1024, used: Number(row[2]) * 1024, available: Number(row[3]) * 1024 };
}

export function parseHardware(raw, serial) {
  const text = raw.replaceAll('\r', '');
  const props = Object.fromEntries(section(text, 'PROPS').split('\n').filter(l => l.includes('=')).map(l => {
    const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()];
  }));
  const get = name => props[name] || null;
  const model = get('ro.product.model');
  const manufacturer = get('ro.product.manufacturer');
  const soc = get('ro.soc.model');
  const profile = /xiaomi/i.test(manufacturer || '') && soc === 'SM8350' &&
    (/^M2102K1[CG]$/.test(model || '') || get('ro.product.device') === 'star') ? mi11Ultra : null;
  const displayText = section(text, 'DISPLAY');
  const size = displayText.match(/Physical size:\s*(\d+)x(\d+)/);
  const override = displayText.match(/Override size:\s*(\d+)x(\d+)/);
  const modes = [...section(text, 'MODES').matchAll(/width=(\d+), height=(\d+), fps=([\d.]+)/g)].map(m => ({ width: Number(m[1]), height: Number(m[2]), rate: Math.round(Number(m[3]) * 100) / 100 }));
  const mainArea = size ? Number(size[1]) * Number(size[2]) : Math.max(0, ...modes.map(m => m.width * m.height));
  const rates = [...new Set(modes.filter(m => m.width * m.height === mainArea).map(m => m.rate))].sort((a, b) => a - b);
  const gl = section(text, 'GPU').match(/^GLES:\s*([^,]+),\s*([^,]+),\s*(.+)$/m);
  const cores = section(text, 'CPUMAX').split('\n').map(line => {
    const [id, max] = line.trim().split(/\s+/);
    return /^cpu\d+$/.test(id || '') ? { id, maxMHz: /^\d+$/.test(max || '') ? Number(max) / 1000 : null } : null;
  }).filter(Boolean).sort((a, b) => Number(a.id.slice(3)) - Number(b.id.slice(3)));
  const maxFrequencies = cores.map(c => c.maxMHz).filter(Number.isFinite);
  const features = [...new Set([...section(text, 'FEATURES').matchAll(/^feature:(android\.hardware\.[\w.]+)/gm)].map(m => m[1]))];
  const battery = section(text, 'BATTERY');
  return {
    model, name: get('ro.product.marketname') || model || 'Android 设备', manufacturer, serial,
    soc, android: get('ro.build.version.release'), sdk: get('ro.build.version.sdk'),
    chipset: soc === 'SM8350' ? 'Snapdragon 888' : soc || '处理器信息未提供',
    gpu: gl?.[2]?.replace('(TM) ', '') || profile?.gpu || 'GPU',
    uptime: Number(section(text, 'UPTIME').split(' ')[0]) || null,
    hardware: {
      collectedAt: Date.now(), profile,
      device: get('ro.product.device'), board: get('ro.product.board'), platform: get('ro.board.platform'),
      socManufacturer: get('ro.soc.manufacturer'), hardware: get('ro.hardware'), abi: get('ro.product.cpu.abilist')?.split(',') || [],
      cores, maxCpuMHz: maxFrequencies.length ? Math.max(...maxFrequencies) : null,
      display: { physical: size ? `${size[1]} × ${size[2]}` : null, override: override ? `${override[1]} × ${override[2]}` : null,
        density: Number(displayText.match(/Physical density:\s*(\d+)/)?.[1]) || null,
        overrideDensity: Number(displayText.match(/Override density:\s*(\d+)/)?.[1]) || null, rates },
      graphics: { vendor: gl?.[1] || null, renderer: gl?.[2] || null, driver: gl?.[3] || null, openGles: gl?.[3]?.match(/OpenGL ES ([\d.]+)/)?.[1] || null },
      system: { kernel: section(text, 'KERNEL') || null, securityPatch: get('ro.build.version.security_patch'),
        build: get('ro.build.display.id'), incremental: get('ro.build.version.incremental'),
        hyperOs: get('ro.mi.os.version.name'), miui: get('ro.miui.ui.version.name') },
      batteryTechnology: battery.match(/^\s*technology:\s*(.+)$/m)?.[1] || null,
      thermalSensors: section(text, 'THERMALPATHS').split('\n').map(line => { const [name, path] = line.trim().split(/\s+/); return /^\/sys\/class\/thermal\/thermal_zone\d+\/temp$/.test(path || '') ? { name, path } : null; }).filter(Boolean),
      memory: parseMemory(section(text, 'MEM')), storage: parseStorage(section(text, 'STORAGE')), features
    }
  };
}
