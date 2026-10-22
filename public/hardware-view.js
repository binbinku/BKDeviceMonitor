let renderedDevice = null;
const sourceNames = { device: '设备读取', profile: '型号规格', missing: '未提供' };
const GiB = value => Number.isFinite(value) && value >= 0 ? `${(value / 1024 ** 3).toFixed(2)} GiB` : null;
const number = (value, suffix, places = 1) => Number.isFinite(value) ? `${value.toFixed(places)} ${suffix}` : null;
const row = (label, value, source = 'device', live = null) => ({ label, value, source, live });
const chip = (text, className = '') => Object.assign(document.createElement('span'), { className: `hardware-source ${className}`, textContent: text });
function element(tag, className, content) {
  const el = document.createElement(tag); el.className = className;
  if (content != null) el.textContent = content;
  return el;
}
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`); svg.append(use); return svg;
}
function card(title, description, iconName, rows) {
  const root = element('details', 'panel hardware-card');
  root.open = iconName === 'cpu';
  const summary = element('summary', 'hardware-summary');
  const summaryText = element('div', 'hardware-summary-text');
  const head = element('div', 'hardware-card-head');
  head.append(icon(iconName), element('h2', '', title)); summaryText.append(head);
  summaryText.append(element('p', 'hardware-card-description', description));
  summary.append(summaryText); root.append(summary);
  const list = element('dl', 'hardware-rows');
  for (const data of rows) {
    const item = element('div', 'hardware-row');
    item.append(element('dt', '', data.label));
    const dd = element('dd', '');
    const value = element('span', 'hardware-row-value', data.value ?? '系统未提供');
    if (data.live) value.dataset.hardwareLive = data.live;
    dd.append(value, chip(sourceNames[data.value != null ? data.source : 'missing'], data.value != null ? data.source : 'missing'));
    item.append(dd); list.append(item);
  }
  root.append(list); return root;
}

export function resetHardware() {
  renderedDevice = null;
  const root = document.getElementById('hardware-view');
  const empty = element('div', 'hardware-empty panel');
  empty.append(icon('hardware'), element('h2', '', '等待设备硬件信息'), element('p', '', '连接并授权 Android 设备后，自动读取硬件与系统详情。'));
  root.replaceChildren(empty);
}

export function renderHardware(info, sample) {
  const h = info?.hardware;
  if (!h) return;
  const root = document.getElementById('hardware-view');
  const p = h.profile;
  const measuredMemory = sample?.memory || h.memory;
  const mem = measuredMemory?.total > 0 ? measuredMemory : {};
  const storage = sample?.storage || h.storage;
  const key = `${info.serial}:${h.collectedAt}`;
  if (renderedDevice !== key) {
    renderedDevice = key;
    const intro = element('section', 'panel hardware-intro');
    const introHead = element('div', 'hardware-intro-head');
    const title = element('div', ''); title.append(element('span', 'hardware-eyebrow', '设备档案'), element('h2', '', info.name));
    const badge = element('span', 'hardware-identity', `${info.manufacturer || 'Android'} / ${info.model || '未知型号'}`);
    introHead.append(title, badge); intro.append(introHead);
    intro.append(element('p', 'hardware-introduction', p
      ? '以 Snapdragon 888 为计算核心，配备高分辨率 AMOLED 屏幕、LPDDR5 内存与 UFS 3.1 存储。下面将这台设备的实际配置与官方型号规格逐项呈现。'
      : '以下信息由当前设备通过 ADB 提供。未匹配到已核实的型号档案时，仅展示可读取的配置，不推测元件规格。'));
    const highlights = element('div', 'hardware-highlights');
    for (const [label, value, source] of [
      ['芯片平台', info.chipset, 'device'], ['CPU 最高频率', number(h.maxCpuMHz == null ? null : h.maxCpuMHz / 1000, 'GHz', 2), 'device'],
      ['系统支持刷新率', h.display.rates.length ? `${Math.max(...h.display.rates)} Hz` : null, 'device'], ['电池典型容量', p?.battery.capacity, 'profile']
    ]) {
      const item = element('div', 'hardware-highlight');
      item.append(element('span', '', label), element('strong', '', value || '未提供'), chip(sourceNames[value ? source : 'missing'], value ? source : 'missing'));
      highlights.append(item);
    }
    intro.append(highlights);
    const legend = element('div', 'hardware-provenance');
    legend.append(chip('设备读取', 'device'), element('span', '', '当前手机返回的配置'), chip('型号规格', 'profile'), element('span', '', '已核实的官方参数'));

    const groups = element('div', 'hardware-grid');
    const clusters = new Map();
    for (const core of h.cores) if (core.maxMHz != null) {
      const cpus = clusters.get(core.maxMHz) || []; cpus.push(core.id.toUpperCase()); clusters.set(core.maxMHz, cpus);
    }
    const clusterRows = [...clusters].sort(([a], [b]) => b - a).map(([freq, cores], i) => row(
      p && clusters.size === 3 ? ['超大核心', '性能核心', '能效核心'][i] : `核心组 ${i + 1}`,
      `${cores.join(' / ')} · ${(freq / 1000).toFixed(2)} GHz`));
    groups.append(card('处理器 · CPU', '最高频率来自内核配置；实时频率与负载可在 CPU 页面查看。', 'cpu', [
      row('芯片型号', `${info.chipset} · ${info.soc || '未知 SoC'}`), row('芯片厂商', h.socManufacturer),
      row('CPU 系列', p?.cpu, 'profile'), row('制造工艺', p?.process, 'profile'),
      row('核心数量', h.cores.length ? `${h.cores.length} 核` : null), ...clusterRows,
      row('支持的指令集', h.abi.length ? h.abi.join(' / ') : null)
    ]));
    groups.append(card('图形处理器 · GPU', '渲染器与 OpenGL ES 来自系统图形服务的驱动报告。', 'gpu', [
      row('渲染器', h.graphics.renderer), row('图形厂商', h.graphics.vendor), row('OpenGL ES', h.graphics.openGles),
      row('驱动版本', h.graphics.driver),
      row('Vulkan 能力', h.features.includes('android.hardware.vulkan.level') ? '系统声明支持' : null)
    ]));
    groups.append(card('屏幕与显示', '系统支持的刷新模式不等于此刻屏幕的实际刷新率。', 'phone', [
      row('物理分辨率', h.display.physical ? `${h.display.physical} px` : null),
      ...(h.display.override ? [row('覆盖分辨率', `${h.display.override} px`)] : []),
      row('支持的刷新模式', h.display.rates.length ? `${h.display.rates.join(' / ')} Hz` : null),
      row('系统逻辑密度', h.display.density ? `${h.display.density} dpi` : null),
      ...(h.display.overrideDensity ? [row('覆盖逻辑密度', `${h.display.overrideDensity} dpi`)] : []),
      row('屏幕尺寸 / 材质', p ? `${p.display.size} · ${p.display.type}` : null, 'profile'),
      row('物理像素密度', p?.display.ppi, 'profile'), row('触控采样上限', p?.display.touch, 'profile'), row('HDR 显示', p?.display.hdr, 'profile')
    ]));
    groups.append(card('内存与存储', 'GiB 为二进制容量；数据分区不等于整机标称闪存容量。', 'memory', [
      row('内存规格', p?.memoryType, 'profile'), row('系统可见物理内存', GiB(mem.total), 'device', 'memoryTotal'),
      row('可用内存', GiB(mem.available), 'device', 'memoryAvailable'),
      row('交换空间 / 已用', mem.swapTotal ? `${GiB(mem.swapTotal)} / ${GiB(mem.swapUsed) || '0.00 GiB'}` : null, 'device', 'swap'),
      row('闪存规格', p?.storageType, 'profile'),
      row('数据分区总量', GiB(storage?.total), 'device', 'storageTotal'),
      row('数据分区已用', GiB(storage?.used), 'device', 'storageUsed'), row('数据分区可用', GiB(storage?.available), 'device', 'storageAvailable')
    ]));
    groups.append(card('电池与充电', '容量和功率为型号标称值，不代表当前电池健康度或实测充电功率。', 'bolt', [
      row('典型容量', p?.battery.capacity, 'profile'), row('电芯技术', h.batteryTechnology),
      row('有线充电上限', p?.battery.wired, 'profile'), row('无线充电上限', p?.battery.wireless, 'profile'),
      row('当前电量', number(sample?.battery?.level, '%', 0), 'device', 'batteryLevel'),
      row('电池温度', number(sample?.battery?.temperature, '°C'), 'device', 'batteryTemp'),
      row('电池电压', number(sample?.battery?.voltage, 'V', 3), 'device', 'batteryVoltage')
    ]));
    groups.append(card('系统与设备身份', '以当前安装的系统为准；安全补丁日期由系统声明。', 'hardware', [
      row('设备型号 / 代号', [info.model, h.device].filter(Boolean).join(' / ') || null),
      row('Android / API', info.android ? `Android ${info.android} · API ${info.sdk || '—'}` : null),
      row('系统版本', h.system.incremental), row('系统标识', h.system.hyperOs || h.system.miui),
      row('安全补丁', h.system.securityPatch), row('内核版本', h.system.kernel),
      row('构建标识', h.system.build), row('主板 / 平台', [h.board, h.platform].filter(Boolean).join(' / ') || null)
    ]));
    if (p) {
      groups.append(card('影像与机身', '以下为该型号的官方规格，不由 ADB 推断摄像头型号。', 'phone', [
        ...p.cameras.map(([label, val]) => row(label, val, 'profile')),
        row('机身尺寸', p.body.dimensions, 'profile'), row('重量', p.body.weight, 'profile')
      ]));
      groups.append(card('连接与音频', '网络能力会受地区、运营商和系统版本影响。', 'link', [
        row('蜂窝网络', p.connectivity.cellular, 'profile'), row('无线网络', p.connectivity.wifi, 'profile'),
        row('蓝牙版本', p.connectivity.bluetooth, 'profile'), row('音频调音', p.connectivity.audio, 'profile'),
        row('NFC', h.features.includes('android.hardware.nfc') ? '系统声明支持' : null),
        row('红外发射', h.features.includes('android.hardware.consumerir') ? '系统声明支持' : null),
        row('USB Host / OTG', h.features.includes('android.hardware.usb.host') ? '系统声明支持' : null)
      ]));
    }
    const capabilities = element('section', 'panel hardware-capabilities');
    const head = element('div', 'hardware-card-head'); head.append(icon('check'), element('h2', '', '传感器与硬件能力')); capabilities.append(head);
    capabilities.append(element('p', 'hardware-card-description', '来自 Android 系统硬件能力声明；仅标记检测到的能力，不代表当前已启用。'));
    const tags = element('div', 'capability-tags');
    const featureLabels = { 'sensor.accelerometer': '加速度计', 'sensor.gyroscope': '陀螺仪', 'sensor.compass': '电子罗盘', 'sensor.barometer': '气压计', 'sensor.light': '环境光传感器', 'sensor.proximity': '距离传感器', 'sensor.stepcounter': '计步器', 'fingerprint': '指纹识别', 'location.gps': 'GPS', 'nfc': 'NFC', 'consumerir': '红外发射', 'bluetooth_le': '低功耗蓝牙', 'usb.host': 'USB Host', 'camera.front': '前置摄像头', 'camera.capability.raw': 'RAW 拍摄' };
    for (const [feature, label] of Object.entries(featureLabels)) if (h.features.includes(`android.hardware.${feature}`)) {
      const tag = element('span', 'capability-tag'); tag.append(icon('check'), document.createTextNode(label)); tags.append(tag);
    }
    if (!tags.children.length) tags.append(element('span', 'hardware-no-features', '系统未提供可识别的硬件能力信息'));
    capabilities.append(tags);
    const sources = element('section', 'hardware-sources');
    const collected = new Date(h.collectedAt).toLocaleString('zh-CN', { hour12: false });
    sources.append(element('p', '', `设备读取：${collected} · 连接时采集静态配置，容量、电量和温度随实时采样更新。`));
    if (p) {
      sources.append(element('p', '', '型号规格参考官方资料；不同地区与批次可能存在差异，系统信息以本机读取为准。'));
      const links = element('div', 'hardware-source-links');
      for (const source of p.sources) { const link = element('a', '', source.title + ' ↗'); link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; links.append(link); }
      sources.append(links);
    }
    root.replaceChildren(intro, legend, groups, capabilities, sources);
  }
  const live = {
    memoryTotal: GiB(mem.total), memoryAvailable: GiB(mem.available),
    swap: mem.swapTotal ? `${GiB(mem.swapTotal)} / ${GiB(mem.swapUsed) || '0.00 GiB'}` : null,
    storageTotal: GiB(storage?.total), storageUsed: GiB(storage?.used), storageAvailable: GiB(storage?.available),
    batteryLevel: number(sample?.battery?.level, '%', 0), batteryTemp: number(sample?.battery?.temperature, '°C'), batteryVoltage: number(sample?.battery?.voltage, 'V', 3)
  };
  for (const target of root.querySelectorAll('[data-hardware-live]')) {
    const content = live[target.dataset.hardwareLive];
    target.textContent = content || '系统未提供';
    const badge = target.nextElementSibling;
    badge.className = `hardware-source ${content ? 'device' : 'missing'}`;
    badge.textContent = sourceNames[content ? 'device' : 'missing'];
  }
}
