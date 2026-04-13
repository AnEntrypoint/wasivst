
const WORKLET_URL = new URL('./wasivst-worklet.js?v=' + Date.now(), import.meta.url).href;
const WASM_URL = new URL('./wasivst-qemu.wasm', import.meta.url).href;
const ROOTFS_URL = new URL('./rootfs.ext4', import.meta.url).href;
const ROOTFS_PARTS_URL = new URL('./rootfs.parts.json', import.meta.url).href;

window.__wasivst = window.__wasivst ?? { logs: [], instances: {}, serial: {} };

export class WasiVST {
  #node;
  #port;
  #pluginUrl;
  #paramResolvers = new Map();

  constructor(node, port, pluginUrl) {
    this.#node = node;
    this.#port = port;
    this.#pluginUrl = pluginUrl;
  }

  static async load(audioCtx, pluginUrl) {
    await audioCtx.audioWorklet.addModule(WORKLET_URL);

    const node = new AudioWorkletNode(audioCtx, 'wasivst-processor', {
      processorOptions: { wasmUrl: WASM_URL, rootfsUrl: ROOTFS_URL, rootfsPartsUrl: ROOTFS_PARTS_URL },
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    const instance = new WasiVST(node, node.port, pluginUrl);
    node.port.onmessage = (e) => instance.#onMessage(e.data);

    await instance.#waitForReady();
    node.port.postMessage({ type: 'load', pluginPath: pluginUrl });

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
    this.#port.postMessage({ type: 'setParam', id, value });
  }

  getParam(id) {
    return new Promise((resolve) => {
      this.#paramResolvers.set(id, resolve);
      this.#port.postMessage({ type: 'getParam', id });
    });
  }

  dispose() {
    this.#node.disconnect();
    this.#node.port.close();
    delete window.__wasivst.instances[this.#pluginUrl];
  }

  #waitForReady() {
    return new Promise((resolve, reject) => {
      const handler = (e) => {
        if (e.data?.type === 'ready') {
          this.#node.port.removeEventListener('message', handler);
          resolve();
        } else if (e.data?.type === 'error') {
          this.#node.port.removeEventListener('message', handler);
          reject(new Error('wasivst worklet: ' + e.data.message));
        }
      };
      this.#node.port.addEventListener('message', handler);
      this.#node.port.start();
    });
  }

  #onMessage(msg) {
    if (msg.type === 'error') {
      console.error('wasivst worklet error:', msg.message);
      if (window.__wasivst.instances[this.#pluginUrl]) {
        window.__wasivst.instances[this.#pluginUrl].state = 'error';
        window.__wasivst.instances[this.#pluginUrl].error = msg.message;
      }
    } else if (msg.type === 'getParamResp') {
      this.#paramResolvers.get(msg.id)?.(msg.value);
      this.#paramResolvers.delete(msg.id);
    } else if (msg.type === 'log') {
      const entry = { ts: Date.now(), level: msg.level, subsystem: msg.subsystem, msg: msg.message };
      window.__wasivst.logs.push(entry);
      if (window.__wasivst.logs.length > 1000) window.__wasivst.logs.shift();
    } else if (msg.type === 'ready') {
      if (window.__wasivst.instances[this.#pluginUrl]) {
        window.__wasivst.instances[this.#pluginUrl].state = 'ready';
      }
    }
  }
}
