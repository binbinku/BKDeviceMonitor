<div align="center">

<img src="docs/assets/hero.svg" width="100%" alt="BKDeviceMonitor — Android performance, in focus." />

# BKDeviceMonitor

**A clearer view of your Android device.**

A local Android performance monitor for your desktop. Connect a phone, inspect load and frame timing, explore its hardware, and export your findings.

[简体中文](README.md) · [**English**](README.en.md)

[![MIT License](docs/assets/license.svg)](LICENSE) ![macOS / Windows](docs/assets/platform.svg) ![Electron](docs/assets/runtime.svg)

[Preview](#-preview) · [Features](#-what-you-can-do) · [Quick start](#-quick-start) · [Development](#-development--builds) · [Metrics guide](docs/metrics.en.md)

</div>

## ✨ What you can do

- **Watch workloads change** — Track total and per-core CPU load, live frequencies, GPU, memory, and battery status with continuous charts and hover readings.
- **Inspect app performance** — Follow the foreground app or select a running one to inspect app CPU and memory, plus FPS, frame intervals, and jank where available.
- **Explore device hardware** — Browse CPU, GPU, display, storage, system, and sensor details, with device readings clearly distinguished from official model specifications.
- **Keep a test record** — Capture sessions, peaks, and summaries; export CSV trends, JSON session reports, and hardware profiles.
- **Install local APKs (v1.3.0 source)** — Use a native file picker, an explicit device target, background installation status, and actionable error messages.
- **Browse and download device files (v1.4.0 source)** — Shared-storage shortcuts, path navigation, multi-selection, folder downloads, real byte progress, cancellation, and transfer records.
- **Stay focused** — A Codex-inspired dark workspace, restrained chart colors, and an immersive macOS window. Desktop mode needs no separate backend.

> 🔌 Connect over USB / ADB. No root, Shizuku, or companion phone app required. Once dependencies and ADB are prepared, monitoring and analysis work offline.

## 🖥 Preview

### Performance overview

![BKDeviceMonitor overview showing CPU, GPU, memory trends, and per-core status](docs/screenshots/overview.jpg)

<details>
<summary><strong>Show the device hardware profile</strong></summary>

![BKDeviceMonitor hardware profile with grouped specifications, sources, and sensor capabilities](docs/screenshots/hardware.jpg)

</details>

<sub>Captured from a real Mi 11 Ultra in web mode, which shares its interface and collection engine with the desktop app. The serial number and active process list are hidden for public presentation. The app interface currently uses Simplified Chinese; bilingual support here refers to the project documentation.</sub>

## 📊 Data & capabilities

| Module | What it shows |
| :--- | :--- |
| CPU | Total / per-core utilization, live frequencies, online cores, and core groups |
| GPU | Readable Qualcomm KGSL utilization, driver details, and graphics capabilities |
| Memory | Used / available / cached RAM, swap, readable PSI pressure, and major faults |
| Apps & frames | Target main-process CPU, PSS / RSS, threads; Perfetto FPS, P95 / P99 frame intervals, jank, and dropped frames |
| Thermals & battery | Readable CPU / GPU / skin / battery temperatures, system thermal status, charge level, voltage, charging state, and estimated net battery power |
| Network | Device-wide upload / download rates |
| Hardware profile | SoC, GPU, display modes, RAM / storage, system build, security patch, sensors, and official specifications for matching models |
| Trends & reports | 1 / 5 / 15-minute trends, display pause, CSV exports, session JSON, and hardware JSON |

**Every metric has a source and a limit.** Unsupported or unreadable values display `—`. Missing data is never filled with simulated values, and display refresh rate is never used as FPS. GPU, Perfetto, temperature, and PSI availability depend on Android version, vendor interfaces, and permissions.

CPU is normalized to a device-wide `0–100%` scale. Memory utilization is `1 − MemAvailable / MemTotal`. App CPU and memory cover the main process only. Battery temperature is not CPU temperature; estimated net battery power is not charger input power. See the [metrics guide](docs/metrics.en.md) for sampling details.

## 🚀 Quick start

### Download the desktop app

Open the **[v1.2.1 Release](https://github.com/binbinku/BKDeviceMonitor/releases/tag/v1.2.1)**, or download the package for your computer:

| Your computer | Package |
| :--- | :--- |
| Mac · Apple Silicon (M series) | [macOS ARM64 ZIP](https://github.com/binbinku/BKDeviceMonitor/releases/download/v1.2.1/BKDeviceMonitor-1.2.1-mac-arm64.zip) |
| Mac · Intel | [macOS x64 ZIP](https://github.com/binbinku/BKDeviceMonitor/releases/download/v1.2.1/BKDeviceMonitor-1.2.1-mac-x64.zip) |
| Windows 11 · x64 | [Windows x64 ZIP](https://github.com/binbinku/BKDeviceMonitor/releases/download/v1.2.1/BKDeviceMonitor-1.2.1-win-x64.zip) |

On Mac, extract and move `BKDeviceMonitor.app` to Applications. On Windows, extract the entire archive and run `BKDeviceMonitor.exe`. The release includes `SHA256SUMS.txt` for verification.

### Run from source

You need **Node.js 22.12+**, npm, and an Android phone with USB debugging enabled. Installing dependencies and preparing ADB initially require internet access.

```sh
git clone https://github.com/binbinku/BKDeviceMonitor.git
cd BKDeviceMonitor
npm ci
npm run prepare:adb
npm start
```

1. Enable **USB debugging** in the phone's Developer options.
2. Connect with a data-capable USB cable and choose **Allow USB debugging** on the phone.
3. Open the app and wait for automatic connection, or choose your phone through the connection dialog.

On Windows, install the phone manufacturer's USB driver if the device is not recognized by ADB. The preparation script downloads macOS / Windows ADB from [Google's official Platform Tools](https://developer.android.com/tools/releases/platform-tools). Set `ADB_PATH` to use an existing ADB executable instead.

### Platform status

| Platform | Build target | Validation |
| :--- | :--- | :--- |
| macOS · Apple Silicon | ARM64 ZIP | Tested with a Mi 11 Ultra |
| macOS · Intel | x64 ZIP | Cross-built; not yet tested on matching hardware |
| Windows 11 | x64 ZIP | Cross-built; not yet tested on matching hardware |

Download a desktop package, run from source, or build your own package. Packages include Electron and ADB, so end users need neither Node.js nor Android Studio. Current macOS builds are ad-hoc signed and not notarized; Windows builds have no certificate signature.

## 📦 Install an APK

Available in the **current v1.3.0 source and local builds**. The published v1.2.1 release does not include this feature.

1. Click **安装 APK** at the top right of the desktop app, then **选择文件** to open the native file picker.
2. Choose a local standalone `.apk` file and verify the filename, target device model, and serial number.
3. Click **开始安装**, keep USB connected, and check for any installation confirmation on the phone.

Uses `adb install -r` to update an existing app while retaining its data. It never automatically uninstalls apps, forces a downgrade, or grants all runtime permissions. Signature conflicts, insufficient storage, USB install restrictions, and other common errors have actionable messages; expand the ADB details for raw output. Progress is indeterminate rather than a fabricated percentage. Closing the panel or reloading the UI does not stop the main-process job. Exiting the app stops the local command but cannot guarantee rollback of work already performed on the phone.

Only standalone APKs are supported, not `.aab`, `.apks`, or split APK sets. Installation is desktop-only; web mode exposes no file installation endpoint.

## 🗂 Device files & downloads

The **current v1.4.0 source and local builds** add **设备文件** to the sidebar. The published v1.2.1 release does not include this feature.

- Browse shared-storage shortcuts (downloads, camera photos, screenshots, documents) or enter a directory under `/sdcard`.
- Sort by name, size, or modification time; filter the current directory, show hidden entries, and select multiple files or folders.
- Choose **下载所选** (download selection) or **下载当前文件夹** (download current folder), then pick a local destination in the native dialog. One download batch runs at a time; batches allow up to 200 selected roots and a scan of at most 20,000 entries / 64 levels.
- Tasks show actual bytes written, speed, and results, with cancellation and reveal-in-folder controls. Downloads survive UI reloads and page changes. The latest 20 task records remain in memory during this app run; resumable downloads are not supported.
- Downloads are staged in a hidden temporary directory at the destination and published after size checks. Existing files are never overwritten: colliding names get numbered suffixes. Unsupported Windows characters and reserved names are converted to portable names. Failed or cancelled jobs clean temporary files; cleanup failures identify the remaining temporary directory.

This first version provides read-only browsing of internal shared storage (`/sdcard`, including the `/storage/emulated/0` alias). It does not upload, delete, or rename phone files. Access to `Android/data` and `Android/obb` depends on device permissions; private application directories are outside the supported scope. Folder downloads include hidden regular files and skip symbolic links / special files. An unreadable subdirectory fails the batch with an explanation. Transfers stay bound to their selected device and never switch to another phone. Cancellation is unavailable during final publication of completed files.

File operations use restricted desktop IPC, are not exposed through optional web mode, and do not upload phone files to the cloud.

## 🛠 Development & builds

| Command | Purpose |
| :--- | :--- |
| `npm start` / `npm run dev` | Launch the Electron desktop app |
| `npm run prepare:adb` | Download official ADB and preserve upstream notices, source metadata, and archive SHA-256 records |
| `npm test` | Run parser, engine, session, and local access restriction tests |
| `npm run pack:mac` | Generate an app directory for Apple Silicon Macs |
| `npm run build:mac` | Build macOS ARM64 and x64 ZIP packages |
| `npm run build:win` | Build a Windows x64 ZIP package |
| `npm run web` | Start the optional web entry at `http://localhost:3210` |

Build outputs are written to `release/`. On Windows, extract the entire archive and keep `resources` and DLLs alongside the executable.

```text
BKDeviceMonitor/
├── desktop/           Native window, restricted IPC, save dialogs, ADB resolution
├── public/            HTML / CSS / JavaScript UI and Canvas charts
├── monitor.mjs        Local collection engine
├── metrics.mjs        Core CPU / GPU / memory metrics
├── hardware.mjs       Hardware parsing and model profiles
├── telemetry.mjs      Apps, thermals, network, and memory pressure
├── trace.mjs          Perfetto frame and current parsing
├── session.mjs        Test session statistics and reports
├── server.mjs         Optional web adapter
└── tests/             Automated tests
```

### Local operation & retention

The desktop app uses restricted IPC and a local resource protocol, with **no HTTP server**. ADB still uses its standard local daemon, normally on port `5037`. The renderer enables sandboxing and context isolation, with Node integration disabled. The optional web entry listens only on `127.0.0.1` and checks request origins.

Recent trends stay in memory for approximately 15 minutes. Pausing freezes the display while collection and sessions continue. Sessions survive page changes and UI reloads but are cleared when the app exits. Export before closing to keep your results. Reports include at most the latest 20,000 session samples; see [session details](docs/metrics.en.md#test-sessions).

## 🤝 Contributing

[Issues and suggestions](https://github.com/binbinku/BKDeviceMonitor/issues) and [pull requests](https://github.com/binbinku/BKDeviceMonitor/pulls) are welcome. For compatibility reports, include your phone model, Android version, desktop OS, and reproduction steps. Remove serial numbers and other personal information from logs. Include relevant test results for collection or parser changes.

Built with [Electron](https://www.electronjs.org/), [Android Platform Tools](https://developer.android.com/tools/releases/platform-tools), and [Perfetto](https://perfetto.dev/). Thanks to the projects and people behind these tools.

## 📄 License

The project's original code is available under the **[MIT License](LICENSE)**. Use, modify, and distribute it, including commercially, while retaining the copyright notice and license text.

Electron, ADB, and other third-party dependencies retain their own licenses and notices. This project's MIT license does not replace upstream licenses. Bundled ADB retains its upstream `NOTICE.txt`.

---

<div align="center">
<sub>BKDeviceMonitor · Made for every cycle.</sub><br />
<sub><a href="README.md">阅读简体中文版 →</a></sub>
</div>
