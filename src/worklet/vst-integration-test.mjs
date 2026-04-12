import { chromium } from '@playwright/test';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const dist = join(__dir, '../../dist');
const plugin = join(dist, 'SurgeXT.dll');

if (!existsSync(plugin)) throw new Error(`SurgeXT.dll not found at ${plugin}`);

const mimeOf = p =>
  p.endsWith('.html') ? 'text/html' :
  p.endsWith('.js') ? 'application/javascript' :
  p.endsWith('.mjs') ? 'application/javascript' :
  p.endsWith('.wasm') ? 'application/wasm' :
  p.endsWith('.json') ? 'application/json' :
  'application/octet-stream';

const server = createServer((req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  const safe = req.url === '/' ? '/index.html' : req.url.replace(/\.\./g, '');
  try {
    res.writeHead(200, { 'Content-Type': mimeOf(safe) });
    res.end(readFileSync(join(dist, safe)));
  } catch { res.writeHead(404); res.end(); }
}).listen(0);

await new Promise(r => server.once('listening', r));
const { port } = server.address();
const base = `http://localhost:${port}`;

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

const errors = [];
const logs = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); else logs.push(m.text()); });

await page.goto(`${base}/`);

const result = await page.evaluate(async (pluginUrl) => {
  const mod = await import('/wasivst.js');
  const ac = new AudioContext({ sampleRate: 44100 });
  await ac.audioWorklet.addModule('/wasivst-worklet.js');
  const node = new AudioWorkletNode(ac, 'wasivst-processor', {
    processorOptions: {
      libv86Url: `${location.origin}/libv86.mjs`,
      rootfsUrl: `${location.origin}/rootfs.ext4`,
      rootfsPartsUrl: `${location.origin}/rootfs.parts.json`,
    },
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  node.connect(ac.destination);
  window.__wasivst.instances[pluginUrl] = { state: 'node-created', node };
  return { state: 'node-created', hasWasiVST: typeof mod.WasiVST === 'function' };
}, `${base}/SurgeXT.dll`);

server.close();
await browser.close();

if (errors.length) { console.error('VST integration test FAILED:', errors); process.exit(1); }
if (!result.hasWasiVST) { console.error('VST integration test FAILED: WasiVST not exported'); process.exit(1); }
console.log('VST integration test PASSED', result);
console.log('Logs:', logs.slice(-10));
