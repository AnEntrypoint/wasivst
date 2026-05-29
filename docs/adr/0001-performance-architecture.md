# ADR 0001: Performance architecture for 64-bit VSTs in the browser

Status: accepted (2026-05-29)
Supersedes: the v86 / virtio-serial design described in the original CLAUDE.md.

## Context

The hard requirement is unmodified 64-bit Windows VST2/VST3 plugin DLLs running
in a browser, as performant as possible. The pre-existing design (CLAUDE.md)
chose v86 (an x86-to-wasm PC emulator) booting Alpine + 64-bit Wine, with all
host<->worklet audio crossing a single emulated serial byte stream.

That design is unworkable on two independent counts, both witnessed:

1. v86 cannot run a 64-bit guest. v86's own README states verbatim:
   "Linux works pretty well. 64-bit kernels are not supported." It JITs some
   64-bit *instructions* but is a 32-bit-kernel machine. It therefore cannot
   boot 64-bit Wine and cannot load 64-bit VST DLLs. The hard requirement
   disqualifies v86 outright.

2. The serial transport is non-realtime by construction. In the existing
   `src/worklet/wasivst.js` the audio path per 128-sample block does:
   `input.map(Array.from)` (allocation), `postMessage` (structured clone),
   re-wrap to Float32Array, encode to a byte frame, marshal to a JS string
   char-by-char via `String.fromCharCode`, push through an emulated UART, and on
   return re-parse the whole receive buffer once per received byte (O(n^2) in
   `#drainAndDispatch`), decode per-sample with DataView, postMessage back, and
   play the result one block late with no synchronization. The pipeline has also
   never run end to end: `dist/` is empty, v86 is not installed, and the smoke
   test only asserts the worklet module loads.

## Decision

### Engine: webix / blink (drop v86)

Adopt webix (AnEntrypoint/webix) as the execution engine. webix is a ~280-line
host over jart/blink compiled to wasm (`blinkenlib.wasm`, ~240KB). blink is an
x86-64 userspace emulator that owns the CPU, MMU, ~150 Linux x86-64 syscalls,
signals, and clone. webix already runs real x86-64 Linux userspace in the
browser: ELF64, musl-static and Alpine-dynamic `/bin/busybox` + `/sbin/apk` via
`ld-musl`, SSE2 (witnessed by its `test.js`, 19/19).

The plugin runs as: AudioWorklet -> webix/blink (wasm) -> Alpine+Wine64 rootfs
-> a Linux VST host process -> Wine loads the Win64 VST DLL.

Rejected alternatives:
- v86: no 64-bit kernel (see Context).
- Box64: x86-64 userspace emulator with Wine64/WOW64 support, but its DynaRec
  backends are only Arm/RISC-V/LoongArch and it links native host libraries
  (libc, SDL, GL). There is no wasm backend; not browser-viable without writing
  one.
- QEMU TCG to wasm: TCG does support x86-64 long mode (unlike v86) and
  emscripten forks exist, but it is larger and interpreter-grade in wasm, and
  webix/blink is already built and adopted.

### Transport: blink zero-copy memory window (drop serial and hand-built SAB)

webix v0.8.0 exposes a zero-copy guest<->host memory window: the guest registers
a buffer via a synthetic syscall (the framebuffer uses `0x5fb`) and the JS host
reads it via `blinkenlib_spy_address` directly into `Module.HEAPU8/HEAPF32`. We
use this primitive for audio: the in-guest VST host mmaps an audio I/O buffer
(control header + input float region + output float region + parameter mailbox)
and the worklet reads/writes it through `HEAPF32` subarray views. No emulated
serial, no `String.fromCharCode`, no per-byte drain, no per-sample DataView
loop, no separate SAB ring to maintain.

### Threading: webix shared memory

webix v0.8.0 is built `-pthread --shared-memory --import-memory`
(`PTHREAD_POOL_SIZE=8`). The engine runs off the main thread; the audio window
lives in shared/imported wasm memory (`Module.HEAPU8.buffer`). Requires
`crossOriginIsolated` (COOP/COEP) at serve time.

### Boot latency: blink snapshot/restore

blink supports byte-exact snapshot/restore of wasm memory + registers, and the
emscripten FS persists across `runElf` within a page session. Boot Wine and load
the plugin once, snapshot, and ship the snapshot so users restore instead of
cold-booting Alpine + Wine.

## The binding constraint: no JIT in wasm

blink's JIT emits native x86-64/aarch64 machine code at runtime and jumps to it.
The wasm sandbox has no executable-from-data path, so this is, in webix's words,
"structurally impossible. NOJIT is permanent in-browser." The webix build runs
blink's interpreter, which blink's README puts at roughly 10x slower than its
native JIT.

The only way to do runtime code generation in wasm is to emit wasm *bytecode*
and `WebAssembly.instantiate()` it. That is a different, unwritten dynarec
backend for blink (block-chained, code-cached, async-instantiate). It is a
research-grade subproject with uncertain realtime payoff and is tracked
separately (`wasm-jit-spike`); the architecture does not block on it.

Consequence for product scope:
- Offline / non-realtime rendering (render N blocks into a buffer, decoupled
  from the audio-callback deadline) is the primary supported mode.
- Realtime streaming (engine runs ahead, worklet drains a deep pre-rendered
  ring) is offered only where the engine sustains >= 1x realtime on the target
  plugin, gated on benchmark.

## Open risks (gating)

- `wine-runs-under-blink`: whether Wine64 runs under blink at all (NOJIT,
  emscripten has no `fork()`, ~150 syscalls, single address space). Wine spawns
  wineserver and services; the no-fork limit may force a single-process Wine
  configuration or block Wine entirely. This is the highest-risk unknown and is
  the next spike; the entire webix-VST path depends on it.
- `realtime-budget`: at-risk under NOJIT for non-trivial synths (a 128-sample
  block at 48kHz must complete in ~2.7ms).

## References

- v86 README (github.com/copy/v86): "64-bit kernels are not supported."
- blink README (github.com/jart/blink): x86-64 interp + JIT, JIT long-mode only,
  runs x86-64-linux ELF, cannot boot Windows.
- box64 README (github.com/ptitSeb/box64): DynaRec Arm/RISC-V/LoongArch only.
- webix README + AGENTS.md (github.com/AnEntrypoint/webix): blink-to-wasm host,
  v0.8.0 threads/sockets/framebuffer/spy_address, "JIT impossible ... NOJIT is
  permanent in-browser."
