import {
  VOLUME_HOMOGENEOUS,
  mixedVolume,
  validateVolumeClassification,
  aggregateCompleteOctants
} from './classification.mjs';

function validatePath(path) {
  if (!Array.isArray(path) || path.some(branch => !Number.isInteger(branch) || branch < 0 || branch > 7)) {
    throw new Error('volume refinement path must contain branches 0..7');
  }
}

export function refineVolumeClassification({
  path = [],
  maxDepth,
  probe
} = {}) {
  validatePath(path);
  if (!Number.isInteger(maxDepth) || maxDepth < path.length) {
    throw new Error('maxDepth must be >= path depth');
  }
  if (typeof probe !== 'function') throw new Error('probe callback required');

  const stats = {
    inspectedNodes: 0,
    terminalNodes: 0,
    deepestDepth: path.length,
    directHomogeneous: 0,
    unresolvedAtLimit: 0,
    reasons: Object.create(null)
  };

  function visit(currentPath) {
    stats.inspectedNodes += 1;
    stats.deepestDepth = Math.max(stats.deepestDepth, currentPath.length);

    const probed = probe(currentPath);
    const classification = validateVolumeClassification(probed?.classification ?? probed);
    const reason = probed?.reason ?? classification.kind;
    stats.reasons[reason] = (stats.reasons[reason] ?? 0) + 1;

    if (classification.kind === VOLUME_HOMOGENEOUS) {
      stats.terminalNodes += 1;
      stats.directHomogeneous += 1;
      return classification;
    }

    if (currentPath.length >= maxDepth) {
      stats.terminalNodes += 1;
      stats.unresolvedAtLimit += 1;
      return mixedVolume();
    }

    const children = [];
    for (let branch = 0; branch < 8; branch += 1) {
      children.push(visit([...currentPath, branch]));
    }
    return aggregateCompleteOctants(children);
  }

  const classification = visit([...path]);
  return Object.freeze({
    classification,
    path: Object.freeze([...path]),
    maxDepth,
    stats: Object.freeze({
      ...stats,
      reasons: Object.freeze({ ...stats.reasons })
    })
  });
}
