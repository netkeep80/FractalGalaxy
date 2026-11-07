import { makeFractalRing } from './fractal-ring.mjs';
import { proceduralIdentityKey } from '../procedural/source-ref.mjs';

export function makeSparseRingStore(rings = []) {
  const byId = Object.create(null);
  for (const ring of rings) {
    const normalized = makeFractalRing(ring);
    if (byId[normalized.id]) throw new Error(`duplicate FractalRing id: ${normalized.id}`);
    byId[normalized.id] = normalized;
  }
  return { byId };
}

export function putFractalRing(store, ring) {
  const normalized = makeFractalRing(ring);
  return {
    byId: {
      ...store.byId,
      [normalized.id]: normalized
    }
  };
}

export function getFractalRing(store, id) {
  return store.byId[id] ?? null;
}

export function ringsForProceduralSource(store, ref) {
  const key = proceduralIdentityKey(ref);
  return Object.values(store.byId).filter(ring => proceduralIdentityKey(ring.source) === key);
}

export function ringsForPhysicalParent(store, parentId = null) {
  return Object.values(store.byId).filter(ring => ring.physicalParentId === parentId);
}

export function sparseRingCount(store) {
  return Object.keys(store.byId).length;
}
