import {
  INTERFACE_NONE,
  INTERFACE_PRESENT,
  INTERFACE_REFINE,
  classifyMaterialInterface,
  makeReferenceFacePatch,
  subdivideReferenceFacePatch
} from './interface.mjs';

function validatePath(path, name) {
  if (path === null) return null;
  if (!Array.isArray(path) || path.some(branch => !Number.isInteger(branch) || branch < 0 || branch > 7)) {
    throw new Error(`${name} must be an octree path or null`);
  }
  return path;
}

function axisIndex(axis) {
  if (axis === 'x') return 0;
  if (axis === 'y') return 1;
  if (axis === 'z') return 2;
  throw new Error('axis must be x, y, or z');
}

function branchFromBits(bits) {
  return bits[0] + 2 * bits[1] + 4 * bits[2];
}

export function faceChildPairs(axis, side) {
  const normal = axisIndex(axis);
  if (side !== -1 && side !== 1) throw new Error('side must be -1 or 1');

  const tangent = [0, 1, 2].filter(index => index !== normal);
  const aNormalBit = side === 1 ? 1 : 0;
  const bNormalBit = 1 - aNormalBit;
  const pairs = [];

  // Order matches subdivideReferenceFacePatch:
  // (u-,v-), (u+,v-), (u-,v+), (u+,v+).
  for (let patchIndex = 0; patchIndex < 4; patchIndex += 1) {
    const uBit = patchIndex & 1;
    const vBit = (patchIndex >> 1) & 1;
    const aBits = [0, 0, 0];
    const bBits = [0, 0, 0];
    aBits[normal] = aNormalBit;
    bBits[normal] = bNormalBit;
    aBits[tangent[0]] = bBits[tangent[0]] = uBit;
    aBits[tangent[1]] = bBits[tangent[1]] = vBit;

    pairs.push(Object.freeze({
      patchIndex,
      branchA: branchFromBits(aBits),
      branchB: branchFromBits(bBits)
    }));
  }

  return Object.freeze(pairs);
}

export function extractInterfacePatches({
  pathA,
  pathB,
  axis,
  side,
  maxDepth,
  classifyA,
  classifyB,
  patch = makeReferenceFacePatch()
} = {}) {
  validatePath(pathA, 'pathA');
  validatePath(pathB, 'pathB');
  if (!Array.isArray(pathA)) throw new Error('pathA required');
  if (pathB && pathB.length !== pathA.length) throw new Error('A/B paths must have same depth');
  if (!Number.isInteger(maxDepth) || maxDepth < pathA.length) {
    throw new Error('maxDepth must be >= starting depth');
  }
  if (typeof classifyA !== 'function' || typeof classifyB !== 'function') {
    throw new Error('classifyA/classifyB callbacks required');
  }

  const present = [];
  const unresolved = [];
  const stats = {
    visitedPairs: 0,
    discardedPatches: 0,
    presentPatches: 0,
    unresolvedPatches: 0,
    deepestDepth: pathA.length
  };

  function visit(currentA, currentB, currentPatch) {
    const depth = currentA.length;
    stats.visitedPairs += 1;
    stats.deepestDepth = Math.max(stats.deepestDepth, depth);

    const classificationA = classifyA(currentA);
    const classificationB = classifyB(currentB);
    const decision = classifyMaterialInterface(classificationA, classificationB);

    if (decision.kind === INTERFACE_NONE) {
      stats.discardedPatches += 1;
      return;
    }

    const record = {
      depth,
      pathA: Object.freeze([...currentA]),
      pathB: currentB ? Object.freeze([...currentB]) : null,
      patch: currentPatch,
      decision
    };

    if (decision.kind === INTERFACE_PRESENT) {
      present.push(Object.freeze(record));
      stats.presentPatches += 1;
      return;
    }

    if (decision.kind !== INTERFACE_REFINE) throw new Error('unknown interface decision');

    if (depth >= maxDepth) {
      unresolved.push(Object.freeze(record));
      stats.unresolvedPatches += 1;
      return;
    }

    const subpatches = subdivideReferenceFacePatch(currentPatch);
    const pairs = faceChildPairs(axis, side);
    for (const pair of pairs) {
      visit(
        [...currentA, pair.branchA],
        currentB ? [...currentB, pair.branchB] : null,
        subpatches[pair.patchIndex]
      );
    }
  }

  visit([...pathA], pathB ? [...pathB] : null, makeReferenceFacePatch(patch));

  return Object.freeze({
    present: Object.freeze(present),
    unresolved: Object.freeze(unresolved),
    stats: Object.freeze({ ...stats })
  });
}
