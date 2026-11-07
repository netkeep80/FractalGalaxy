function axisBaseSign(axis) {
  if (axis === 'x') return 1;
  if (axis === 'y') return -1;
  if (axis === 'z') return 1;
  throw new Error('axis must be x, y, or z');
}

function validateGeometry(geometry) {
  if (!geometry || !Array.isArray(geometry.referenceVertices) || geometry.referenceVertices.length !== 4
    || !Array.isArray(geometry.deformedVertices) || geometry.deformedVertices.length !== 4) {
    throw new Error('SurfacePatch geometry with 4 vertices required');
  }
  if (geometry.side !== -1 && geometry.side !== 1) throw new Error('geometry side must be -1 or 1');
  axisBaseSign(geometry.axis);
  return geometry;
}

export function surfacePatchWinding(axis, side) {
  if (side !== -1 && side !== 1) throw new Error('side must be -1 or 1');
  const forward = axisBaseSign(axis) === side;
  return Object.freeze(forward ? [0,1,2,3] : [0,3,2,1]);
}

export function triangulateSurfacePatchGeometry(geometry) {
  const patch = validateGeometry(geometry);
  const winding = surfacePatchWinding(patch.axis, patch.side);

  // Canonical reference diagonal is vertex 0 ↔ vertex 2. Reversing the face
  // changes winding but never changes the diagonal or vertex identities.
  const triangles = winding[1] === 1
    ? [[0,1,2],[0,2,3]]
    : [[0,2,1],[0,3,2]];

  return Object.freeze({
    diagonal: Object.freeze([0,2]),
    winding,
    triangles: Object.freeze(triangles.map(indices => Object.freeze({
      indices: Object.freeze(indices),
      referenceVertices: Object.freeze(indices.map(index => patch.referenceVertices[index])),
      deformedVertices: Object.freeze(indices.map(index => patch.deformedVertices[index]))
    })))
  });
}

export function triangleNormal(vertices) {
  if (!Array.isArray(vertices) || vertices.length !== 3) throw new Error('triangle requires 3 vertices');
  const [a,b,c] = vertices;
  const ab = b.map((value, i) => value - a[i]);
  const ac = c.map((value, i) => value - a[i]);
  return [
    ab[1]*ac[2] - ab[2]*ac[1],
    ab[2]*ac[0] - ab[0]*ac[2],
    ab[0]*ac[1] - ab[1]*ac[0]
  ];
}
