import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareProofTriangles,paintProvenSurface} from '../demo/studio-surface-renderer.mjs';
const vertices=[
 {reference:[0,0,-1],position:[0,0,-1]},
 {reference:[1,0,-1],position:[1,0,-1]},
 {reference:[0,1,-1],position:[0,1,-1]},
 {reference:[0,0,1],position:[0,0,1]},
 {reference:[1,0,1],position:[1,0,1]},
 {reference:[0,1,1],position:[0,1,1]}
];
const mesh={vertices,triangles:[
 {indices:[3,4,5],decision:'PRESENT'},
 {indices:[0,1,2],decision:'PRESENT'}
],unresolved:[{patch:{u0:0,u1:1,v0:0,v1:1},decision:'REFINE'}]};
const project=p=>({x:p[0]*100,y:p[1]*100,depth:p[2]});
test('depth-sort known proven triangles while ignoring unresolved proof gaps',()=>{
 const prepared=prepareProofTriangles(mesh,project);
 assert.deepEqual(prepared.map(t=>t.index),[1,0]);
 assert.deepEqual(prepared.map(t=>t.depth),[-1,1]);
 assert.ok(prepared.every(t=>t.light>=.3&&t.light<=1));
 assert.equal(mesh.unresolved.length,1);
});
test('paint only proven triangles with deterministic shaded fill',()=>{
 const commands=[],ctx={
  save(){commands.push('save');},restore(){commands.push('restore');},
  beginPath(){commands.push('begin');},moveTo(){},lineTo(){},closePath(){},
  fill(){commands.push(['fill',this.fillStyle]);},
  stroke(){commands.push(['stroke',this.strokeStyle]);}
 };
 assert.equal(paintProvenSurface(ctx,mesh,project),2);
 assert.equal(commands.filter(c=>Array.isArray(c)&&c[0]==='fill').length,2);
 assert.deepEqual(commands.at(-1),'restore');
 const emptymesh={vertices:[],triangles:[],unresolved:mesh.unresolved};
 assert.equal(paintProvenSurface(ctx,emptymesh,project),0);
 assert.throws(()=>prepareProofTriangles({...mesh,triangles:[{indices:[0,1,2],decision:'REFINE'}]},project),/unproven/);
});
