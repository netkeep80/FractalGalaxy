import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY,makeGamma,makeMaterial,octreeGridToPath
} from '../src/fractal-matter.mjs';
import {
  enumerateAdaptiveRegionalFacePairs,
  extractAdaptiveRegionalMaterialInterfaces
} from '../src/surface/adaptive-regional-extractor.mjs';

function fixture(){
  const coarse=octreeGridToPath({depth:2,x:1,y:1,z:1});
  const fine=[];
  for(const y of [2,3])for(const z of [2,3]){
    fine.push(octreeGridToPath({depth:3,x:4,y,z}));
  }
  return {coarse,fine,cells:[coarse,...fine]};
}

test('S3-B adaptive topology resolves one coarse face against four fine leaves',()=>{
  const {coarse,fine,cells}=fixture();
  const faces=enumerateAdaptiveRegionalFacePairs(cells);
  const seams=faces.filter(face=>face.coarseFine&&
    JSON.stringify(face.rootPathA)===JSON.stringify(coarse));
  assert.equal(seams.length,4);
  assert.equal(new Set(seams.map(face=>face.key)).size,4);
  assert.ok(seams.every(face=>face.axis==='x'&&face.side===1&&face.proofDepth===3));
  assert.deepEqual(
    seams.map(face=>face.rootPathB).sort(),
    [...fine].sort()
  );
  assert.ok(seams.every(face=>face.pathA.length===3&&face.pathB.length===3));
});

test('S3-B adaptive regional proof preserves D across coarse/fine ownership',()=>{
  const {coarse,cells}=fixture();
  const material=makeMaterial({
    id:'adaptive',
    gamma:makeGamma({rootSeed:7,fixture:'solid'}),
    edits:[{path:coarse,value:EMPTY}]
  });
  const before=structuredClone(material);
  const result=extractAdaptiveRegionalMaterialInterfaces(material,{
    cellPaths:cells,maxDepth:3,outsideMedium:'EMPTY'
  });
  const seam=result.present.filter(item=>item.coarseFine);
  assert.equal(seam.length,4);
  assert.equal(result.unresolved.length,0);
  assert.ok(seam.every(item=>
    item.decision.leftMedium==='EMPTY'&&item.decision.rightMedium==='SOLID:rock:1'
  ));
  assert.deepEqual(material,before);
});

test('S3-B adaptive result is traversal invariant and rejects overlapping leaves',()=>{
  const {cells,coarse}=fixture();
  const material=makeMaterial({id:'solid',gamma:makeGamma({fixture:'solid'})});
  const a=extractAdaptiveRegionalMaterialInterfaces(material,{cellPaths:cells,maxDepth:3});
  const b=extractAdaptiveRegionalMaterialInterfaces(material,{cellPaths:[...cells].reverse(),maxDepth:3});
  assert.deepEqual(b,a);
  assert.throws(
    ()=>enumerateAdaptiveRegionalFacePairs([coarse,[...coarse,0]]),
    /overlap|ancestry/i
  );
});
