import {
  VOLUME_HOMOGENEOUS,
  VOLUME_MIXED,
  validateVolumeClassification
} from '../volume/classification.mjs';

export const INTERFACE_NONE = 'NONE';
export const INTERFACE_PRESENT = 'PRESENT';
export const INTERFACE_REFINE = 'REFINE';

export function classifyMaterialInterface(leftInput, rightInput) {
  const left = validateVolumeClassification(leftInput);
  const right = validateVolumeClassification(rightInput);

  if (left.kind === VOLUME_MIXED || right.kind === VOLUME_MIXED) {
    return Object.freeze({ kind: INTERFACE_REFINE });
  }

  if (left.kind === VOLUME_HOMOGENEOUS && right.kind === VOLUME_HOMOGENEOUS) {
    if (left.medium === right.medium) {
      return Object.freeze({ kind: INTERFACE_NONE, medium: left.medium });
    }
    return Object.freeze({
      kind: INTERFACE_PRESENT,
      leftMedium: left.medium,
      rightMedium: right.medium
    });
  }

  throw new Error('unreachable interface classification');
}

function axisIndex(axis) {
  if (axis === 'x') return 0;
  if (axis === 'y') return 1;
  if (axis === 'z') return 2;
  throw new Error('axis must be x, y, or z');
}

export function incidentOctantsForFace(axis, side) {
  const a = axisIndex(axis);
  if (side !== -1 && side !== 1) throw new Error('side must be -1 or 1');
  const requiredBit = side === 1 ? 1 : 0;
  const result = [];

  for (let branch = 0; branch < 8; branch += 1) {
    const bits = [branch & 1, (branch >> 1) & 1, (branch >> 2) & 1];
    if (bits[a] === requiredBit) result.push(branch);
  }
  return Object.freeze(result);
}

export function makeReferenceFacePatch({
  u0 = 0,
  u1 = 1,
  v0 = 0,
  v1 = 1
} = {}) {
  for (const [name, value] of Object.entries({ u0, u1, v0, v1 })) {
    if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  }
  if (!(u0 < u1) || !(v0 < v1)) throw new Error('face patch bounds must be increasing');
  return Object.freeze({ u0, u1, v0, v1 });
}

export function subdivideReferenceFacePatch(input = {}) {
  const patch = makeReferenceFacePatch(input);
  const um = (patch.u0 + patch.u1) / 2;
  const vm = (patch.v0 + patch.v1) / 2;

  return Object.freeze([
    makeReferenceFacePatch({ u0: patch.u0, u1: um, v0: patch.v0, v1: vm }),
    makeReferenceFacePatch({ u0: um, u1: patch.u1, v0: patch.v0, v1: vm }),
    makeReferenceFacePatch({ u0: patch.u0, u1: um, v0: vm, v1: patch.v1 }),
    makeReferenceFacePatch({ u0: um, u1: patch.u1, v0: vm, v1: patch.v1 })
  ]);
}
