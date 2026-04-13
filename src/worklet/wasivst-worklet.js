// wasivst-worklet.js — pure audio pass-through, no V86 dependency.
// V86 runs on the main thread; audio frames are exchanged via this.port.

const FRAME_TAG = { LOAD: 0x01, PROCESS: 0x02, PROCESS_RESP: 0x03, SET_PARAM: 0x04, GET_PARAM: 0x05, GET_PARAM_RESP: 0x06, LOG: 0x07 };

class WasivstProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
    this._ready = false;
    this._pendingOutput = null;
    this.port.onmessage = (e) => this._onMessage(e.data);
  }

  _onMessage(msg) {
    if (msg.type === 'ready') {
      this._ready = true;
      // Echo ready back so main thread #waitForReady resolves
      this.port.postMessage({ type: 'ready' });
    } else if (msg.type === 'processResp') {
      this._pendingOutput = msg.channels;
    } else if (msg.type === 'getParamResp') {
      this.port.postMessage(msg);
    } else if (msg.type === 'log') {
      this.port.postMessage(msg);
    } else if (msg.type === 'error') {
      this.port.postMessage(msg);
    }
  }

  process(inputs, outputs) {
    if (!this._ready) return true;

    const input = inputs[0];
    const output = outputs[0];

    // Send audio input to main thread for V86 processing
    const channels = input.map(ch => Array.from(ch));
    this.port.postMessage({ type: 'process', channels });

    // Write pending output from previous frame
    if (this._pendingOutput) {
      for (let c = 0; c < this._pendingOutput.length && c < output.length; c++) {
        for (let i = 0; i < this._pendingOutput[c].length && i < output[c].length; i++) {
          output[c][i] = this._pendingOutput[c][i];
        }
      }
      this._pendingOutput = null;
    }

    return true;
  }
}

registerProcessor('wasivst-processor', WasivstProcessor);
