import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareProofTriangles,paintProvenSurface,proofGapBoundaryVertices} from '../demo/studio-surface-renderer.mjs';
import {assembleProvenSurfaceMesh,cubeToSphereDeformation} from '../src/fractal-matter.mjs';
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
test('projected-overlap ordering keeps the nearest curved local triangle on top',()=>{
 const positions=[
  [-0.5773502691896257,-0.5773502691896257,0.5773502691896257],
  [0,-0.7071067811865476,0.7071067811865476],[0,0,1],
  [-0.7071067811865476,0,0.7071067811865476],
  [0.5773502691896257,-0.5773502691896257,0.5773502691896257],
  [0.7071067811865476,0,0.7071067811865476],
  [0,0.7071067811865476,0.7071067811865476],
  [-0.5773502691896257,0.5773502691896257,0.5773502691896257],
  [0.5773502691896257,0.5773502691896257,0.5773502691896257]
 ];
 const triangles=[[0,1,2],[0,2,3],[1,4,5],[1,5,2],[3,2,6],[3,6,7],[2,5,8],[2,8,6]];
 const curved={vertices:positions.map(position=>({reference:position,position})),
  triangles:triangles.map(indices=>({indices,decision:'PRESENT'})),unresolved:[]};
 const yaw=-2.4,pitch=-1.05,zoom=10/7;
 const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch),scale=420*.30*zoom;
 const cameraProject=([x,y,z])=>{
  const x1=x*cy+z*sy,z1=-x*sy+z*cy,y1=y*cp-z1*sp;
  return {x:300+x1*scale,y:210-y1*scale,depth:y*sp+z1*cp};
 };
 const order=prepareProofTriangles(curved,cameraProject,{deformed:true}).map(t=>t.index);
 assert.deepEqual(order,[5,7,4,6,1,0,3,2]);
 assert.ok(order.indexOf(0)<order.indexOf(3),'far triangle 0 must be painted before nearer triangle 3');
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
test('deformed paint uses canonical vertex positions rather than reference coordinates',()=>{
 const local={vertices:[
  {reference:[0,0,0],position:[10,20,1]},
  {reference:[1,0,0],position:[11,20,1]},
  {reference:[0,1,0],position:[10,21,1]}
 ],triangles:[{indices:[0,1,2],decision:'PRESENT'}],unresolved:[]};
 const path=[];
 const ctx={save(){},restore(){},beginPath(){path.length=0;},
  moveTo(x,y){path.push([x,y]);},lineTo(x,y){path.push([x,y]);},closePath(){},fill(){this.filled=[...path];},stroke(){}};
 paintProvenSurface(ctx,local,p=>({x:p[0],y:p[1],depth:p[2]}),{deformed:true});
 assert.deepEqual(ctx.filled,[[10,20],[11,20],[10,21]]);
});
test('unresolved outline samples the same canonical midpoint as adjacent tessellated proven mesh',()=>{
 const bounds={min:[-1,-1,-1],max:[1,1,1]};
 const key=p=>p.join(',');
 const deformation=reference=>{
  const position=cubeToSphereDeformation(reference);
  return key(reference)==='0,-0.5,1'
    ? [position[0]+.13,position[1]-.04,position[2]+.07]
    : position;
 };
 const extraction={present:[{patch:{u0:0,u1:.5,v0:0,v1:.5},decision:{kind:'PRESENT'}}],unresolved:[]};
 const proven=assembleProvenSurfaceMesh({bounds,axis:'z',side:1,extraction,
  deformation,tessellationDepth:1});
 const gap=proofGapBoundaryVertices({bounds,axis:'z',side:1,
  patch:{u0:.5,u1:1,v0:0,v1:.5},deformation,tessellationDepth:1});
 const provenMid=proven.vertices.find(v=>key(v.reference)==='0,-0.5,1');
 const gapMid=gap.find(v=>key(v.reference)==='0,-0.5,1');
 assert.ok(provenMid&&gapMid,'shared canonical midpoint must exist on both displayed boundaries');
 assert.deepEqual(gapMid.position,provenMid.position);
 assert.equal(gap.length,8,'depth-1 outline has corners plus one midpoint per edge');
});


test('PERF visibility broad-phase removes at least 99% of all-pairs work on a sparse 6400-triangle field',()=>{
 const cols=80,rows=80,vertices=[],triangles=[];
 for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
   const base=vertices.length;
   const px=x*10,py=y*10;
   vertices.push(
     {reference:[px,py,0],position:[px,py,0]},
     {reference:[px+2,py,0],position:[px+2,py,0]},
     {reference:[px,py+2,0],position:[px,py+2,0]}
   );
   triangles.push({indices:[base,base+1,base+2],decision:'PRESENT'});
 }
 const sparse={vertices,triangles,unresolved:[]};
 const stats={};
 const ordered=prepareProofTriangles(
   sparse,
   p=>({x:p[0],y:p[1],depth:p[2]}),
   {stats}
 );
 assert.equal(ordered.length,6400);
 assert.equal(stats.allPairs,6400*6399/2);
 assert.ok(Number.isInteger(stats.candidatePairs),JSON.stringify(stats));
 assert.ok(stats.candidatePairs*100<stats.allPairs,
   'projected broad-phase must eliminate >99% of pair candidates: '+JSON.stringify(stats));
 assert.ok(stats.orderOperations<stats.allPairs/100,
   'topological ordering must not rescan the remaining set quadratically: '+JSON.stringify(stats));
});

test('PERF broad-phase preserves exhaustive visibility order on overlapping adversarial triangles',()=>{
 const positions=[];
 const triangles=[];
 for(let i=0;i<32;i++){
   const z=(i%7)*.07;
   const x=(i%4)*.18;
   const y=Math.floor(i/4)*.08;
   const base=positions.length;
   positions.push([x,y,z],[x+.55,y+.06,z+.03],[x+.08,y+.48,z-.02]);
   triangles.push({indices:[base,base+1,base+2],decision:'PRESENT'});
 }
 const adversarial={
   vertices:positions.map(position=>({reference:position,position})),
   triangles,unresolved:[]
 };
 const project=([x,y,z])=>({x:x*200+y*17,y:y*180-x*11,depth:z+x*.03});
 const optimized=prepareProofTriangles(adversarial,project,{broadPhase:true}).map(t=>t.index);
 const exhaustive=prepareProofTriangles(adversarial,project,{broadPhase:false}).map(t=>t.index);
 assert.deepEqual(optimized,exhaustive);
});
