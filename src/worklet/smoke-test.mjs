import { chromium } from '@playwright/test';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const dist = join(__dir, '../../dist');

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
  const safe = req.url === '/' ? '/index.html' : req.url.split('?')[0].replace(/\.\./g, '');
  try {
    const body = readFileSync(join(dist, safe));
    res.writeHead(200, { 'Content-Type': mimeOf(safe) });
    res.end(body);
  } catch {
    res.writeHead(404); res.end();
  }
}).listen(0);

await new Promise(r => server.once('listening', r));
const { port } = server.address();
const base = `http://localhost:${port}`;

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`${base}/`);

// Verify the worklet module loads successfully (static import of libv86.mjs resolves)
await page.evaluate(async () => {
  const ac = new AudioContext();
  await ac.audioWorklet.addModule('/wasivst-worklet.js');
});

server.close();
await browser.close();

if (errors.length) {
  console.error('Smoke test FAILED:', errors);
  process.exit(1);
}
console.log('Smoke test PASSED');
