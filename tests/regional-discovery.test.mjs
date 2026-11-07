import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY,solid,makeGamma,makeMaterial,octreePathsAtDepth
} from '../src/fractal-matter.mjs';
import {extractDiscoveredRegionalMaterialInterfaces} from '../src/surface/adaptive-regional-extractor.mjs';
import {assembleRegionalSurfaceMesh} from '../src/geometry/regional-surface-mesh.mjs';

function referenceArea(mesh){
  let area=0;
  for(const triangle of mesh.triangles){
    const [a,b,c]=triangle.indices.map(index=>mesh.vertices[index].reference);
    const ab=b.map((value,i)=>value-a[i]);
    const ac=c.map((value,i)=>value-a[i]);
    const cross=[
      ab[1]*ac[2]-ab[2]*ac[1],
      ab[2]*ac[0]-ab[0]*ac[2],
      ab[0]*ac[1]-ab[1]*ac[0]
    ];
    area+=Math.hypot(...cross)/2;
  }
  return area;
}

test('S3-C volume discovery exposes a solid D island wholly inside one depth-2 regional cell',()=>{
  const material=makeMaterial({
    id:'island',
    gamma:makeGamma({fixture:'solid'}),
    edits:[
      {path:[],value:EMPTY},
      {path:[0,7,0,7],value:solid('rock',1)}
    ]
  });
  const before=structuredClone(material);
  const extraction=extractDiscoveredRegionalMaterialInterfaces(material,{
    cellPaths:octreePathsAtDepth(2),maxDepth:5,outsideMedium:'EMPTY'
  });
  assert.equal(extraction.present.length,6);
  assert.equal(extraction.unresolved.length,0);
  assert.equal(extraction.unresolvedCells.length,0);
  assert.ok(extraction.stats.discoveredLeaves>64);
  const mesh=assembleRegionalSurfaceMesh({extraction,targetDepth:4});
  assert.equal(mesh.triangles.length,12);
  assert.equal(referenceArea(mesh),0.09375);
  assert.deepEqual(material,before);
});

test('S3-C volume discovery exposes an internal empty D cavity in homogeneous solid',()=>{
  const material=makeMaterial({
    id:'cavity',
    gamma:makeGamma({fixture:'solid'}),
    edits:[{path:[0,7,0,7],value:EMPTY}]
  });
  const extraction=extractDiscoveredRegionalMaterialInterfaces(material,{
    cellPaths:octreePathsAtDepth(2),maxDepth:5,outsideMedium:'EMPTY'
  });
  const internal=extraction.present.filter(item=>item.rootPathB!==null);
  assert.equal(internal.length,6);
  assert.equal(extraction.unresolvedCells.length,0);
  assert.ok(internal.every(item=>
    new Set([item.decision.leftMedium,item.decision.rightMedium]).has('EMPTY')
  ));
});

test('S3-C discovery preserves explicit unresolved coverage when the material budget ends before a descendant D edit',()=>{
  const material=makeMaterial({
    id:'budget',
    gamma:makeGamma({fixture:'solid'}),
    edits:[
      {path:[],value:EMPTY},
      {path:[0,7,0,7],value:solid('rock',1)}
    ]
  });
  const extraction=extractDiscoveredRegionalMaterialInterfaces(material,{
    cellPaths:octreePathsAtDepth(2),maxDepth:3,outsideMedium:'EMPTY'
  });
  assert.equal(extraction.present.length,0);
  assert.ok(extraction.unresolvedCells.length>0);
  assert.ok(extraction.stats.unresolvedCells>0);
  assert.ok(extraction.unresolved.length>0);
});

test('S3-C discovered regional result is invariant to root traversal order',()=>{
  const material=makeMaterial({
    id:'island-order',
    gamma:makeGamma({fixture:'solid'}),
    edits:[
      {path:[],value:EMPTY},
      {path:[0,7,0,7],value:solid('rock',1)}
    ]
  });
  const roots=octreePathsAtDepth(2);
  const a=extractDiscoveredRegionalMaterialInterfaces(material,{cellPaths:roots,maxDepth:5});
  const b=extractDiscoveredRegionalMaterialInterfaces(material,{cellPaths:[...roots].reverse(),maxDepth:5});
  assert.deepEqual(b,a);
});
