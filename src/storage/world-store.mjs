import { makeFractalRing } from '../rings/fractal-ring.mjs';
import { proceduralIdentityKey } from '../procedural/source-ref.mjs';

export const WORLD_STORE_VERSION = 'e1-world-store-1';
export const RECORD_ABSENT = 'ABSENT';
export const RECORD_UNLOADED = 'UNLOADED';
export const RECORD_RESIDENT = 'RESIDENT';

function objectMap() {
  return Object.create(null);
}

function cloneRing(ring) {
  return ring ? structuredClone(ring) : null;
}

function rebuildIndexes(records) {
  const bySource = objectMap();
  const byPhysicalParent = objectMap();

  for (const ring of Object.values(records)) {
    const sourceKey = proceduralIdentityKey(ring.source);
    (bySource[sourceKey] ??= []).push(ring.id);

    const parentKey = ring.physicalParentId ?? '@root';
    (byPhysicalParent[parentKey] ??= []).push(ring.id);
  }

  for (const index of [bySource, byPhysicalParent]) {
    for (const ids of Object.values(index)) ids.sort();
  }

  return { bySource, byPhysicalParent };
}

function normalizeResidentIds(records, resident) {
  const ids = objectMap();

  if (resident === 'all') {
    for (const id of Object.keys(records)) ids[id] = true;
    return ids;
  }
  if (resident === 'none' || resident == null) return ids;
  if (!Array.isArray(resident)) throw new Error('resident must be all, none, or an array of ids');

  for (const id of resident) {
    if (!records[id]) throw new Error(`cannot make missing record resident: ${id}`);
    ids[id] = true;
  }
  return ids;
}

export function validateWorldStore(store) {
  if (!store || store.version !== WORLD_STORE_VERSION) {
    throw new Error('unsupported WorldStore version');
  }

  for (const [id, ring] of Object.entries(store.records ?? {})) {
    if (id !== ring.id) throw new Error(`FractalRing id mismatch: ${id}`);
    if (ring.physicalParentId && !store.records[ring.physicalParentId]) {
      throw new Error(`missing physical parent: ${ring.physicalParentId}`);
    }
  }

  for (const id of Object.keys(store.records ?? {})) {
    const seen = new Set([id]);
    let current = store.records[id];
    while (current?.physicalParentId) {
      const parentId = current.physicalParentId;
      if (seen.has(parentId)) throw new Error(`physical FractalRing cycle at: ${parentId}`);
      seen.add(parentId);
      current = store.records[parentId];
    }
  }

  for (const id of Object.keys(store.residentIds ?? {})) {
    if (!store.records[id]) throw new Error(`resident id has no persistent record: ${id}`);
  }

  return true;
}

export function makeMemoryWorldStore({ rings = [], resident = 'all' } = {}) {
  const records = objectMap();
  for (const input of rings) {
    const ring = makeFractalRing(input);
    if (records[ring.id]) throw new Error(`duplicate FractalRing id: ${ring.id}`);
    records[ring.id] = ring;
  }

  const store = {
    version: WORLD_STORE_VERSION,
    records,
    residentIds: normalizeResidentIds(records, resident),
    indexes: rebuildIndexes(records)
  };
  validateWorldStore(store);
  return store;
}

export function ringRecordState(store, id) {
  if (!store?.records?.[id]) return RECORD_ABSENT;
  return store.residentIds?.[id] ? RECORD_RESIDENT : RECORD_UNLOADED;
}

export function hasFractalRingRecord(store, id) {
  return ringRecordState(store, id) !== RECORD_ABSENT;
}

export function readResidentFractalRing(store, id) {
  return ringRecordState(store, id) === RECORD_RESIDENT
    ? cloneRing(store.records[id])
    : null;
}

export function loadFractalRingRecord(store, id) {
  const state = ringRecordState(store, id);
  if (state === RECORD_ABSENT) {
    return { store, state, ring: null };
  }
  if (state === RECORD_RESIDENT) {
    return { store, state, ring: cloneRing(store.records[id]) };
  }

  const next = {
    ...store,
    residentIds: { ...store.residentIds, [id]: true }
  };
  validateWorldStore(next);
  return { store: next, state: RECORD_RESIDENT, ring: cloneRing(store.records[id]) };
}

export function unloadFractalRingRecord(store, id) {
  const state = ringRecordState(store, id);
  if (state === RECORD_ABSENT || state === RECORD_UNLOADED) return store;

  const residentIds = { ...store.residentIds };
  delete residentIds[id];
  const next = { ...store, residentIds };
  validateWorldStore(next);
  return next;
}

export function putFractalRingRecord(store, input, { resident = true } = {}) {
  validateWorldStore(store);
  const ring = makeFractalRing(input);
  const records = { ...store.records, [ring.id]: ring };
  const residentIds = { ...store.residentIds };

  if (resident) residentIds[ring.id] = true;
  else delete residentIds[ring.id];

  const next = {
    ...store,
    records,
    residentIds,
    indexes: rebuildIndexes(records)
  };
  validateWorldStore(next);
  return next;
}

export function deleteFractalRingRecord(store, id) {
  validateWorldStore(store);
  if (!store.records[id]) return store;

  const children = ringIdsForPhysicalParent(store, id);
  if (children.length) {
    throw new Error(`cannot delete FractalRing with physical children: ${id}`);
  }

  const records = { ...store.records };
  const residentIds = { ...store.residentIds };
  delete records[id];
  delete residentIds[id];

  const next = {
    ...store,
    records,
    residentIds,
    indexes: rebuildIndexes(records)
  };
  validateWorldStore(next);
  return next;
}

export function ringIdsForProceduralSource(store, ref) {
  return [...(store.indexes.bySource[proceduralIdentityKey(ref)] ?? [])];
}

export function ringIdsForPhysicalParent(store, parentId = null) {
  return [...(store.indexes.byPhysicalParent[parentId ?? '@root'] ?? [])];
}

export function worldStoreStats(store) {
  validateWorldStore(store);
  const persisted = Object.keys(store.records).length;
  const resident = Object.keys(store.residentIds).filter(id => store.records[id]).length;
  return { persisted, resident, unloaded: persisted - resident };
}

export function serializePersistentWorldStore(store) {
  validateWorldStore(store);
  const rings = Object.values(store.records)
    .map(cloneRing)
    .sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify({ version: WORLD_STORE_VERSION, rings });
}

export function loadPersistentWorldStore(json, { resident = 'none' } = {}) {
  const parsed = JSON.parse(json);
  if (!parsed || parsed.version !== WORLD_STORE_VERSION || !Array.isArray(parsed.rings)) {
    throw new Error('unsupported persistent WorldStore snapshot');
  }
  return makeMemoryWorldStore({ rings: parsed.rings, resident });
}
