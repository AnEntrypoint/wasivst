# Changelog

## [Unreleased] - 2026-04-12

### Changed
- Replaced Emscripten/QEMU WASM compilation with pre-built v86 npm package (v0.5.319)
  - v86 is an x86-64 PC emulator distributed as pre-built WASM via npm — no Emscripten toolchain required
  - CI now runs `npm pack v86` to fetch libv86.mjs and v86.wasm; QEMU build step removed
- wasivst-worklet.js: complete rewrite to use v86 V86 class via dynamic `import(libv86Url)`
  - AudioWorkletProcessor creates V86 instance with rootfs.ext4 as ArrayBuffer (fetched via fetch())
  - virtio-serial IPC: serial0_send() for host→guest writes, serial0-output-byte listener for guest→host reads
  - _drainResponse() parses accumulated serial bytes into PROCESS_RESP / GET_PARAM_RESP / LOG frames
- wasivst.js: updated URL references from libv86.js → libv86.mjs and rootfs from qemu-rootfs → rootfs.ext4
- CLAUDE.md: updated architecture docs to reflect v86 (removed Emscripten sections, added v86 config reference)

### Fixed
- docker create: pass dummy /null command for FROM scratch images (no default CMD available)
- mkfs.ext4: increased rootfs size from 256M → 768M to fit Wine 406MB install
- busybox-static /sbin/init ETXTBSY: rm -f /sbin/init before overwriting (unlink inode first)
- npm pack --pack-destination: create /tmp/v86-pack dir before npm pack (ENOENT otherwise)
- smoke-test.mjs: serve / as /index.html, strip .. from paths (path traversal prevention)

## [0.1.0] - 2026-04-12

### Added
- Transformed yabridge into wasivst: run unmodified Windows VST2/VST3 plugins in the browser via WASM
- QEMU x86-64 system emulator compiled to WASM via Emscripten as plugin runtime
- Linux guest rootfs (Alpine + Wine 64-bit) build pipeline (src/guest/)
- Headless VST2/VST3 host binary for guest (src/host/) with virtio-serial IPC
- SerialChannel IPC layer: length-prefixed bitsery frames over virtio-serial (src/host/ipc/)
- AudioWorkletProcessor (wasivst-worklet.js) driving QEMU WASM + SharedArrayBuffer audio
- Main-thread ES module API (wasivst.js): WasiVST.load(), connect(), setParam(), getParam(), dispose()
- window.__wasivst live observability registry: logs ring buffer, instances map, serial counters
- GitHub Actions CI/CD pipeline: build-host, build-guest-rootfs, build-qemu-wasm, bundle-and-publish
- npm package @anentrypoint/wasivst with ESM exports
- GitHub Pages demo deployment
- Playwright smoke test (headless Chrome)
- wasivstctl CLI tool stub for packaging .wasivst bundles
- docs/architecture.md: full system design documentation

### Removed
- All yabridge Wine bridge components (src/wine-host/, src/chainloader/, src/plugin/)
- yabridgectl Rust tool (tools/yabridgectl/)
- yabridge-specific meson build targets (bitbridge, winedbg, clap options)
- Windows cross-compilation configuration (cross-wine.conf)
