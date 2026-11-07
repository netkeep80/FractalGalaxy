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
    await rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:150});
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
      await setControl('probeDepth','0','input');
      await setControl('interfaceSource','manual');
      await setControl('mediumA','ROCK');
      await setControl('mediumB','ROCK');
      assert.equal(await cdp.evaluate('document.getElementById("interfaceBadge").dataset.kind'),'NONE');
      assert.equal(await cdp.evaluate('document.getElementById("presentPatches").textContent'),'0');
      assert.equal(await cdp.evaluate('document.getElementById("unresolvedPatches").textContent'),'0');
      await setControl('mediumB','EMPTY');
      assert.equal(await cdp.evaluate('document.getElementById("interfaceBadge").dataset.kind'),'PRESENT');
      assert.equal(await cdp.evaluate('document.getElementById("presentPatches").textContent'),'1');
      await setControl('mediumA','MIXED');
      assert.equal(await cdp.evaluate('document.getElementById("interfaceBadge").dataset.kind'),'REFINE');
      assert.equal(await cdp.evaluate('document.getElementById("presentPatches").textContent'),'0');
      assert.equal(await cdp.evaluate('document.getElementById("unresolvedPatches").textContent'),'1');
      await setControl('interfaceSource','procedural');
    });

    await t.test('surface proof and unresolved rendering have distinct visual effects, and only proven patches triangulate', async () => {
      await cdp.evaluate('document.querySelector("[data-surface-mode=debug]").click()');
      const hash = () => cdp.evaluate('(() => {const a=document.getElementById("referenceView").getContext("2d").getImageData(0,0,600,420).data;let h=2166136261;for(let i=0;i<a.length;i+=4)h=Math.imul(h^a[i],16777619);return h>>>0;})()');
      const setTriangles = checked => cdp.evaluate('(() => {const e=document.getElementById("showTriangulation");e.checked='+checked+';e.dispatchEvent(new Event("change",{bubbles:true}));})()');
      await setControl('interfaceSource','manual');
      await setControl('mediumA','ROCK');
      await setControl('mediumB','ROCK');
      const none = await hash();
      await setControl('mediumB','EMPTY');
      const proven = await hash();
      assert.notEqual(none,proven,'PRESENT must draw a different interface than NONE');
      await setTriangles(false);
      const noTriangles = await hash();
      assert.notEqual(noTriangles,proven,'proven patch should show deterministic triangulation');
      await setTriangles(true);
      await setControl('mediumA','MIXED');
      const unresolvedWithTriangles = await hash();
      await setTriangles(false);
      assert.equal(await hash(),unresolvedWithTriangles,'unresolved patch must not be triangulated');
      assert.notEqual(unresolvedWithTriangles,proven,'unresolved and proven must look different');
      await setTriangles(true);
      await setControl('interfaceSource','procedural');
      await cdp.evaluate('document.querySelector("[data-surface-mode=surface]").click()');
    });

    await t.test('S2 browser proof: local filled mesh, diagnostic mode and explicit uncertainty',async()=>{
      await setControl('probeDepth','0','input');
      await setControl('interfaceSource','manual');
      await setControl('mediumA','ROCK');
      await setControl('mediumB','ROCK');
      await cdp.evaluate('document.querySelector("[data-surface-mode=surface]").click()');
      const get=expression=>cdp.evaluate(expression);
      const png=()=>get('document.getElementById("referenceView").toDataURL()');
      const initial=await png();
      const original=await inspect();
      const ringCount=await get('document.getElementById("studioRingCount").textContent');
      assert.equal(await get('document.getElementById("studioMeshTriangles").textContent'),'0');
      assert.equal(await get('document.getElementById("studioMeshVertices").textContent'),'0');
      assert.match(await get('document.getElementById("studioSurfaceStatus").textContent'),/нет/i);

      await setControl('mediumB','EMPTY');
      assert.equal(await get('document.getElementById("studioMeshTriangles").textContent'),'8');
      assert.equal(await get('document.getElementById("studioMeshVertices").textContent'),'9');
      assert.equal(await get('document.getElementById("presentPatches").textContent'),'1');
      assert.equal(await get('document.getElementById("unresolvedPatches").textContent'),'0');
      const painted=await png();
      assert.notEqual(painted,initial,'filled proven surface must change the actual canvas pixels');
      const surfaceStatus=await get('document.getElementById("studioSurfaceStatus").textContent');
      assert.match(surfaceStatus,/доказан/);

      await cdp.evaluate('document.querySelector("[data-surface-mode=debug]").click()');
      assert.equal(await get('document.querySelector("[data-surface-mode=debug]").getAttribute("aria-pressed")'),'true');
      assert.equal(await get('document.getElementById("studioMeshTriangles").textContent'),'8');
      assert.notEqual(await png(),painted,'debug patch overlay must differ from filled view');
      assert.equal((await inspect()).path,original.path);
      assert.equal(await get('document.getElementById("studioRingCount").textContent'),ringCount);
      await cdp.evaluate('document.querySelector("[data-surface-mode=surface]").click()');
      assert.equal(await png(),painted,'switching display mode must recover bit-identical proven surface pixels');

      await setControl('mediumA','MIXED');
      assert.equal(await get('document.getElementById("studioMeshTriangles").textContent'),'0');
      assert.equal(await get('document.getElementById("studioMeshVertices").textContent'),'0');
      assert.equal(await get('document.getElementById("unresolvedPatches").textContent'),'1');
      assert.match(await get('document.getElementById("studioSurfaceStatus").textContent'),/уточнен/i);
      assert.notEqual(await png(),painted,'proof gap should be visibly distinct from solid fill');
      const unresolved=await png();
      await setControl('studioLanguage','en');
      assert.equal(await get('document.getElementById("studioLegendProven").textContent'),'Proven material interface');
      assert.equal(await get('document.getElementById("studioLegendUnresolved").textContent'),'Unresolved proof region');
      assert.equal(await get('document.querySelector("[data-surface-mode=surface]").textContent'),'Surface');
      assert.equal(await png(),unresolved,'translation must not alter geometry pixels');
      await setControl('studioLanguage','ru');
      assert.equal(await png(),unresolved);
      assert.equal((await inspect()).mass,original.mass);
      assert.equal(await get('document.getElementById("studioRingCount").textContent'),ringCount);
      await setControl('interfaceSource','procedural');
    });

    await t.test('diagnostic text is translated but its canonical classification remains constant', async () => {
      await setControl('interfaceSource','manual');
      await setControl('mediumA','ROCK');
      await setControl('mediumB','EMPTY');
      await setControl('studioLanguage','ru');
      assert.match(await cdp.evaluate('document.getElementById("classificationA").textContent'),/^Однородная область/);
      assert.equal(await cdp.evaluate('document.getElementById("interfaceBadge").dataset.kind'),'PRESENT');
      assert.equal(await cdp.evaluate('document.getElementById("interfaceBadge").textContent'),'Граница обнаружена');
      await setControl('studioLanguage','en');
      assert.match(await cdp.evaluate('document.getElementById("classificationA").textContent'),/^Homogeneous region/);
      assert.equal(await cdp.evaluate('document.getElementById("interfaceBadge").dataset.kind'),'PRESENT');
      assert.equal(await cdp.evaluate('document.getElementById("interfaceBadge").textContent'),'Interface present');
      await setControl('studioLanguage','ru');
      await setControl('interfaceSource','procedural');
    });

    await t.test('English locale has no leftover Cyrillic in user-facing control and diagnostic labels', async () => {
      await setControl('studioLanguage','en');
      const leftovers = await cdp.evaluate('(() => {const selectors=[".hero .eyebrow",".hero h1",".hero .lede",".controls label span",".controls h2",".inspector h2",".inspector dt",".inspector .note",".viewport-head h2",".viewport-head p",".lab-controls label span",".lab-controls h3",".lab-controls p.note",".section-heading h2",".section-heading p",".studio-inspector dt",".studio-inspector h3",".studio-inspector h4",".studio-inspector .lab-readout span",".studio-toolbar button",".studio-language span",".studio-picking-help",".explain-strip span","footer"];return selectors.flatMap(sel=>[...document.querySelectorAll(sel)].filter(el=>/[А-Яа-яЁё]/.test(el.textContent)).map(el=>({selector:sel,text:el.textContent.trim().slice(0,90)})));})()');
      assert.deepEqual(leftovers,[], 'English user-facing labels must be translated');
      assert.equal(await cdp.evaluate('document.getElementById("view").getAttribute("aria-label")'),'Material-field slice');
      assert.equal(await cdp.evaluate('document.getElementById("studioChildButton").getAttribute("aria-label")'),'Enter selected octant');
      await setControl('studioLanguage','ru');
      assert.equal(await cdp.evaluate('document.getElementById("studioChildButton").getAttribute("aria-label")'),'Перейти в выбранный октант');
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

    await t.test('octree tree lazy expansion, keyboard support and canonical selection', async () => {
      await cdp.evaluate('document.getElementById("studioHierarchyTab_octree").click()');
      const initial=await cdp.evaluate('({role:document.getElementById("studioHierarchyTree").getAttribute("role"),nodes:document.querySelectorAll("#studioHierarchyTree [role=treeitem]").length,selected:[...document.querySelectorAll("#studioHierarchyTree [aria-selected=true]")].map(x=>x.dataset.treeKey)})');
      assert.equal(initial.role,'tree');
      assert.ok(initial.nodes<150,'octree hierarchy must be lazy rather than eagerly creating all 8^4 cells');
      assert.deepEqual(initial.selected,['octree:'+(await inspect()).path]);

      await cdp.evaluate('(() => {const root=[...document.querySelectorAll("#studioHierarchyTree [data-tree-key]")].find(x=>x.dataset.treeKey==="octree:/"); root.focus();root.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft",bubbles:true}));})()');
      assert.equal(await cdp.evaluate('document.querySelectorAll("#studioHierarchyTree [role=treeitem]").length'),1);
      assert.equal(await cdp.evaluate('document.querySelector("#studioHierarchyTree [role=treeitem]").getAttribute("aria-expanded")'),'false');
      await cdp.evaluate('(() => {const root=document.querySelector("#studioHierarchyTree [role=treeitem]");root.focus();root.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}));})()');
      assert.equal(await cdp.evaluate('document.querySelector("#studioHierarchyTree [role=treeitem]").getAttribute("aria-expanded")'),'true');
      const nodesAfter=await cdp.evaluate('document.querySelectorAll("#studioHierarchyTree [role=treeitem]").length');
      assert.ok(nodesAfter>=9 && nodesAfter<150);
      await cdp.evaluate('(() => {const child=[...document.querySelectorAll("#studioHierarchyTree [data-tree-key]")].find(x=>x.dataset.treeKey==="octree:/6");child.click();})()');
      assert.equal((await inspect()).path,'/6');
      assert.equal((await inspect()).level,1);
      assert.equal(await cdp.evaluate('document.querySelector("#studioHierarchyTree [aria-selected=true]").dataset.treeKey'),'octree:/6');
      assert.equal(await cdp.evaluate('document.getElementById("studioBreadcrumbs").querySelectorAll("button").length'),2);
    });

    await t.test('Split tree identifies current owner leaves and does not impersonate physical parenthood',async()=>{
      await cdp.evaluate('document.getElementById("studioHierarchyTab_split").click()');
      const names=await cdp.evaluate('[...document.querySelectorAll("#studioHierarchyTree [data-tree-key]")].map(x=>x.dataset.treeKey)');
      assert.deepEqual(names,['split:root','split:left','split:right','split:rb','split:rt']);
      assert.match(await cdp.evaluate('document.querySelector(".studio-tree-note").textContent'),/не физическое/);
      await cdp.evaluate('(() => {const leaf=[...document.querySelectorAll("#studioHierarchyTree [data-tree-key]")].find(x=>x.dataset.treeKey==="split:rb");leaf.click();})()');
      assert.equal(await cdp.evaluate('document.getElementById("mode").value'),'owners');
      assert.equal(await cdp.evaluate('document.getElementById("owner").textContent'),'rb');
      const selected=await inspect();
      assert.match(selected.path,/^\/[0-7]+/);
      assert.equal(await cdp.evaluate('document.querySelector("#studioHierarchyTree [aria-selected=true]").dataset.treeKey'),'split:rb');
    });


    await t.test('populated FractalRing tree shows physical and source paths without loading unloaded records', async()=>{
      const result=await cdp.evaluate("(async()=>{\n  const {createStudioHierarchyUI}=await import('/studio-tree.mjs');\n  const core=await import('/src/fractal-matter.mjs');\n  const {translate}=await import('/studio-i18n.mjs');\n  const store=core.makeMemoryWorldStore({resident:['planet-ring'],rings:[\n    {id:'planet-ring',source:{rootId:'planet',address:[],algorithmId:'g',algorithmVersion:'v1'}},\n    {id:'fragment',physicalParentId:'planet-ring',\n      source:{rootId:'planet',address:[5,2,7,3],algorithmId:'g',algorithmVersion:'v1'}}\n  ]});\n  const mount=document.createElement('section');\n  const widget=createStudioHierarchyUI({\n    mount,translate:key=>translate('ru',key),getLocale:()=> 'ru',\n    getSelectedPath:()=>[],getSelectedOwner:()=>null,\n    getSplitModel:()=>({root:{id:'root'},left:{id:'left'},rb:{id:'rb'},rt:{id:'rt'}}),\n    getWorldStore:()=>store,core,\n    onSelectOctree:()=>{throw Error('unexpected octree selection');},\n    onSelectSplit:()=>{throw Error('unexpected split selection');}\n  });\n  widget.open('physical');\n  const physicalRoot=[...mount.querySelectorAll('[data-tree-key]')].map(el=>el.dataset.treeKey);\n  mount.querySelector('[data-tree-toggle=\"ring:planet-ring\"]').click();\n  const physicalChild=[...mount.querySelectorAll('[data-tree-key]')].find(el=>el.dataset.treeKey==='ring:fragment');\n  const unloadedLabel=physicalChild.textContent;\n  physicalChild.click();\n  const details=mount.querySelector('#studioRingDetails').textContent;\n  widget.open('source');\n  const seen=[];\n  for(const address of ['/','/5','/5/2','/5/2/7','/5/2/7/3']){\n    const item=[...mount.querySelectorAll('[data-tree-kind=\"source\"]')].find(el=>\n      el.querySelector('small')?.textContent.trim().endsWith('· '+address));\n    if(!item)throw Error('Missing virtual source address '+address);\n    seen.push(address);\n    const toggle=item.closest('.studio-tree-row').querySelector('[data-tree-toggle]');\n    if(toggle&&!toggle.disabled)toggle.click();\n  }\n  const sourceChild=[...mount.querySelectorAll('[data-tree-key]')].find(el=>el.dataset.treeKey==='ring:fragment');\n  sourceChild?.click();\n  return {physicalRoot,unloadedLabel,details,seen,sourceChild:Boolean(sourceChild),\n    after:core.worldStoreStats(store),sourceDetail:mount.querySelector('#studioRingDetails').textContent};\n})()");
      assert.deepEqual(result.physicalRoot,['ring:planet-ring']);
      assert.match(result.unloadedLabel,/Выгружен/);
      assert.match(result.details,/planet\/5\/2\/7\/3/);
      assert.deepEqual(result.seen,['/','/5','/5/2','/5/2/7','/5/2/7/3']);
      assert.equal(result.sourceChild,true);
      assert.match(result.sourceDetail,/fragment/);
      assert.deepEqual(result.after,{persisted:2,resident:1,unloaded:1});
    });

    await t.test('physical and procedural FractalRing viewers display honest empty state',async()=>{
      const before=await inspect();
      for(const mode of ['physical','source']){
        await cdp.evaluate('document.getElementById("studioHierarchyTab_'+mode+'").click()');
        assert.equal(await cdp.evaluate('document.querySelectorAll("#studioHierarchyTree [role=treeitem]").length'),0);
        assert.match(await cdp.evaluate('document.querySelector(".studio-tree-note").textContent'),/нет сохранённых FractalRing/);
        assert.equal(await cdp.evaluate('document.querySelector("#studioHierarchyTab_'+mode+'").getAttribute("aria-selected")'),'true');
        assert.equal((await inspect()).path,before.path);
      }
      await setControl('studioLanguage','en');
      assert.match(await cdp.evaluate('document.querySelector(".studio-tree-note").textContent'),/No persisted FractalRing/);
      await setControl('studioLanguage','ru');
      await cdp.evaluate('document.getElementById("studioHierarchyTab_octree").click()');
      assert.equal(await cdp.evaluate('document.querySelector("#studioHierarchyTree [aria-selected=true]").dataset.treeKey'),'octree:'+(await inspect()).path);
    });


    await t.test('real 3D vertex drag: threshold gating, impact tree, FractalRing split and pixel-exact geometry preservation',async()=>{
      await cdp.evaluate('document.getElementById("resetCamera").click()');
      await setControl('probeDepth','0','input');
      await setControl('interfaceSource','manual');
      await setControl('mediumA','ROCK');
      await setControl('mediumB','EMPTY');
      await cdp.evaluate('document.querySelector("[data-surface-mode=surface]").click()');
      await setControl('faceAxis','z');
      await setControl('faceSide','1');
      await setControl('deformBlend','0','input');
      await setControl('rndAmplitude','0','input');
      await setControl('smoothingWeight','0','input');
      await setControl('influenceMagnitude','0','input');
      await setControl('influenceThreshold','0.045','input');
      await setControl('influenceCompliance','1','input');
      await cdp.evaluate('(() => {const e=document.getElementById("studioVertexEdit");e.checked=true;e.dispatchEvent(new Event("change",{bubbles:true}));})()');
      assert.equal(await cdp.evaluate('document.querySelector(".studio-views").dataset.mode'),'deformed');
      const point=await cdp.evaluate('(async()=>{const {referenceProjection}=await import("/studio-picking.mjs");const c=document.getElementById("deformedView");c.scrollIntoView({block:"center"});await new Promise(requestAnimationFrame);const r=c.getBoundingClientRect();const p=referenceProjection([0,0,1],{width:c.width,height:c.height,camera:{yaw:-.66,pitch:.46,zoom:1}});const x=r.left+p.x*r.width/c.width,y=r.top+p.y*r.height/c.height;return {x,y,over:document.elementFromPoint(x,y)===c};})()');
      assert.equal(point.over,true,'target must be on the visible actual deformed canvas');
      const moveDrag=async(dx,dy)=>{
        await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});
        await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x+dx,y:point.y+dy,button:'left',buttons:1});
        await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x+dx,y:point.y+dy,button:'left',clickCount:1});
      };
      assert.equal(await cdp.evaluate('document.getElementById("studioRingCount").textContent'),'0');
      assert.equal(await cdp.evaluate('document.getElementById("studioMeshTriangles").textContent'),'8');
      const meshBeforeDrag=await cdp.evaluate('document.getElementById("deformedView").toDataURL()');
      await moveDrag(2,0);
      assert.equal(await cdp.evaluate('document.getElementById("studioVertexKey").textContent'),'0,0,1');
      assert.equal(await cdp.evaluate('document.getElementById("studioRingCount").textContent'),'0','subthreshold gesture must not materialize');
      assert.equal(await cdp.evaluate('document.querySelector("#studioSplitRing").disabled'),true);
      const beforeCancel=await cdp.evaluate('document.getElementById("deformedView").toDataURL()');
      await cdp.evaluate('document.getElementById("deformedView").addEventListener("pointerdown",e=>window.__fgCancelPointerId=e.pointerId,{once:true})');
      await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});
      await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x+66,y:point.y+11,button:'left',buttons:1});
      await cdp.evaluate('(() => {const c=document.getElementById("deformedView");c.dispatchEvent(new PointerEvent("pointercancel",{pointerId:window.__fgCancelPointerId,bubbles:true}));})()');
      await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x+66,y:point.y+11,button:'left',clickCount:1});
      assert.equal(await cdp.evaluate('document.getElementById("studioRingCount").textContent'),'0','cancelled gesture must not create a ring');
      assert.equal(await cdp.evaluate('document.getElementById("deformedView").toDataURL()'),beforeCancel,'cancelled gesture must restore preview');
      await moveDrag(70,-18);
      assert.notEqual(await cdp.evaluate('document.getElementById("deformedView").toDataURL()'),meshBeforeDrag,
        'dragged canonical center must change filled surface pixels');
      assert.equal(await cdp.evaluate('document.getElementById("studioMeshTriangles").textContent'),'8');
      assert.equal(await cdp.evaluate('document.getElementById("studioRingCount").textContent'),'1','active gesture must create FractalRing');
      assert.equal(await cdp.evaluate('document.querySelector("#studioSplitRing").disabled'),false);
      assert.equal(await cdp.evaluate('document.getElementById("studioHierarchyTab_impact").getAttribute("aria-selected")'),'true');
      assert.ok(await cdp.evaluate('document.querySelectorAll("#studioHierarchyTree [data-tree-kind=ring]").length')>=1);
      const deformedBeforeSplit=await cdp.evaluate('document.getElementById("deformedView").toDataURL()');
      await cdp.evaluate('document.getElementById("studioSplitRing").click()');
      assert.equal(await cdp.evaluate('document.getElementById("studioRingCount").textContent'),'9');
      assert.equal(await cdp.evaluate('document.getElementById("studioHierarchyTab_physical").getAttribute("aria-selected")'),'true');
      assert.equal(await cdp.evaluate('document.querySelectorAll("#studioHierarchyTree [data-tree-kind=ring]").length'),9);
      assert.equal(await cdp.evaluate('document.getElementById("deformedView").toDataURL()'),deformedBeforeSplit,
        'split must not move canonical deformed vertex on screen');
      await cdp.evaluate('document.getElementById("studioHierarchyTab_impact").click()');
      assert.ok(await cdp.evaluate('document.querySelectorAll("#studioHierarchyTree [data-tree-kind=ring]").length')>=2);
      await cdp.evaluate('document.getElementById("studioHierarchyTab_source").click()');
      assert.ok(await cdp.evaluate('document.querySelectorAll("#studioHierarchyTree [data-tree-kind=ring]").length')>=1);
      await setControl('studioLanguage','en');
      assert.equal(await cdp.evaluate('document.getElementById("studioVertexEditLabel").textContent'),'Edit vertices');
      assert.equal(await cdp.evaluate('document.getElementById("studioSplitRing").textContent'),'Split ring');
      await setControl('studioLanguage','ru');
      assert.equal(await cdp.evaluate('document.getElementById("studioSplitRing").textContent'),'Разделить кольцо');
      await setControl('interfaceSource','procedural');
    });

    assert.deepEqual(cdp.exceptions,[], 'no JavaScript exceptions under acceptance scenarios');
  } finally {
    chrome?.socket.close();
    chrome?.child.kill('SIGKILL');
    if(server) await new Promise(resolve => server.close(resolve));
    await rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:150});
  }
});
