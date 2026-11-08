import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,extname} from 'node:path';
import {createServer} from 'node:http';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function chromeBinary(){
  for(const binary of ['google-chrome','chromium','chromium-browser']){
    if(spawnSync('which',[binary]).status===0)return binary;
  }
  throw new Error('Chromium required for BASE→HEAD benchmark');
}
async function startServer(root){
  const server=createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost');
      const path=decodeURIComponent(url.pathname);
      const fromSrc=path==='/src'||path.startsWith('/src/');
      const fromRoot=path==='/version.json';
      const base=resolve(root,fromRoot?'.':(fromSrc?'src':'demo'));
      const rel=fromRoot?'version.json':(fromSrc?path.replace(/^\/src\/?/,''):(path==='/'?'index.html':path.slice(1)));
      const full=resolve(base,rel);
      if(!full.startsWith(base+'/')||full.includes('/.git/')){res.writeHead(403);res.end();return;}
      const bytes=await readFile(full);
      const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json'}[extname(full)]||'text/plain';
      res.writeHead(200,{'content-type':mime+'; charset=utf-8','cache-control':'no-store'});
      res.end(bytes);
    }catch(error){res.writeHead(404);res.end(String(error.message));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {server,url:'http://127.0.0.1:'+server.address().port+'/'};
}
async function startChrome(binary,dir){
  const child=spawn(binary,[
    '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    '--no-first-run','--no-default-browser-check','--remote-debugging-port=0',
    '--user-data-dir='+dir,'about:blank'
  ],{stdio:'ignore'});
  let port;
  for(let i=0;i<100;i++){
    if(child.exitCode!==null)throw new Error('Chromium exited early');
    try{
      const active=await readFile(join(dir,'DevToolsActivePort'),'utf8');
      port=Number(active.split('\n')[0]);
      if(port>0)break;
    }catch{}
    await sleep(100);
  }
  if(!port)throw new Error('Chromium DevTools port unavailable');
  const list=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  const socketUrl=list.find(item=>item.type==='page')?.webSocketDebuggerUrl;
  if(!socketUrl)throw new Error('Chromium page target unavailable');
  const socket=new WebSocket(socketUrl);
  await new Promise((resolve,reject)=>{
    socket.addEventListener('open',resolve,{once:true});
    socket.addEventListener('error',reject,{once:true});
  });
  return {child,socket};
}
function connectCdp(socket){
  let id=0;
  const pending=new Map(),exceptions=[];
  socket.addEventListener('message',event=>{
    const message=JSON.parse(event.data);
    if(message.method==='Runtime.exceptionThrown')exceptions.push(message.params?.exceptionDetails?.text??'JavaScript exception');
    if(!message.id||!pending.has(message.id))return;
    const entry=pending.get(message.id);pending.delete(message.id);
    if(message.error)entry.reject(new Error(message.error.message));else entry.resolve(message.result);
  });
  const send=(method,params={})=>new Promise((resolve,reject)=>{
    const requestId=++id;pending.set(requestId,{resolve,reject});
    socket.send(JSON.stringify({id:requestId,method,params}));
  });
  const evaluate=async expression=>{
    const response=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(response.exceptionDetails)throw new Error(response.exceptionDetails.exception?.description??response.exceptionDetails.text);
    return response.result?.value;
  };
  const until=async(expression,expected,label)=>{
    for(let i=0;i<200;i++){
      if(await evaluate(expression)===expected)return;
      await sleep(100);
    }
    throw new Error('condition not reached: '+label);
  };
  return {send,evaluate,until,exceptions};
}
function percentile(sorted,fraction){
  return sorted[Math.min(sorted.length-1,Math.floor(sorted.length*fraction))];
}
async function measure(root,binary,profile,samples,mode){
  const web=await startServer(root);
  const chrome=await startChrome(binary,profile);
  try{
    const cdp=connectCdp(chrome.socket);
    await cdp.send('Page.enable');await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
    await cdp.send('Page.navigate',{url:web.url});
    await cdp.until('Boolean(document.getElementById("studioLanguage"))',true,'workspace ready');
    await cdp.evaluate('document.querySelector("button[data-surface-mode=regional]").click()');
    await cdp.until('Number(document.getElementById("studioMeshTriangles").textContent)>1000',true,'regional mesh ready');
    await cdp.evaluate('document.querySelector("button[data-view=deformed]").click()');
    await cdp.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const triangles=await cdp.evaluate('Number(document.getElementById("studioMeshTriangles").textContent)');
    let timings;
    if(mode==='zoom'){
      timings=await cdp.evaluate('(async()=>{const canvas=document.getElementById("deformedView"),samples=[];for(let i=0;i<'+samples+';i++){await new Promise(requestAnimationFrame);const start=performance.now();canvas.dispatchEvent(new WheelEvent("wheel",{deltaY:3,bubbles:true,cancelable:true}));await new Promise(requestAnimationFrame);samples.push(performance.now()-start);}return samples;})()');
    }else if(mode==='rotate'){
      const hit=await cdp.evaluate('(()=>{const c=document.getElementById("deformedView");c.scrollIntoView({block:"center"});const r=c.getBoundingClientRect();globalThis.__fgRotateTiming={start:0,samples:[]};document.addEventListener("pointermove",()=>{globalThis.__fgRotateTiming.start=performance.now();},{capture:true});c.addEventListener("pointermove",()=>{const start=globalThis.__fgRotateTiming.start;requestAnimationFrame(()=>globalThis.__fgRotateTiming.samples.push(performance.now()-start));});return{x:r.left+r.width*.5,y:r.top+r.height*.5};})()');
      await cdp.evaluate('new Promise(requestAnimationFrame)');
      await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:hit.x,y:hit.y,button:'left',clickCount:1});
      for(let i=0;i<samples;i++){
        await cdp.send('Input.dispatchMouseEvent',{
          type:'mouseMoved',x:hit.x+8*(i+1),y:hit.y+((i%2)?6:-6),button:'left',buttons:1
        });
        await cdp.until('globalThis.__fgRotateTiming.samples.length === '+(i+1),true,'rotation paint '+(i+1));
      }
      timings=await cdp.evaluate('globalThis.__fgRotateTiming.samples');
      await cdp.send('Input.dispatchMouseEvent',{
        type:'mouseReleased',x:hit.x+8*samples,y:hit.y,button:'left',clickCount:1
      });
    }else throw new Error('unknown benchmark mode '+mode);
    if(cdp.exceptions.length)throw new Error('browser exceptions: '+JSON.stringify(cdp.exceptions));
    const sorted=[...timings].sort((a,b)=>a-b);
    const perf=await cdp.evaluate('globalThis.__fractalGalaxyPerformance?.snapshot?.()??null');
    return {
      mode,triangles,samples:timings.length,min:sorted[0],
      p50:percentile(sorted,.5),p95:percentile(sorted,.95),max:sorted.at(-1),perf
    };
  }finally{
    chrome.socket.close();chrome.child.kill('SIGKILL');
    await new Promise(resolve=>web.server.close(resolve));
  }
}

const baseSha=process.argv[2];
if(!baseSha)throw new Error('usage: node scripts/perf-base-head-browser.mjs <base-sha>');
const repoRoot=process.cwd();
const temp=await mkdtemp(join(tmpdir(),'fg-perf-base-head-'));
const baseRoot=join(temp,'base');
const binary=chromeBinary();
try{
  execFileSync('git',['worktree','add','--detach',baseRoot,baseSha],{cwd:repoRoot,stdio:'inherit'});
  const headZoom=await measure(repoRoot,binary,join(temp,'chrome-head-zoom'),20,'zoom');
  const headRotate=await measure(repoRoot,binary,join(temp,'chrome-head-rotate'),20,'rotate');
  // BASE is intentionally bounded: pre-optimization camera redraw can take many seconds.
  const baseZoom=await measure(baseRoot,binary,join(temp,'chrome-base-zoom'),3,'zoom');
  const baseRotate=await measure(baseRoot,binary,join(temp,'chrome-base-rotate'),3,'rotate');
  for(const [base,head] of [[baseZoom,headZoom],[baseRotate,headRotate]]){
    if(base.triangles!==head.triangles)throw new Error('BASE/HEAD benchmark geometry mismatch: '+JSON.stringify({base,head}));
  }
  const speedupZoom=baseZoom.p50/headZoom.p50;
  const speedupRotate=baseRotate.p50/headRotate.p50;
  const result={
    baseSha,headSha:execFileSync('git',['rev-parse','HEAD'],{cwd:repoRoot,encoding:'utf8'}).trim(),
    zoom:{base:baseZoom,head:headZoom,speedup:speedupZoom},
    rotate:{base:baseRotate,head:headRotate,speedup:speedupRotate}
  };
  console.log('PERF_BASE_HEAD '+JSON.stringify(result));
  for(const metric of [result.zoom,result.rotate]){
    if(metric.head.p50>100)throw new Error('HEAD median camera redraw exceeds 100ms: '+JSON.stringify(result));
    if(metric.head.p95>150)throw new Error('HEAD p95 camera redraw exceeds 150ms: '+JSON.stringify(result));
    if(metric.speedup<100)throw new Error('controlled BASE→HEAD median speedup is below 100x: '+JSON.stringify(result));
  }
}finally{
  try{execFileSync('git',['worktree','remove','--force',baseRoot],{cwd:repoRoot,stdio:'ignore'});}catch{}
  await rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:200});
}
