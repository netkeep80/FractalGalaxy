import test from 'node:test';
import assert from 'node:assert/strict';

import {makeGamma,makeMaterial} from '../src/fractal-matter.mjs';
import {
  octreePathsAtDepth,
  enumerateRegionalFacePairs,
  extractRegionalMaterialInterfaces
} from '../src/surface/regional-extractor.mjs';

function compact(result){
  return {
    faces:result.faces.map(face=>({
      key:face.key,axis:face.axis,side:face.side,
      pathA:face.pathA,pathB:face.pathB
    })),
    present:result.present.map(item=>({
      faceKey:item.faceKey,depth:item.depth,
      patch:item.patch,decision:item.decision
    })),
    unresolved:result.unresolved.map(item=>({
      faceKey:item.faceKey,depth:item.depth,patch:item.patch
    })),
    stats:result.stats
  };
}

test('S3-A complete depth-1 region enumerates 12 internal + 24 global exterior faces exactly once',()=>{
  const cells=octreePathsAtDepth(1);
  assert.equal(cells.length,8);
  const faces=enumerateRegionalFacePairs(cells);
  assert.equal(faces.length,36);
  assert.equal(faces.filter(face=>face.pathB===null).length,24);
  assert.equal(faces.filter(face=>face.pathB!==null).length,12);
  assert.equal(new Set(faces.map(face=>face.key)).size,36);
});

test('S3-A partial region never fabricates EMPTY for a missing in-domain neighbor',()=>{
  const faces=enumerateRegionalFacePairs([[0]]);
  assert.deepEqual(
    faces.map(face=>[face.axis,face.side,face.pathB]),
    [['x',-1,null],['y',-1,null],['z',-1,null]]
  );
});

test('S3-A rejects duplicate region cells and mixed input depths',()=>{
  assert.throws(()=>enumerateRegionalFacePairs([[0],[0]]),/duplicate/i);
  assert.throws(()=>enumerateRegionalFacePairs([[0],[0,0]]),/same depth/i);
});

test('S3-A solid complete region has no internal material surface and 24 proven exterior faces',()=>{
  const material=makeMaterial({
    id:'solid',
    gamma:makeGamma({rootSeed:1,fixture:'solid'})
  });
  const before=structuredClone(material);
  const result=extractRegionalMaterialInterfaces(material,{
    cellPaths:octreePathsAtDepth(1),
    maxDepth:1,
    outsideMedium:'EMPTY'
  });
  assert.equal(result.stats.facePairs,36);
  assert.equal(result.stats.internalFaces,12);
  assert.equal(result.stats.exteriorFaces,24);
  assert.equal(result.stats.provenPatches,24);
  assert.equal(result.stats.unresolvedPatches,0);
  assert.equal(result.present.length,24);
  assert.equal(result.unresolved.length,0);
  assert.ok(result.present.every(item=>item.pathB===null));
  assert.deepEqual(material,before,'regional extraction must be read-only');
});

test('S3-A canonical regional result is invariant to input traversal order',()=>{
  const material=makeMaterial({
    id:'height',
    gamma:makeGamma({rootSeed:0x12345678,alphaNeighbor:0,fixture:'height'})
  });
  const cells=octreePathsAtDepth(1);
  const forward=extractRegionalMaterialInterfaces(material,{
    cellPaths:cells,maxDepth:3,outsideMedium:'EMPTY'
  });
  const reverse=extractRegionalMaterialInterfaces(material,{
    cellPaths:[...cells].reverse(),maxDepth:3,outsideMedium:'EMPTY'
  });
  assert.deepEqual(compact(reverse),compact(forward));
  assert.ok(forward.present.length>0,'fixture must exercise proven regional interfaces');
  assert.ok(forward.unresolved.length>0,'fixture must preserve finite-depth proof gaps');
});
