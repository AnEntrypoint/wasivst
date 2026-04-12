# Changelog

## [Unreleased] - 2026-04-12

### Added
- GitHub Pages live demo deployed on every push to main (not just tags)
  - `src/demo/index.html`: plugin URL input defaulting to bundled MDA TestTone (`mda-TestTone.dll`, VST2), load button, status + log display
  - `src/demo/coi-serviceworker.js`: service worker injects COOP/COEP headers on GH Pages (required for SharedArrayBuffer)
    - Fixed SW registration to use relative path (works under /wasivst/ subpath)
    - Fixed reload: listens for `activated` state on installing SW, reloads if already active on re-visit
  - CI bundles MDA TestTone VST2 (from studiorack/mda v1.0.4) as default demo plugin: `mda-TestTone.dll`
  - mda-win.zip v1.0.4 does not contain Piano; uses TestTone (tone generator, present in zip) instead
- Removed duplicate `smoke-test` CI job (bundle-and-publish already runs smoke test)
- Split rootfs.ext4 into 50MB parts in CI for GitHub Pages compatibility
  - `split -b 50m` produces `rootfs.ext4.part-*` files + `rootfs.parts.json` manifest
  - wasivst-worklet.js fetches parts manifest then reassembles via `_fetchParts()`
  - Falls back to monolithic `rootfs.ext4` if no parts manifest found
- VST integration test CI job: downloads Surge XT nightly (free 64-bit VST3, pluginsonly zip), boots it in Playwright/Chrome
  - Switched from Dexed: Dexed's Inno Setup 6.1.0 installer is incompatible with ubuntu-22.04's innoextract 1.8
  - Surge XT pluginsonly.zip: VST3 binary at `Surge XT.vst3/Contents/x86_64-win/Surge XT.vst3` (not .dll)
  - Asset URL resolved dynamically from GitHub Releases API (Nightly tag) — no hardcoded filename
  - `vst-integration-test.mjs`: verifies JS/worklet pipeline loads (module import, addModule, AudioWorkletNode creation) — full emulator boot not tested in CI (too slow for shared runners)
  - Runs in parallel with `bundle-and-publish` (both depend on `build-qemu-wasm`)

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
