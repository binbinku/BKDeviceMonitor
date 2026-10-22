<div align="center">

<img src="docs/assets/hero.svg" width="100%" alt="BKDeviceMonitor — Android performance, in focus." />

# BKDeviceMonitor

**让 Android 性能，一目了然。**

一个本地运行的 Android 性能监测桌面应用。连接手机，观察负载与帧率，了解硬件，留存测试结果。

[**简体中文**](README.md) · [English](README.en.md)

[![MIT License](docs/assets/license.svg)](LICENSE) ![macOS / Windows](docs/assets/platform.svg) ![Electron](docs/assets/runtime.svg)

[界面预览](#-界面预览) · [功能](#-你可以用它做什么) · [快速开始](#-快速开始) · [开发与构建](#-开发与构建) · [指标说明](docs/metrics.zh-CN.md)

</div>

## ✨ 你可以用它做什么

- **观察每一次负载变化** — CPU 总体与逐核负载、实时频率、GPU、内存和电池状态，配合连续趋势与悬停读数。
- **追踪应用表现** — 跟随前台或选择运行中的应用，查看应用 CPU、内存，以及可用时的 FPS、帧间隔和卡顿数据。
- **了解这台设备** — 处理器、GPU、屏幕、存储、系统与传感器分组展示，每项区分设备实读与官方型号规格。
- **留存一次完整测试** — 记录测试会话、峰值与汇总，导出 CSV 趋势、JSON 报告和硬件配置。
- **保持专注** — Codex 风格的深灰界面、低饱和曲线、macOS 沉浸式窗口；桌面模式无需单独启动后端。

> 🔌 通过 USB / ADB 连接，无需 Root、Shizuku 或安装手机端应用。准备好依赖与 ADB 后，采集和分析可离线完成。

## 🖥 界面预览

### 性能总览

![BKDeviceMonitor 性能总览：CPU、GPU、内存趋势与逐核状态](docs/screenshots/overview.jpg)

<details>
<summary><strong>展开查看：设备硬件档案</strong></summary>

![BKDeviceMonitor 硬件信息：规格分组、数据来源与传感器能力](docs/screenshots/hardware.jpg)

</details>

<sub>截图来自小米 11 Ultra 实机的网页模式，与桌面版共用界面和采集引擎；为公开展示隐藏了序列号和活跃进程列表。界面语言目前为简体中文，中英文版本指项目文档。</sub>

## 📊 数据与能力

| 模块 | 显示内容 |
| :--- | :--- |
| CPU | 整机 / 逐核使用率、实时频率、在线核心、核心分组 |
| GPU | 可读的高通 KGSL 负载、驱动与图形能力 |
| 内存 | 已用 / 可用 / 缓存、Swap、可读的 PSI 压力与重大缺页 |
| 应用与帧率 | 目标主进程 CPU、PSS / RSS、线程；Perfetto 帧率、P95 / P99 帧间隔、卡顿与丢弃帧 |
| 温控与电池 | CPU / GPU / 机身 / 电池可读温度、系统热状态、电量、电压、充电状态与净电池功率估算 |
| 网络 | 整机网络上传 / 下载速率 |
| 硬件档案 | SoC、GPU、显示模式、RAM / 存储、系统构建、安全补丁、传感器及匹配型号的官方规格 |
| 趋势与报告 | 1 / 5 / 15 分钟趋势、暂停显示、CSV 导出、测试会话 JSON、硬件 JSON |

**数据有来源，也有边界。** 不可读或不支持的指标显示 `—`；不会以模拟数值填充，也不会把屏幕刷新率当作 FPS。GPU、Perfetto、温度和 PSI 的可用性取决于 Android 版本、厂商接口与权限。

CPU 以整机 `0–100%` 归一化；内存使用率为 `1 − MemAvailable / MemTotal`；应用 CPU / 内存只统计主进程。电池温度不代表 CPU 温度，净电池功率估算也不代表充电器输入功率。完整采样口径见 [指标说明](docs/metrics.zh-CN.md)。

## 🚀 快速开始

### 下载桌面版

前往 **[v1.2.1 Release](https://github.com/binbinku/BKDeviceMonitor/releases/tag/v1.2.1)**，或按电脑平台直接下载：

| 你的电脑 | 安装包 |
| :--- | :--- |
| Mac · Apple Silicon（M 系列） | [macOS ARM64 ZIP](https://github.com/binbinku/BKDeviceMonitor/releases/download/v1.2.1/BKDeviceMonitor-1.2.1-mac-arm64.zip) |
| Mac · Intel | [macOS x64 ZIP](https://github.com/binbinku/BKDeviceMonitor/releases/download/v1.2.1/BKDeviceMonitor-1.2.1-mac-x64.zip) |
| Windows 11 · x64 | [Windows x64 ZIP](https://github.com/binbinku/BKDeviceMonitor/releases/download/v1.2.1/BKDeviceMonitor-1.2.1-win-x64.zip) |

Mac 解压后将 `BKDeviceMonitor.app` 放入「应用程序」；Windows 解压完整目录后运行 `BKDeviceMonitor.exe`。Release 附有 `SHA256SUMS.txt` 供校验。

### 从源码启动

需要 **Node.js 22.12+**、npm，以及开启 USB 调试的 Android 手机。首次安装依赖和准备 ADB 需要联网。

```sh
git clone https://github.com/binbinku/BKDeviceMonitor.git
cd BKDeviceMonitor
npm ci
npm run prepare:adb
npm start
```

1. 在手机「开发者选项」中开启 **USB 调试**。
2. 使用可传输数据的 USB 线连接电脑，在手机上选择 **允许 USB 调试**。
3. 打开应用，等待自动连接，或通过「连接设备」选择手机。

Windows 若无法识别 ADB 设备，请安装手机厂商的 USB 驱动。准备脚本从 [Google 官方 Platform Tools](https://developer.android.com/tools/releases/platform-tools) 获取 macOS / Windows ADB；也可通过 `ADB_PATH` 指定已有 ADB 可执行文件。

### 平台状态

| 平台 | 构建目标 | 验证状态 |
| :--- | :--- | :--- |
| macOS · Apple Silicon | ARM64 ZIP | 已连接小米 11 Ultra 验证 |
| macOS · Intel | x64 ZIP | 已交叉构建，待对应机器验证 |
| Windows 11 | x64 ZIP | 已交叉构建，待对应机器验证 |

可以直接下载桌面版，也可以从源码启动或自行构建。构建产物包含 Electron 与 ADB，使用时无需安装 Node.js 或 Android Studio。当前 macOS 包仅做 ad-hoc 签名，未公证；Windows 包未做证书签名。

## 🛠 开发与构建

| 命令 | 用途 |
| :--- | :--- |
| `npm start` / `npm run dev` | 启动 Electron 桌面应用 |
| `npm run prepare:adb` | 下载官方 ADB，保留上游 NOTICE 与来源 / SHA-256 记录 |
| `npm test` | 运行解析、采集引擎、会话与本地访问限制测试 |
| `npm run pack:mac` | 生成当前 Apple Silicon Mac 的应用目录 |
| `npm run build:mac` | 构建 macOS ARM64 与 x64 ZIP |
| `npm run build:win` | 构建 Windows x64 ZIP |
| `npm run web` | 启动可选网页入口：`http://localhost:3210` |

构建产物保存在 `release/`。Windows 使用时需解压完整目录，保留 EXE 附近的 `resources` 与 DLL。

```text
BKDeviceMonitor/
├── desktop/           原生窗口、受限 IPC、保存对话框、ADB 定位
├── public/            HTML / CSS / JavaScript 界面与 Canvas 图表
├── monitor.mjs        本地采集引擎
├── metrics.mjs        CPU / GPU / 内存基础指标
├── hardware.mjs       硬件解析与型号档案
├── telemetry.mjs      应用、温控、网络与内存压力
├── trace.mjs          Perfetto 帧与电流解析
├── session.mjs        测试会话统计与报告
├── server.mjs         可选网页模式适配器
└── tests/             自动化测试
```

### 本地运行与数据保留

桌面版通过受限 IPC 调用采集引擎，使用本地资源协议，**不启动 HTTP 服务**；ADB 仍使用标准本机 daemon（默认端口 `5037`）。渲染进程启用 sandbox / contextIsolation，关闭 Node integration。可选网页入口仅监听 `127.0.0.1` 并校验来源。

趋势在内存中保留最近约 15 分钟；暂停只冻结显示，采集与会话继续。会话可跨页面切换和界面刷新，但退出应用后清空。需要留存时请先导出；报告最多附带最近 20,000 个会话采样，详见 [指标说明](docs/metrics.zh-CN.md#深度监测与测试会话)。

## 🤝 参与贡献

欢迎提交 [问题与建议](https://github.com/binbinku/BKDeviceMonitor/issues) 或 [Pull Request](https://github.com/binbinku/BKDeviceMonitor/pulls)。反馈设备兼容性时，请提供手机型号、Android 版本、电脑系统与复现步骤，并移除日志中的序列号等个人信息。涉及采集或解析的改动，请附相关测试结果。

项目基于 [Electron](https://www.electronjs.org/)、[Android Platform Tools](https://developer.android.com/tools/releases/platform-tools) 与 [Perfetto](https://perfetto.dev/) 构建，感谢这些开源项目与工具。

## 📄 开源许可

本项目原创代码采用 **[MIT License](LICENSE)**，允许使用、修改与分发，包括商业用途；请保留版权声明与许可文本。

Electron、ADB 及其他第三方依赖沿用各自的许可证与声明；项目的 MIT 许可不替代这些上游许可。随包分发的 ADB 保留其上游 `NOTICE.txt`。

---

<div align="center">
<sub>BKDeviceMonitor · Made for every cycle.</sub><br />
<sub><a href="README.en.md">Read in English →</a></sub>
</div>
