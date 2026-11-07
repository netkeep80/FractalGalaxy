import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RECORD_ABSENT,
  RECORD_UNLOADED,
  RECORD_RESIDENT,
  makeProceduralRef,
  makeFractalRing,
  makeMemoryWorldStore,
  ringRecordState,
  readResidentFractalRing,
  loadFractalRingRecord,
  unloadFractalRingRecord,
  putFractalRingRecord,
  deleteFractalRingRecord,
  ringIdsForProceduralSource,
  ringIdsForPhysicalParent,
  worldStoreStats,
  serializePersistentWorldStore,
  loadPersistentWorldStore
} from '../src/fractal-matter.mjs';

function ring(id, address, extra = {}) {
  return makeFractalRing({
    id,
    source: makeProceduralRef({
      rootId: 'planet-1',
      address,
      algorithmId: extra.algorithmId ?? 'planet',
      algorithmVersion: extra.algorithmVersion ?? '1'
    }),
    physicalParentId: extra.physicalParentId ?? null,
    overrides: extra.overrides ?? {}
  });
}

test('WorldStore distinguishes missing record, unloaded record, and resident record', () => {
  const store = makeMemoryWorldStore({
    rings: [ring('deep-change', [5, 2, 7, 3])],
    resident: 'none'
  });

  assert.equal(ringRecordState(store, 'not-created'), RECORD_ABSENT);
  assert.equal(ringRecordState(store, 'deep-change'), RECORD_UNLOADED);
  assert.equal(readResidentFractalRing(store, 'deep-change'), null);

  const loaded = loadFractalRingRecord(store, 'deep-change');
  assert.equal(loaded.state, RECORD_RESIDENT);
  assert.equal(loaded.ring.id, 'deep-change');
  assert.equal(ringRecordState(loaded.store, 'deep-change'), RECORD_RESIDENT);

  const unloaded = unloadFractalRingRecord(loaded.store, 'deep-change');
  assert.equal(ringRecordState(unloaded, 'deep-change'), RECORD_UNLOADED);
  assert.equal(worldStoreStats(unloaded).persisted, 1);
  assert.equal(worldStoreStats(unloaded).resident, 0);
});

test('indexes operate on persistent records independently of residency', () => {
  const source = makeProceduralRef({
    rootId: 'planet-1',
    address: [5, 2, 7, 3],
    algorithmId: 'planet',
    algorithmVersion: '1'
  });

  let store = makeMemoryWorldStore({ rings: [], resident: 'none' });
  store = putFractalRingRecord(store, makeFractalRing({
    id: 'changed',
    source,
    overrides: { deltaRevision: 3 }
  }), { resident: false });

  assert.equal(ringRecordState(store, 'changed'), RECORD_UNLOADED);
  assert.deepEqual(ringIdsForProceduralSource(store, source), ['changed']);
  assert.deepEqual(ringIdsForPhysicalParent(store, null), ['changed']);
});

test('same procedural location with another algorithm version is a different source identity', () => {
  const a = ring('a', [1, 2, 3], { algorithmVersion: '1' });
  const b = ring('b', [1, 2, 3], { algorithmVersion: '2' });
  const store = makeMemoryWorldStore({ rings: [a, b], resident: 'none' });

  assert.deepEqual(ringIdsForProceduralSource(store, a.source), ['a']);
  assert.deepEqual(ringIdsForProceduralSource(store, b.source), ['b']);
});

test('persistent snapshot does not persist transient residency', () => {
  const sourceRing = ring('fragment', [6, 1, 4]);
  const store = makeMemoryWorldStore({ rings: [sourceRing], resident: 'all' });
  assert.equal(ringRecordState(store, 'fragment'), RECORD_RESIDENT);

  const json = serializePersistentWorldStore(store);
  const cold = loadPersistentWorldStore(json);

  assert.equal(ringRecordState(cold, 'fragment'), RECORD_UNLOADED);
  assert.deepEqual(cold.records.fragment.source.address, [6, 1, 4]);

  const loaded = loadFractalRingRecord(cold, 'fragment');
  assert.equal(loaded.ring.id, 'fragment');
  assert.equal(ringRecordState(loaded.store, 'fragment'), RECORD_RESIDENT);
});

test('unloaded physical parent remains valid and cannot be deleted while children refer to it', () => {
  const parent = ring('ship', []);
  const child = ring('rock', [2, 3], { physicalParentId: 'ship' });
  const store = makeMemoryWorldStore({ rings: [parent, child], resident: 'none' });

  assert.equal(ringRecordState(store, 'ship'), RECORD_UNLOADED);
  assert.deepEqual(ringIdsForPhysicalParent(store, 'ship'), ['rock']);
  assert.throws(
    () => deleteFractalRingRecord(store, 'ship'),
    /physical children/
  );

  const withoutChild = deleteFractalRingRecord(store, 'rock');
  const withoutParent = deleteFractalRingRecord(withoutChild, 'ship');
  assert.equal(ringRecordState(withoutParent, 'ship'), RECORD_ABSENT);
});

test('persistent physical forest rejects missing parents and cycles regardless of residency', () => {
  assert.throws(
    () => makeMemoryWorldStore({
      rings: [ring('orphan', [1], { physicalParentId: 'missing' })],
      resident: 'none'
    }),
    /missing physical parent/
  );

  const a = ring('a', [1], { physicalParentId: 'b' });
  const b = ring('b', [2], { physicalParentId: 'a' });
  assert.throws(
    () => makeMemoryWorldStore({ rings: [a, b], resident: 'none' }),
    /physical FractalRing cycle/
  );
});
