import test from 'node:test';
import assert from 'node:assert/strict';

import {
  makeProceduralRef,
  childProceduralRef,
  parentProceduralRef,
  proceduralRefKey,
  shouldMaterializeFractalRing,
  makeFractalRing,
  reparentFractalRing,
  makeSparseRingStore,
  putFractalRing,
  ringsForProceduralSource,
  sparseRingCount
} from '../src/fractal-matter.mjs';

test('procedural octree path exists without FractalRing materialization', () => {
  let ref = makeProceduralRef({ rootId: 'planet-1' });
  for (const branch of [5, 2, 7, 3]) ref = childProceduralRef(ref, branch);

  assert.equal(proceduralRefKey(ref), 'planet-1:5/2/7/3');
  assert.equal(proceduralRefKey(parentProceduralRef(ref)), 'planet-1:5/2/7');

  const store = makeSparseRingStore();
  assert.equal(sparseRingCount(store), 0);
});

test('ordinary procedural difference does not by itself require a FractalRing', () => {
  assert.equal(shouldMaterializeFractalRing({ proceduralResultDiffers: true }), false);
  assert.equal(shouldMaterializeFractalRing({ materialOverride: true }), true);
  assert.equal(shouldMaterializeFractalRing({ parameterOverride: true }), true);
  assert.equal(shouldMaterializeFractalRing({ independentIdentity: true }), true);
  assert.equal(shouldMaterializeFractalRing({ physicalState: true }), true);
});

test('deep changed region can be stored directly without intermediate FractalRings', () => {
  const source = makeProceduralRef({
    rootId: 'planet-1',
    address: [5, 2, 7, 3],
    neighborRefs: {
      west: { rootId: 'planet-1', address: [5, 2, 7, 2] }
    }
  });

  const changed = makeFractalRing({
    id: 'changed-17',
    source,
    materialId: 'mat-17',
    overrides: { deltaRevision: 1 }
  });

  const store = putFractalRing(makeSparseRingStore(), changed);

  assert.equal(sparseRingCount(store), 1);
  assert.equal(ringsForProceduralSource(store, source)[0].id, 'changed-17');
  assert.equal(store.byId['changed-17'].source.neighborRefs.west.rootId, 'planet-1');
  assert.deepEqual(store.byId['changed-17'].source.neighborRefs.west.address, [5, 2, 7, 2]);
});

test('physical reparenting does not change procedural origin', () => {
  const source = makeProceduralRef({ rootId: 'planet-1', address: [5, 2, 7, 3] });
  const rock = makeFractalRing({ id: 'rock-1', source, physicalParentId: 'planet-ring' });

  const detached = reparentFractalRing(rock, null);
  const cargo = reparentFractalRing(detached, 'ship-cargo');

  assert.equal(proceduralRefKey(rock.source), 'planet-1:5/2/7/3');
  assert.equal(proceduralRefKey(detached.source), 'planet-1:5/2/7/3');
  assert.equal(proceduralRefKey(cargo.source), 'planet-1:5/2/7/3');
  assert.equal(cargo.physicalParentId, 'ship-cargo');
});
