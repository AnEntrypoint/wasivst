# wasivst Technical Reference

## Project Overview

**wasivst** is a WebAssembly runtime that enables unmodified Windows VST2/VST3 plugin DLLs to run in web browsers. It transforms the original yabridge codebase (a Wine plugin bridge for Linux) into a WASM-based architecture.

**Not a Linux plugin bridge anymore.** This is a browser platform pivot: the goal is to run Windows .dll plugins in JavaScript environments via QEMU emulation.

### Publishing

- npm package: `@anentrypoint/wasivst`
- GitHub repo: AnEntrypoint/wasivst
- License: GPL-3.0

## Architecture Stack

```
Browser (main thread)
  └─ AudioWorklet (wasivst-worklet.js)
       └─ WASM: v86 x86-64 PC emulator (npm: v86 0.5.319, pre-built)
            └─ Alpine Linux 3.19 guest (minimal rootfs, ext4 image)
                 └─ Wine 64-bit
                      └─ wasivst-host.exe (headless VST host, Windows PE via MinGW)
                           └─ MyPlugin.vst3 (.dll)
  └─ Web Audio API (SharedArrayBuffer + MessageChannel)
```

### Key Components

- **src/worklet/** — wasivst.js (main thread API), wasivst-worklet.js (AudioWorkletProcessor)
- **src/host/** — headless VST2/VST3 host binary (C++, runs under Wine)
  - Loads .dll via Win32 LoadLibrary (Wine API)
  - Initializes VST2 AEffect or VST3 IPluginFactory
  - Handles audio/control frames via virtio-serial
  - Runs minimal Win32 message pump thread for plugins that require it
- **src/guest/** — rootfs build scripts (Dockerfile, buildroot external tree, init script)
- **src/common/** — Serialization (bitsery), audio buffers, logging, VST ABI types (inherited from yabridge)
- **tools/wasivstctl/** — CLI for packaging .wasivst bundles (zip: DLL + metadata)

## Communication Protocol

All host↔worklet communication uses a single **virtio-serial byte stream**. Frames are **length-prefixed** and serialized with **bitsery**.

| FrameTag | Direction | Payload |
|----------|-----------|---------|
| LOAD (0x01) | worklet→host | Plugin path (UTF-8) |
| PROCESS (0x02) | worklet→host | Sample count (u32), Float32 audio in |
| PROCESS_RESP (0x03) | host→worklet | Float32 audio out |
| SET_PARAM (0x04) | worklet→host | Param index (u32), value (f64) |
| GET_PARAM (0x05) | worklet→host | Param index (u32) |
| GET_PARAM_RESP (0x06) | host→worklet | value (f64) |
| LOG (0x07) | host→worklet | Level (u8), subsystem, message |

**Frame format:** `[u32 length][u8 tag][payload bytes]`

## v86 WASM Emulator

v86 (npm: `v86`, version 0.5.319) is a pre-built x86-64 PC emulator in JS/WASM. No compilation required.

**Distribution**: `npm pack v86` downloads a tarball containing:
- `build/v86.wasm` — WASM emulator binary (~2MB)
- `build/libv86.mjs` — ES module API for AudioWorklet `import()`
- `build/libv86.js` — CJS API (unused)

**Why v86 instead of QEMU compiled via Emscripten:**
QEMU 8.2 uses meson internally. `emcmake ./configure` is an autotools pattern — it does not work with meson-based builds. QEMU's configure also rejects Emscripten as a valid host OS (`uname -s` returns `Linux`, which causes `ERROR: Unrecognized host OS`). v86 is pre-built, maintained, and supports the full x86-64 ISA needed for Wine.

**V86 instance config** (wasivst-worklet.js):
```js
new V86({
  wasm_path: wasmUrl,        // wasivst-qemu.wasm (v86.wasm renamed)
  memory_size: 256 * 1024 * 1024,
  vga_memory_size: 2 * 1024 * 1024,
  hda: { buffer: rootfsBuffer }, // rootfs.ext4 as ArrayBuffer
  autostart: true,
  disable_keyboard: true,
  disable_mouse: true,
  serial0: true,             // virtio-serial for host↔guest IPC
})
```

Guest rootfs is fetched via `fetch()` at AudioWorklet init time.

## Observability

Live debug registry at `window.__wasivst`:

```js
window.__wasivst = {
  logs: [],        // ring buffer (max 1000 entries): {ts, level, subsystem, msg}
  instances: {},   // keyed by plugin URL: {state, paramCount, audioState}
  serial: {}       // raw serial channel stats: {bytesIn, bytesOut}
};
```

Used for debugging audio dropouts, plugin load failures, and parameter mapping issues.

## Critical Constraints

### No GUI Support
VST editor windows **cannot render in WASM.** This is architectural and permanent. The runtime is audio-only. Plugins that require visual feedback are not compatible.

### 64-bit Plugins Only
- Wine is built as 64-bit only
- No 32-bit plugin support
- No bitbridge (32-bit shim to 64-bit host)

### SharedArrayBuffer Required
- Browsers require `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers
- No fallback to synchronous audio (Web Workers cannot be used without SAB)
- Chrome 92+, Firefox 79+ minimum

### Boot Latency
Expect 5-15 seconds to start:
1. QEMU cold boot (~3-5s)
2. Alpine init + Wine startup (~2-5s)
3. Plugin DLL load + VST initialization (~1-5s)

This is normal and not a bug.

### Audio Latency
virtio-serial IPC adds ~1-5ms per audio block. This is unavoidable in the stack. Small buffer sizes (128-256 samples) may be unreliable; recommend 512+ samples.

## File System Layout

```
/c/dev/yabridge/
├── CLAUDE.md                           # This file
├── README.md                           # User-facing overview
├── CHANGELOG.md
├── meson_options.txt                   # Build options (VST3 support toggle)
├── meson.build                         # Root build script
├── src/
│   ├── worklet/
│   │   ├── wasivst.js                 # Main thread API
│   │   └── wasivst-worklet.js         # AudioWorkletProcessor
│   ├── host/
│   │   ├── meson.build
│   │   ├── main.cpp                   # Entry point, message pump
│   │   └── ipc/
│   │       ├── serial-channel.h/cpp   # virtio-serial I/O
│   │       └── frame-dispatcher.h     # FrameTag dispatch
│   ├── guest/
│   │   ├── Dockerfile                 # Alpine + Wine rootfs builder
│   │   ├── init                       # /sbin/init in guest
│   │   ├── qemu-build.sh              # Emscripten QEMU compilation
│   │   └── buildroot/                 # Buildroot external tree (alt)
│   └── common/
│       ├── serialization/
│       │   ├── common.h               # bitsery wrappers
│       │   ├── vst2.h                 # VST2 ABI types
│       │   └── vst3/                  # VST3 ABI types
│       ├── audio-shm.h                # SharedArrayBuffer layout
│       ├── logging/                   # Log streaming
│       └── ...                        # (inherited from yabridge)
├── tools/wasivstctl/
│   └── main.cpp                       # CLI bundler/packager
├── docs/
│   ├── architecture.md                # Detailed design (VST protocol, etc.)
│   ├── building.md                    # Build instructions (Linux env required)
│   └── ...
├── .github/workflows/
│   └── build.yml                      # Full CI/CD pipeline
└── dist/                              # Build artifacts (generated)
    ├── wasivst-qemu.wasm
    ├── wasivst-host
    └── rootfs.ext4
```

## Build Environment

**CI runs on ubuntu-22.04 via GitHub Actions.** No local build environment needed for the WASM emulator — it is fetched from npm.

- Meson 1.0+ + ninja (wasivst-host.exe compilation)
- mingw-w64 (cross-compile Windows PE for Wine)
- Docker (guest Alpine rootfs)
- Node.js + npm (v86 package fetch, Playwright smoke test)
- No Emscripten — v86 is pre-built

## Key Implementation Notes

### Serial Channel I/O (src/host/ipc/serial-channel.h/cpp)

The SerialChannel class reads/writes to virtio-serial device (typically `/dev/virtio-port/0` in guest):

```cpp
class SerialChannel {
  void write(const void* data, size_t size);
  bool read(void* data, size_t size);
  // Internal: length-prefixed frame marshalling
};
```

Used for all VST parameter and audio frame I/O. **Blocking reads** — frames must arrive in order.

### Frame Dispatcher (src/host/ipc/frame-dispatcher.h)

Routes incoming frames by FrameTag to handlers:

```cpp
void on_load(const std::string& path);
void on_process(uint32_t frames, const float* in);
void on_set_param(uint32_t idx, double val);
// ...
```

### bitsery Serialization (src/common/serialization/)

All complex types use bitsery for compact binary encoding. Example:

```cpp
template <typename S>
void serialize(S& s, AudioBuffer& v) {
  s.value1b(v.channels);
  s.container(v.data, MAX_SAMPLES);
}
```

**Important:** bitsery version and message format must match between host and worklet. Mismatches cause silent data corruption.

### Win32 Message Pump (src/host/main.cpp)

Some VST plugins (especially GUI editors) require a Win32 message loop. The host runs a **minimal message pump thread** that dispatches `PeekMessage()` calls periodically. This is NOT a GUI event loop — it just prevents plugin crashes from deadlocked message queues.

## Testing & Debugging

### Local Testing

Use `wasivstctl` to test plugins locally via headless QEMU:

```bash
wasivstctl load MyPlugin.vst3 --test-process 1024
```

This runs the plugin in a local QEMU instance without a browser.

### Browser Debugging

1. Open DevTools Console
2. Access `window.__wasivst.logs` for real-time log stream
3. Monitor `window.__wasivst.serial` for I/O stats
4. Check AudioWorklet processor time via `performance.measure()`

### Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| Plugin fails to load | Path not found or DLL incompatibility | Check plugin URL, verify VST3 support (meson -Dvst3=true) |
| No audio output | virtio-serial blocked or frame format mismatch | Check `__wasivst.serial.bytesOut`, review logs |
| AudioWorklet crashes | WASM OOM or assertion failure | Check Memory Growth setting, increase rootfs size |
| 5-15s boot latency | Normal QEMU startup | Not a bug; use web worker to avoid blocking main thread |
| SharedArrayBuffer error | Missing COOP/COEP headers | Ensure server sends correct headers |

## Non-Obvious Design Decisions

1. **No bitbridge:** 32-bit plugins are incompatible because Wine is 64-bit only. This is a hard limit, not a future feature.

2. **virtio-serial over IPC sockets:** QEMU in WASM cannot reliably use traditional Unix sockets. virtio-serial is the only stable device in Emscripten's QEMU build. This required abandoning the yabridge socket architecture.

3. **Embedded rootfs vs. fetch():** Small plugins may use embedded rootfs (faster startup), large plugins may fetch dynamically. The build system can toggle this via a flag.

4. **SharedArrayBuffer requirement:** Web Workers alone (no SAB) cannot achieve <10ms audio latency. SAB is mandatory for any real VST plugin.

5. **Bitsery over MessagePack/Protobuf:** bitsery is inherited from yabridge and is ultra-compact (critical for audio frames). Changing serialization would break protocol compatibility.

6. **wasivst-host is a Windows PE, not a Linux ELF.** It must be compiled with `x86_64-w64-mingw32-g++` (MinGW). Linux GCC produces an ELF that Wine cannot execute as a subprocess, and Linux dlopen cannot load Windows PE DLLs. The meson cross-file is `cross-mingw.ini` at repo root. CI invocation: `meson setup build --cross-file cross-mingw.ini -Dvst3=false`.

7. **Alpine 3.19 apk: `wine-libs` is not a separate package.** The `wine` package pulls in its own libraries. Only `wine`, `e2fsprogs`, and `busybox-static` are needed in the guest Dockerfile. Adding `wine-libs` explicitly causes an apk error (package not found).

8. **serial-channel.cpp: binary mode required on Windows.** MinGW/MSVC stdio opens stdin/stdout in text mode, which translates `\n` to `\r\n` and corrupts the raw binary virtio-serial frame stream. Add at startup, guarded by `#ifdef _WIN32`:
   ```cpp
   #include <fcntl.h>
   #include <io.h>
   _setmode(_fileno(stdin),  _O_BINARY);
   _setmode(_fileno(stdout), _O_BINARY);
   ```

9. **npm pack v86 requires pre-created destination dir.** `npm pack v86 --pack-destination /tmp/v86-pack` fails if `/tmp/v86-pack` does not exist. Create the directory first: `mkdir -p /tmp/v86-pack && npm pack v86 --pack-destination /tmp/v86-pack`.

10. **Docker rootfs build: busybox-static /sbin/init hard-link trap.** busybox-static creates `/sbin/init` as a hard-link to `/bin/busybox`. If you `printf > /sbin/init` while the container is running `/bin/sh` (which shares the same inode), you get ETXTBSY ("text file busy"). Fix: `rm -f /sbin/init` before writing the new init script to unlink the directory entry.

11. **docker create on FROM scratch requires explicit command.** `docker create --name tmp wasivst-guest` fails on FROM scratch images because the image has no default CMD. Even if the container never runs, you must provide a command arg: `docker create --name tmp wasivst-guest /null`. The arg is never executed (the create is immediate), but it is syntactically required.

12. **Dexed VST3 is the official demo plugin.** mda plugins from studiorack/mda are **32-bit VST2** and cannot be loaded by the 64-bit Wine runtime. Dexed v1.0.1 from asb2m10/dexed provides a 64-bit VST3 (`Dexed.vst3/Contents/x86_64-win/Dexed.vst3`) with no extra assets required. The CI workflow extracts it from `Dexed-1.0.1-win.zip` and copies it to `dist/Dexed.vst3.dll`.

13. **CI smoke test consolidated.** The duplicate smoke-test job was removed — `bundle-and-publish` now runs the smoke test inline, eliminating redundant execution.

## Roadmap & Known Limitations

### Remaining PRD Items
All core items complete. CI pipeline fully green as of 2026-04-12.

### Will Not Support
- GUI/editor rendering
- 32-bit plugins
- Real-time plugin editor communication
- VST 2.4+ (VST2 only; VST3 preferred)

---

## Quick API Reference

```js
import { WasiVST } from '@anentrypoint/wasivst/wasivst.js';

const ctx = new AudioContext();

// Load a plugin
const vst = await WasiVST.load(ctx, 'https://example.com/plugin.vst3');

// Connect to audio graph
vst.connect(ctx.destination);

// Parameter I/O
await vst.setParam(0, 0.5);  // param index, normalized [0, 1]
const val = await vst.getParam(0);

// Debugging
console.log(window.__wasivst.logs);
console.log(window.__wasivst.instances);
```

See README.md for user-facing examples.
