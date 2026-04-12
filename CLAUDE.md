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
       └─ WASM: QEMU x86-64 emulator (compiled via Emscripten 3.1.50)
            └─ Alpine Linux 3.19 guest (minimal rootfs)
                 └─ Wine 64-bit
                      └─ wasivst-host (headless VST host binary)
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

## QEMU WASM Compilation

QEMU is compiled to WASM via Emscripten 3.1.50 with these flags:

```bash
emcc [...] \
  -s USE_PTHREADS=1 \           # WASM threads via SharedArrayBuffer + Atomics
  -s ALLOW_MEMORY_GROWTH=1 \    # Dynamic memory (plugins may need arbitrary amounts)
  -s TCG_BACKEND=yes \          # Pure TCG (no KVM in browser)
  -target wasm32 \
  src/qemu/softmmu/qemu-system-x86_64.c
```

**Why these flags matter:**
- `USE_PTHREADS=1` is required for audio processing threads in guest Wine
- `ALLOW_MEMORY_GROWTH=1` is critical; Windows VST plugins often allocate large buffers
- TCG is the only backend available in WASM (no hardware virtualization)

Guest rootfs is embedded as binary data or fetched via `fetch()` at runtime.

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

**Currently requires Linux build environment** (Windows builds not yet supported):

- Meson 1.0+ (build system)
- Emscripten 3.1.50 (QEMU → WASM compilation)
- Docker or buildroot (guest rootfs)
- Wine headers (for VST plugin interfaces)
- GCC/Clang (for C++ compilation)

See `docs/building.md` for full setup.

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

## Roadmap & Known Limitations

### Remaining PRD Items
- vst-host-binary: full meson build verification (mostly done)
- guest-rootfs-build: Docker + buildroot rootfs (templates exist)
- qemu-wasm-bundle: Emscripten compilation (CI step exists)
- worklet-processor: WASM virtio-serial integration (core done)
- worklet-js-api: main thread API finalization (mostly done)
- ci-cd-pipeline: end-to-end CI (GitHub Actions workflow complete)
- observability-guest-channel: log streaming from guest (partially done)

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
