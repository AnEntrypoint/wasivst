const FRAME_TAG = { LOAD: 0x01, PROCESS: 0x02, PROCESS_RESP: 0x03, SET_PARAM: 0x04, GET_PARAM: 0x05, GET_PARAM_RESP: 0x06, LOG: 0x07 };

class WasivstProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
    this._ready = false;
    this._rxBuf = [];
    this._v86 = null;
    const { wasmUrl, rootfsUrl, rootfsPartsUrl } = options.processorOptions ?? {};
    if (!wasmUrl || !rootfsUrl) throw new Error('wasivst: wasmUrl and rootfsUrl required');
    this._init(wasmUrl, rootfsUrl, rootfsPartsUrl).catch(e => {
      this.port.postMessage({ type: 'error', message: e.message });
    });
    this.port.onmessage = (e) => this._onMessage(e.data);
  }

  async _init(wasmUrl, rootfsUrl, rootfsPartsUrl) {
    // V86 is pre-loaded into globalThis by libv86-loader.js via addModule().
    // Dynamic import() is not allowed in AudioWorkletGlobalScope.
    const V86 = globalThis.V86;
    if (!V86) throw new Error('wasivst: V86 not found — ensure libv86-loader.js was added via addModule before wasivst-worklet.js');

    const rootfsBuffer = rootfsPartsUrl
      ? await this._fetchParts(rootfsPartsUrl)
      : await fetch(rootfsUrl).then(r => r.arrayBuffer());

    this._v86 = new V86({
      wasm_path: wasmUrl,
      memory_size: 256 * 1024 * 1024,
      vga_memory_size: 2 * 1024 * 1024,
      hda: { buffer: rootfsBuffer },
      autostart: true,
      disable_keyboard: true,
      disable_mouse: true,
      serial0: true,
    });

    this._v86.add_listener('serial0-output-byte', (byte) => {
      this._rxBuf.push(byte);
    });

    this._v86.add_listener('emulator-ready', () => {
      this._ready = true;
      this.port.postMessage({ type: 'ready' });
    });
  }

  _onMessage(msg) {
    if (msg.type === 'setParam') {
      this._serialWrite(this._encodeSetParam(msg.id, msg.value));
    } else if (msg.type === 'getParam') {
      this._serialWrite(this._encodeGetParam(msg.id));
    } else if (msg.type === 'load') {
      this._serialWrite(this._encodeLoad(msg.pluginPath));
    }
  }

  process(inputs, outputs) {
    if (!this._ready) return true;

    const input = inputs[0];
    const output = outputs[0];

    this._serialWrite(this._encodeProcess(input));

    const resp = this._drainResponse();
    if (resp) this._dispatch(resp, output);

    return true;
  }

  _drainResponse() {
    if (this._rxBuf.length < 1) return null;
    const tag = this._rxBuf[0];
    if (tag === FRAME_TAG.PROCESS_RESP) {
      if (this._rxBuf.length < 9) return null;
      const dv = new DataView(new Uint8Array(this._rxBuf.slice(0, 9)).buffer);
      const sampleCount = dv.getUint32(1, true);
      const chCount = dv.getUint32(5, true);
      const total = 9 + sampleCount * chCount * 4;
      if (this._rxBuf.length < total) return null;
      const frame = new Uint8Array(this._rxBuf.splice(0, total));
      return frame;
    } else if (tag === FRAME_TAG.GET_PARAM_RESP) {
      if (this._rxBuf.length < 13) return null;
      const frame = new Uint8Array(this._rxBuf.splice(0, 13));
      return frame;
    } else if (tag === FRAME_TAG.LOG) {
      if (this._rxBuf.length < 10) return null;
      const dv = new DataView(new Uint8Array(this._rxBuf).buffer);
      const subLen = dv.getUint32(2, true);
      const msgLen = dv.getUint32(6 + subLen, true);
      const total = 10 + subLen + msgLen;
      if (this._rxBuf.length < total) return null;
      const frame = new Uint8Array(this._rxBuf.splice(0, total));
      return frame;
    }
    this._rxBuf.shift();
    return null;
  }

  _dispatch(frame, output) {
    const tag = frame[0];
    if (tag === FRAME_TAG.PROCESS_RESP) {
      this._decodeProcessResp(frame, output);
    } else if (tag === FRAME_TAG.GET_PARAM_RESP) {
      const dv = new DataView(frame.buffer);
      this.port.postMessage({ type: 'getParamResp', id: dv.getUint32(1, true), value: dv.getFloat64(5, true) });
    } else if (tag === FRAME_TAG.LOG) {
      const dv = new DataView(frame.buffer);
      const level = frame[1];
      const subLen = dv.getUint32(2, true);
      const subsystem = new TextDecoder().decode(frame.slice(6, 6 + subLen));
      const msgLen = dv.getUint32(6 + subLen, true);
      const message = new TextDecoder().decode(frame.slice(10 + subLen, 10 + subLen + msgLen));
      this.port.postMessage({ type: 'log', level, subsystem, message });
    }
  }

  _encodeLoad(path) {
    const enc = new TextEncoder();
    const pathBytes = enc.encode(path);
    const buf = new Uint8Array(5 + pathBytes.length);
    buf[0] = FRAME_TAG.LOAD;
    new DataView(buf.buffer).setUint32(1, pathBytes.length, true);
    buf.set(pathBytes, 5);
    return buf;
  }

  _encodeProcess(channels) {
    const chCount = channels.length;
    const sampleCount = channels[0]?.length ?? 128;
    const headerSize = 1 + 4 + 4 + 4;
    const audioSize = chCount * sampleCount * 4;
    const buf = new Uint8Array(headerSize + audioSize);
    const dv = new DataView(buf.buffer);
    buf[0] = FRAME_TAG.PROCESS;
    dv.setUint32(1, sampleCount, true);
    dv.setUint32(5, chCount, true);
    dv.setUint32(9, audioSize, true);
    let offset = headerSize;
    for (const ch of channels) {
      for (let i = 0; i < sampleCount; i++) {
        dv.setFloat32(offset, ch?.[i] ?? 0, true);
        offset += 4;
      }
    }
    return buf;
  }

  _decodeProcessResp(frame, output) {
    const dv = new DataView(frame.buffer);
    const sampleCount = dv.getUint32(1, true);
    const chCount = dv.getUint32(5, true);
    let offset = 9;
    for (let c = 0; c < chCount && c < output.length; c++) {
      for (let i = 0; i < sampleCount && i < output[c].length; i++) {
        output[c][i] = dv.getFloat32(offset, true);
        offset += 4;
      }
    }
  }

  _encodeSetParam(id, value) {
    const buf = new Uint8Array(13);
    const dv = new DataView(buf.buffer);
    buf[0] = FRAME_TAG.SET_PARAM;
    dv.setUint32(1, id, true);
    dv.setFloat64(5, value, true);
    return buf;
  }

  _encodeGetParam(id) {
    const buf = new Uint8Array(5);
    buf[0] = FRAME_TAG.GET_PARAM;
    new DataView(buf.buffer).setUint32(1, id, true);
    return buf;
  }

  async _fetchParts(partsUrl) {
    const parts = await fetch(partsUrl).then(r => r.json());
    const base = partsUrl.replace(/[^/]+$/, '');
    const buffers = await Promise.all(parts.map(n => fetch(base + n).then(r => r.arrayBuffer())));
    const total = buffers.reduce((n, b) => n + b.byteLength, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const b of buffers) { out.set(new Uint8Array(b), off); off += b.byteLength; }
    return out.buffer;
  }

  _serialWrite(bytes) {
    if (this._v86) this._v86.serial0_send(bytes);
  }
}

registerProcessor('wasivst-processor', WasivstProcessor);
