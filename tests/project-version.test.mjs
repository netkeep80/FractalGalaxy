import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');

async function text(path){
  return readFile(join(root,path),'utf8');
}

test('project version is canonical SemVer and synchronized with package.json',async()=>{
  const [versionJson,packageJson]=await Promise.all([
    text('version.json').then(JSON.parse),
    text('package.json').then(JSON.parse)
  ]);
  assert.match(versionJson.version,/^\d+\.\d+\.\d+$/);
  assert.equal(packageJson.version,versionJson.version);
});

test('version bump helper increments patch exactly once and refuses desynchronization',async()=>{
  const module=await import(pathToFileURL(join(root,'scripts/bump-version.mjs')).href);
  assert.equal(module.nextPatchVersion('0.0.2'),'0.0.3');
  assert.equal(module.nextPatchVersion('12.34.56'),'12.34.57');
  for(const invalid of ['1','1.2','v1.2.3','1.2.3-beta','1.2.-1']){
    assert.throws(()=>module.nextPatchVersion(invalid),/SemVer|version/i);
  }

  const temp=await mkdtemp(join(tmpdir(),'fg-version-'));
  try{
    await writeFile(join(temp,'version.json'),JSON.stringify({version:'2.4.9'},null,2)+'\n');
    await writeFile(join(temp,'package.json'),JSON.stringify({name:'fixture',version:'2.4.9'},null,2)+'\n');
    assert.equal(await module.bumpProjectVersion({root:temp}),'2.4.10');
    assert.equal(JSON.parse(await readFile(join(temp,'version.json'),'utf8')).version,'2.4.10');
    assert.equal(JSON.parse(await readFile(join(temp,'package.json'),'utf8')).version,'2.4.10');

    await writeFile(join(temp,'package.json'),JSON.stringify({name:'fixture',version:'9.9.9'},null,2)+'\n');
    await assert.rejects(()=>module.bumpProjectVersion({root:temp}),/synchron/i);
  }finally{
    await rm(temp,{recursive:true,force:true});
  }
});

test('merged PR workflow serializes patch bumps and protects bootstrap from double increment',async()=>{
  const workflow=await text('.github/workflows/version-bump.yml');
  assert.match(workflow,/pull_request_target:/);
  assert.match(workflow,/types:\s*\[closed\]/);
  assert.match(workflow,/branches:\s*\[main\]/);
  assert.match(workflow,/pull_request\.merged\s*==\s*true/);
  assert.match(workflow,/contents:\s*write/);
  assert.match(workflow,/actions:\s*write/);
  assert.match(workflow,/group:\s*project-version-main/);
  assert.match(workflow,/cancel-in-progress:\s*false/);
  assert.match(workflow,/base\.sha/);
  assert.match(workflow,/version\.json/);
  assert.match(workflow,/scripts\/bump-version\.mjs/);
  assert.match(workflow,/git push origin HEAD:main/);
  assert.match(workflow,/for attempt in 1 2 3/);
  assert.match(workflow,/gh workflow run pages\.yml --ref main/);
});

test('GitHub Pages publishes version metadata and Studio renders project + protocol versions',async()=>{
  const [pages,app]=await Promise.all([
    text('.github/workflows/pages.yml'),
    text('demo/app.js')
  ]);
  assert.match(pages,/version\.json/);
  assert.match(pages,/cp version\.json \.pages\/version\.json/);
  assert.match(app,/fetch\(['"]\.\/version\.json['"]/);
  assert.match(app,/E0_VERSION/);
  assert.match(app,/projectVersion/);
});
