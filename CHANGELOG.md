# Changelog

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
