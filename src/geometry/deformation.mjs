function finiteVec3(value, name) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
    throw new Error(`${name} must be a finite vec3`);
  }
  return value;
}

export function cellLocalToReference(bounds, local) {
  if (!bounds || !Array.isArray(bounds.min) || !Array.isArray(bounds.max)) {
    throw new Error('bounds must contain min/max vec3');
  }
  const min = finiteVec3(bounds.min, 'bounds.min');
  const max = finiteVec3(bounds.max, 'bounds.max');
  const uvw = finiteVec3(local, 'local');

  if (uvw.some(value => value < 0 || value > 1)) {
    throw new Error('local coordinates must be within [0,1]');
  }

  return uvw.map((value, axis) => min[axis] + value * (max[axis] - min[axis]));
}

export function identityDeformation(reference) {
  return [...finiteVec3(reference, 'reference')];
}

export function deformReferencePoint(reference, deformation = identityDeformation) {
  if (typeof deformation !== 'function') throw new Error('deformation must be a function');
  const input = [...finiteVec3(reference, 'reference')];
  return [...finiteVec3(deformation(input), 'deformed point')];
}

// Continuous cube-to-ball mapping. On the boundary of [-1,1]^3 it maps
// the topological cube surface to a unit sphere; inside it yields a smooth
// deformed volume suitable as an executable "inflated cube" example.
export function cubeToSphereDeformation(reference, { radius = 1 } = {}) {
  const [x, y, z] = finiteVec3(reference, 'reference');
  if (![x, y, z].every(value => value >= -1 && value <= 1)) {
    throw new Error('cube-to-sphere reference coordinates must be within [-1,1]');
  }
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('radius must be positive');

  const xx = x * x, yy = y * y, zz = z * z;
  const sx = x * Math.sqrt(Math.max(0, 1 - yy / 2 - zz / 2 + yy * zz / 3));
  const sy = y * Math.sqrt(Math.max(0, 1 - zz / 2 - xx / 2 + zz * xx / 3));
  const sz = z * Math.sqrt(Math.max(0, 1 - xx / 2 - yy / 2 + xx * yy / 3));
  return [radius * sx, radius * sy, radius * sz];
}

export function translateMaterialPoint(point, translation = [0, 0, 0]) {
  const p = finiteVec3(point, 'point');
  const t = finiteVec3(translation, 'translation');
  return [p[0] + t[0], p[1] + t[1], p[2] + t[2]];
}
