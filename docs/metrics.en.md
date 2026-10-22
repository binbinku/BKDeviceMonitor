# Metrics & collection guide

[Back to the English README](../README.en.md) · [简体中文](metrics.zh-CN.md)

## Core metrics & interaction

- **CPU:** Delta sampling of `/proc/stat`, normalized to 0–100% for the device and each core. Guest time is not counted twice. The first sample has no baseline and displays `—`.
- **CPU frequency:** Readable per-core `scaling_cur_freq` values, shown in MHz.
- **GPU:** Qualcomm KGSL `gpubusy`, calculated as busy time / total time. Its driver sampling window differs from the CPU window. Unreadable values and zero total time display `—`.
- **RAM:** `1 − MemAvailable / MemTotal`, with capacities in GiB. Available memory includes reclaimable cache.
- **Battery:** Charge level, charging state, voltage, and battery temperature from `dumpsys battery`. Battery temperature does not describe CPU core temperature.
- **Processes:** Read `top` every five seconds, excluding collection commands. CPU percentages are divided by the core count to match the device-wide scale.
- **Trends:** Core metrics are collected every second. The latest 900 samples are retained, with 1 / 5 / 15-minute views, series toggles, hover readings, display pause, and CSV export.
- **Pause & reload:** Pausing only freezes the display. Collection continues; resuming shows the latest data. A UI reload restores this run's history. Switching devices clears that history.
- **Missing data:** No device, offline devices, unauthorized devices, and missing ADB have explicit states. Unreadable metrics are never replaced with simulated values.

## Hardware information

The hardware page groups CPU cores and maximum frequencies, GPU driver, display resolution and supported modes, RAM and data partition capacity, charging specifications, system build, security patch, imaging, and sensor capabilities. Export the profile as JSON.

Fields identify device readings, model specifications, or missing information. The Mi 11 Ultra model profile uses Xiaomi's official specifications and Qualcomm's product brief, with source links in the app. Other models do not inherit this profile. Installed software versions always come from the connected device.

Nominal charging power is not measured charging power. Logical DPI is not panel PPI. Data partition capacity is not nominal flash capacity. Static configuration is collected on connection; available memory, storage, and battery status update with live sampling. Hardware sections can be expanded independently; the CPU section opens by default.

## Deep monitoring

Open **深度监测** in the sidebar, or `http://localhost:3210/#insights` in optional web mode.

- **Frames:** Uses the phone's Perfetto `android.surfaceflinger.frametimeline` source. Roughly every three seconds, a two-second window is collected. Target app main and child process IDs are matched; presentation frames are counted on the most active single surface and deduplicated by DisplayFrame token. Counts from multiple layers are not added together. Shows valid-window FPS, P95 / P99 frame intervals, system-marked jank, and dropped frames. No new frames, unsupported sources, or a background target produce a missing-data state. Refresh rate never substitutes for FPS.
- **CPU groups:** Group cores by configured maximum frequency; show the mean of readable live frequencies and the online-core count.
- **Thermals:** Read `thermalservice` and named CPU / GPU / skin / battery temperature nodes. CPU and GPU cards use the maximum readable sensor value for that component. Thermal level 0 means no system thermal alert; it does not prove the absence of frequency limiting. Cooling device values retain their vendor meaning.
- **Target app:** Follow the foreground app automatically or select a running app / process. CPU, thread count, PSS, and RSS refer to the main process only. CPU uses the same 0–100% device-wide scale; memory updates every five seconds.
- **Current & power:** Perfetto `android.power` counters provide the magnitude of mean current over a valid window. Net battery power magnitude is estimated from current × latest battery voltage. It is neither charger input power nor total device power consumption. Unsupported sources remain unavailable.
- **Network:** Compute device-wide rates from `/proc/net/dev` wlan, eth, and rmnet_data counter deltas using elapsed time. Loopback, VPN, and virtual interfaces are excluded to reduce duplicate counting. First samples and counter resets do not produce rates.
- **Memory pressure:** Read PSI avg10 where permitted, plus swap-in / swap-out pages, major fault rates, and OOM counts since boot. RAM utilization never substitutes for unavailable PSI.

## Test sessions

The in-process engine records session start / end, mean and peak CPU, peak temperatures, valid-window weighted mean FPS, jank, frame interval percentiles, and foreground app changes.

- Sessions continue across UI reloads and page changes.
- Disconnecting, switching devices, or manually changing the target ends a session. Automatic foreground changes are recorded as events.
- Each trace window is accumulated once. Windows preceding session start are excluded.
- JSON reports include at most the latest **20,000 detailed samples**. Percentiles use the latest **100,000 valid frame intervals**; aggregate peaks and mean CPU cover the whole session.
- Records live in memory and are cleared on application exit. Export manually to keep a report.

Deep monitoring also supports a separate CSV export and restores up to 15 minutes of recent trends after UI reloads during the same run. Display pause does not stop collection or sessions. Frame / current traces run while a desktop window or browser connection exists; trace files are not retained on the phone.

## Local access & tests

Desktop mode does not listen on HTTP ports. Restricted IPC calls the collection engine directly. Optional web mode listens only on `127.0.0.1` and rejects cross-origin API calls. ADB collection commands are fixed; selected device serials must belong to the current authorized device list. No root, Shizuku, or phone companion app is required. Readable metrics vary by vendor and Android version.

```sh
npm test
```

Tests cover metric and hardware parsing, primary / secondary display selection, model matching, missing values, device authorization states, API access restrictions, session behavior, and the desktop engine. Server tests use isolated mock ADB. Desktop engine tests prohibit listener creation and cover events, validation, stopping collection, and bundled Windows ADB path resolution.

## References

- [Perfetto FrameTimeline protocol](https://android.googlesource.com/platform/external/perfetto/+/refs/heads/android14-release/protos/perfetto/trace/android/frame_timeline_event.proto)
- [Perfetto battery counters protocol](https://android.googlesource.com/platform/external/perfetto/+/refs/heads/android14-release/protos/perfetto/trace/power/battery_counters.proto)
- [Electron security recommendations](https://www.electronjs.org/docs/latest/tutorial/security/)
- [Electron custom protocols](https://www.electronjs.org/docs/latest/api/protocol)
