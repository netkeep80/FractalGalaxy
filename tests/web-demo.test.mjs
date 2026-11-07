import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('GitHub Pages demo publishes the complete source module graph', async () => {
  const appUrl = new URL('../demo/app.js', import.meta.url);
  execFileSync(process.execPath, ['--check', fileURLToPath(appUrl)], { stdio: 'pipe' });

  const [html, app, css, workflow, facade] = await Promise.all([
    readFile(new URL('../demo/index.html', import.meta.url), 'utf8'),
    readFile(appUrl, 'utf8'),
    readFile(new URL('../demo/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8'),
    readFile(new URL('../src/fractal-matter.mjs', import.meta.url), 'utf8')
  ]);

  assert.match(html, /<canvas id="view"/);
  assert.match(html, /type="module" src="\.\/app\.js"/);
  assert.match(app, /from '\.\/src\/fractal-matter\.mjs'/);
  assert.match(app, /splitMaterial/);
  assert.match(app, /queryMaterial/);
  assert.match(app, /integrateMass/);
  assert.match(css, /canvas/);

  assert.match(facade, /from '\.\/procedural\/source-ref\.mjs'/);
  assert.match(facade, /from '\.\/rings\/fractal-ring\.mjs'/);
  assert.match(facade, /from '\.\/storage\/world-store\.mjs'/);
  assert.match(workflow, /cp -R src\/\. \.pages\/src\//);
  assert.doesNotMatch(workflow, /cp src\/fractal-matter\.mjs \.pages\/src\//);
  assert.match(workflow, /deploy-pages/);

  const temp = await mkdtemp(join(tmpdir(), 'fractal-galaxy-pages-'));
  try {
    const assembledSrc = join(temp, 'src');
    await cp(new URL('../src/', import.meta.url), assembledSrc, { recursive: true });
    const deployedFacade = pathToFileURL(join(assembledSrc, 'fractal-matter.mjs')).href;
    const module = await import(deployedFacade);
    assert.equal(typeof module.makeProceduralRef, 'function');
    assert.equal(typeof module.makeMemoryWorldStore, 'function');
    assert.equal(typeof module.resolveM, 'function');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
