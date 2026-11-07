import { overrideFractalRing } from './fractal-ring.mjs';
import { referenceVertexKey } from '../geometry/surface-patch.mjs';

function vec3(value, name) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
    throw new Error(`${name} must be finite vec3`);
  }
  return [...value];
}

export function geometryVertexOffsets(ring) {
  return structuredClone(ring?.overrides?.geometryVertexOffsets ?? {});
}

export function setFractalRingVertexOffset(ring, reference, offset) {
  if (!ring?.id) throw new Error('FractalRing required');
  const key = referenceVertexKey(reference);
  const nextOffsets = geometryVertexOffsets(ring);
  const normalized = vec3(offset, 'vertex offset');

  if (normalized.every(value => value === 0)) delete nextOffsets[key];
  else nextOffsets[key] = normalized;

  return overrideFractalRing(ring, { geometryVertexOffsets: nextOffsets });
}

export function fractalRingVertexOffset(ring, reference) {
  const key = referenceVertexKey(reference);
  return vec3(ring?.overrides?.geometryVertexOffsets?.[key] ?? [0,0,0], 'stored vertex offset');
}
