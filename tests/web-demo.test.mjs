import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('GitHub Pages demo uses the real E0 module and has required UI surfaces', async () => {
  const appUrl = new URL('../demo/app.js', import.meta.url);
  execFileSync(process.execPath, ['--check', fileURLToPath(appUrl)], { stdio: 'pipe' });

  const [html, app, css, workflow] = await Promise.all([
    readFile(new URL('../demo/index.html', import.meta.url), 'utf8'),
    readFile(appUrl, 'utf8'),
    readFile(new URL('../demo/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8')
  ]);

  assert.match(html, /<canvas id="view"/);
  assert.match(html, /type="module" src="\.\/app\.js"/);
  assert.match(app, /from '\.\/src\/fractal-matter\.mjs'/);
  assert.match(app, /splitMaterial/);
  assert.match(app, /queryMaterial/);
  assert.match(app, /integrateMass/);
  assert.match(css, /canvas/);

  assert.match(workflow, /cp demo\/index\.html demo\/app\.js demo\/styles\.css \.pages\//);
  assert.match(workflow, /cp src\/fractal-matter\.mjs \.pages\/src\//);
  assert.match(workflow, /deploy-pages/);
});
