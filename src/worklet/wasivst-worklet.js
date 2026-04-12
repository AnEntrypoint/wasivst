
const FRAME_TAG = {
  LOAD:           0x01,
  PROCESS:        0x02,
  PROCESS_RESP:   0x03,
  SET_PARAM:      0x04,
  GET_PARAM:      0x05,
  GET_PARAM_RESP: 0x06,
  LOG:            0x07,
};

class WasivstProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);

    this._ready = false;
    this._pendingAudio = [];
    this._wasmModule = null;

    const wasmUrl = options.processorOptions?.wasmUrl;
    if (!wasmUrl) throw new Error('wasivst-processor: wasmUrl required in processorOptions');

    this._init(wasmUrl);
    this.port.onmessage = (e) => this._onMessage(e.data);
  }

  async _init(wasmUrl) {
    const resp = await fetch(wasmUrl);
    const buf = await resp.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(buf, this._buildImports());
    this._wasmModule = instance;
    this._ready = true;
    this.port.postMessage({ type: 'ready' });
  }

  _buildImports() {
    return {
      env: {
        memory: new WebAssembly.Memory({ initial: 256, maximum: 65536, shared: true }),
      },
    };
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
    const result = this._serialRead();
    if (result) this._decodeProcessResp(result, output);

    return true;
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

  _decodeProcessResp(bytes, output) {
    const dv = new DataView(bytes.buffer);
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

  _serialWrite(_bytes) {
  }

  _serialRead() {
    return null;
  }
}

registerProcessor('wasivst-processor', WasivstProcessor);
