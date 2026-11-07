import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateGeometryInfluence,
  geometryInfluenceCreatesOverride,
  shouldMaterializeFractalRing,
  makeProceduralRef,
  makeFractalRing,
  setFractalRingVertexOffset,
  fractalRingVertexOffset
} from '../src/fractal-matter.mjs';

test('subthreshold influence does not create persistent geometry change', () => {
  const wind = evaluateGeometryInfluence([0.02, 0, 0], {
    threshold: 0.1,
    compliance: 1
  });

  assert.equal(wind.active, false);
  assert.equal(wind.excess, 0);
  assert.deepEqual(wind.offset, [0,0,0]);
  assert.equal(geometryInfluenceCreatesOverride(wind), false);
  assert.equal(
    shouldMaterializeFractalRing({ geometryOverride: geometryInfluenceCreatesOverride(wind) }),
    false
  );
});

test('influence exactly at threshold still produces no geometry override', () => {
  const result = evaluateGeometryInfluence([0.1, 0, 0], {
    threshold: 0.1,
    compliance: 5
  });

  assert.equal(result.active, false);
  assert.deepEqual(result.offset, [0,0,0]);
});

test('only excess above threshold contributes to persistent displacement', () => {
  const result = evaluateGeometryInfluence([0.25, 0, 0], {
    threshold: 0.1,
    compliance: 2
  });

  assert.equal(result.active, true);
  assert.ok(Math.abs(result.magnitude - 0.25) < 1e-12);
  assert.ok(Math.abs(result.excess - 0.15) < 1e-12);
  assert.ok(Math.abs(result.offset[0] - 0.3) < 1e-12);
  assert.ok(Math.abs(result.offset[1]) < 1e-12);
  assert.ok(Math.abs(result.offset[2]) < 1e-12);
  assert.equal(geometryInfluenceCreatesOverride(result), true);
});

test('threshold response preserves influence direction', () => {
  const result = evaluateGeometryInfluence([3, 4, 0], {
    threshold: 2,
    compliance: 0.5
  });

  assert.equal(result.active, true);
  assert.ok(Math.abs(result.magnitude - 5) < 1e-12);
  assert.ok(Math.abs(result.excess - 3) < 1e-12);
  assert.ok(Math.abs(result.offset[0] - 0.9) < 1e-12);
  assert.ok(Math.abs(result.offset[1] - 1.2) < 1e-12);
});

test('only active threshold result needs to be persisted into FractalRing geometry override', () => {
  const source = makeProceduralRef({
    rootId:'planet',
    address:[1,2],
    algorithmId:'planet',
    algorithmVersion:'1'
  });
  const ring = makeFractalRing({ id:'fragment', source });

  const below = evaluateGeometryInfluence([0.03,0,0], { threshold:0.1, compliance:1 });
  assert.equal(geometryInfluenceCreatesOverride(below), false);
  assert.deepEqual(fractalRingVertexOffset(ring, [1,0,0]), [0,0,0]);

  const above = evaluateGeometryInfluence([0.3,0,0], { threshold:0.1, compliance:1 });
  const changed = setFractalRingVertexOffset(ring, [1,0,0], above.offset);
  const stored = fractalRingVertexOffset(changed, [1,0,0]);
  assert.ok(Math.abs(stored[0] - 0.2) < 1e-12);
  assert.ok(Math.abs(stored[1]) < 1e-12);
  assert.ok(Math.abs(stored[2]) < 1e-12);
});
