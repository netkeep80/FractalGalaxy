export function normalizeProceduralAddress(address = []) {
  if (!Array.isArray(address)) throw new Error('procedural address must be an array');
  const copy = address.map(branch => {
    if (!Number.isInteger(branch) || branch < 0 || branch > 7) {
      throw new Error('procedural branch must be 0..7');
    }
    return branch;
  });
  return Object.freeze(copy);
}

export function makeProceduralRef({
  rootId,
  address = [],
  algorithmId = 'e0',
  algorithmVersion = 'e0-prototype-1',
  neighborRefs = {}
} = {}) {
  if (!rootId) throw new Error('procedural rootId required');
  if (!algorithmId || !algorithmVersion) throw new Error('algorithm identity/version required');

  const neighbors = {};
  for (const [key, ref] of Object.entries(neighborRefs ?? {})) {
    if (!key) throw new Error('neighbor key required');
    neighbors[key] = {
      rootId: ref.rootId,
      address: normalizeProceduralAddress(ref.address ?? [])
    };
    if (!neighbors[key].rootId) throw new Error('neighbor rootId required');
  }

  return Object.freeze({
    rootId,
    address: normalizeProceduralAddress(address),
    algorithmId,
    algorithmVersion,
    neighborRefs: Object.freeze(neighbors)
  });
}

export function childProceduralRef(ref, branch) {
  const parent = makeProceduralRef(ref);
  return makeProceduralRef({
    ...parent,
    address: [...parent.address, branch],
    neighborRefs: parent.neighborRefs
  });
}

export function parentProceduralRef(ref) {
  const current = makeProceduralRef(ref);
  if (current.address.length === 0) return null;
  return makeProceduralRef({
    ...current,
    address: current.address.slice(0, -1),
    neighborRefs: current.neighborRefs
  });
}

export function proceduralRefKey(ref) {
  const current = makeProceduralRef(ref);
  return `${current.rootId}:${current.address.join('/')}`;
}

export function sameProceduralRef(a, b) {
  return proceduralRefKey(a) === proceduralRefKey(b)
    && a.algorithmId === b.algorithmId
    && a.algorithmVersion === b.algorithmVersion;
}
