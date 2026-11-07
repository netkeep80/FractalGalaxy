export const VOLUME_HOMOGENEOUS = 'HOMOGENEOUS';
export const VOLUME_MIXED = 'MIXED';

function mediumId(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('medium must be a non-empty string');
  }
  return value;
}

export function homogeneousVolume(medium) {
  return Object.freeze({ kind: VOLUME_HOMOGENEOUS, medium: mediumId(medium) });
}

export function mixedVolume() {
  return Object.freeze({ kind: VOLUME_MIXED });
}

export function isHomogeneousVolume(value) {
  return value?.kind === VOLUME_HOMOGENEOUS && typeof value.medium === 'string';
}

export function validateVolumeClassification(value) {
  if (isHomogeneousVolume(value)) return value;
  if (value?.kind === VOLUME_MIXED) return value;
  throw new Error('invalid volume classification');
}

export function aggregateCompleteOctants(classifications) {
  if (!Array.isArray(classifications) || classifications.length !== 8) {
    throw new Error('complete octant aggregation requires exactly 8 classifications');
  }
  const children = classifications.map(validateVolumeClassification);
  if (children.some(child => child.kind === VOLUME_MIXED)) return mixedVolume();

  const medium = children[0].medium;
  return children.every(child => child.medium === medium)
    ? homogeneousVolume(medium)
    : mixedVolume();
}
