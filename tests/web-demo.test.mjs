import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

  // The facade now has nested E1 imports. Publishing only fractal-matter.mjs would
  // make the browser fail module resolution even when the demo uses only E0 exports.
  assert.match(facade, /from '\.\/procedural\/source-ref\.mjs'/);
  assert.match(facade, /from '\.\/rings\/fractal-ring\.mjs'/);
  assert.match(workflow, /cp -R src\/\. \.pages\/src\//);
  assert.doesNotMatch(workflow, /cp src\/fractal-matter\.mjs \.pages\/src\//);
  assert.match(workflow, /deploy-pages/);
});
