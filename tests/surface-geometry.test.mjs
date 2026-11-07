import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VOLUME_HOMOGENEOUS,
  VOLUME_MIXED,
  INTERFACE_NONE,
  INTERFACE_PRESENT,
  INTERFACE_REFINE,
  homogeneousVolume,
  mixedVolume,
  aggregateCompleteOctants,
  classifyMaterialInterface,
  incidentOctantsForFace,
  makeReferenceFacePatch,
  subdivideReferenceFacePatch,
  cellLocalToReference,
  deformReferencePoint,
  cubeToSphereDeformation
} from '../src/fractal-matter.mjs';

test('volume classification can certify homogeneous media without materializing children', () => {
  const rock = homogeneousVolume('ROCK');
  assert.equal(rock.kind, VOLUME_HOMOGENEOUS);
  assert.equal(rock.medium, 'ROCK');

  const complete = aggregateCompleteOctants(Array.from({ length: 8 }, () => homogeneousVolume('ROCK')));
  assert.deepEqual(complete, rock);

  const mixed = aggregateCompleteOctants([
    ...Array.from({ length: 7 }, () => homogeneousVolume('ROCK')),
    homogeneousVolume('EMPTY')
  ]);
  assert.equal(mixed.kind, VOLUME_MIXED);
});

test('material interface is derived from media on both sides', () => {
  assert.equal(
    classifyMaterialInterface(homogeneousVolume('ROCK'), homogeneousVolume('ROCK')).kind,
    INTERFACE_NONE
  );

  const exterior = classifyMaterialInterface(
    homogeneousVolume('ROCK'),
    homogeneousVolume('EMPTY')
  );
  assert.equal(exterior.kind, INTERFACE_PRESENT);
  assert.equal(exterior.leftMedium, 'ROCK');
  assert.equal(exterior.rightMedium, 'EMPTY');

  const internal = classifyMaterialInterface(
    homogeneousVolume('ROCK'),
    homogeneousVolume('ICE')
  );
  assert.equal(internal.kind, INTERFACE_PRESENT);

  assert.equal(
    classifyMaterialInterface(mixedVolume(), homogeneousVolume('EMPTY')).kind,
    INTERFACE_REFINE
  );
});

test('surface refinement touches only four incident octants of each cube face', () => {
  assert.deepEqual(incidentOctantsForFace('x', -1), [0, 2, 4, 6]);
  assert.deepEqual(incidentOctantsForFace('x', 1), [1, 3, 5, 7]);
  assert.deepEqual(incidentOctantsForFace('y', -1), [0, 1, 4, 5]);
  assert.deepEqual(incidentOctantsForFace('z', 1), [4, 5, 6, 7]);

  const children = subdivideReferenceFacePatch(makeReferenceFacePatch());
  assert.equal(children.length, 4);
  assert.deepEqual(children[0], { u0: 0, u1: 0.5, v0: 0, v1: 0.5 });
  assert.deepEqual(children[3], { u0: 0.5, u1: 1, v0: 0.5, v1: 1 });
});

test('shared topological boundary has one deformed position independent of adjacent cell side', () => {
  const leftBounds = { min: [-1, -1, -1], max: [0, 1, 1] };
  const rightBounds = { min: [0, -1, -1], max: [1, 1, 1] };

  const fromLeft = cellLocalToReference(leftBounds, [1, 0.25, 0.75]);
  const fromRight = cellLocalToReference(rightBounds, [0, 0.25, 0.75]);
  assert.deepEqual(fromLeft, fromRight);

  const a = deformReferencePoint(fromLeft, point => cubeToSphereDeformation(point));
  const b = deformReferencePoint(fromRight, point => cubeToSphereDeformation(point));
  assert.deepEqual(a, b);
});

test('cube-to-sphere deformation proves the octree cube is topology, not final geometry', () => {
  const corner = cubeToSphereDeformation([1, 1, 1]);
  const radius = Math.hypot(...corner);

  assert.ok(Math.abs(radius - 1) < 1e-12);
  assert.notDeepEqual(corner, [1, 1, 1]);

  const faceCenter = cubeToSphereDeformation([1, 0, 0], { radius: 3 });
  assert.deepEqual(faceCenter, [3, 0, 0]);
});
