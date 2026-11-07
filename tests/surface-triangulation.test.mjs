import test from 'node:test';
import assert from 'node:assert/strict';

import {
  makeReferenceFacePatch,
  buildSurfacePatchGeometry,
  cubeToSphereDeformation,
  surfacePatchWinding,
  triangulateSurfacePatchGeometry,
  triangleNormal
} from '../src/fractal-matter.mjs';

const bounds = { min: [-1,-1,-1], max: [1,1,1] };
const patch = makeReferenceFacePatch();

test('surface triangulation uses canonical 0-2 diagonal independent of face side', () => {
  for (const axis of ['x','y','z']) {
    for (const side of [-1,1]) {
      const geometry = buildSurfacePatchGeometry({ bounds, axis, side, patch });
      const mesh = triangulateSurfacePatchGeometry(geometry);
      assert.deepEqual(mesh.diagonal, [0,2]);
      assert.equal(mesh.triangles.length, 2);
      assert.equal(new Set(mesh.triangles.flatMap(t => t.indices)).size, 4);
    }
  }
});

test('reference triangle winding points from cell A toward neighbor B', () => {
  const axisIndex = { x:0, y:1, z:2 };

  for (const axis of ['x','y','z']) {
    for (const side of [-1,1]) {
      const geometry = buildSurfacePatchGeometry({ bounds, axis, side, patch });
      const mesh = triangulateSurfacePatchGeometry(geometry);
      for (const triangle of mesh.triangles) {
        const normal = triangleNormal(triangle.referenceVertices);
        assert.ok(normal[axisIndex[axis]] * side > 0, `${axis}${side}: wrong winding`);
      }
    }
  }
});

test('winding is topology-derived and deterministic', () => {
  assert.deepEqual(surfacePatchWinding('x', 1), [0,1,2,3]);
  assert.deepEqual(surfacePatchWinding('x', -1), [0,3,2,1]);
  assert.deepEqual(surfacePatchWinding('y', -1), [0,1,2,3]);
  assert.deepEqual(surfacePatchWinding('y', 1), [0,3,2,1]);
  assert.deepEqual(surfacePatchWinding('z', 1), [0,1,2,3]);
  assert.deepEqual(surfacePatchWinding('z', -1), [0,3,2,1]);
});

test('deformation changes triangle coordinates but not topology or diagonal', () => {
  const reference = buildSurfacePatchGeometry({ bounds, axis:'x', side:1, patch });
  const sphere = buildSurfacePatchGeometry({
    bounds,
    axis:'x',
    side:1,
    patch,
    deformation: point => cubeToSphereDeformation(point)
  });

  const a = triangulateSurfacePatchGeometry(reference);
  const b = triangulateSurfacePatchGeometry(sphere);

  assert.deepEqual(a.diagonal, b.diagonal);
  assert.deepEqual(a.triangles.map(t => t.indices), b.triangles.map(t => t.indices));
  assert.notDeepEqual(a.triangles[0].deformedVertices, b.triangles[0].deformedVertices);
});
