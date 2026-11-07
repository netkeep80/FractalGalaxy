import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function chromeBinary() {
  for (const binary of ['google-chrome', 'chromium', 'chromium-browser']) {
    if (spawnSync('which', [binary]).status === 0) return binary;
  }
  return null;
}

async function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = decodeURIComponent(url.pathname);
      const fromSrc = path === '/src' || path.startsWith('/src/');
      const base = resolve(root, fromSrc ? 'src' : 'demo');
      const rel = fromSrc ? path.replace(/^\/src\/?/, '') : (path === '/' ? 'index.html' : path.slice(1));
      const full = resolve(base, rel);
      if (!full.startsWith(base + '/') || full.includes('/.git/')) {
        res.writeHead(403); res.end(); return;
      }
      const bytes = await readFile(full);
      const mime = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript',
        '.mjs':'text/javascript', '.json':'application/json' }[extname(full)] || 'text/plain';
      res.writeHead(200, { 'content-type': mime + '; charset=utf-8', 'cache-control':'no-store' });
      res.end(bytes);
    } catch (error) {
      res.writeHead(404); res.end(String(error.message));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url: 'http://127.0.0.1:' + server.address().port + '/' };
}

async function startChrome(binary, dir) {
  const child = spawn(binary, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', '--user-data-dir=' + dir, 'about:blank'
  ], { stdio: 'ignore' });
  let port;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('Chromium exited early');
    try {
      const active = await readFile(join(dir, 'DevToolsActivePort'), 'utf8');
      port = Number(active.split('\n')[0]);
      if (port > 0) break;
    } catch { /* browser still starting */ }
    await sleep(100);
  }
  if (!port) throw new Error('Chromium DevTools port unavailable');
  const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const socketUrl = list.find(item => item.type === 'page')?.webSocketDebuggerUrl;
  if (!socketUrl) throw new Error('Chromium page target unavailable');
  const socket = new WebSocket(socketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once:true });
    socket.addEventListener('error', reject, { once:true });
  });
  return { child, socket };
}

function connectCdp(socket) {
  let id = 0;
  const pending = new Map();
  const exceptions = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') {
      exceptions.push(message.params?.exceptionDetails?.text ?? 'JavaScript exception');
    }
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const requestId = ++id;
      pending.set(requestId, { resolve, reject });
      socket.send(JSON.stringify({ id:requestId, method, params }));
    });
  }
  async function evaluate(expression) {
    const response = await send('Runtime.evaluate', { expression, returnByValue:true, awaitPromise:true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result?.value;
  }
  async function until(expression, expected, label) {
    for (let i=0;i<70;i++) {
      if (await evaluate(expression) === expected) return;
      await sleep(100);
    }
    throw new Error('Studio browser condition not reached: ' + label);
  }
  return { send, evaluate, until, exceptions };
}

test('real Chromium Studio workspace: direct 3D picking, hierarchy and locale round-trip', { timeout:30000 }, async t => {
  const binary = chromeBinary();
  if (!binary) {
    if (process.env.CI) throw new Error('Chromium is required in CI for Studio browser acceptance');
    t.skip('Chromium not installed locally'); return;
  }
  const temp = await mkdtemp(join(tmpdir(), 'fg-studio-cdp-'));
  let server, chrome;
  try {
    const web = await startServer();
    server = web.server;
    chrome = await startChrome(binary, temp);
    const cdp = connectCdp(chrome.socket);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.navigate', { url:web.url });
    await cdp.until('Boolean(document.getElementById("studioLanguage"))', true, 'workspace initialization');
    assert.equal(await cdp.evaluate('document.querySelector(".studio-inspector") !== null'), true);
    assert.equal(await cdp.evaluate('document.getElementById("studioLevel").textContent'), '2');

    const coords = await cdp.evaluate('(() => { const r=document.getElementById("referenceView").getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()');
    await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:coords.x,y:coords.y,button:'left',clickCount:1});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:coords.x,y:coords.y,button:'left',clickCount:1});
    const selected = await cdp.evaluate('document.getElementById("studioPath").textContent');
    assert.match(selected, /^\/\d+\/\d+$/);
    await cdp.evaluate('document.getElementById("studioParent").click()');
    assert.equal(await cdp.evaluate('document.getElementById("studioLevel").textContent'), '1');
    await cdp.evaluate('(() => { document.getElementById("studioChildOctant").value="6"; document.getElementById("studioChildButton").click(); })()');
    assert.equal(await cdp.evaluate('document.getElementById("studioLevel").textContent'), '2');
    const restored = await cdp.evaluate('document.getElementById("studioPath").textContent');

    await cdp.evaluate('(() => { const e=document.getElementById("studioLanguage"); e.value="en"; e.dispatchEvent(new Event("change", {bubbles:true})); })()');
    assert.equal(await cdp.evaluate('document.getElementById("studioInspectorHeading").textContent'), 'Inspector');
    assert.equal(await cdp.evaluate('document.documentElement.lang'), 'en');
    assert.equal(await cdp.evaluate('document.querySelector(".hero h1").textContent'), 'Fractal matter as an executable world');
    assert.equal(await cdp.evaluate('document.querySelector(".hero .lede").textContent.startsWith("A shared material-field model")'), true);
    assert.equal(await cdp.evaluate('/[А-Яа-я]/.test(document.querySelector(".hero .lede").textContent)'), false);
    assert.equal(await cdp.evaluate('document.getElementById("showReferenceGrid").checked'), false);
    assert.equal(await cdp.evaluate('document.getElementById("studioPath").textContent'), restored);
    await cdp.evaluate('(() => { const e=document.getElementById("studioLanguage"); e.value="ru"; e.dispatchEvent(new Event("change", {bubbles:true})); })()');
    assert.equal(await cdp.evaluate('document.getElementById("studioInspectorHeading").textContent'), 'Инспектор');
    assert.equal(await cdp.evaluate('document.getElementById("studioPath").textContent'), restored);
    assert.deepEqual(cdp.exceptions, [], 'browser runtime exceptions');
  } finally {
    chrome?.socket.close();
    chrome?.child.kill('SIGKILL');
    if (server) await new Promise(resolve => server.close(resolve));
    await rm(temp,{recursive:true,force:true});
  }
});
