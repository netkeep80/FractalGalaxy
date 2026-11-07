import test from 'node:test';
import assert from 'node:assert/strict';
import { pickReferenceCube, referenceProjection, centerOfPath, childPath, parentPath, formatPath } from '../demo/studio-picking.mjs';

test('reference picker hits the front face in the same orthographic projection as Studio', () => {
  const camera = { yaw: 0, pitch: 0, zoom: 1 };
  const viewport = { width: 600, height: 420, camera };
  const projected = referenceProjection([0.45, 0.4, 1], viewport);
  const hit = pickReferenceCube({ ...viewport, x: projected.x, y: projected.y });
  assert.ok(hit);
  assert.equal(hit.axis, 'z');
  assert.equal(hit.side, 1);
  assert.ok(Math.abs(hit.point[0] - 0.45) < 1e-9);
  assert.ok(Math.abs(hit.point[1] - 0.4) < 1e-9);
  assert.ok(hit.inside[2] < 1);
});
test('reference picker does not manufacture a hit outside the projected cube', () => {
  const camera = { yaw: 0, pitch: 0, zoom: 1 };
  assert.equal(pickReferenceCube({ x: 590, y: 210, width: 600, height: 420, camera }), null);
});
test('reference picker preserves an unambiguous face on rotated camera', () => {
  const camera = { yaw: -0.66, pitch: 0.46, zoom: 1 };
  const hit = pickReferenceCube({ x: 300, y: 210, width: 600, height: 420, camera });
  assert.ok(hit);
  assert.ok(['x','y','z'].includes(hit.axis));
  assert.ok(hit.point.every(v => v >= -1-1e-9 && v <= 1+1e-9));
  assert.ok(Math.abs(hit.point[['x','y','z'].indexOf(hit.axis)] - hit.side) < 1e-8);
});
test('canonical parent and child paths preserve octree center and depth bounds', () => {
  assert.deepEqual(centerOfPath([]), [0,0,0]);
  assert.deepEqual(childPath([], 7), [7]);
  assert.deepEqual(childPath([7], 0), [7,0]);
  assert.deepEqual(parentPath([7,0,6]), [7,0]);
  assert.equal(parentPath([]), null);
  assert.equal(childPath([1,2,3,4],0), null);
  assert.deepEqual(centerOfPath([7]), [.5,.5,.5]);
  assert.deepEqual(centerOfPath([0,7]), [-.25,-.25,-.25]);
  assert.equal(formatPath([7,0,6]), '/7/0/6');
  assert.equal(formatPath([]), '/');
  assert.throws(() => childPath([1],8), /octant/);
});
