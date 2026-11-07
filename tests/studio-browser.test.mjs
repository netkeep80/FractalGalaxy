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
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
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


test('S1 acceptance: actual pointer targets, synchronized views, hierarchy limits and persistent language', {timeout:45000}, async t => {
  const binary = chromeBinary();
  if (!binary) {
    if (process.env.CI) throw new Error('Chromium required in CI');
    t.skip('Chromium not installed'); return;
  }
  const temp = await mkdtemp(join(tmpdir(), 'fg-studio-acceptance-'));
  let server, chrome;
  try {
    const web = await startServer();
    server = web.server;
    chrome = await startChrome(binary, temp);
    const cdp = connectCdp(chrome.socket);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {width:1600,height:900,deviceScaleFactor:1,mobile:false});
    await cdp.send('Page.navigate', {url:web.url});
    await cdp.until('Boolean(document.getElementById("studioLanguage"))', true, 'workspace ready');

    const inspect = () => cdp.evaluate('(() => ({path:document.getElementById("studioPath").textContent,level:Number(document.getElementById("studioLevel").textContent),face:document.getElementById("studioFace").textContent,material:document.getElementById("classificationA").textContent,probe:Number(document.getElementById("probeDepth").value),seed:document.getElementById("seed").value,mass:document.getElementById("massRoot").textContent}))()');
    const click = async ({x,y}) => {
      await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
      await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
    };
    const locateCanvas = async (id, u=0.5, v=0.5) => cdp.evaluate('(async () => {const el=document.getElementById('+JSON.stringify(id)+'); el.scrollIntoView({block:"center"}); await new Promise(resolve=>requestAnimationFrame(resolve)); const r=el.getBoundingClientRect(); return {x:r.left+r.width*'+u+',y:r.top+r.height*'+v+',width:el.width,height:el.height,over:document.elementFromPoint(r.left+r.width*'+u+',r.top+r.height*'+v+')===el};})()');
    const browserHash = () => cdp.evaluate('(() => {const a=document.getElementById("referenceView").getContext("2d").getImageData(0,0,600,420).data; let h=2166136261; for(let i=0;i<a.length;i+=43)h=Math.imul(h^a[i],16777619); return h>>>0;})()');
    const setControl = (id, value, type='change') => cdp.evaluate('(() => {const el=document.getElementById('+JSON.stringify(id)+'); el.value='+JSON.stringify(String(value))+'; el.dispatchEvent(new Event('+JSON.stringify(type)+',{bubbles:true}));})()');
    const viewRect = await cdp.evaluate('(() => {const lab=document.querySelector(".lab-grid").getBoundingClientRect();const central=document.querySelector(".studio-views").getBoundingClientRect();const right=document.querySelector(".studio-inspector").getBoundingClientRect();return {lab:lab.x,central:central.x,centerRight:central.right,inspector:right.x,inspectorRight:right.right,viewportWidth:innerWidth};})()');
    await t.test('workspace is columns: central view and inspector to the right within screen', () => {
      assert.ok(viewRect.central > viewRect.lab);
      assert.ok(viewRect.inspector >= viewRect.centerRight-2, JSON.stringify(viewRect));
      assert.ok(viewRect.inspectorRight <= viewRect.viewportWidth+2, JSON.stringify(viewRect));
    });

    await t.test('real 3D click selects expected ray-hit cell, not just a syntactically valid address', async () => {
      const hitPoint = await locateCanvas('referenceView');
      assert.ok(hitPoint.over, 'pointer MUST target visible reference canvas in viewport');
      const expected = await cdp.evaluate('(async()=>{const {pickReferenceCube}=await import("/studio-picking.mjs");const {addressForPoint}=await import("/src/fractal-matter.mjs");const el=document.getElementById("referenceView");const h=pickReferenceCube({x:el.width/2,y:el.height/2,width:el.width,height:el.height,camera:{yaw:-0.66,pitch:0.46,zoom:1}});const path=addressForPoint(h.inside,Number(document.getElementById("probeDepth").value)).path;return {path:"/"+path.join("/"),face:h.axis.toUpperCase()+(h.side===1?"+":"−")};})()');
      const before = await inspect();
      assert.notEqual(before.path, expected.path, 'precondition: click must change selection to falsify inert event handling');
      await click(hitPoint);
      assert.equal((await inspect()).path,expected.path);
      assert.equal((await inspect()).face,expected.face);
    });

    await t.test('drag or outside click never silently changes selection', async () => {
      const before = await inspect();
      const hash = await browserHash();
      const p = await locateCanvas('referenceView');
      await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});
      await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x+60,y:p.y+22,button:'left',buttons:1});
      await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x+60,y:p.y+22,button:'left',clickCount:1});
      assert.equal((await inspect()).path,before.path);
      assert.notEqual(await browserHash(),hash,'drag must change camera rendering');
      const outside=await locateCanvas('referenceView',0.025,0.025);
      assert.ok(outside.over,'outside-domain click still targets canvas');
      await click(outside);
      assert.equal((await inspect()).path,before.path);
    });

    await t.test('2D click updates canonical selection, E1 inspector and visible selection marker', async () => {
      const p=await locateCanvas('view',0.18,0.28);
      assert.ok(p.over,'2D click is on-screen and targets actual canvas');
      const selectedBefore = await inspect();
      const sliceHash = () => cdp.evaluate('(() => {const a=document.getElementById("view").getContext("2d").getImageData(0,0,640,640).data;let h=2166136261;for(let i=0;i<a.length;i+=43)h=Math.imul(h^a[i],16777619);return h>>>0;})()');
      const canvasBefore=await sliceHash();
      await click(p);
      const expected = await cdp.evaluate('(async()=>{const {addressForPoint}=await import("/src/fractal-matter.mjs");const c=document.getElementById("view");const r=c.getBoundingClientRect();const x=-1+2*('+p.x+'-r.left)/r.width;const y=1-2*('+p.y+'-r.top)/r.height;const z=Number(document.getElementById("zSlice").value);return "/"+addressForPoint([x,y,z],Number(document.getElementById("probeDepth").value)).path.join("/");})()');
      assert.notEqual(expected,selectedBefore.path,'precondition: 2D click changes octree cell');
      assert.equal((await inspect()).path,expected);
      assert.notEqual(await sliceHash(),canvasBefore,'2D marker must redraw after 2D selection');
    });

    await t.test('parent, breadcrumb root and depth limit are enforced', async () => {
      await cdp.evaluate('document.getElementById("studioBreadcrumbs").querySelectorAll("button")[0].click()');
      assert.equal((await inspect()).path,'/');
      assert.equal((await inspect()).level,0);
      assert.equal(await cdp.evaluate('document.getElementById("studioParent").disabled'),true);
      await setControl('studioChildOctant','7');
      await cdp.evaluate('document.getElementById("studioChildButton").click()');
      assert.equal((await inspect()).path,'/7');
      for (let i=0;i<3;i++) await cdp.evaluate('document.getElementById("studioChildButton").click()');
      const atMax=await inspect();
      assert.equal(atMax.level,4);
      assert.equal(await cdp.evaluate('document.getElementById("studioChildButton").disabled'),true);
      await cdp.evaluate('document.getElementById("studioChildButton").click()');
      assert.equal((await inspect()).path,atMax.path);
    });

    await t.test('view modes keep same selection and camera representation', async () => {
      const before=await inspect();
      for (const mode of ['deformed','split','reference']) {
        await cdp.evaluate('document.querySelector("[data-view='+mode+']").click()');
        assert.equal(await cdp.evaluate('document.querySelector(".studio-views").dataset.mode'),mode);
        assert.equal((await inspect()).path,before.path);
        assert.equal((await inspect()).mass,before.mass);
        assert.equal(await cdp.evaluate('document.querySelector("[data-view='+mode+']").getAttribute("aria-pressed")'),'true');
      }
    });

    await t.test('independent material proof result: same medium NONE, distinct PRESENT, MIXED unresolved', async () => {
      await setControl('interfaceSource','manual');
      await setControl('mediumA','ROCK');
      await setControl('mediumB','ROCK');
      assert.equal(await cdp.evaluate('document.getElementById("interfaceBadge").textContent'),'NONE');
      assert.equal(await cdp.evaluate('document.getElementById("presentPatches").textContent'),'0');
      assert.equal(await cdp.evaluate('document.getElementById("unresolvedPatches").textContent'),'0');
      await setControl('mediumB','EMPTY');
      assert.equal(await cdp.evaluate('document.getElementById("interfaceBadge").textContent'),'PRESENT');
      assert.equal(await cdp.evaluate('document.getElementById("presentPatches").textContent'),'1');
      await setControl('mediumA','MIXED');
      assert.equal(await cdp.evaluate('document.getElementById("interfaceBadge").textContent'),'REFINE');
      assert.equal(await cdp.evaluate('document.getElementById("presentPatches").textContent'),'0');
      assert.equal(await cdp.evaluate('document.getElementById("unresolvedPatches").textContent'),'1');
      await setControl('interfaceSource','procedural');
    });

    await t.test('locale switches without material change and persists across page reload', async () => {
      const before=await inspect();
      const hash=await browserHash();
      await setControl('studioLanguage','en');
      assert.equal(await cdp.evaluate('document.documentElement.lang'),'en');
      assert.equal(await cdp.evaluate('document.getElementById("studioInspectorHeading").textContent'),'Inspector');
      assert.equal((await inspect()).path,before.path);
      assert.equal((await inspect()).mass,before.mass);
      assert.equal((await inspect()).seed,before.seed);
      assert.equal(await browserHash(),hash);
      assert.equal(await cdp.evaluate('localStorage.getItem("fractalgalaxy.locale")'),'en');
      await cdp.send('Page.reload',{ignoreCache:true});
      await cdp.until('document.getElementById("studioLanguage")?.value', 'en','saved English choice');
      assert.equal(await cdp.evaluate('document.getElementById("studioInspectorHeading").textContent'),'Inspector');
      await setControl('studioLanguage','ru');
      assert.equal(await cdp.evaluate('document.getElementById("studioInspectorHeading").textContent'),'Инспектор');
      assert.equal(await cdp.evaluate('localStorage.getItem("fractalgalaxy.locale")'),'ru');
    });

    assert.deepEqual(cdp.exceptions,[], 'no JavaScript exceptions under acceptance scenarios');
  } finally {
    chrome?.socket.close();
    chrome?.child.kill('SIGKILL');
    if(server) await new Promise(resolve => server.close(resolve));
    await rm(temp,{recursive:true,force:true});
  }
});
