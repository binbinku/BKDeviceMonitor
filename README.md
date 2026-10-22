# BKDeviceMonitor · 手机性能监测桌面应用

基于 Electron 的 Windows 11 / macOS 桌面应用，采用参考 Codex 的深灰工作台风格。界面使用 HTML / CSS / JavaScript；主进程直接调用随应用打包的 ADB。桌面模式不启动 HTTP 服务、不监听应用端口，不需要安装 Node.js、Android Studio 或单独启动后端。ADB 自身仍使用标准的本机 ADB daemon（默认 5037），方便复用已有调试授权。

macOS 使用沉浸式窗口：隐藏系统标题栏，红黄绿按钮融入侧栏，顶部留白与面包屑区域支持拖动，保留系统窗口控制。

1.2.0 更新：统一中性灰配色，收起大面积彩色卡片，使用简洁指标行与细分隔线；CPU / GPU / 内存曲线保留低饱和度区分色。硬件页支持展开参数分组，默认展开处理器，其余详情可按需展开，数据来源与配置导出完整保留。

1.2.1：应用正式命名为 BKDeviceMonitor，窗口、菜单、侧栏、导出文件与应用包名称统一更新。

## 直接使用

- Apple Silicon Mac：解压 `release/BKDeviceMonitor-1.2.1-mac-arm64.zip`，将 BKDeviceMonitor.app 放到「应用程序」后打开。
- Intel Mac：使用 `release/BKDeviceMonitor-1.2.1-mac-x64.zip`。
- Windows 11 x64：解压 `release/BKDeviceMonitor-1.2.1-win-x64.zip` 的完整目录，运行 BKDeviceMonitor.exe。不要单独移动 exe，resources 与 DLL 需留在相邻目录。
- 手机打开 USB 调试，接入数据线，并在手机上允许这台电脑调试。默认连接首个已授权设备，也可在「连接设备」切换。
- 导出 CSV / JSON 时使用系统保存对话框。取消保存不会显示成功提示。关闭最后一个窗口会退出应用并停止采集；不会关闭系统中共享的 ADB daemon。

运行不需要联网。Windows 若在设备管理器中未识别 ADB 设备，需安装手机厂商的 USB 驱动；应用不自动安装驱动。

macOS 构建使用 ad-hoc 本地签名；当前所有构建均没有开发者证书签名，macOS 也未做 Apple 公证，属于本地测试版本；面向其他用户正式发布前需配置平台代码签名。macOS ARM64 已连接小米 11 Ultra 验证；Windows 与 Intel Mac 的包为交叉构建，尚未在对应机器运行验证。

## 开发与打包

开发环境需要 Node.js 22.12+。仅首次安装依赖和准备 ADB 需要联网。

```sh
npm ci
npm run prepare:adb
npm start
```

```sh
npm test
npm run build:mac
npm run build:win
```

`build:mac` 生成 ARM64 与 x64 两个 macOS zip；`build:win` 生成 Windows x64 免安装 zip。只需当前 Mac 的应用目录可运行 `npm run pack:mac`。打包包含各平台 ADB、Windows ADB DLL、上游 NOTICE、版本和下载来源校验记录；不包含刷机工具。准备脚本从 [Google 官方 Platform Tools](https://developer.android.com/tools/releases/platform-tools) 下载，ADB 当前为 37.0.1。需要自定义路径时可设置 `ADB_PATH`，其次查找内置 ADB、ANDROID_SDK_ROOT / ANDROID_HOME、平台默认 SDK 路径与 PATH。

桌面结构：`desktop/main.mjs` 管理原生窗口、保存对话框与受限 IPC；`desktop/preload.cjs` 仅暴露采集请求、事件订阅及导出；`monitor.mjs` 是不依赖网络服务的采集引擎。渲染进程启用 sandbox / contextIsolation，禁用 Node integration，使用本地 `bkdevicemonitor://app` 协议加载资源。实现参考 [Electron 安全建议](https://www.electronjs.org/docs/latest/tutorial/security/) 与 [自定义协议文档](https://www.electronjs.org/docs/latest/api/protocol)。

浏览器模式作为可选兼容入口保留，使用同一采集引擎：`npm run web`，再打开 http://localhost:3210；桌面版不运行这个入口。

## 指标与交互

- CPU：读取 `/proc/stat`，根据相邻采样计算总负载和各核心负载，0–100%，不重复计入 guest 时间。第一帧没有基准时显示 `—`。
- CPU 频率：各核心 `scaling_cur_freq`，以 MHz 展示。
- GPU：高通 KGSL `gpubusy` 的忙碌时间 / 总时间；驱动窗口与 CPU 不完全一致。不可读或总时间为零时显示 `—`。
- 内存：`1 − MemAvailable / MemTotal`；容量以 GiB 展示，可用容量包含可回收缓存。
- 电池：通过 `dumpsys battery` 读取电量、充电状态、电压与电池温度。温度不代表 CPU 核心温度。
- 活跃进程：每 5 秒读取 `top`，排除采集命令自身；CPU 百分比除以核心数，与整机 0–100% 口径一致。
- CPU、GPU、内存每秒采集，缓存最近 900 个样本；1/5/15 分钟切换、曲线图例开关、悬停查看采样、暂停显示、CSV 导出。
- 暂停只冻结显示，后台采集继续；恢复后回到最新数据。重新加载界面可恢复本次应用运行的历史。切换设备会清空历史。
- 无设备、设备离线、未授权、ADB 缺失均有明确提示。绝不以模拟数据替代不可读指标。

## 硬件信息

侧栏「硬件信息」或地址 `http://localhost:3210/#hardware` 展示处理器核心与最高频率、GPU 驱动、屏幕分辨率与刷新模式、RAM/数据分区、充电规格、系统构建、安全补丁、影像和传感器能力。支持导出 JSON 硬件配置。

每项注明「设备读取」「型号规格」或「未提供」。Mi 11 Ultra 型号档案参考小米官方规格与 Qualcomm 产品简介，页面附原始来源链接。其他型号不套用该档案。系统版本使用实际设备返回值；标称功率不等于当前充电功率，逻辑 dpi 不等于面板 PPI，数据分区容量不等于整机标称闪存容量。

静态硬件信息在建立连接时采集；可用内存、存储和电池状态随采样更新。界面使用 深灰工作台风格，桌面与窄屏均可访问硬件页。

## 深度监测与测试会话

打开 `http://localhost:3210/#insights` 或侧栏「深度监测」。继续使用 深灰工作台风格。

- 帧率与卡顿：使用手机自带 Perfetto 的 `android.surfaceflinger.frametimeline`，每约 3 秒采集一个 2 秒窗口。按目标应用主/子进程匹配，在最活跃的单一图层统计呈现帧；按 DisplayFrame token 去重，不将多个图层帧数相加。显示有效窗口 FPS、帧间隔 P95/P99、系统标记的卡顿帧与丢弃帧。无新帧、不支持或后台状态均保持缺失提示，不以刷新率替代 FPS。
- CPU 频率：按硬件最高频率分组，显示各组可读核心的平均实时频率与在线核心数。
- 温控：读取 `thermalservice` 等级及带名称的 `cpuss-*-usr` / `gpuss-*-usr` / skin / battery 温度节点。CPU/GPU 卡片显示各自可读传感器的最高温度。等级 0 仅表示系统无热告警，不能断言没有任何限频；冷却设备状态保留厂商原值。
- 指定应用：默认跟随前台，也可选择正在运行的应用/进程。CPU、线程、PSS、RSS 仅对应主进程；CPU 使用与整机统计一致的 0–100% 口径，内存每 5 秒更新。
- 电流与功率：使用 Perfetto `android.power` 电流计数器，显示有效窗口平均电流的绝对值；净功率幅值按电流 × 最近电池电压估算。不是充电器输入功率或整机耗电，接口不支持时不估造数值。
- 网络：对 `/proc/net/dev` 的 wlan、eth、rmnet_data 接口按实际间隔求差，排除 loopback/VPN/虚拟接口以避免重复统计。显示整机收发速率，第一帧与计数器重置不计算速率。
- 内存压力：PSI avg10（如可读），以及换入/换出页数、重大缺页速率、启动以来 OOM 计数。PSI 不可读时不会用 RAM 使用率冒充压力值。
- 测试会话：应用内采集引擎记录开始/结束、CPU 平均/峰值、温度峰值、有效窗口加权平均 FPS、卡顿、帧间隔分位数及应用切换事件。刷新或切换页面后会话继续；断开、切换设备或手动更换目标自动结束。同一追踪窗口只累计一次，开始前的窗口不会计入。导出 JSON 报告及最近 20000 个采样，分位数取最近 100000 个有效帧间隔；汇总峰值与 CPU 平均覆盖整场。应用退出后清空内存记录，需手动导出以保留。

暂停只影响显示，采集与测试会话继续。深度监测页支持单独导出 CSV，刷新可恢复本次运行最近 15 分钟趋势。帧/电流追踪在桌面窗口或浏览器连接存在时运行，不在手机上保留追踪文件。

协议参考：[Android 14 FrameTimeline](https://android.googlesource.com/platform/external/perfetto/+/refs/heads/android14-release/protos/perfetto/trace/android/frame_timeline_event.proto)、[电池追踪](https://android.googlesource.com/platform/external/perfetto/+/refs/heads/android14-release/protos/perfetto/trace/power/battery_counters.proto)。

## 本地访问与测试

桌面版不监听 HTTP 端口，通过受限 IPC 调用采集引擎；可选网页模式仅监听 `127.0.0.1`，拒绝跨来源 API 调用。ADB 命令固定为只读采集，设备序列号必须出现在当前已授权设备列表中。无需 Root、Shizuku 或手机端应用；不同厂商系统的可读指标可能有差异。

```sh
npm test
```

测试覆盖性能统计、硬件解析、主副屏区分、型号匹配、缺失值处理、无设备/未授权状态与 API 访问限制。服务测试使用隔离的模拟 ADB，不修改实际手机状态。

新增桌面测试直接运行采集引擎，禁止创建监听端口，验证事件、测试会话、输入检查、停止采集及 Windows 内置 ADB 路径解析。最终应用仅包含自身源码与 Electron / ADB，不携带打包工具依赖。
