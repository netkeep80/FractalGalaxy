function finiteVec3(value, name) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
    throw new Error(`${name} must be a finite vec3`);
  }
  return [...value];
}

function norm(v) {
  return Math.hypot(...v);
}

function scale(v, k) {
  return v.map(value => value * k);
}

export function evaluateGeometryInfluence(influenceVector, {
  threshold = 0,
  compliance = 1
} = {}) {
  const influence = finiteVec3(influenceVector, 'influenceVector');
  if (!Number.isFinite(threshold) || threshold < 0) throw new Error('threshold must be >= 0');
  if (!Number.isFinite(compliance) || compliance < 0) throw new Error('compliance must be >= 0');

  const magnitude = norm(influence);
  if (magnitude <= threshold || magnitude === 0 || compliance === 0) {
    return Object.freeze({
      active: false,
      magnitude,
      threshold,
      excess: 0,
      compliance,
      offset: Object.freeze([0, 0, 0])
    });
  }

  const excess = magnitude - threshold;
  const offsetMagnitude = excess * compliance;
  const offset = scale(influence, offsetMagnitude / magnitude);

  return Object.freeze({
    active: true,
    magnitude,
    threshold,
    excess,
    compliance,
    offset: Object.freeze(offset)
  });
}

export function geometryInfluenceCreatesOverride(result) {
  return Boolean(result?.active && Array.isArray(result.offset)
    && result.offset.some(value => value !== 0));
}
