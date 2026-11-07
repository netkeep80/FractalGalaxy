import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cubeToSphereDeformation,
  makeFractalVertexDeformation
} from '../src/fractal-matter.mjs';
import {stitchCoarseFineInterface} from '../src/geometry/coarse-fine-stitch.mjs';

const coarse={
  bounds:{min:[-1,-1,-1],max:[0,0,0]},
  axis:'x',
  side:1
};

const fineFaces=[
  {id:'00',bounds:{min:[0,-1,-1],max:[.5,-.5,-.5]},axis:'x',side:-1},
  {id:'10',bounds:{min:[0,-.5,-1],max:[.5,0,-.5]},axis:'x',side:-1},
  {id:'01',bounds:{min:[0,-1,-.5],max:[.5,-.5,0]},axis:'x',side:-1},
  {id:'11',bounds:{min:[0,-.5,-.5],max:[.5,0,0]},axis:'x',side:-1}
];

test('S3-B1 one coarse face stitches to four fine faces through 9 canonical vertices',()=>{
  const stitched=stitchCoarseFineInterface({coarse,fineFaces});
  assert.equal(stitched.tiles.length,4);
  assert.equal(stitched.vertices.length,9);
  assert.equal(stitched.stats.tiles,4);
  assert.equal(stitched.stats.vertices,9);
  assert.equal(stitched.stats.cracks,0);
  assert.deepEqual(
    stitched.tiles.map(tile=>tile.patch),
    [
      {u0:0,u1:.5,v0:0,v1:.5},
      {u0:.5,u1:1,v0:0,v1:.5},
      {u0:0,u1:.5,v0:.5,v1:1},
      {u0:.5,u1:1,v0:.5,v1:1}
    ]
  );
  for(const tile of stitched.tiles){
    assert.deepEqual(tile.coarseVertexKeys,tile.fineVertexKeys);
    assert.equal(new Set(tile.vertexIndices).size,4);
  }
  assert.ok(stitched.vertices.some(vertex=>vertex.key==='0,-0.5,-0.5'));
});

test('S3-B1 coarse/fine shared coordinates remain exact under nonlinear deformation, RND, smoothing and persisted offset',()=>{
  const deformation=makeFractalVertexDeformation({
    baseDeformation:point=>cubeToSphereDeformation(point),
    seed:0x1234abcd,
    randomAmplitude:.09,
    smoothingWeight:.35,
    smoothingTarget:({basePosition})=>basePosition,
    interactionOffsets:{
      '0,-0.5,-0.5':[.125,-.075,.04],
      '0,-0.5,-1':[-.03,.02,.01]
    }
  });
  const stitched=stitchCoarseFineInterface({coarse,fineFaces,deformation});
  for(const tile of stitched.tiles){
    assert.deepEqual(tile.coarsePositions,tile.finePositions);
  }
  const center=stitched.vertices.find(vertex=>vertex.key==='0,-0.5,-0.5');
  assert.ok(center);
  assert.deepEqual(center.position,deformation([0,-0.5,-0.5]));
  assert.deepEqual(center.reference,[0,-0.5,-0.5]);
});

test('S3-B1 result is invariant to fine-face traversal order',()=>{
  const forward=stitchCoarseFineInterface({coarse,fineFaces});
  const reverse=stitchCoarseFineInterface({coarse,fineFaces:[...fineFaces].reverse()});
  assert.deepEqual(reverse,forward);
});

test('S3-B1 rejects incomplete, duplicate and non-coplanar 1:4 seams',()=>{
  assert.throws(
    ()=>stitchCoarseFineInterface({coarse,fineFaces:fineFaces.slice(0,3)}),
    /four fine faces/i
  );
  assert.throws(
    ()=>stitchCoarseFineInterface({coarse,fineFaces:[fineFaces[0],fineFaces[0],fineFaces[2],fineFaces[3]]}),
    /coverage|duplicate/i
  );
  const shifted=fineFaces.map((face,index)=>index===3
    ? {...face,bounds:{min:[.1,-.5,-.5],max:[.6,0,0]}}
    : face
  );
  assert.throws(
    ()=>stitchCoarseFineInterface({coarse,fineFaces:shifted}),
    /plane|coplanar/i
  );
});
