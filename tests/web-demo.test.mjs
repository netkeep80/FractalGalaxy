import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('GitHub Pages Studio publishes live procedural surface/geometry probing', async () => {
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
  assert.match(html, /<canvas id="referenceView"/);
  assert.match(html, /<canvas id="deformedView"/);
  assert.match(html, /id="interfaceSource"/);
  assert.match(html, /id="probeDepth"/);
  assert.match(html, /id="classificationA"/);
  assert.match(html, /id="refinementA"/);
  assert.match(html, /id="presentPatches"/);
  assert.match(html, /id="unresolvedPatches"/);
  assert.match(html, /id="visitedPairs"/);
  assert.match(html, /id="showTriangulation"/);
  assert.match(html, /id="rndAmplitude"/);
  assert.match(html, /id="smoothingWeight"/);
  assert.match(html, /id="influenceMagnitude"/);
  assert.match(html, /id="influenceThreshold"/);
  assert.match(html, /id="influenceCompliance"/);
  assert.match(html, /id="impactGate"/);
  assert.match(html, /type="module" src="\.\/app\.js"/);

  assert.match(app, /from '\.\/src\/fractal-matter\.mjs'/);
  assert.match(app, /classifyMaterialRegion/);
  assert.match(app, /adjacentOctreePath/);
  assert.match(app, /octreeBoundsForPath/);
  assert.match(app, /extractMaterialInterface/);
  assert.match(app, /drawExtractedSurface/);
  assert.match(app, /buildSurfacePatchGeometry/);
  assert.match(app, /triangulateSurfacePatchGeometry/);
  assert.match(app, /makeFractalVertexDeformation/);
  assert.match(app, /currentVertexDeformation/);
  assert.match(app, /evaluateGeometryInfluence/);
  assert.match(app, /currentImpact/);
  assert.doesNotMatch(app, /blendedDeformation/);
  assert.match(app, /selectedPoint/);
  assert.match(app, /pickReferenceCube/);
  assert.match(app, /selectStudioPath/);
  assert.match(app, /applyStudioLocale/);
  assert.match(app, /studioUi = createStudioWorkspace/);
  assert.match(workflow, /studio-picking\.mjs/);
  assert.match(workflow, /studio-i18n\.mjs/);
  assert.match(app, /renderGeometryLab/);
  assert.match(app, /studio\.outside/);
  assert.match(css, /\.lab-grid/);
  assert.match(css, /\.interface-badge/);

  assert.match(facade, /from '\.\/surface\/interface\.mjs'/);
  assert.match(facade, /from '\.\/geometry\/deformation\.mjs'/);
  assert.match(facade, /from '\.\/volume\/refinement\.mjs'/);
  assert.match(facade, /from '\.\/volume\/octree-address\.mjs'/);
  assert.match(workflow, /cp -R src\/\. \.pages\/src\//);
  assert.match(workflow, /deploy-pages/);

  const temp = await mkdtemp(join(tmpdir(), 'fractal-galaxy-pages-'));
  try {
    const assembledSrc = join(temp, 'src');
    await cp(new URL('../src/', import.meta.url), assembledSrc, { recursive: true });
    const deployedFacade = pathToFileURL(join(assembledSrc, 'fractal-matter.mjs')).href;
    const module = await import(deployedFacade);
    assert.equal(typeof module.classifyMaterialRegion, 'function');
    assert.equal(typeof module.adjacentOctreePath, 'function');
    assert.equal(typeof module.classifyMaterialInterface, 'function');
    assert.equal(typeof module.extractMaterialInterface, 'function');
    assert.equal(typeof module.extractInterfacePatches, 'function');
    assert.equal(typeof module.buildSurfacePatchGeometry, 'function');
    assert.equal(typeof module.assertSharedEdgeGeometry, 'function');
    assert.equal(typeof module.triangulateSurfacePatchGeometry, 'function');
    assert.equal(typeof module.makeFractalVertexDeformation, 'function');
    assert.equal(typeof module.setFractalRingVertexOffset, 'function');
    assert.equal(typeof module.evaluateGeometryInfluence, 'function');
    assert.equal(typeof module.geometryInfluenceCreatesOverride, 'function');
    assert.equal(typeof module.cubeToSphereDeformation, 'function');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
