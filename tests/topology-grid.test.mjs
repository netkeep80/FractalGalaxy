import test from 'node:test';
import assert from 'node:assert/strict';

import {cubeToSphereDeformation} from '../src/fractal-matter.mjs';
import {buildCanonicalTopologyGrid} from '../src/geometry/topology-grid.mjs';

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
