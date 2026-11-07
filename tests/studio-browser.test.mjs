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

async function startServer({appSuffix=''}={}) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = decodeURIComponent(url.pathname);
      const fromSrc = path === '/src' || path.startsWith('/src/');
      const fromProjectRoot = path === '/version.json';
      const base = resolve(root, fromProjectRoot ? '.' : (fromSrc ? 'src' : 'demo'));
      const rel = fromProjectRoot
        ? 'version.json'
        : (fromSrc ? path.replace(/^\/src\/?/, '') : (path === '/' ? 'index.html' : path.slice(1)));
      const full = resolve(base, rel);
      if (!full.startsWith(base + '/') || full.includes('/.git/')) {
        res.writeHead(403); res.end(); return;
      }
      let bytes = await readFile(full);
      if(appSuffix && full===resolve(root,'demo','app.js')){
        bytes=Buffer.concat([bytes,Buffer.from('\n'+appSuffix+'\n')]);
      }
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
    const expectedProjectVersion=JSON.parse(await readFile(join(root,'version.json'),'utf8')).version;
    await cdp.until(
      'document.getElementById("version").dataset.projectVersion === '+JSON.stringify(expectedProjectVersion),
      true,
      'project version badge'
    );
    assert.equal(
      await cdp.evaluate('document.getElementById("version").textContent'),
      'v'+expectedProjectVersion+' · e0-prototype-1'
    );
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


test('S2 rendering regressions: fresh mode roundtrip and curved local depth ordering', {timeout:30000}, async t => {
  const binary=chromeBinary();
  if(!binary){
    if(process.env.CI)throw new Error('Chromium required in CI');
    t.skip('Chromium not installed');return;
  }
  const temp=await mkdtemp(join(tmpdir(),'fg-s2-rendering-'));
  let server,chrome;
  try{
    const web=await startServer();server=web.server;
    chrome=await startChrome(binary,temp);
    const cdp=connectCdp(chrome.socket);
    await cdp.send('Page.enable');await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1600,height:900,deviceScaleFactor:1,mobile:false});
    await cdp.send('Page.navigate',{url:web.url});
    await cdp.until('Boolean(document.getElementById("studioLanguage"))',true,'workspace ready');
    const setControl=(id,value,type='change')=>cdp.evaluate('(() => {const el=document.getElementById('+JSON.stringify(id)+');el.value='+JSON.stringify(String(value))+';el.dispatchEvent(new Event('+JSON.stringify(type)+',{bubbles:true}));})()');
    await setControl('probeDepth','0','input');
    await setControl('interfaceSource','manual');
    await setControl('mediumA','ROCK');await setControl('mediumB','EMPTY');
    await setControl('faceAxis','z');await setControl('faceSide','1');
    await setControl('deformBlend','0','input');await setControl('rndAmplitude','0','input');
    await setControl('smoothingWeight','0','input');await setControl('influenceMagnitude','0','input');
    await cdp.evaluate('document.querySelector("button[data-surface-mode=surface]").click()');
    const before=await cdp.evaluate('document.getElementById("referenceView").toDataURL()');
    await cdp.evaluate('document.querySelector("button[data-surface-mode=debug]").click()');
    await cdp.evaluate('document.querySelector("button[data-surface-mode=surface]").click()');
    assert.equal(await cdp.evaluate('document.getElementById("referenceView").toDataURL()'),before,
      'first Surface→Diagnostics→Surface roundtrip on a fresh Canvas context must be pixel-identical');

    await setControl('deformBlend','1','input');
    await setControl('smoothingWeight','.2','input');
    await cdp.evaluate('document.querySelector("[data-view=deformed]").click()');
    const point=await cdp.evaluate('(async()=>{const c=document.getElementById("deformedView");c.scrollIntoView({block:"center"});await new Promise(requestAnimationFrame);const r=c.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()');
    await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x-174,y:point.y-151,button:'left',buttons:1});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x-174,y:point.y-151,button:'left',clickCount:1});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:point.x-174,y:point.y-151,deltaX:0,deltaY:-Math.log(10/7)*1000});
    const pixel=await cdp.evaluate('[...document.getElementById("deformedView").getContext("2d").getImageData(194,335,1,1).data]');
    assert.deepEqual(pixel,[29,144,109,255],
      'nearest curved local triangle must supply the opaque overlap pixel');

    await cdp.evaluate('document.getElementById("resetCamera").click()');
    await cdp.evaluate(`(() => {
      window.__fgGapPaths=[];
      if(window.__fgGapCaptureInstalled)return;
      window.__fgGapCaptureInstalled=true;
      const proto=CanvasRenderingContext2D.prototype;
      const begin=proto.beginPath,move=proto.moveTo,line=proto.lineTo,stroke=proto.stroke;
      proto.beginPath=function(){this.__fgAuditPath=[];return begin.call(this);};
      proto.moveTo=function(x,y){this.__fgAuditPath?.push([x,y]);return move.call(this,x,y);};
      proto.lineTo=function(x,y){this.__fgAuditPath?.push([x,y]);return line.call(this,x,y);};
      proto.stroke=function(){
        if(String(this.strokeStyle).toLowerCase()==='#f3b35c'){
          window.__fgGapPaths.push({canvas:this.canvas.id,points:[...(this.__fgAuditPath??[])]});
        }
        return stroke.call(this);
      };
    })()`);
    await setControl('mediumA','MIXED');
    const gapEvidence=await cdp.evaluate(`(() => {
      const paths=(window.__fgGapPaths??[]).filter(item=>item.canvas==='deformedView');
      const path=paths.find(item=>item.points.length===8);
      const yaw=-.66,pitch=.46,cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
      const x=0,y=-Math.SQRT1_2,z=Math.SQRT1_2;
      const x1=x*cy+z*sy,z1=-x*sy+z*cy,y1=y*cp-z1*sp;
      const scale=420*.30;
      const expected=[300+x1*scale,210-y1*scale];
      const distance=path?Math.min(...path.points.map(p=>Math.hypot(p[0]-expected[0],p[1]-expected[1]))):Infinity;
      return {count:path?.points.length??0,distance};
    })()`);
    assert.equal(gapEvidence.count,8,'depth-1 unresolved Canvas outline must include canonical edge midpoints');
    assert.ok(gapEvidence.distance<1e-7,'unresolved Canvas path must pass through the canonical deformed midpoint');
    assert.deepEqual(cdp.exceptions,[],'no JavaScript exceptions under S2 rendering regressions');
  }finally{
    chrome?.socket.close();chrome?.child.kill('SIGKILL');
    if(server)await new Promise(resolve=>server.close(resolve));
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
      await cdp.evaluate('document.querySelector("button[data-surface-mode=debug]").click()');
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
      await cdp.evaluate('document.querySelector("button[data-surface-mode=surface]").click()');
    });

    await t.test('S2 browser proof: local filled mesh, diagnostic mode and explicit uncertainty',async()=>{
      // The preceding test may have persisted English; this scenario tests RU first.
      await setControl('studioLanguage','ru');
      await setControl('probeDepth','0','input');
      await setControl('interfaceSource','manual');
      await setControl('mediumA','ROCK');
      await setControl('mediumB','ROCK');
      await cdp.evaluate('document.querySelector("button[data-surface-mode=surface]").click()');
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

      await cdp.evaluate('document.querySelector("button[data-surface-mode=debug]").click()');
      assert.equal(await get('document.querySelector("button[data-surface-mode=debug]").getAttribute("aria-pressed")'),'true');
      assert.equal(await get('document.getElementById("studioMeshTriangles").textContent'),'8');
      assert.notEqual(await png(),painted,'debug patch overlay must differ from filled view');
      assert.equal((await inspect()).path,original.path);
      assert.equal(await get('document.getElementById("studioRingCount").textContent'),ringCount);
      await cdp.evaluate('document.querySelector("button[data-surface-mode=surface]").click()');
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
      assert.equal(await get('document.querySelector("button[data-surface-mode=surface]").textContent'),'Surface');
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
      await cdp.evaluate('document.querySelector("button[data-surface-mode=surface]").click()');
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
      await cdp.evaluate(`(() => {
        window.__fgSurfaceFillPaths=[];
        if(window.__fgSurfaceFillCaptureInstalled)return;
        window.__fgSurfaceFillCaptureInstalled=true;
        const proto=CanvasRenderingContext2D.prototype;
        const begin=proto.beginPath,move=proto.moveTo,line=proto.lineTo,fill=proto.fill;
        proto.beginPath=function(){this.__fgSurfaceFillPath=[];return begin.call(this);};
        proto.moveTo=function(x,y){this.__fgSurfaceFillPath?.push([x,y]);return move.call(this,x,y);};
        proto.lineTo=function(x,y){this.__fgSurfaceFillPath?.push([x,y]);return line.call(this,x,y);};
        proto.fill=function(...args){
          if(this.canvas?.id==='deformedView'&&this.__fgSurfaceFillPath?.length===3){
            window.__fgSurfaceFillPaths.push(this.__fgSurfaceFillPath.map(point=>[...point]));
          }
          return fill.apply(this,args);
        };
      })()`);
      const captureFilledSurface=()=>cdp.evaluate(`(() => {
        const count=Number(document.getElementById('studioMeshTriangles').textContent);
        const paths=(window.__fgSurfaceFillPaths??[]).slice(-count)
          .map(path=>path.map(([x,y])=>[Number(x.toFixed(9)),Number(y.toFixed(9))]));
        const frequencies=new Map();
        for(const path of paths)for(const point of path){
          const key=point.join(',');
          const entry=frequencies.get(key)??{point,count:0};
          entry.count++;frequencies.set(key,entry);
        }
        const center=[...frequencies.values()].sort((a,b)=>b.count-a.count)[0]?.point??null;
        return {paths,center};
      })()`);
      // Force one clean post-hook frame. The oracle records only the actual
      // proven triangle fill paths, excluding axes, handles and frame strokes.
      await cdp.evaluate('document.getElementById("resetCamera").click()');
      const filledBeforeDrag=await captureFilledSurface();
      assert.equal(filledBeforeDrag.paths.length,8,'baseline fill-only capture must contain exactly 8 proven triangles');
      assert.ok(filledBeforeDrag.center,'baseline canonical center must be present in the filled mesh');
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
      const filledAfterPersist=await captureFilledSurface();
      assert.equal(filledAfterPersist.paths.length,8,'persisted fill-only capture must contain exactly 8 proven triangles');
      assert.notDeepEqual(filledAfterPersist.paths,filledBeforeDrag.paths,
        'post-release proven triangle fill must retain the persisted WorldStore displacement');
      assert.ok(Math.hypot(
        filledAfterPersist.center[0]-filledBeforeDrag.center[0],
        filledAfterPersist.center[1]-filledBeforeDrag.center[1]
      )>1,'persisted canonical center must move in the final fill, not only in preview/handle pixels');
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
      assert.deepEqual((await captureFilledSurface()).paths,filledAfterPersist.paths,
        'Split must preserve the final proven triangle fill geometry, not only the composite canvas');
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


test('S3 acceptance: regional surface mode and canonical nonlinear topology grid are live in Studio', {timeout:45000}, async t => {
  const binary=chromeBinary();
  if(!binary){
    if(process.env.CI)throw new Error('Chromium required in CI');
    t.skip('Chromium not installed');return;
  }
  const temp=await mkdtemp(join(tmpdir(),'fg-s3-regional-'));
  let server,chrome;
  try{
    const web=await startServer();server=web.server;
    chrome=await startChrome(binary,temp);
    const cdp=connectCdp(chrome.socket);
    await cdp.send('Page.enable');await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1600,height:900,deviceScaleFactor:1,mobile:false});
    await cdp.send('Page.navigate',{url:web.url});
    await cdp.until('Boolean(document.getElementById("studioLanguage"))',true,'workspace ready');
    const setControl=(id,value,type='change')=>cdp.evaluate('(() => {const el=document.getElementById('+JSON.stringify(id)+');el.value='+JSON.stringify(String(value))+';el.dispatchEvent(new Event('+JSON.stringify(type)+',{bubbles:true}));})()');

    await setControl('interfaceSource','procedural');
    await setControl('fixture','solid');
    await setControl('deformBlend','1','input');
    const before=await cdp.evaluate('(() => ({path:document.getElementById("studioPath").textContent,mass:document.getElementById("massRoot").textContent}))()');
    await cdp.evaluate('document.querySelector("button[data-surface-mode=regional]").click()');
    const regional=await cdp.evaluate('(() => ({mode:document.querySelector(".studio-views").dataset.surfaceMode,triangles:Number(document.getElementById("studioMeshTriangles").textContent),vertices:Number(document.getElementById("studioMeshVertices").textContent),faces:Number(document.getElementById("studioRegionalFaces").textContent),unresolved:Number(document.getElementById("studioRegionalUnresolved").textContent),path:document.getElementById("studioPath").textContent,mass:document.getElementById("massRoot").textContent}))()');
    assert.equal(regional.mode,'regional');
    assert.ok(regional.triangles>0&&regional.vertices>0&&regional.faces>0);
    assert.equal(regional.unresolved,0);
    assert.equal(regional.path,before.path);
    assert.equal(regional.mass,before.mass);

    await setControl('fixture','height');
    const procedural=await cdp.evaluate('(() => ({triangles:Number(document.getElementById("studioMeshTriangles").textContent),unresolved:Number(document.getElementById("studioRegionalUnresolved").textContent),status:document.getElementById("studioSurfaceStatus").textContent,path:document.getElementById("studioPath").textContent}))()');
    assert.ok(procedural.triangles>0,'procedural regional view must retain proven geometry');
    assert.ok(procedural.unresolved>0,'finite procedural regional proof must expose unresolved gaps');
    assert.ok(procedural.status.length>0);
    assert.equal(procedural.path,before.path);

    await cdp.evaluate(`(() => {
      window.__fgS3GridPaths=[];
      if(window.__fgS3GridCaptureInstalled)return;
      window.__fgS3GridCaptureInstalled=true;
      const proto=CanvasRenderingContext2D.prototype;
      const begin=proto.beginPath,move=proto.moveTo,line=proto.lineTo,stroke=proto.stroke;
      proto.beginPath=function(){this.__fgS3Path=[];return begin.call(this);};
      proto.moveTo=function(x,y){this.__fgS3Path?.push([x,y]);return move.call(this,x,y);};
      proto.lineTo=function(x,y){this.__fgS3Path?.push([x,y]);return line.call(this,x,y);};
      proto.stroke=function(){
        if(this.canvas?.id==='deformedView'&&this.__fgS3Path?.length>2){
          window.__fgS3GridPaths.push(this.__fgS3Path.map(point=>[...point]));
        }
        return stroke.call(this);
      };
    })()`);
    await cdp.evaluate('(() => {const e=document.getElementById("showReferenceGrid");e.checked=true;e.dispatchEvent(new Event("change",{bubbles:true}));})()');
    const grid=await cdp.evaluate('(() => ({count:(window.__fgS3GridPaths??[]).length,max:Math.max(0,...(window.__fgS3GridPaths??[]).map(path=>path.length))}))()');
    assert.ok(grid.count>0,'deformed topology grid must draw sampled polylines');
    assert.ok(grid.max>=9,'grid line must contain canonical intermediate samples, not only two endpoints');
    assert.deepEqual(cdp.exceptions,[],'no JavaScript exceptions in S3 regional mode');
  }finally{
    chrome?.socket.close();chrome?.child.kill('SIGKILL');
    if(server)await new Promise(resolve=>server.close(resolve));
    await rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:150});
  }
});


test('S3 adversarial regressions: discovery, regional edit, all topology paths and shared proof-gap sampling', {timeout:75000}, async t => {
  const binary=chromeBinary();
  if(!binary){
    if(process.env.CI)throw new Error('Chromium required in CI');
    t.skip('Chromium not installed');return;
  }
  const auditSuffix=[
    "const __fgOriginalBuildModel=buildModel;",
    "globalThis.__fgS3Audit={",
    " snapshot:()=>({probe:currentProbeContext(),store:demoWorldStore,local:currentSurfaceMesh.deformed,regional:currentRegionalMesh.deformed,extraction:currentRegionalExtraction,selected:selectedVertexReference}),",
    " project:p=>rotateProject(p,deformedCanvas),",
    " deform:p=>currentVertexDeformation()(p),",
    " handles:()=>selectedFaceHandles().map(v=>({...v,screen:rotateProject(currentVertexDeformation()(v.reference),deformedCanvas)})),",
    " redraw:()=>renderGeometryLab(),",
    " material:mat=>{buildModel=()=>({...__fgOriginalBuildModel(),root:mat});renderGeometryLab();},",
    " restore:()=>{buildModel=__fgOriginalBuildModel;renderGeometryLab();}",
    "};"
  ].join("\n");
  const temp=await mkdtemp(join(tmpdir(),'fg-s3-adversarial-'));
  let server,chrome;
  try{
    const web=await startServer({appSuffix:auditSuffix});server=web.server;
    chrome=await startChrome(binary,temp);
    const cdp=connectCdp(chrome.socket);
    await cdp.send('Page.enable');await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1600,height:1100,deviceScaleFactor:1,mobile:false});
    await cdp.send('Page.navigate',{url:web.url});
    await cdp.until('Boolean(globalThis.__fgS3Audit)',true,'S3 audit hook ready');
    const setControl=(id,value,type='change')=>cdp.evaluate('(() => {const el=document.getElementById('+JSON.stringify(id)+');el.value='+JSON.stringify(String(value))+';el.dispatchEvent(new Event('+JSON.stringify(type)+',{bubbles:true}));})()');
    const setCheckbox=(id,value)=>cdp.evaluate('(() => {const el=document.getElementById('+JSON.stringify(id)+');el.checked='+JSON.stringify(Boolean(value))+';el.dispatchEvent(new Event("change",{bubbles:true}));})()');
    const clearCapture=()=>cdp.evaluate("(() => {globalThis.__fgS3Fills=[];globalThis.__fgS3Strokes=[];})()");
    const installCapture=()=>cdp.evaluate("(() => {globalThis.__fgS3Fills=[];globalThis.__fgS3Strokes=[];if(globalThis.__fgS3CaptureInstalled)return;globalThis.__fgS3CaptureInstalled=true;const p=CanvasRenderingContext2D.prototype,o={beginPath:p.beginPath,moveTo:p.moveTo,lineTo:p.lineTo,closePath:p.closePath,arc:p.arc,fill:p.fill,stroke:p.stroke};p.beginPath=function(){this.__fgS3Path=[];this.__fgS3Arc=false;this.__fgS3Closed=false;return o.beginPath.call(this);};p.moveTo=function(x,y){this.__fgS3Path?.push([x,y]);return o.moveTo.call(this,x,y);};p.lineTo=function(x,y){this.__fgS3Path?.push([x,y]);return o.lineTo.call(this,x,y);};p.closePath=function(){this.__fgS3Closed=true;return o.closePath.call(this);};p.arc=function(...args){this.__fgS3Arc=true;return o.arc.apply(this,args);};p.fill=function(...args){if(this.canvas?.id==='deformedView'&&!this.__fgS3Arc&&this.__fgS3Path?.length===3)globalThis.__fgS3Fills.push(this.__fgS3Path.map(point=>[...point]));return o.fill.apply(this,args);};p.stroke=function(...args){if(this.canvas?.id==='deformedView'&&!this.__fgS3Arc)globalThis.__fgS3Strokes.push({points:(this.__fgS3Path??[]).map(point=>[...point]),style:String(this.strokeStyle).toLowerCase(),width:this.lineWidth,dash:this.getLineDash(),closed:this.__fgS3Closed});return o.stroke.apply(this,args);};})()");
    await installCapture();

    // S3-AUD-03: selected diagnostic topology uses the same canonical crossing.
    await setControl('probeDepth','0','input');
    await setControl('interfaceSource','manual');
    await setControl('mediumA','ROCK');await setControl('mediumB','EMPTY');
    await setControl('faceAxis','z');await setControl('faceSide','1');
    await setControl('deformBlend','1','input');await setControl('rndAmplitude','0','input');
    await setControl('smoothingWeight','0','input');await setControl('influenceMagnitude','0','input');
    await setCheckbox('showReferenceGrid',false);
    await cdp.evaluate('document.querySelector("[data-view=deformed]").click()');
    await cdp.evaluate('document.querySelector("button[data-surface-mode=debug]").click()');
    await clearCapture();await cdp.evaluate('__fgS3Audit.redraw()');
    const diagnostic=await cdp.evaluate("(() => {const center=__fgS3Audit.project([0,0,1]);const lines=(globalThis.__fgS3Strokes??[]).filter(path=>/102,\\s*235,\\s*190/.test(path.style));const distances=lines.map(line=>Math.min(...line.points.map(point=>Math.hypot(point[0]-center.x,point[1]-center.y))));return{count:lines.length,lengths:lines.map(line=>line.points.length),distances,central:distances.filter(distance=>distance<1e-7).length};})()");
    assert.equal(diagnostic.count,6,'selected face must draw all six canonical topology polylines');
    assert.ok(diagnostic.lengths.every(length=>length>2),'every selected topology line must contain canonical intermediate vertices');
    assert.equal(diagnostic.central,2,'the two central selected topology lines must share the canonical crossing');

    // S3-REAUD-01: root and fine selected grids share the exact depth-4 crossing.
    await setCheckbox('showReferenceGrid',true);
    await setControl('rndAmplitude','.12','input');
    await setControl('smoothingWeight','.2','input');
    await cdp.evaluate('(() => {const e=document.getElementById("studioChildOctant");for(const branch of ["7","6","7"]){e.value=branch;document.getElementById("studioChildButton").click();}})()');
    assert.equal(await cdp.evaluate('document.getElementById("studioPath").textContent'),'/7/6/7');
    await clearCapture();await cdp.evaluate('__fgS3Audit.redraw()');
    const deepCrossing=await cdp.evaluate("(() => {const p=__fgS3Audit.project(__fgS3Audit.deform([.5,.875,1]));const strokes=globalThis.__fgS3Strokes??[];const root=strokes.filter(path=>/121,\\s*150,\\s*174/.test(path.style));const selected=strokes.filter(path=>/102,\\s*235,\\s*190/.test(path.style));const nearest=paths=>Math.min(...paths.flatMap(path=>path.points.map(point=>Math.hypot(point[0]-p.x,point[1]-p.y))));return{rootCount:root.length,selectedCount:selected.length,rootDistance:nearest(root),selectedDistance:nearest(selected)};})()");
    assert.ok(deepCrossing.rootCount>0&&deepCrossing.selectedCount>0);
    assert.ok(deepCrossing.rootDistance<1e-7,'root topology grid must include the fine canonical crossing');
    assert.ok(deepCrossing.selectedDistance<1e-7,'selected fine topology grid must include the same canonical crossing');
    await cdp.evaluate('document.getElementById("studioParent").click();document.getElementById("studioParent").click();document.getElementById("studioParent").click()');
    await setCheckbox('showReferenceGrid',false);

    // S3-AUD-04: unresolved perimeter and proven boundary use one target-depth sampling contract.
    await setControl('interfaceSource','procedural');await setControl('fixture','height');
    await setControl('rndAmplitude','.12','input');await setControl('smoothingWeight','.2','input');
    await setControl('influenceMagnitude','0','input');
    await cdp.evaluate('document.querySelector("button[data-surface-mode=regional]").click()');
    await clearCapture();await cdp.evaluate('__fgS3Audit.redraw()');
    const gap=await cdp.evaluate("(async()=>{const c=await import('/src/fractal-matter.mjs'),s=__fgS3Audit.snapshot(),mesh=s.regional,ex=s.extraction,gaps=(globalThis.__fgS3Strokes??[]).filter(path=>path.style==='#f3b35c'&&path.closed),emap=new Map();for(let ti=0;ti<mesh.triangles.length;ti++){const tri=mesh.triangles[ti];for(let j=0;j<3;j++){const a=mesh.vertices[tri.indices[j]],b=mesh.vertices[tri.indices[(j+1)%3]],key=[a.key,b.key].sort().join('|');if(!emap.has(key))emap.set(key,[]);emap.get(key).push({ti,a,b});}}function corners(item){const box=c.octreeBoundsForPath(item.pathA),ai=['x','y','z'].indexOf(item.axis),ts=[0,1,2].filter(i=>i!==ai);return [[0,0],[1,0],[1,1],[0,1]].map(([u,v])=>{const p=[0,0,0];p[ai]=item.side===1?box.max[ai]:box.min[ai];p[ts[0]]=box.min[ts[0]]+u*(box.max[ts[0]]-box.min[ts[0]]);p[ts[1]]=box.min[ts[1]]+v*(box.max[ts[1]]-box.min[ts[1]]);return p;});}let witness=null;for(let i=0;i<ex.unresolved.length;i++){const item=ex.unresolved[i],vs=corners(item),path=gaps[i];if(!path)continue;for(let edge=0;edge<4;edge++){const a=vs[edge],b=vs[(edge+1)%4],key=[c.referenceVertexKey(a),c.referenceVertexKey(b)].sort().join('|'),tri=(emap.get(key)??[]).find(entry=>mesh.patches[mesh.triangles[entry.ti].patchIndex].axis===item.axis);if(!tri)continue;const samplesPerEdge=path.points.length/4,pa=__fgS3Audit.project(tri.a.position),pb=__fgS3Audit.project(tri.b.position),vx=pb.x-pa.x,vy=pb.y-pa.y;for(let sample=0;sample<samplesPerEdge;sample++){const painted=path.points[edge*samplesPerEdge+sample],t=Math.max(0,Math.min(1,((painted[0]-pa.x)*vx+(painted[1]-pa.y)*vy)/(vx*vx+vy*vy))),distance=Math.hypot(painted[0]-pa.x-t*vx,painted[1]-pa.y-t*vy);if(!witness||distance>witness.distance)witness={distance,targetDepth:mesh.stats.targetDepth,proofDepth:item.depth,samplesPerEdge};}}}return{witness,gaps:gaps.length,unresolved:ex.unresolved.length};})()");
    assert.ok(gap.gaps>0&&gap.unresolved>0);
    assert.ok(gap.witness);
    assert.ok(gap.witness.distance<1e-7,'regional unresolved contour must lie on the actual proven boundary polyline');

    // S3-AUD-01: material-aware discovery finds an internal D island inside a coarse regional cell.
    await clearCapture();
    const island=await cdp.evaluate("(async()=>{const c=await import('/src/fractal-matter.mjs');const material=c.makeMaterial({id:'island',gamma:c.makeGamma({fixture:'solid'}),edits:[{path:[],value:c.EMPTY},{path:[0,7,0,7],value:c.solid('rock',1)}]});__fgS3Audit.material(material);globalThis.__fgS3Fills=[];__fgS3Audit.redraw();const s=__fgS3Audit.snapshot();return{present:s.extraction.present.length,unresolved:s.extraction.unresolved.length,unresolvedCells:s.extraction.unresolvedCells?.length??0,triangles:s.regional.triangles.length,fills:globalThis.__fgS3Fills.length,point:c.queryMaterial(material,[-.3125,-.3125,-.3125])};})()");
    assert.equal(island.point.kind,'SOLID');
    assert.equal(island.present,6);
    assert.equal(island.unresolved,0);
    assert.equal(island.unresolvedCells,0);
    assert.equal(island.triangles,12);
    assert.equal(island.fills,island.triangles,'Regional acceptance must observe actual triangle fill paths');

    // S3-AUD-02: a native Regional vertex drag changes the persisted final fill and survives Split.
    await cdp.evaluate('__fgS3Audit.restore()');
    await setControl('interfaceSource','procedural');await setControl('fixture','solid');
    await setControl('probeDepth','0','input');await setControl('faceAxis','z');await setControl('faceSide','1');
    await setControl('deformBlend','0','input');await setControl('rndAmplitude','0','input');
    await setControl('smoothingWeight','0','input');await setControl('influenceMagnitude','0','input');
    await setControl('influenceThreshold','.045','input');await setControl('influenceCompliance','1','input');
    await cdp.evaluate('(() => {const e=document.getElementById("studioChildOctant");e.value="7";document.getElementById("studioChildButton").click();e.value="7";document.getElementById("studioChildButton").click();})()');
    await cdp.evaluate('document.querySelector("button[data-surface-mode=regional]").click()');
    await setCheckbox('studioVertexEdit',true);
    await clearCapture();await cdp.evaluate('__fgS3Audit.redraw()');
    const beforeEdit=await cdp.evaluate("(() => {const s=__fgS3Audit.snapshot(),count=s.regional.triangles.length;return{regional:s.regional,fills:(globalThis.__fgS3Fills??[]).slice(-count),rings:Object.keys(s.store.records).length,hasVertex:s.regional.vertices.some(vertex=>vertex.key==='0.75,0.75,1')};})()");
    assert.equal(beforeEdit.rings,0);
    assert.equal(beforeEdit.hasVertex,true,'editable canonical center must be sampled by Regional mesh');
    assert.equal(beforeEdit.fills.length,beforeEdit.regional.triangles.length);
    const hit=await cdp.evaluate("(async()=>{const canvas=document.getElementById('deformedView');canvas.scrollIntoView({block:'center'});await new Promise(requestAnimationFrame);const h=__fgS3Audit.handles().find(vertex=>vertex.key==='0.75,0.75,1'),rect=canvas.getBoundingClientRect(),x=rect.left+h.screen.x*rect.width/canvas.width,y=rect.top+h.screen.y*rect.height/canvas.height;return{x,y,over:document.elementFromPoint(x,y)===canvas};})()");
    assert.equal(hit.over,true,'Regional edit pointer must target the visible deformed canvas');
    await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:hit.x,y:hit.y,button:'left',clickCount:1});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:hit.x+65,y:hit.y-15,button:'left',buttons:1});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:hit.x+65,y:hit.y-15,button:'left',clickCount:1});
    await clearCapture();await cdp.evaluate('__fgS3Audit.redraw()');
    const afterEdit=await cdp.evaluate("(() => {const s=__fgS3Audit.snapshot(),count=s.regional.triangles.length;return{regional:s.regional,fills:(globalThis.__fgS3Fills??[]).slice(-count),rings:Object.keys(s.store.records).length};})()");
    assert.equal(afterEdit.rings,1);
    assert.notDeepEqual(afterEdit.regional,beforeEdit.regional,'persisted offset must change the actual Regional mesh');
    assert.notDeepEqual(afterEdit.fills,beforeEdit.fills,'persisted offset must change post-release Regional triangle fill paths');
    await clearCapture();await cdp.evaluate('document.getElementById("studioSplitRing").click();globalThis.__fgS3Fills=[];__fgS3Audit.redraw()');
    const afterSplit=await cdp.evaluate("(() => {const s=__fgS3Audit.snapshot(),count=s.regional.triangles.length;return{regional:s.regional,fills:(globalThis.__fgS3Fills??[]).slice(-count)};})()");
    assert.deepEqual(afterSplit.regional,afterEdit.regional);
    assert.deepEqual(afterSplit.fills,afterEdit.fills);

    assert.deepEqual(cdp.exceptions,[],'no JavaScript exceptions under S3 adversarial regressions');
  }finally{
    chrome?.socket.close();chrome?.child.kill('SIGKILL');
    if(server)await new Promise(resolve=>server.close(resolve));
    await rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:150});
  }
});


test('PERF camera-only regional interaction is cached, coalesced and sub-100ms', {timeout:60000}, async t => {
  const binary=chromeBinary();
  if(!binary){
    if(process.env.CI)throw new Error('Chromium required in CI');
    t.skip('Chromium not installed');return;
  }
  const temp=await mkdtemp(join(tmpdir(),'fg-perf-camera-'));
  let server,chrome;
  try{
    const web=await startServer();server=web.server;
    chrome=await startChrome(binary,temp);
    const cdp=connectCdp(chrome.socket);
    await cdp.send('Page.enable');await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
    await cdp.send('Page.navigate',{url:web.url});
    await cdp.until('Boolean(document.getElementById("studioLanguage"))',true,'workspace ready');
    await cdp.until('Boolean(globalThis.__fractalGalaxyPerformance)',true,'performance instrumentation');

    await cdp.evaluate('document.querySelector("button[data-surface-mode=regional]").click()');
    await cdp.until('Number(document.getElementById("studioMeshTriangles").textContent)>1000',true,'regional mesh ready');

    const checksum=id=>cdp.evaluate('(()=>{const c=document.getElementById('+JSON.stringify(id)+'),d=c.getContext("2d").getImageData(0,0,c.width,c.height).data;let h=2166136261>>>0;for(let i=0;i<d.length;i+=97){h^=d[i];h=Math.imul(h,16777619)>>>0;}return h;})()');

    // FG-PERF-001: a hidden viewport must be repainted from the current shared camera when revealed.
    await cdp.evaluate('document.querySelector("button[data-view=reference]").click()');
    const hiddenBefore=await checksum('deformedView');
    const switchBefore=await cdp.evaluate('__fractalGalaxyPerformance.snapshot()');
    await cdp.evaluate('(async()=>{const canvas=document.getElementById("referenceView");canvas.scrollIntoView({block:"center"});await new Promise(requestAnimationFrame);canvas.dispatchEvent(new WheelEvent("wheel",{deltaY:-80,bubbles:true,cancelable:true}));await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);})()');
    const hiddenAfterCamera=await checksum('deformedView');
    assert.equal(hiddenAfterCamera,hiddenBefore,'hidden deformed viewport must stay untouched while reference-only view is painted');
    await cdp.evaluate('document.querySelector("button[data-view=deformed]").click()');
    await cdp.evaluate('new Promise(requestAnimationFrame)');
    const revealed=await checksum('deformedView');
    assert.notEqual(revealed,hiddenBefore,'revealed viewport must repaint using the current camera, not expose a stale frame');
    const switchAfter=await cdp.evaluate('__fractalGalaxyPerformance.snapshot()');
    assert.equal(switchAfter.fullBuilds,switchBefore.fullBuilds,'viewport switch must not rebuild world/proof state');
    assert.equal(switchAfter.regionalExtractions,switchBefore.regionalExtractions);
    assert.equal(switchAfter.regionalMeshAssemblies,switchBefore.regionalMeshAssemblies);

    const before=await cdp.evaluate('__fractalGalaxyPerformance.snapshot()');
    const eventResult=await cdp.evaluate('(async()=>{const canvas=document.getElementById("deformedView");canvas.scrollIntoView({block:"center"});await new Promise(requestAnimationFrame);for(let i=0;i<24;i++){canvas.dispatchEvent(new WheelEvent("wheel",{deltaY:i%2?6:-5,bubbles:true,cancelable:true}));}await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return __fractalGalaxyPerformance.snapshot();})()');

    assert.equal(eventResult.fullBuilds,before.fullBuilds,
      'camera-only wheel events must not rebuild material/proof state');
    assert.equal(eventResult.regionalExtractions,before.regionalExtractions,
      'camera-only events must perform zero regional extractions after warmup');
    assert.equal(eventResult.regionalMeshAssemblies,before.regionalMeshAssemblies,
      'camera-only events must perform zero regional mesh assemblies after warmup');
    assert.ok(eventResult.viewRenders-before.viewRenders<=2,
      '24 same-task camera events must coalesce to at most two view paints');
    assert.ok(eventResult.lastVisibilityAllPairs>0);
    assert.ok(eventResult.lastVisibilityCandidates*100<eventResult.lastVisibilityAllPairs,
      'regional painter narrow-phase must cut candidate pairs by >=100x: '+JSON.stringify(eventResult));
    assert.ok(eventResult.lastVisibilityBroadPhaseOperations<eventResult.lastVisibilityAllPairs/20,
      'reported broad-phase tree/sort work must remain far below all-pairs: '+JSON.stringify(eventResult));

    // Independent event-to-frame timings: 20 distinct camera redraws, not one lucky lastViewMs sample.
    const distribution=await cdp.evaluate('(async()=>{const canvas=document.getElementById("deformedView"),samples=[];for(let i=0;i<20;i++){await new Promise(requestAnimationFrame);const start=performance.now();canvas.dispatchEvent(new WheelEvent("wheel",{deltaY:i%2?3:-3,bubbles:true,cancelable:true}));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));samples.push(performance.now()-start);}const sorted=[...samples].sort((a,b)=>a-b);return{samples,p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],max:sorted.at(-1),snapshot:__fractalGalaxyPerformance.snapshot()};})()');
    assert.ok(distribution.p50<=100,'20-frame median camera latency must be <=100ms: '+JSON.stringify(distribution));
    assert.ok(distribution.p95<=150,'camera p95 must remain bounded in CI: '+JSON.stringify(distribution));
    assert.equal(distribution.snapshot.fullBuilds,before.fullBuilds);
    assert.equal(distribution.snapshot.regionalExtractions,before.regionalExtractions);
    assert.equal(distribution.snapshot.regionalMeshAssemblies,before.regionalMeshAssemblies);

    t.diagnostic('PERF_COUNTERS '+JSON.stringify({
      triangles:Number(await cdp.evaluate('document.getElementById("studioMeshTriangles").textContent')),
      before,eventResult,distribution
    }));
    assert.deepEqual(cdp.exceptions,[]);
  }finally{
    chrome?.socket.close();chrome?.child.kill('SIGKILL');
    if(server)await new Promise(resolve=>server.close(resolve));
    await rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:150});
  }
});
