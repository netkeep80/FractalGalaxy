function validatePath(path) {
  if (!Array.isArray(path) || path.some(branch => !Number.isInteger(branch) || branch < 0 || branch > 7)) {
    throw new Error('octree path must contain branches 0..7');
  }
  return path;
}

function axisIndex(axis) {
  if (axis === 'x') return 0;
  if (axis === 'y') return 1;
  if (axis === 'z') return 2;
  throw new Error('axis must be x, y, or z');
}

export function octreePathToGrid(path) {
  validatePath(path);
  let x = 0, y = 0, z = 0;
  for (const branch of path) {
    x = (x << 1) | (branch & 1);
    y = (y << 1) | ((branch >> 1) & 1);
    z = (z << 1) | ((branch >> 2) & 1);
  }
  return { depth: path.length, x, y, z };
}

export function octreeGridToPath({ depth, x, y, z }) {
  if (!Number.isInteger(depth) || depth < 0 || depth > 30) throw new Error('invalid octree depth');
  const size = 2 ** depth;
  for (const [name, value] of Object.entries({ x, y, z })) {
    if (!Number.isInteger(value) || value < 0 || value >= size) {
      throw new Error(`${name} outside octree grid`);
    }
  }

  const path = [];
  for (let level = depth - 1; level >= 0; level -= 1) {
    const bx = (x >> level) & 1;
    const by = (y >> level) & 1;
    const bz = (z >> level) & 1;
    path.push(bx + 2 * by + 4 * bz);
  }
  return path;
}

export function adjacentOctreePath(path, axis, side) {
  validatePath(path);
  const a = axisIndex(axis);
  if (side !== -1 && side !== 1) throw new Error('side must be -1 or 1');

  const grid = octreePathToGrid(path);
  const coords = [grid.x, grid.y, grid.z];
  coords[a] += side;
  const size = 2 ** grid.depth;
  if (coords[a] < 0 || coords[a] >= size) return null;

  return octreeGridToPath({
    depth: grid.depth,
    x: coords[0],
    y: coords[1],
    z: coords[2]
  });
}

export function octreeBoundsForPath(path, { min = -1, max = 1 } = {}) {
  validatePath(path);
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(min < max)) {
    throw new Error('invalid octree domain');
  }
  const { depth, x, y, z } = octreePathToGrid(path);
  const size = 2 ** depth;
  const step = (max - min) / size;
  const coords = [x, y, z];
  return {
    min: coords.map(value => min + value * step),
    max: coords.map(value => min + (value + 1) * step)
  };
}

export function octreeCellCenter(path, domain) {
  const bounds = octreeBoundsForPath(path, domain);
  return bounds.min.map((value, axis) => (value + bounds.max[axis]) / 2);
}
