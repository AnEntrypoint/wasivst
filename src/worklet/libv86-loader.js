// Loaded via audioWorklet.addModule() before wasivst-worklet.js.
// Imports V86 from libv86.mjs and exposes it as a global so the worklet
// processor can reference it without a dynamic import() call, which is
// disallowed in AudioWorkletGlobalScope.
import { V86 } from './libv86.mjs';
globalThis.V86 = V86;
