import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const requirementsUrl = new URL('../requirements/', import.meta.url);
const ROOTS = new Set(['FG-PRODUCT-000', 'FG-PROJECT-000']);

function requirementId(text, path) {
  const match = /^id:\s*([^\s]+)\s*$/m.exec(text);
  assert.ok(match, `${path}: missing id`);
  return match[1];
}

function derivesFromIds(text) {
  const ids = [];
  const pattern = /- predicates: \[derives_from\]\s*\n\s*target:\s*\n\s*kind: requirement\s*\n\s*id:\s*([^\s]+)\s*/g;
  for (const match of text.matchAll(pattern)) ids.push(match[1]);
  return ids;
}

test('Requirement graph has exactly two roots and every other Requirement has one primary derives_from parent', async () => {
  const names = (await readdir(requirementsUrl)).filter(name => name.endsWith('.rg.yaml')).sort();
  const parentById = new Map();

  for (const name of names) {
    const text = await readFile(new URL(name, requirementsUrl), 'utf8');
    const id = requirementId(text, name);
    const parents = derivesFromIds(text);

    if (ROOTS.has(id)) {
      assert.deepEqual(parents, [], `${id}: root must not derive_from another Requirement`);
    } else {
      assert.equal(parents.length, 1, `${id}: expected exactly one primary derives_from parent`);
      parentById.set(id, parents[0]);
    }
  }

  const ids = new Set([...parentById.keys(), ...ROOTS]);
  for (const [id, parent] of parentById) {
    assert.ok(ids.has(parent), `${id}: missing derives_from parent ${parent}`);
  }

  for (const id of ids) {
    const seen = new Set();
    let current = id;
    while (parentById.has(current)) {
      assert.ok(!seen.has(current), `Requirement hierarchy cycle at ${current}`);
      seen.add(current);
      current = parentById.get(current);
    }
    assert.ok(ROOTS.has(current), `${id}: hierarchy does not terminate at a declared root`);
  }
});
