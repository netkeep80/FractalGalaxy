import test from 'node:test';
import assert from 'node:assert/strict';

import {cubeToSphereDeformation} from '../src/fractal-matter.mjs';
import {buildCanonicalTopologyLines,buildCanonicalTopologyGrid} from '../src/geometry/topology-grid.mjs';

test('S3-D topology grid shares one canonical vertex at every line intersection',()=>{
  const grid=buildCanonicalTopologyGrid({
    steps:4,curveSubdivisions:2,
    deformation:point=>cubeToSphereDeformation(point)
  });
  assert.equal(grid.lines.length,60);
  assert.equal(grid.stats.segmentsPerLine,8);
  const target=grid.vertices.findIndex(vertex=>vertex.key==='1,0,0');
  assert.ok(target>=0);
  const occurrences=grid.lines.filter(line=>line.vertexIndices.includes(target));
  assert.ok(occurrences.length>=2,'crossing face-grid lines must reuse one canonical vertex index');
  for(const line of occurrences){
    const indices=line.vertexIndices.filter(index=>grid.vertices[index].key==='1,0,0');
    assert.deepEqual(indices,[target]);
  }
});

test('S3-D nonlinear support line follows sampled deformation instead of an endpoint chord',()=>{
  const grid=buildCanonicalTopologyGrid({
    steps:4,curveSubdivisions:2,
    deformation:point=>cubeToSphereDeformation(point)
  });
  const line=grid.lines.find(item=>item.axis==='x'&&item.side===1&&item.direction==='u'&&item.gridIndex===2);
  assert.ok(line);
  const vertices=line.vertexIndices.map(index=>grid.vertices[index]);
  const center=vertices.find(vertex=>vertex.key==='1,0,0');
  assert.ok(center);
  const first=vertices[0].position,last=vertices.at(-1).position;
  const chordMid=first.map((v,i)=>(v+last[i])/2);
  assert.deepEqual(center.position,[1,0,0]);
  assert.notDeepEqual(center.position,chordMid,
    'nonlinear grid must evaluate the canonical midpoint, not draw one deformed endpoint chord');
});

test('S3-D grid is deterministic and validates sampling bounds',()=>{
  const a=buildCanonicalTopologyGrid({steps:4,curveSubdivisions:3});
  const b=buildCanonicalTopologyGrid({steps:4,curveSubdivisions:3});
  assert.deepEqual(b,a);
  assert.throws(()=>buildCanonicalTopologyGrid({steps:0}),/steps/);
  assert.throws(()=>buildCanonicalTopologyGrid({curveSubdivisions:0}),/curveSubdivisions/);
});


test('S3-D selected diagnostic lines share the exact nonlinear canonical crossing',()=>{
  const geometry=buildCanonicalTopologyLines({
    lines:[
      {a:[-1,0,1],b:[1,0,1],name:'u'},
      {a:[0,-1,1],b:[0,1,1],name:'v'}
    ],
    subdivisions:4,
    deformation:point=>cubeToSphereDeformation(point)
  });
  const center=geometry.vertices.findIndex(vertex=>vertex.key==='0,0,1');
  assert.ok(center>=0);
  assert.deepEqual(geometry.vertices[center].position,[0,0,1]);
  assert.ok(geometry.lines.every(line=>line.vertexIndices.includes(center)));
  const endpoints=geometry.lines[0].vertexIndices.map(index=>geometry.vertices[index].position);
  const chordMid=endpoints[0].map((value,i)=>(value+endpoints.at(-1)[i])/2);
  assert.notDeepEqual(geometry.vertices[center].position,chordMid);
});


test('S3-D root and fine topology lines include their common canonical crossing even with different schedules',()=>{
  const geometry=buildCanonicalTopologyLines({
    lines:[
      {a:[.5,-1,1],b:[.5,1,1],name:'root'},
      {a:[.25,.875,1],b:[.5,.875,1],name:'fine'}
    ],
    subdivisions:8,
    deformation:point=>cubeToSphereDeformation(point)
  });
  const crossing=geometry.vertices.findIndex(vertex=>vertex.key==='0.5,0.875,1');
  assert.ok(crossing>=0);
  for(const line of geometry.lines){
    assert.ok(line.vertexIndices.includes(crossing),line.name+' omits the shared canonical intersection');
  }
});

test('S3-D topology grid preserves the previously supported sampling capacity',()=>{
  const medium=buildCanonicalTopologyGrid({steps:16,curveSubdivisions:7});
  assert.equal(medium.stats.segmentsPerLine,112);
  assert.equal(medium.lines.length,204);
  const maximum=buildCanonicalTopologyGrid({steps:32,curveSubdivisions:16});
  assert.equal(maximum.stats.segmentsPerLine,512);
  assert.equal(maximum.lines.length,396);
});
