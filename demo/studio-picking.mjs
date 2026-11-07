// Pure orthographic reference-space picking and canonical hierarchy helpers.
// Kept independent of DOM and rendering so the interaction semantics are testable.
const AXES = ['x', 'y', 'z'];
function finite(v) { return typeof v === 'number' && Number.isFinite(v); }
function validatePath(path) {
  if (!Array.isArray(path) || path.some(n => !Number.isInteger(n) || n < 0 || n > 7)) {
    throw new RangeError('octree path must contain branches 0..7');
  }
}
export function parentPath(path) {
  validatePath(path);
  return path.length ? path.slice(0, -1) : null;
}
export function childPath(path, branch, maxDepth = 4) {
  validatePath(path);
  if (!Number.isInteger(branch) || branch < 0 || branch > 7) throw new RangeError('invalid octant');
  if (path.length >= maxDepth) return null;
  return [...path, branch];
}
export function centerOfPath(path) {
  validatePath(path);
  let min = [-1, -1, -1], max = [1, 1, 1];
  for (const branch of path) {
    for (let axis = 0; axis < 3; axis++) {
      const middle = (min[axis] + max[axis]) / 2;
      if ((branch >> axis) & 1) min[axis] = middle;
      else max[axis] = middle;
    }
  }
  return min.map((v, axis) => (v + max[axis]) / 2);
}
export function formatPath(path) {
  validatePath(path);
  return path.length ? '/' + path.join('/') : '/';
}
export function referenceProjection(point, { width, height, camera }) {
  const [x, y, z] = point;
  const { yaw, pitch, zoom } = camera;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  const y1 = y * cp - z1 * sp;
  const scale = Math.min(width, height) * 0.30 * zoom;
  return { x: width / 2 + x1 * scale, y: height / 2 - y1 * scale };
}
export function pickReferenceCube({ x, y, width, height, camera }) {
  if (![x, y, width, height, camera?.yaw, camera?.pitch, camera?.zoom].every(finite)
      || width <= 0 || height <= 0 || camera.zoom <= 0) {
    throw new RangeError('invalid reference viewport or camera');
  }
  const scale = Math.min(width, height) * 0.30 * camera.zoom;
  const x1 = (x - width / 2) / scale;
  const y1 = (height / 2 - y) / scale;
  const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw);
  const cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);

  // Inverse of app.js rotateProject. The camera faces decreasing projected depth.
  const depth = 4;
  const z1 = -y1 * sp + depth * cp;
  const origin = [x1 * cy - z1 * sy, y1 * cp + depth * sp, x1 * sy + z1 * cy];
  const direction = [cp * sy, -sp, -cp * cy];
  let near = -Infinity, far = Infinity, faceAxis = -1, faceSide = 0;

  for (let axis = 0; axis < 3; axis++) {
    const o = origin[axis], d = direction[axis];
    if (Math.abs(d) < 1e-12) {
      if (o < -1 || o > 1) return null;
      continue;
    }
    const first = (-1 - o) / d;
    const second = (1 - o) / d;
    const t0 = Math.min(first, second), t1 = Math.max(first, second);
    if (t0 > near) {
      near = t0;
      faceAxis = axis;
      faceSide = d > 0 ? -1 : 1;
    }
    far = Math.min(far, t1);
    if (near > far) return null;
  }
  if (far < 0 || near < 0 || faceAxis === -1) return null;
  const point = origin.map((v, axis) => v + near * direction[axis]);
  const epsilon = 1e-7;
  const inside = origin.map((v, axis) =>
    Math.max(-1 + epsilon, Math.min(1 - epsilon, v + (near + epsilon) * direction[axis])));
  return { point, inside, axis: AXES[faceAxis], side: faceSide };
}
