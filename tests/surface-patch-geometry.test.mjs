import test from 'node:test';
import assert from 'node:assert/strict';

import {
  makeReferenceFacePatch,
  subdivideReferenceFacePatch,
  buildSurfacePatchGeometry,
  sharedSurfaceEdges,
  assertSharedEdgeGeometry,
  cubeToSphereDeformation
} from '../src/fractal-matter.mjs';

const bounds = { min: [-1, -1, -1], max: [1, 1, 1] };

test('surface patch geometry maps normalized face patch to canonical reference vertices', () => {
  const geometry = buildSurfacePatchGeometry({
    bounds,
    axis: 'x',
    side: 1,
    patch: makeReferenceFacePatch({ u0: 0, u1: 0.5, v0: 0.5, v1: 1 })
  });

  assert.deepEqual(geometry.referenceVertices, [
    [1, -1, 0],
    [1, 0, 0],
    [1, 0, 1],
    [1, -1, 1]
  ]);
  assert.equal(geometry.vertexKeys.length, 4);
  assert.equal(geometry.edges.length, 4);
});

test('adjacent quadtree patches share one canonical edge before deformation', () => {
  const [leftBottom, rightBottom] = subdivideReferenceFacePatch(makeReferenceFacePatch());
  const a = buildSurfacePatchGeometry({ bounds, axis: 'z', side: 1, patch: leftBottom });
  const b = buildSurfacePatchGeometry({ bounds, axis: 'z', side: 1, patch: rightBottom });

  const shared = sharedSurfaceEdges(a, b);
  assert.equal(shared.length, 1);
  assert.equal(shared[0].key, '0,-1,1|0,0,1');
});

test('adjacent patches independently deform their shared edge to identical coordinates', () => {
  const patches = subdivideReferenceFacePatch(makeReferenceFacePatch());
  const a = buildSurfacePatchGeometry({
    bounds,
    axis: 'z',
    side: 1,
    patch: patches[0],
    deformation: point => cubeToSphereDeformation(point)
  });
  const b = buildSurfacePatchGeometry({
    bounds,
    axis: 'z',
    side: 1,
    patch: patches[1],
    deformation: point => cubeToSphereDeformation(point)
  });

  assert.equal(assertSharedEdgeGeometry(a, b, { epsilon: 0 }), 1);

  const sharedKeys = new Set(
    a.vertexKeys.filter(key => b.vertexKeys.includes(key))
  );
  assert.deepEqual([...sharedKeys].sort(), ['0,-1,1', '0,0,1']);

  for (const key of sharedKeys) {
    const ai = a.vertexKeys.indexOf(key);
    const bi = b.vertexKeys.indexOf(key);
    assert.deepEqual(a.deformedVertices[ai], b.deformedVertices[bi]);
  }
});

test('four child patches form a crack-free 2x2 face under cube-to-sphere deformation', () => {
  const geometries = subdivideReferenceFacePatch(makeReferenceFacePatch())
    .map(patch => buildSurfacePatchGeometry({
      bounds,
      axis: 'x',
      side: 1,
      patch,
      deformation: point => cubeToSphereDeformation(point)
    }));

  const sharedCounts = [];
  for (let i = 0; i < geometries.length; i++) {
    for (let j = i + 1; j < geometries.length; j++) {
      const count = assertSharedEdgeGeometry(geometries[i], geometries[j], { epsilon: 0 });
      if (count) sharedCounts.push(count);
    }
  }

  // 2x2 patch grid has four internal shared edges.
  assert.deepEqual(sharedCounts, [1,1,1,1]);
});

test('non-neighbor patches do not invent shared edges', () => {
  const patches = subdivideReferenceFacePatch(makeReferenceFacePatch());
  const a = buildSurfacePatchGeometry({ bounds, axis: 'y', side: -1, patch: patches[0] });
  const diagonal = buildSurfacePatchGeometry({ bounds, axis: 'y', side: -1, patch: patches[3] });

  assert.equal(sharedSurfaceEdges(a, diagonal).length, 0);
  assert.equal(assertSharedEdgeGeometry(a, diagonal), 0);
});
