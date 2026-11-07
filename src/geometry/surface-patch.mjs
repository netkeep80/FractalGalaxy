import { deformReferencePoint, identityDeformation } from './deformation.mjs';

function finiteVec3(value, name) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
    throw new Error(`${name} must be a finite vec3`);
  }
  return value;
}

function validateBounds(bounds) {
  if (!bounds || !Array.isArray(bounds.min) || !Array.isArray(bounds.max)) {
    throw new Error('bounds must contain min/max vec3');
  }
  const min = finiteVec3(bounds.min, 'bounds.min');
  const max = finiteVec3(bounds.max, 'bounds.max');
  if (min.some((value, axis) => !(value < max[axis]))) {
    throw new Error('bounds must be increasing');
  }
  return { min, max };
}

function validatePatch(patch) {
  if (!patch || !Number.isFinite(patch.u0) || !Number.isFinite(patch.u1)
    || !Number.isFinite(patch.v0) || !Number.isFinite(patch.v1)
    || !(patch.u0 < patch.u1) || !(patch.v0 < patch.v1)
    || patch.u0 < 0 || patch.u1 > 1 || patch.v0 < 0 || patch.v1 > 1) {
    throw new Error('patch must be within normalized [0,1] face coordinates');
  }
  return patch;
}

function axisIndex(axis) {
  if (axis === 'x') return 0;
  if (axis === 'y') return 1;
  if (axis === 'z') return 2;
  throw new Error('axis must be x, y, or z');
}

function normalizeNumber(value) {
  return Object.is(value, -0) ? 0 : value;
}

export function referenceVertexKey(point) {
  const p = finiteVec3(point, 'reference point');
  return p.map(value => String(normalizeNumber(value))).join(',');
}

export function canonicalEdgeKey(a, b) {
  const keys = [referenceVertexKey(a), referenceVertexKey(b)].sort();
  return `${keys[0]}|${keys[1]}`;
}

export function surfacePatchReferenceVertices({
  bounds,
  axis,
  side,
  patch
} = {}) {
  const box = validateBounds(bounds);
  const face = validatePatch(patch);
  const normal = axisIndex(axis);
  if (side !== -1 && side !== 1) throw new Error('side must be -1 or 1');

  const tangent = [0, 1, 2].filter(index => index !== normal);
  const values = [
    [face.u0, face.v0],
    [face.u1, face.v0],
    [face.u1, face.v1],
    [face.u0, face.v1]
  ];

  return Object.freeze(values.map(([u, v]) => {
    const point = [0, 0, 0];
    point[normal] = side === 1 ? box.max[normal] : box.min[normal];
    point[tangent[0]] = box.min[tangent[0]] + u * (box.max[tangent[0]] - box.min[tangent[0]]);
    point[tangent[1]] = box.min[tangent[1]] + v * (box.max[tangent[1]] - box.min[tangent[1]]);
    return Object.freeze(point.map(normalizeNumber));
  }));
}

export function surfacePatchEdges(referenceVertices) {
  if (!Array.isArray(referenceVertices) || referenceVertices.length !== 4) {
    throw new Error('surface patch requires 4 reference vertices');
  }
  const order = [[0,1],[1,2],[2,3],[3,0]];
  return Object.freeze(order.map(([a,b], index) => Object.freeze({
    index,
    vertexIndices: Object.freeze([a,b]),
    key: canonicalEdgeKey(referenceVertices[a], referenceVertices[b])
  })));
}

export function buildSurfacePatchGeometry({
  bounds,
  axis,
  side,
  patch,
  deformation = identityDeformation
} = {}) {
  if (typeof deformation !== 'function') throw new Error('deformation must be a function');

  const referenceVertices = surfacePatchReferenceVertices({ bounds, axis, side, patch });
  const deformedVertices = Object.freeze(
    referenceVertices.map(point => Object.freeze(deformReferencePoint(point, deformation)))
  );
  const vertexKeys = Object.freeze(referenceVertices.map(referenceVertexKey));
  const edges = surfacePatchEdges(referenceVertices);

  return Object.freeze({
    axis,
    side,
    patch: Object.freeze({ ...patch }),
    referenceVertices,
    deformedVertices,
    vertexKeys,
    edges
  });
}

export function sharedSurfaceEdges(a, b) {
  if (!a?.edges || !b?.edges) throw new Error('surface patch geometry required');
  const bByKey = new Map(b.edges.map(edge => [edge.key, edge]));
  return Object.freeze(
    a.edges
      .filter(edge => bByKey.has(edge.key))
      .map(edge => Object.freeze({
        key: edge.key,
        a: edge,
        b: bByKey.get(edge.key)
      }))
  );
}

export function assertSharedEdgeGeometry(a, b, { epsilon = 0 } = {}) {
  if (!Number.isFinite(epsilon) || epsilon < 0) throw new Error('epsilon must be >= 0');
  const shared = sharedSurfaceEdges(a, b);

  for (const pair of shared) {
    const aIndices = pair.a.vertexIndices;
    const bIndices = pair.b.vertexIndices;
    const aByKey = new Map(aIndices.map(index => [a.vertexKeys[index], a.deformedVertices[index]]));
    const bByKey = new Map(bIndices.map(index => [b.vertexKeys[index], b.deformedVertices[index]]));

    for (const [key, av] of aByKey) {
      const bv = bByKey.get(key);
      if (!bv) throw new Error(`shared edge lost canonical vertex: ${key}`);
      for (let axis = 0; axis < 3; axis += 1) {
        if (Math.abs(av[axis] - bv[axis]) > epsilon) {
          throw new Error(`deformed shared edge mismatch at ${key}`);
        }
      }
    }
  }

  return shared.length;
}
