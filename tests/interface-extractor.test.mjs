import test from 'node:test';
import assert from 'node:assert/strict';

import {
  homogeneousVolume,
  mixedVolume,
  faceChildPairs,
  extractInterfacePatches,
  makeGamma,
  makeMaterial,
  EMPTY,
  classifyMaterialRegion,
  extractMaterialInterface
} from '../src/fractal-matter.mjs';

test('face child pairs preserve tangential patch identity across opposite normal bits', () => {
  assert.deepEqual(
    faceChildPairs('x', 1).map(({ branchA, branchB }) => [branchA, branchB]),
    [[1,0],[3,2],[5,4],[7,6]]
  );
  assert.deepEqual(
    faceChildPairs('z', -1).map(({ branchA, branchB }) => [branchA, branchB]),
    [[0,4],[1,5],[2,6],[3,7]]
  );
});

test('interface extractor keeps one proven whole-face patch for different homogeneous media', () => {
  const result = extractInterfacePatches({
    pathA: [0],
    pathB: [1],
    axis: 'x',
    side: 1,
    maxDepth: 4,
    classifyA: () => homogeneousVolume('ROCK'),
    classifyB: () => homogeneousVolume('EMPTY')
  });

  assert.equal(result.present.length, 1);
  assert.equal(result.unresolved.length, 0);
  assert.deepEqual(result.present[0].patch, { u0:0, u1:1, v0:0, v1:1 });
  assert.equal(result.stats.visitedPairs, 1);
});

test('same medium is discarded without surface subdivision', () => {
  const result = extractInterfacePatches({
    pathA: [0],
    pathB: [1],
    axis: 'x',
    side: 1,
    maxDepth: 4,
    classifyA: () => homogeneousVolume('ROCK'),
    classifyB: () => homogeneousVolume('ROCK')
  });

  assert.equal(result.present.length, 0);
  assert.equal(result.unresolved.length, 0);
  assert.equal(result.stats.discardedPatches, 1);
  assert.equal(result.stats.visitedPairs, 1);
});

test('MIXED interface refines only four face-paired child regions', () => {
  const result = extractInterfacePatches({
    pathA: [0],
    pathB: [1],
    axis: 'x',
    side: 1,
    maxDepth: 2,
    classifyA: path => path.length === 1 ? mixedVolume() : homogeneousVolume('ROCK'),
    classifyB: path => path.length === 1 ? mixedVolume() :
      homogeneousVolume(path.at(-1) === 0 || path.at(-1) === 4 ? 'ROCK' : 'EMPTY')
  });

  assert.equal(result.stats.visitedPairs, 5);
  assert.equal(result.present.length, 2);
  assert.equal(result.stats.discardedPatches, 2);
  assert.deepEqual(
    result.present.map(item => item.patch),
    [
      { u0:0.5, u1:1, v0:0, v1:0.5 },
      { u0:0.5, u1:1, v0:0.5, v1:1 }
    ]
  );
});

test('finite depth preserves unresolved patches instead of inventing a surface', () => {
  const result = extractInterfacePatches({
    pathA: [0],
    pathB: [1],
    axis: 'x',
    side: 1,
    maxDepth: 2,
    classifyA: () => mixedVolume(),
    classifyB: () => homogeneousVolume('EMPTY')
  });

  assert.equal(result.present.length, 0);
  assert.equal(result.unresolved.length, 4);
  assert.equal(result.stats.unresolvedPatches, 4);
});

test('material wrapper extracts D boundary without creating persistent objects', () => {
  const material = makeMaterial({
    id: 'edited',
    gamma: makeGamma({ fixture: 'solid' }),
    edits: [{ path: [1], value: EMPTY }]
  });

  const extracted = extractMaterialInterface(material, {
    pathA: [0],
    pathB: [1],
    axis: 'x',
    side: 1,
    maxDepth: 5
  });

  assert.equal(classifyMaterialRegion(material, [0], { maxDepth: 1 }).classification.medium, 'SOLID:rock:1');
  assert.equal(classifyMaterialRegion(material, [1], { maxDepth: 1 }).classification.medium, 'EMPTY');
  assert.equal(extracted.present.length, 1);
  assert.equal(extracted.present[0].decision.leftMedium, 'SOLID:rock:1');
  assert.equal(extracted.present[0].decision.rightMedium, 'EMPTY');
});
