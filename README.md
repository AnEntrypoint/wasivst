# wasivst

Run unmodified Windows VST2 and VST3 plugins in the browser via WebAssembly.

wasivst boots a minimal Linux guest with Wine inside a QEMU x86-64 emulator
compiled to WASM, loads any Windows VST2/VST3 `.dll` inside it, and exposes
the plugin as a Web Audio API `AudioWorkletNode`.

```
Browser
  └─ AudioWorklet (wasivst-worklet.js)
       └─ WASM: QEMU x86-64 emulator
            └─ Linux guest (Alpine)
                 └─ Wine
                      └─ MyPlugin.vst3 (.dll)
  └─ Web Audio API
       │ SharedArrayBuffer (audio buffers)
       └─ MessageChannel (VST param messages)
```

## Usage

```js
import { WasiVST } from 'https://cdn.jsdelivr.net/npm/@anentrypoint/wasivst/wasivst.js';

const ctx = new AudioContext();
const vst = await WasiVST.load(ctx, 'https://example.com/MyPlugin.vst3');
vst.connect(ctx.destination);
vst.setParam(0, 0.5);
```

## Requirements

- Browser with SharedArrayBuffer support (Chrome 92+, Firefox 79+)
- Served with `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` headers (required for
  SharedArrayBuffer)

## Architecture

See [docs/architecture.md](docs/architecture.md) for full design documentation.

## Building

See [docs/building.md](docs/building.md) for build instructions.

## License

GPL-3.0. See [COPYING](COPYING).
