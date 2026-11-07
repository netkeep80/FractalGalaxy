import { makeProceduralRef } from '../procedural/source-ref.mjs';

const ZERO3 = Object.freeze([0, 0, 0]);

function vec3(value, name) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
    throw new Error(`${name} must be finite vec3`);
  }
  return [...value];
}

export function shouldMaterializeFractalRing(reason = {}) {
  return Boolean(
    reason.materialOverride
    || reason.parameterOverride
    || reason.algorithmOverride
    || reason.geometryOverride
    || reason.ownershipOverride
    || reason.independentIdentity
    || reason.physicalState
    || reason.physicalComposition
  );
}

export function makeFractalRing({
  id,
  source,
  physicalParentId = null,
  materialId = null,
  position = ZERO3,
  velocity = ZERO3,
  angularVelocity = ZERO3,
  overrides = {}
} = {}) {
  if (!id) throw new Error('FractalRing id required');
  return {
    id,
    source: makeProceduralRef(source),
    physicalParentId,
    materialId,
    position: vec3(position, 'position'),
    velocity: vec3(velocity, 'velocity'),
    angularVelocity: vec3(angularVelocity, 'angularVelocity'),
    overrides: structuredClone(overrides)
  };
}

export function reparentFractalRing(ring, physicalParentId) {
  const next = structuredClone(ring);
  next.physicalParentId = physicalParentId ?? null;
  // Procedural origin is immutable under physical reparenting.
  next.source = makeProceduralRef(ring.source);
  return next;
}

export function overrideFractalRing(ring, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('override patch must be an object');
  }
  const next = structuredClone(ring);
  next.overrides = { ...next.overrides, ...structuredClone(patch) };
  next.source = makeProceduralRef(ring.source);
  return next;
}
