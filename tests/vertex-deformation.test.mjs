import test from 'node:test';
import assert from 'node:assert/strict';

import {
  makeReferenceFacePatch,
  subdivideReferenceFacePatch,
  buildSurfacePatchGeometry,
  assertSharedEdgeGeometry,
  cubeToSphereDeformation,
  deterministicVertexRandom,
  radialBoundaryTarget,
  evaluateFractalVertex,
  makeFractalVertexDeformation,
  makeProceduralRef,
  makeFractalRing,
  setFractalRingVertexOffset,
  fractalRingVertexOffset,
  shouldMaterializeFractalRing,
  makeMemoryWorldStore,
  serializePersistentWorldStore,
  loadPersistentWorldStore
} from '../src/fractal-matter.mjs';

test('deterministic RND is a function of canonical shared vertex and seed', () => {
  const point = [1, 0, 0.5];
  const a = deterministicVertexRandom(point, { seed: 123, amplitude: 0.2 });
  const b = deterministicVertexRandom(point, { seed: 123, amplitude: 0.2 });
  const c = deterministicVertexRandom(point, { seed: 124, amplitude: 0.2 });

  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.ok(Math.hypot(...a) <= 0.2 + 1e-15);
});

test('boundary smoothing can damp procedural roughness toward a canonical surface target', () => {
  const reference = [1, 0.5, 0.25];
  const rough = evaluateFractalVertex(reference, {
    baseDeformation: point => cubeToSphereDeformation(point),
    seed: 77,
    randomAmplitude: 0.15,
    smoothingWeight: 0,
    smoothingTarget: ({ reference }) => radialBoundaryTarget(reference, { radius: 1 })
  });
  const smooth = evaluateFractalVertex(reference, {
    baseDeformation: point => cubeToSphereDeformation(point),
    seed: 77,
    randomAmplitude: 0.15,
    smoothingWeight: 1,
    smoothingTarget: ({ reference }) => radialBoundaryTarget(reference, { radius: 1 })
  });

  assert.notDeepEqual(rough.position, smooth.position);
  assert.ok(Math.abs(Math.hypot(...smooth.position) - 1) < 1e-12);
  assert.deepEqual(smooth.position, smooth.smoothingTarget);
});

test('interaction displacement is applied after procedural deformation and smoothing', () => {
  const reference = [1, 0, 0];
  const key = '1,0,0';
  const base = evaluateFractalVertex(reference, {
    baseDeformation: point => cubeToSphereDeformation(point),
    seed: 5,
    randomAmplitude: 0.1,
    smoothingWeight: 1,
    smoothingTarget: ({ reference }) => radialBoundaryTarget(reference)
  });
  const impacted = evaluateFractalVertex(reference, {
    baseDeformation: point => cubeToSphereDeformation(point),
    seed: 5,
    randomAmplitude: 0.1,
    smoothingWeight: 1,
    smoothingTarget: ({ reference }) => radialBoundaryTarget(reference),
    interactionOffsets: { [key]: [0.2, -0.1, 0.05] }
  });

  assert.deepEqual(impacted.interactionOffset, [0.2, -0.1, 0.05]);
  const delta = impacted.position.map((value, i) => value - base.position[i]);
  const expected = [0.2, -0.1, 0.05];
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(delta[i] - expected[i]) < 1e-12);
});

test('shared quadtree edge remains crack-free under RND plus smoothing', () => {
  const bounds = { min: [-1,-1,-1], max: [1,1,1] };
  const [aPatch, bPatch] = subdivideReferenceFacePatch(makeReferenceFacePatch());
  const deformation = makeFractalVertexDeformation({
    baseDeformation: point => cubeToSphereDeformation(point),
    seed: 999,
    randomAmplitude: 0.08,
    smoothingWeight: 0.35,
    smoothingTarget: ({ basePosition }) => basePosition
  });

  const a = buildSurfacePatchGeometry({ bounds, axis:'z', side:1, patch:aPatch, deformation });
  const b = buildSurfacePatchGeometry({ bounds, axis:'z', side:1, patch:bPatch, deformation });

  assert.equal(assertSharedEdgeGeometry(a, b, { epsilon: 0 }), 1);
});

test('persistent interaction vertex offset survives cold WorldStore round-trip', () => {
  const source = makeProceduralRef({ rootId:'planet', address:[1,2,3], algorithmId:'planet', algorithmVersion:'1' });
  const ring = makeFractalRing({ id:'impact-fragment', source });
  const changed = setFractalRingVertexOffset(ring, [1,0,0], [0.125,0,0]);

  assert.equal(shouldMaterializeFractalRing({ geometryOverride:true }), true);
  assert.deepEqual(fractalRingVertexOffset(changed, [1,0,0]), [0.125,0,0]);

  const store = makeMemoryWorldStore({ rings:[changed], resident:'all' });
  const cold = loadPersistentWorldStore(serializePersistentWorldStore(store));
  assert.deepEqual(
    fractalRingVertexOffset(cold.records['impact-fragment'], [1,0,0]),
    [0.125,0,0]
  );
});
