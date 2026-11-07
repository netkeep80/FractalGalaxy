const U32 = 0x1_0000_0000;
export const E0_VERSION = 'e0-prototype-1';
export const DOMAIN = Object.freeze({ min: -1, max: 1, depth: 5 });

export const EMPTY = Object.freeze({ kind: 'EMPTY' });
export const NOT_OWNED = Object.freeze({ kind: 'NOT_OWNED' });
export const solid = (materialId = 'rock', density = 1) => {
  if (!materialId || !Number.isFinite(density) || density <= 0) throw new Error('invalid SOLID');
  return Object.freeze({ kind: 'SOLID', materialId, density });
};

function u32(x) { return x >>> 0; }
function imul(a, b) { return Math.imul(a, b) >>> 0; }

export function derive32(parentState, branch) {
  if (!Number.isInteger(branch) || branch < 0 || branch > 7) throw new Error('branch must be 0..7');
  let x = u32(parentState) ^ imul(branch + 1, 0x9e3779b9);
  x = u32(x ^ (x >>> 16));
  x = imul(x, 0x7feb352d);
  x = u32(x ^ (x >>> 15));
  x = imul(x, 0x846ca68b);
  x = u32(x ^ (x >>> 16));
  return x;
}

export function octantIndex(point, bounds) {
  const mid = [0, 1, 2].map(i => (bounds.min[i] + bounds.max[i]) / 2);
  const bx = point[0] >= mid[0] ? 1 : 0;
  const by = point[1] >= mid[1] ? 1 : 0;
  const bz = point[2] >= mid[2] ? 1 : 0;
  return bx + 2 * by + 4 * bz;
}

export function childBounds(bounds, branch) {
  const mid = [0, 1, 2].map(i => (bounds.min[i] + bounds.max[i]) / 2);
  const bits = [branch & 1, (branch >> 1) & 1, (branch >> 2) & 1];
  const min = [], max = [];
  for (let i = 0; i < 3; i++) {
    if (bits[i]) { min[i] = mid[i]; max[i] = bounds.max[i]; }
    else { min[i] = bounds.min[i]; max[i] = mid[i]; }
  }
  return { min, max };
}

export function addressForPoint(point, depth = DOMAIN.depth) {
  if (depth < 0 || depth > DOMAIN.depth) throw new Error('unsupported depth');
  if (point.some(x => !Number.isFinite(x) || x < DOMAIN.min || x > DOMAIN.max)) throw new Error('point outside E0 domain');
  let bounds = { min: [DOMAIN.min, DOMAIN.min, DOMAIN.min], max: [DOMAIN.max, DOMAIN.max, DOMAIN.max] };
  const path = [];
  for (let level = 0; level < depth; level++) {
    const branch = octantIndex(point, bounds);
    path.push(branch);
    bounds = childBounds(bounds, branch);
  }
  return { path, bounds };
}

export function stateForPath(rootState, path) {
  let state = u32(rootState);
  for (const branch of path) state = derive32(state, branch);
  return state;
}

export function makeGamma({ rootSeed = 0, alphaNeighbor = 0, boundaryKey = 'boundary:default', fixture = 'height' } = {}) {
  if (!Number.isInteger(alphaNeighbor) || alphaNeighbor < -8 || alphaNeighbor > 8) throw new Error('alphaNeighbor must be integer -8..8');
  if (!boundaryKey) throw new Error('boundaryKey required');
  if (!['height', 'solid'].includes(fixture)) throw new Error('unsupported fixture');
  return Object.freeze({ version: E0_VERSION, rootSeed: u32(rootSeed), alphaNeighbor, boundaryKey, fixture });
}

export function baseValue(point, gamma, depth = DOMAIN.depth) {
  if (!gamma || gamma.version !== E0_VERSION) throw new Error('unsupported Γ version');
  if (gamma.fixture === 'solid') return solid('rock', 1);
  const { path } = addressForPoint(point, depth);
  const state = stateForPath(gamma.rootSeed, path);
  const h = (((state & 15) - 8) / 128) + (gamma.alphaNeighbor / 16);
  return point[2] <= h ? solid('rock', 1) : EMPTY;
}

function pathKey(path) { return path.join('/'); }
function isPrefix(prefix, full) { return prefix.length <= full.length && prefix.every((v, i) => full[i] === v); }

export function normalizeEdits(edits = []) {
  const seen = new Set();
  return edits.map(e => {
    if (!Array.isArray(e.path) || e.path.some(b => !Number.isInteger(b) || b < 0 || b > 7) || e.path.length > DOMAIN.depth) throw new Error('invalid D path');
    if (!e.value || !['EMPTY', 'SOLID'].includes(e.value.kind)) throw new Error('invalid D value');
    const key = pathKey(e.path);
    if (seen.has(key)) throw new Error(`conflicting D entry at ${key}`);
    seen.add(key);
    if (e.value.kind === 'SOLID') solid(e.value.materialId, e.value.density);
    return structuredClone(e);
  });
}

export function resolveM(point, gamma, edits = []) {
  const { path } = addressForPoint(point, DOMAIN.depth);
  let winner = null;
  for (const edit of edits) {
    if (isPrefix(edit.path, path) && (!winner || edit.path.length > winner.path.length)) winner = edit;
  }
  if (winner) return winner.value.kind === 'EMPTY' ? EMPTY : solid(winner.value.materialId, winner.value.density);
  return baseValue(point, gamma, DOMAIN.depth);
}

export function allSpaceMask() { return Object.freeze({ clauses: [] }); }
function planeValue(point, plane) { return plane.normal[0]*point[0] + plane.normal[1]*point[1] + plane.normal[2]*point[2] - plane.offset; }
export function inMask(point, mask) {
  return (mask?.clauses ?? []).every(c => c.side === 'lt' ? planeValue(point, c) < 0 : planeValue(point, c) >= 0);
}

export function makeMaterial({ id, gamma, edits = [], mask = allSpaceMask() }) {
  if (!id) throw new Error('material id required');
  return { id, gamma, edits: normalizeEdits(edits), mask: structuredClone(mask) };
}

export function queryMaterial(material, point) {
  if (!inMask(point, material.mask)) return NOT_OWNED;
  return resolveM(point, material.gamma, material.edits);
}

export function splitMaterial(material, plane, { leftId, rightId } = {}) {
  if (!leftId || !rightId || leftId === rightId || leftId === material.id || rightId === material.id) throw new Error('new distinct material ids required');
  if (!plane || !Array.isArray(plane.normal) || plane.normal.length !== 3 || plane.normal.every(x => x === 0) || !plane.normal.every(Number.isFinite) || !Number.isFinite(plane.offset)) throw new Error('invalid plane');
  const leftClause = { normal: [...plane.normal], offset: plane.offset, side: 'lt' };
  const rightClause = { normal: [...plane.normal], offset: plane.offset, side: 'ge' };
  const common = material.mask?.clauses ?? [];
  return {
    retiredId: material.id,
    left: makeMaterial({ id: leftId, gamma: material.gamma, edits: material.edits, mask: { clauses: [...common, leftClause] } }),
    right: makeMaterial({ id: rightId, gamma: material.gamma, edits: material.edits, mask: { clauses: [...common, rightClause] } }),
  };
}

function cross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function add(a,b){ return a.map((x,i)=>x+b[i]); }
function sub(a,b){ return a.map((x,i)=>x-b[i]); }
function nearVec(a,b,eps=1e-12){ return a.every((x,i)=>Math.abs(x-b[i])<=eps); }

export function makePhysicalNode({ id, materialId = null, position = [0,0,0], velocity = [0,0,0], angularVelocity = [0,0,0], parentId = null, children = [] }) {
  if (!id) throw new Error('physical id required');
  return { id, materialId, position:[...position], velocity:[...velocity], angularVelocity:[...angularVelocity], parentId, children:[...children] };
}

export function makeWorld({ materials = [], nodes = [] } = {}) {
  const world = { version: E0_VERSION, materials: Object.fromEntries(materials.map(m => [m.id, structuredClone(m)])), nodes: Object.fromEntries(nodes.map(n => [n.id, structuredClone(n)])) };
  validateWorld(world);
  return world;
}

export function contact(world, aId, bId) {
  if (!world.nodes[aId] || !world.nodes[bId]) throw new Error('missing physical node');
  return structuredClone(world);
}

export function attach(world, aId, bId, kId) {
  const next = structuredClone(world);
  if (aId === bId || !kId || next.nodes[kId]) throw new Error('invalid Attach ids');
  const a = next.nodes[aId], b = next.nodes[bId];
  if (!a || !b || a.parentId || b.parentId) throw new Error('Attach requires two live roots');
  if (!nearVec(a.angularVelocity, b.angularVelocity)) throw new Error('incompatible angular velocity');
  const omega = [...a.angularVelocity];
  const center = a.position.map((x,i)=>(x+b.position[i])/2);
  const vKa = sub(a.velocity, cross(omega, sub(a.position, center)));
  const vKb = sub(b.velocity, cross(omega, sub(b.position, center)));
  if (!nearVec(vKa, vKb)) throw new Error('incompatible rigid motion');
  next.nodes[kId] = makePhysicalNode({ id:kId, position:center, velocity:vKa, angularVelocity:omega, children:[aId,bId] });
  a.parentId = kId; b.parentId = kId;
  validateWorld(next);
  return next;
}

export function detach(world, childId) {
  const next = structuredClone(world);
  const child = next.nodes[childId];
  if (!child || !child.parentId) throw new Error('Detach requires a child');
  const parent = next.nodes[child.parentId];
  if (!parent) throw new Error('missing parent');
  child.velocity = add(parent.velocity, cross(parent.angularVelocity, sub(child.position, parent.position)));
  child.angularVelocity = [...parent.angularVelocity];
  parent.children = parent.children.filter(id => id !== childId);
  child.parentId = null;
  if (parent.children.length === 0 && !parent.materialId) delete next.nodes[parent.id];
  validateWorld(next);
  return next;
}

export function integrateMass(material, depth = DOMAIN.depth) {
  if (depth < 0 || depth > DOMAIN.depth) throw new Error('unsupported depth');
  const n = 2 ** depth, step = (DOMAIN.max - DOMAIN.min) / n, cellVolume = step ** 3;
  let mass = 0;
  for (let ix=0; ix<n; ix++) for (let iy=0; iy<n; iy++) for (let iz=0; iz<n; iz++) {
    const p = [DOMAIN.min+(ix+0.5)*step, DOMAIN.min+(iy+0.5)*step, DOMAIN.min+(iz+0.5)*step];
    const value = queryMaterial(material, p);
    if (value.kind === 'SOLID') mass += value.density * cellVolume;
  }
  return mass;
}

export function saveWorld(world) {
  validateWorld(world);
  return JSON.stringify(world);
}

export function loadWorld(json) {
  const parsed = JSON.parse(json);
  if (parsed.version !== E0_VERSION) throw new Error('unsupported world version');
  validateWorld(parsed);
  return parsed;
}

export function validateWorld(world) {
  if (!world || world.version !== E0_VERSION) throw new Error('unsupported world version');
  const nodes = world.nodes ?? {};
  for (const [id,node] of Object.entries(nodes)) {
    if (id !== node.id) throw new Error('physical id mismatch');
    if (node.parentId && !nodes[node.parentId]) throw new Error('missing parent');
    for (const childId of node.children ?? []) {
      if (!nodes[childId]) throw new Error('missing child');
      if (nodes[childId].parentId !== id) throw new Error('double/inconsistent parent');
    }
    if (node.materialId && !world.materials?.[node.materialId]) throw new Error('missing material');
  }
  for (const id of Object.keys(nodes)) {
    const seen = new Set();
    let cur = nodes[id];
    while (cur?.parentId) {
      if (seen.has(cur.parentId)) throw new Error('physical cycle');
      seen.add(cur.parentId);
      cur = nodes[cur.parentId];
    }
  }
  for (const [id,m] of Object.entries(world.materials ?? {})) {
    if (id !== m.id) throw new Error('material id mismatch');
    if (!m.gamma || m.gamma.version !== E0_VERSION) throw new Error('missing/unsupported Γ');
    normalizeEdits(m.edits ?? []);
  }
  return true;
}


// E1 sparse FractalRing overlay primitives.
// Kept behind the E0 facade so existing tests and demos remain source-compatible.
export {
  normalizeProceduralAddress,
  makeProceduralRef,
  childProceduralRef,
  parentProceduralRef,
  proceduralRefKey,
  proceduralIdentityKey,
  sameProceduralRef
} from './procedural/source-ref.mjs';

export {
  shouldMaterializeFractalRing,
  makeFractalRing,
  reparentFractalRing,
  overrideFractalRing
} from './rings/fractal-ring.mjs';


export {
  WORLD_STORE_VERSION,
  RECORD_ABSENT,
  RECORD_UNLOADED,
  RECORD_RESIDENT,
  makeMemoryWorldStore,
  ringRecordState,
  hasFractalRingRecord,
  readResidentFractalRing,
  loadFractalRingRecord,
  unloadFractalRingRecord,
  putFractalRingRecord,
  deleteFractalRingRecord,
  ringIdsForProceduralSource,
  ringIdsForPhysicalParent,
  worldStoreStats,
  serializePersistentWorldStore,
  loadPersistentWorldStore,
  validateWorldStore
} from './storage/world-store.mjs';
