import { deformReferencePoint, identityDeformation } from './deformation.mjs';
import { referenceVertexKey } from './surface-patch.mjs';

function finiteVec3(value, name) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
    throw new Error(`${name} must be a finite vec3`);
  }
  return [...value];
}

function u32(value) {
  return value >>> 0;
}

function mix32(value) {
  let x = u32(value);
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

function hashString(text, seed = 0) {
  let h = u32(0x811c9dc5 ^ seed);
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return mix32(h);
}

function signedUnit(hash) {
  return (hash / 0xffffffff) * 2 - 1;
}

function add(a, b) {
  return a.map((value, i) => value + b[i]);
}

function scale(v, k) {
  return v.map(value => value * k);
}

function lerp(a, b, t) {
  return a.map((value, i) => value + (b[i] - value) * t);
}

function normalize(v) {
  const length = Math.hypot(...v);
  if (length === 0) return [0, 0, 0];
  return v.map(value => value / length);
}

export function deterministicVertexRandom(reference, {
  seed = 0,
  amplitude = 0
} = {}) {
  const point = finiteVec3(reference, 'reference');
  if (!Number.isFinite(amplitude) || amplitude < 0) throw new Error('amplitude must be >= 0');
  const key = referenceVertexKey(point);

  const raw = [
    signedUnit(hashString(`${key}|x`, seed)),
    signedUnit(hashString(`${key}|y`, seed)),
    signedUnit(hashString(`${key}|z`, seed))
  ];
  const direction = normalize(raw);
  const magnitudeHash = hashString(`${key}|magnitude`, seed ^ 0x9e3779b9);
  const magnitude = amplitude * (magnitudeHash / 0xffffffff);

  return Object.freeze(scale(direction, magnitude));
}

export function radialBoundaryTarget(reference, { radius = 1 } = {}) {
  const point = finiteVec3(reference, 'reference');
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('radius must be positive');
  return scale(normalize(point), radius);
}

export function interactionOffsetForVertex(reference, interactionOffsets = {}) {
  const key = referenceVertexKey(reference);
  const value = interactionOffsets?.[key] ?? [0, 0, 0];
  return finiteVec3(value, `interaction offset ${key}`);
}

export function evaluateFractalVertex(reference, {
  baseDeformation = identityDeformation,
  seed = 0,
  randomAmplitude = 0,
  smoothingWeight = 0,
  smoothingTarget = null,
  interactionOffsets = {}
} = {}) {
  const ref = finiteVec3(reference, 'reference');
  if (typeof baseDeformation !== 'function') throw new Error('baseDeformation must be a function');
  if (!Number.isFinite(smoothingWeight) || smoothingWeight < 0 || smoothingWeight > 1) {
    throw new Error('smoothingWeight must be within [0,1]');
  }
  if (smoothingTarget !== null && typeof smoothingTarget !== 'function') {
    throw new Error('smoothingTarget must be a function or null');
  }

  const key = referenceVertexKey(ref);
  const basePosition = deformReferencePoint(ref, baseDeformation);
  const randomOffset = deterministicVertexRandom(ref, { seed, amplitude: randomAmplitude });
  const procedurallyRoughPosition = add(basePosition, randomOffset);

  const target = smoothingTarget
    ? finiteVec3(smoothingTarget(Object.freeze({
        reference: Object.freeze([...ref]),
        key,
        basePosition: Object.freeze([...basePosition]),
        roughPosition: Object.freeze([...procedurallyRoughPosition])
      })), 'smoothing target')
    : procedurallyRoughPosition;

  const smoothedPosition = lerp(procedurallyRoughPosition, target, smoothingWeight);
  const interactionOffset = interactionOffsetForVertex(ref, interactionOffsets);
  const position = add(smoothedPosition, interactionOffset);

  return Object.freeze({
    key,
    reference: Object.freeze(ref),
    basePosition: Object.freeze(basePosition),
    randomOffset,
    procedurallyRoughPosition: Object.freeze(procedurallyRoughPosition),
    smoothingTarget: Object.freeze(target),
    smoothedPosition: Object.freeze(smoothedPosition),
    interactionOffset: Object.freeze(interactionOffset),
    position: Object.freeze(position)
  });
}

export function makeFractalVertexDeformation(options = {}) {
  return reference => evaluateFractalVertex(reference, options).position;
}
