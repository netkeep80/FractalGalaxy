import test from 'node:test';
import assert from 'node:assert/strict';

import {
  makeGamma,
  makeMaterial,
  solid,
  EMPTY,
  classifyMaterialRegion,
  adjacentOctreePath,
  octreePathToGrid,
  octreeGridToPath,
  octreeBoundsForPath
} from '../src/fractal-matter.mjs';

test('octree path/grid conversion and same-depth neighbor lookup need no materialized rings', () => {
  const path = [1, 2];
  assert.deepEqual(octreePathToGrid(path), { depth: 2, x: 2, y: 1, z: 0 });
  assert.deepEqual(octreeGridToPath({ depth: 2, x: 2, y: 1, z: 0 }), path);
  assert.deepEqual(adjacentOctreePath(path, 'x', 1), [1, 3]);
  assert.deepEqual(adjacentOctreePath(path, 'x', -1), [0, 3]);
  assert.equal(adjacentOctreePath([1, 3], 'x', 1), null);

  assert.deepEqual(
    octreeBoundsForPath([0], { min: -1, max: 1 }),
    { min: [-1, -1, -1], max: [0, 0, 0] }
  );
});

test('solid fixture is certified homogeneous without child refinement', () => {
  const material = makeMaterial({
    id: 'solid',
    gamma: makeGamma({ fixture: 'solid' })
  });

  const result = classifyMaterialRegion(material, [], { maxDepth: 5 });
  assert.equal(result.classification.kind, 'HOMOGENEOUS');
  assert.equal(result.classification.medium, 'SOLID:rock:1');
  assert.equal(result.stats.inspectedNodes, 1);
  assert.equal(result.stats.deepestDepth, 0);
  assert.equal(result.stats.reasons['solid-fixture'], 1);
});

test('height fixture proves deep lower/upper cells homogeneous from analytic bounds', () => {
  const material = makeMaterial({
    id: 'height',
    gamma: makeGamma({ rootSeed: 0x12345678, alphaNeighbor: 0, fixture: 'height' })
  });

  const lower = classifyMaterialRegion(material, [0, 0], { maxDepth: 5 });
  assert.equal(lower.classification.kind, 'HOMOGENEOUS');
  assert.equal(lower.classification.medium, 'SOLID:rock:1');
  assert.equal(lower.stats.inspectedNodes, 1);
  assert.equal(lower.stats.reasons['height-global-solid-bound'], 1);

  const upper = classifyMaterialRegion(material, [4, 4], { maxDepth: 5 });
  assert.equal(upper.classification.kind, 'HOMOGENEOUS');
  assert.equal(upper.classification.medium, 'EMPTY');
  assert.equal(upper.stats.inspectedNodes, 1);
  assert.equal(upper.stats.reasons['height-global-empty-bound'], 1);
});

test('deep D override is found by adaptive refinement without persistent intermediate objects', () => {
  const material = makeMaterial({
    id: 'edited',
    gamma: makeGamma({ fixture: 'solid' }),
    edits: [{ path: [7, 3], value: EMPTY }]
  });

  const root = classifyMaterialRegion(material, [], { maxDepth: 2 });
  assert.equal(root.classification.kind, 'MIXED');
  assert.ok(root.stats.inspectedNodes > 1);
  assert.equal(root.stats.deepestDepth, 2);
  assert.ok(root.stats.reasons['descendant-edit'] >= 1);

  const edited = classifyMaterialRegion(material, [7, 3], { maxDepth: 5 });
  assert.equal(edited.classification.kind, 'HOMOGENEOUS');
  assert.equal(edited.classification.medium, 'EMPTY');
  assert.equal(edited.stats.reasons['D-override'], 1);

  const untouched = classifyMaterialRegion(material, [0], { maxDepth: 5 });
  assert.equal(untouched.classification.kind, 'HOMOGENEOUS');
  assert.equal(untouched.classification.medium, 'SOLID:rock:1');
});

test('classification can stop at requested depth and report unresolved volume', () => {
  const material = makeMaterial({
    id: 'height',
    gamma: makeGamma({ rootSeed: 0, fixture: 'height' })
  });

  const result = classifyMaterialRegion(material, [0], { maxDepth: 1 });
  assert.equal(result.classification.kind, 'MIXED');
  assert.equal(result.stats.deepestDepth, 1);
  assert.equal(result.stats.unresolvedAtLimit, 1);
  assert.equal(result.stats.reasons['needs-refinement'], 1);
});
