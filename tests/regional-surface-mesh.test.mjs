import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY,makeGamma,makeMaterial,octreeGridToPath,
  makeProceduralRef,makeMemoryWorldStore,applyVertexInfluence,
  serializePersistentWorldStore,loadPersistentWorldStore,
  worldGeometryOffsets,splitGeometryFractalRing,
  makeFractalVertexDeformation,cubeToSphereDeformation
} from '../src/fractal-matter.mjs';
import {extractAdaptiveRegionalMaterialInterfaces} from '../src/surface/adaptive-regional-extractor.mjs';
import {assembleRegionalSurfaceMesh} from '../src/geometry/regional-surface-mesh.mjs';
import {stitchCoarseFineInterface} from '../src/geometry/coarse-fine-stitch.mjs';

function setup(){
  const coarse=octreeGridToPath({depth:2,x:1,y:1,z:1});
  const fine=[];
  for(const y of [2,3])for(const z of [2,3])fine.push(octreeGridToPath({depth:3,x:4,y,z}));
  const material=makeMaterial({
    id:'adaptive',
    gamma:makeGamma({rootSeed:11,fixture:'solid'}),
    edits:[{path:coarse,value:EMPTY}]
  });
  const extraction=extractAdaptiveRegionalMaterialInterfaces(material,{
    cellPaths:[coarse,...fine],maxDepth:3,outsideMedium:'EMPTY'
  });
  return {coarse,fine,material,extraction};
}

test('S3-B regional mesh integrates the adaptive 1:4 seam without T-junction vertices',()=>{
  const {coarse,fine,extraction}=setup();
  const mesh=assembleRegionalSurfaceMesh({extraction,targetDepth:3});
  assert.deepEqual(mesh.stats,{
    targetDepth:3,faceRecords:8,provenPatches:4,unresolvedPatches:0,unresolvedCells:0,vertices:9,triangles:8
  });
  assert.equal(new Set(mesh.vertices.map(v=>v.key)).size,9);
  assert.ok(mesh.vertices.every(v=>v.reference[0]===0));

  const coarseBounds={min:[-.5,-.5,-.5],max:[0,0,0]};
  const fineFaces=[
    {bounds:{min:[0,-.5,-.5],max:[.25,-.25,-.25]},axis:'x',side:-1},
    {bounds:{min:[0,-.25,-.5],max:[.25,0,-.25]},axis:'x',side:-1},
    {bounds:{min:[0,-.5,-.25],max:[.25,-.25,0]},axis:'x',side:-1},
    {bounds:{min:[0,-.25,-.25],max:[.25,0,0]},axis:'x',side:-1}
  ];
  const seam=stitchCoarseFineInterface({
    coarse:{bounds:coarseBounds,axis:'x',side:1},fineFaces
  });
  assert.deepEqual(
    mesh.vertices.map(v=>v.key).sort(),
    seam.vertices.map(v=>v.key).sort()
  );
});

test('S3-B/S3-RENDER-010 regional geometry survives cold persistence and FractalRing split',()=>{
  const {extraction}=setup();
  const source=makeProceduralRef({
    rootId:'s3-regional',address:[],algorithmId:'e0',algorithmVersion:'v1'
  });
  const reference=[0,-.25,-.25];
  let store=makeMemoryWorldStore({resident:'none'});
  const outcome=applyVertexInfluence(store,{
    source,reference,influence:[.18,-.06,.03],threshold:.02,compliance:1
  });
  store=outcome.store;
  const deform=s=>makeFractalVertexDeformation({
    baseDeformation:point=>cubeToSphereDeformation(point),
    seed:99,randomAmplitude:.05,smoothingWeight:.3,
    smoothingTarget:({basePosition})=>basePosition,
    interactionOffsets:worldGeometryOffsets(s,source)
  });
  const before=assembleRegionalSurfaceMesh({extraction,deformation:deform(store),targetDepth:3});
  const cold=loadPersistentWorldStore(serializePersistentWorldStore(store));
  const afterCold=assembleRegionalSurfaceMesh({extraction,deformation:deform(cold),targetDepth:3});
  assert.deepEqual(afterCold,before);
  const split=splitGeometryFractalRing(cold,outcome.created[0]);
  const afterSplit=assembleRegionalSurfaceMesh({extraction,deformation:deform(split.store),targetDepth:3});
  assert.deepEqual(afterSplit,before);
  const center=before.vertices.find(v=>v.key==='0,-0.25,-0.25');
  assert.ok(center);
  assert.notDeepEqual(center.position,center.reference);
});
