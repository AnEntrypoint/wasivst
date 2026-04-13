
const WORKLET_URL = new URL('./wasivst-worklet.js?v=' + Date.now(), import.meta.url).href;
const WASM_URL = new URL('./wasivst-qemu.wasm', import.meta.url).href;
const ROOTFS_URL = new URL('./rootfs.ext4', import.meta.url).href;
const ROOTFS_PARTS_URL = new URL('./rootfs.parts.json', import.meta.url).href;

window.__wasivst = window.__wasivst ?? { logs: [], instances: {}, serial: { bytesIn: 0, bytesOut: 0 } };

const FRAME_TAG = { LOAD: 0x01, PROCESS: 0x02, PROCESS_RESP: 0x03, SET_PARAM: 0x04, GET_PARAM: 0x05, GET_PARAM_RESP: 0x06, LOG: 0x07 };

export class WasiVST {
  #node;
  #port;
  #pluginUrl;
  #paramResolvers = new Map();
  #v86 = null;
  #rxBuf = [];

  constructor(node, port, pluginUrl) {
    this.#node = node;
    this.#port = port;
    this.#pluginUrl = pluginUrl;
  }

  static async load(audioCtx, pluginUrl) {
    await audioCtx.audioWorklet.addModule(WORKLET_URL);

    const node = new AudioWorkletNode(audioCtx, 'wasivst-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    const instance = new WasiVST(node, node.port, pluginUrl);
    node.port.onmessage = (e) => instance.#onWorkletMessage(e.data);
    node.port.start();

    // Start V86 on the main thread — avoids AudioWorkletGlobalScope restrictions
    await instance.#startV86();

    window.__wasivst.instances[pluginUrl] = { state: 'loading', node };
    return instance;
  }

  connect(destination) {
    this.#node.connect(destination);
  }

  disconnect() {
    this.#node.disconnect();
  }

  setParam(id, value) {
    this.#serialWrite(this.#encodeSetParam(id, value));
  }

  getParam(id) {
    return new Promise((resolve) => {
      this.#paramResolvers.set(id, resolve);
      this.#serialWrite(this.#encodeGetParam(id));
    });
  }

  dispose() {
    this.#node.disconnect();
    this.#node.port.close();
    if (this.#v86) this.#v86.stop();
    delete window.__wasivst.instances[this.#pluginUrl];
  }

  async #startV86() {
    const { V86 } = await import(new URL('./libv86.mjs', import.meta.url).href);

    const rootfsBuffer = await this.#fetchParts(ROOTFS_PARTS_URL);

    this.#v86 = new V86({
      wasm_path: WASM_URL,
      memory_size: 256 * 1024 * 1024,
      vga_memory_size: 2 * 1024 * 1024,
      hda: { buffer: rootfsBuffer },
      autostart: true,
      disable_keyboard: true,
      disable_mouse: true,
      serial0: true,
    });

    this.#v86.add_listener('serial0-output-byte', (byte) => {
      this.#rxBuf.push(byte);
      window.__wasivst.serial.bytesIn++;
      this.#drainAndDispatch();
    });

    await new Promise((resolve) => {
      this.#v86.add_listener('emulator-ready', () => {
        // Notify worklet it can start processing
        this.#port.postMessage({ type: 'ready' });
        resolve();
      });
    });

    // Load the plugin
    this.#serialWrite(this.#encodeLoad(this.#pluginUrl));
    if (window.__wasivst.instances[this.#pluginUrl]) {
      window.__wasivst.instances[this.#pluginUrl].state = 'ready';
    }
  }

  #onWorkletMessage(msg) {
    if (msg.type === 'process') {
      // Forward audio from worklet to V86 via serial
      const channels = msg.channels.map(ch => new Float32Array(ch));
      this.#serialWrite(this.#encodeProcess(channels));
    } else if (msg.type === 'getParamResp') {
      this.#paramResolvers.get(msg.id)?.(msg.value);
      this.#paramResolvers.delete(msg.id);
    } else if (msg.type === 'log') {
      const entry = { ts: Date.now(), level: msg.level, subsystem: msg.subsystem, msg: msg.message };
      window.__wasivst.logs.push(entry);
      if (window.__wasivst.logs.length > 1000) window.__wasivst.logs.shift();
    } else if (msg.type === 'error') {
      console.error('wasivst worklet error:', msg.message);
    }
  }

  #drainAndDispatch() {
    while (this.#rxBuf.length > 0) {
      const tag = this.#rxBuf[0];
      if (tag === FRAME_TAG.PROCESS_RESP) {
        if (this.#rxBuf.length < 9) break;
        const dv = new DataView(new Uint8Array(this.#rxBuf.slice(0, 9)).buffer);
        const sampleCount = dv.getUint32(1, true);
        const chCount = dv.getUint32(5, true);
        const total = 9 + sampleCount * chCount * 4;
        if (this.#rxBuf.length < total) break;
        const frame = new Uint8Array(this.#rxBuf.splice(0, total));
        this.#decodeProcessResp(frame);
      } else if (tag === FRAME_TAG.GET_PARAM_RESP) {
        if (this.#rxBuf.length < 13) break;
        const frame = new Uint8Array(this.#rxBuf.splice(0, 13));
        const dv = new DataView(frame.buffer);
        const id = dv.getUint32(1, true);
        const value = dv.getFloat64(5, true);
        this.#paramResolvers.get(id)?.(value);
        this.#paramResolvers.delete(id);
      } else if (tag === FRAME_TAG.LOG) {
        if (this.#rxBuf.length < 10) break;
        const dv = new DataView(new Uint8Array(this.#rxBuf).buffer);
        const subLen = dv.getUint32(2, true);
        const msgLen = dv.getUint32(6 + subLen, true);
        const total = 10 + subLen + msgLen;
        if (this.#rxBuf.length < total) break;
        const frame = new Uint8Array(this.#rxBuf.splice(0, total));
        const level = frame[1];
        const subsystem = new TextDecoder().decode(frame.slice(6, 6 + subLen));
        const message = new TextDecoder().decode(frame.slice(10 + subLen, 10 + subLen + msgLen));
        const entry = { ts: Date.now(), level, subsystem, msg: message };
        window.__wasivst.logs.push(entry);
        if (window.__wasivst.logs.length > 1000) window.__wasivst.logs.shift();
      } else {
        this.#rxBuf.shift();
      }
    }
  }

  #decodeProcessResp(frame) {
    const dv = new DataView(frame.buffer);
    const sampleCount = dv.getUint32(1, true);
    const chCount = dv.getUint32(5, true);
    const channels = [];
    let offset = 9;
    for (let c = 0; c < chCount; c++) {
      const ch = new Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) {
        ch[i] = dv.getFloat32(offset, true);
        offset += 4;
      }
      channels.push(ch);
    }
    // Send decoded audio back to worklet
    this.#port.postMessage({ type: 'processResp', channels });
  }

  #serialWrite(bytes) {
    if (this.#v86) {
      this.#v86.serial0_send(bytes);
      window.__wasivst.serial.bytesOut += bytes.length;
    }
  }

  #encodeLoad(path) {
    const enc = new TextEncoder();
    const pathBytes = enc.encode(path);
    const buf = new Uint8Array(5 + pathBytes.length);
    buf[0] = FRAME_TAG.LOAD;
    new DataView(buf.buffer).setUint32(1, pathBytes.length, true);
    buf.set(pathBytes, 5);
    return buf;
  }

  #encodeProcess(channels) {
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

  #encodeSetParam(id, value) {
    const buf = new Uint8Array(13);
    const dv = new DataView(buf.buffer);
    buf[0] = FRAME_TAG.SET_PARAM;
    dv.setUint32(1, id, true);
    dv.setFloat64(5, value, true);
    return buf;
  }

  #encodeGetParam(id) {
    const buf = new Uint8Array(5);
    buf[0] = FRAME_TAG.GET_PARAM;
    new DataView(buf.buffer).setUint32(1, id, true);
    return buf;
  }

  async #fetchParts(partsUrl) {
    const parts = await fetch(partsUrl).then(r => r.json());
    const base = partsUrl.replace(/[^/]+$/, '');
    const buffers = await Promise.all(parts.map(n => fetch(base + n).then(r => r.arrayBuffer())));
    const total = buffers.reduce((n, b) => n + b.byteLength, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const b of buffers) { out.set(new Uint8Array(b), off); off += b.byteLength; }
    return out.buffer;
  }
}
