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


test('PERF audit regression: broad-phase preserves exhaustive order for large-coordinate two-triangle counterexample',()=>{
 const positions=[
  [999999999.3875558,1000000002.759836,1.3472459302283823],
  [1000000001.1211773,1000000002.598229,1.8246840462088585],
  [999999999.4271184,1000000004.4934574,1.9026496233418584],
  [999999998.4794582,1000000001.6353612,1.604054702911526],
  [1000000000.7527015,1000000001.738683,1.6446096822619438],
  [999999998.2234248,1000000003.9086045,1.5030118944123387]
 ];
 const fixture={
  vertices:positions.map(position=>({reference:position,position})),
  triangles:[
   {indices:[0,1,2],decision:'PRESENT'},
   {indices:[3,4,5],decision:'PRESENT'}
  ],
  unresolved:[]
 };
 const identity=([x,y,z])=>({x,y,depth:z});
 const optimized=prepareProofTriangles(fixture,identity,{broadPhase:true}).map(t=>t.index);
 const exhaustive=prepareProofTriangles(fixture,identity,{broadPhase:false}).map(t=>t.index);
 assert.deepEqual(optimized,exhaustive);
 assert.deepEqual(optimized,[1,0]);
});

test('PERF audit regression: 520 deterministic finite-coordinate scenes keep broad-phase identical to exhaustive',()=>{
 let state=0x7f4a7c15;
 const random=()=>{
  state=(Math.imul(state,1664525)+1013904223)>>>0;
  return state/0x100000000;
 };
 for(let scene=0;scene<520;scene++){
  const count=2+(scene%7),positions=[],triangles=[];
  const origin=scene%3===0?1e9:scene%3===1?-1e9:0;
  for(let i=0;i<count;i++){
   const cx=origin+(random()-.5)*6;
   const cy=origin+(random()-.5)*6;
   const z=(random()-.5)*4;
   const sx=.2+random()*2.4,sy=.2+random()*2.4;
   const base=positions.length;
   positions.push(
    [cx-sx,cy-sy,z+(random()-.5)*.2],
    [cx+sx,cy-sy*.7,z+(random()-.5)*.2],
    [cx-sx*.4,cy+sy,z+(random()-.5)*.2]
   );
   triangles.push({indices:[base,base+1,base+2],decision:'PRESENT'});
  }
  const fixture={vertices:positions.map(position=>({reference:position,position})),triangles,unresolved:[]};
  const project=([x,y,z])=>({x,y,depth:z});
  const optimized=prepareProofTriangles(fixture,project,{broadPhase:true}).map(t=>t.index);
  const exhaustive=prepareProofTriangles(fixture,project,{broadPhase:false}).map(t=>t.index);
  assert.deepEqual(optimized,exhaustive,'scene '+scene);
 }
});

test('PERF interval broad-phase avoids hidden quadratic scan when X overlaps but Y is disjoint',()=>{
 const count=6500,vertices=[],triangles=[];
 for(let i=0;i<count;i++){
  const base=vertices.length,y=i*10;
  vertices.push(
   {reference:[0,y,0],position:[0,y,0]},
   {reference:[10,y,0],position:[10,y,0]},
   {reference:[0,y+2,0],position:[0,y+2,0]}
  );
  triangles.push({indices:[base,base+1,base+2],decision:'PRESENT'});
 }
 const fixture={vertices,triangles,unresolved:[]},stats={};
 const order=prepareProofTriangles(
  fixture,
  ([x,y,z])=>({x,y,depth:z}),
  {broadPhase:true,stats}
 );
 assert.equal(order.length,count);
 assert.equal(stats.candidatePairs,0);
 assert.equal(stats.allPairs,count*(count-1)/2);
 assert.ok(stats.broadPhaseIndexVisits<count*64,
  'Y interval index must stay subquadratic: '+JSON.stringify(stats));
 assert.ok(stats.broadPhaseOperations<stats.allPairs/50,
  'broad-phase accounting must expose and bound actual index/sort work: '+JSON.stringify(stats));
 assert.ok(stats.broadPhaseSortComparisons>0);
 assert.ok(Number.isInteger(stats.broadPhaseExpireOperations));
});


test('PERF visibility cache reuses only the same full camera state and invalidates zoom/yaw/pitch changes',()=>{
 const positions=[
  [0,0,.1],[2,0,.1],[0,2,.1],
  [.4,.4,.5],[2.4,.4,.5],[.4,2.4,.5]
 ];
 const fixture=Object.freeze({
  vertices:Object.freeze(positions.map(position=>Object.freeze({
    reference:Object.freeze([...position]),position:Object.freeze([...position])
  }))),
  triangles:Object.freeze([
   Object.freeze({indices:Object.freeze([0,1,2]),decision:'PRESENT'}),
   Object.freeze({indices:Object.freeze([3,4,5]),decision:'PRESENT'})
  ]),unresolved:Object.freeze([])
 });
 const statsA={},statsSame={},statsZoom={},statsRotated={};
 const project20=([x,y,z])=>({x:100+x*20,y:100+y*20,depth:z});
 const a=prepareProofTriangles(
  fixture,project20,
  {visibilityCacheKey:'yaw0|pitch0|zoom20',stats:statsA,reusePrepared:true}
 ).map(t=>t.index);
 const same=prepareProofTriangles(
  fixture,project20,
  {visibilityCacheKey:'yaw0|pitch0|zoom20',stats:statsSame,reusePrepared:true}
 ).map(t=>t.index);
 assert.deepEqual(same,a);
 assert.equal(statsA.visibilityCacheHit,false);
 assert.equal(statsSame.visibilityCacheHit,true);
 assert.equal(statsSame.candidatePairs,0);
 prepareProofTriangles(
  fixture,([x,y,z])=>({x:100+x*80,y:100+y*80,depth:z}),
  {visibilityCacheKey:'yaw0|pitch0|zoom80',stats:statsZoom,reusePrepared:true}
 );
 assert.equal(statsZoom.visibilityCacheHit,false);
 prepareProofTriangles(
  fixture,([x,y,z])=>({x:100+(x+z*.2)*20,y:100+y*20,depth:z-x*.1}),
  {visibilityCacheKey:'yaw1|pitch0|zoom20',stats:statsRotated,reusePrepared:true}
 );
 assert.equal(statsRotated.visibilityCacheHit,false);
 assert.ok(statsRotated.candidatePairs>0);
});


test('PERF reusable prepared-frame path is behaviorally identical across changing camera projections',()=>{
 const fixture={
  vertices:[
   {reference:[0,0,0],position:[0,0,0]},
   {reference:[1,0,.1],position:[1,0,.1]},
   {reference:[0,1,.2],position:[0,1,.2]},
   {reference:[.2,.2,.8],position:[.2,.2,.8]},
   {reference:[1.2,.2,.7],position:[1.2,.2,.7]},
   {reference:[.2,1.2,.9],position:[.2,1.2,.9]}
  ],
  triangles:[
   {indices:[0,1,2],decision:'PRESENT',normal:[0,-.1,1]},
   {indices:[3,4,5],decision:'PRESENT',normal:[0,.1,1]}
  ],unresolved:[]
 };
 const projector=(scale,skew)=>((p,out=null)=>{
  const result=out??{};
  result.x=(p[0]+p[2]*skew)*scale;
  result.y=(p[1]-p[2]*skew*.3)*scale;
  result.depth=p[2]-p[0]*skew*.05;
  return result;
 });
 for(const [scale,skew] of [[100,.1],[125,-.17],[80,.31]]){
  const normal=prepareProofTriangles(fixture,projector(scale,skew),{broadPhase:true}).map(t=>t.index);
  const reusable=prepareProofTriangles(fixture,projector(scale,skew),{broadPhase:true,reusePrepared:true}).map(t=>t.index);
  assert.deepEqual(reusable,normal);
 }
});


test('PERF audit regression FG-PERF-007: zoom-dependent area threshold cannot reuse another zoom painter order',()=>{
  const s=.0001;
  const positions=[
    [0,0,-2],[s,0,2],[0,s,2],
    [.1*s,.1*s,0],[.2*s,.1*s,0],[.1*s,.2*s,0]
  ];
  const mesh=Object.freeze({
    vertices:Object.freeze(positions.map(position=>Object.freeze({
      reference:Object.freeze([...position]),position:Object.freeze([...position])
    }))),
    triangles:Object.freeze([
      Object.freeze({indices:Object.freeze([0,1,2]),decision:'PRESENT'}),
      Object.freeze({indices:Object.freeze([3,4,5]),decision:'PRESENT'})
    ]),
    unresolved:Object.freeze([])
  });
  const project=scale=>([x,y,z])=>({x:800+x*scale,y:500+y*scale,depth:z});
  const at100=prepareProofTriangles(mesh,project(100),{
    visibilityCacheKey:'0|0|100',reusePrepared:true
  }).map(t=>t.index);
  const at500Cached=prepareProofTriangles(mesh,project(500),{
    visibilityCacheKey:'0|0|500',reusePrepared:true
  }).map(t=>t.index);
  const at500Fresh=prepareProofTriangles(mesh,project(500),{
    broadPhase:true
  }).map(t=>t.index);
  assert.deepEqual(at100,[1,0]);
  assert.deepEqual(at500Cached,at500Fresh);
  assert.deepEqual(at500Fresh,[0,1]);
});

test('PERF audit regression FG-PERF-008: exact narrow-phase preserves accepted BASE order at large translated coordinates',()=>{
  const positions=[
    [-1000000000.5530576,-1000000002.021376,-0.7129086367785931],
    [-999999999.335029,-1000000002.2513342,-1.6201325496658683],
    [-1000000000.8036442,-1000000000.8033475,-0.26821632497012615],
    [-1000000000.1438776,-1000000001.7896843,-0.7181582227349281],
    [-999999998.2617798,-1000000001.7812183,-1.5558584546670318],
    [-1000000000.6204444,-999999999.9075865,-0.39324559830129147]
  ];
  const mesh={
    vertices:positions.map(position=>({reference:position,position})),
    triangles:[
      {indices:[0,1,2],decision:'PRESENT'},
      {indices:[3,4,5],decision:'PRESENT'}
    ],unresolved:[]
  };
  const identity=([x,y,z])=>({x,y,depth:z});
  const exhaustive=prepareProofTriangles(mesh,identity,{broadPhase:false}).map(t=>t.index);
  const optimized=prepareProofTriangles(mesh,identity,{broadPhase:true}).map(t=>t.index);
  assert.deepEqual(exhaustive,[0,1]);
  assert.deepEqual(optimized,exhaustive);
});

test('PERF audit regression FG-PERF-009: reference and deformed visibility caches are distinct for one immutable mesh',()=>{
  const refs=[
    [0,0,2],[2,0,2],[0,2,2],
    [.2,.2,0],[1.8,.2,0],[.2,1.8,0]
  ];
  const defs=[
    [0,0,-1],[2,0,-1],[0,2,-1],
    [.2,.2,3],[1.8,.2,3],[.2,1.8,3]
  ];
  const vertices=refs.map((reference,index)=>Object.freeze({
    reference:Object.freeze([...reference]),
    position:Object.freeze([...defs[index]])
  }));
  const mesh=Object.freeze({
    vertices:Object.freeze(vertices),
    triangles:Object.freeze([
      Object.freeze({indices:Object.freeze([0,1,2]),decision:'PRESENT'}),
      Object.freeze({indices:Object.freeze([3,4,5]),decision:'PRESENT'})
    ]),
    unresolved:Object.freeze([])
  });
  const project=([x,y,z])=>({x,y,depth:z});
  const referenceOrder=prepareProofTriangles(mesh,project,{
    deformed:false,visibilityCacheKey:'same-camera',reusePrepared:true
  }).map(t=>t.index);
  const deformedCached=prepareProofTriangles(mesh,project,{
    deformed:true,visibilityCacheKey:'same-camera',reusePrepared:true
  }).map(t=>t.index);
  const deformedFresh=prepareProofTriangles(mesh,project,{
    deformed:true,broadPhase:true
  }).map(t=>t.index);
  assert.deepEqual(referenceOrder,[1,0]);
  assert.deepEqual(deformedFresh,[0,1]);
  assert.deepEqual(deformedCached,deformedFresh);
});

test('PERF visibility cache is disabled for mutable mesh objects so coordinate mutation cannot return stale order',()=>{
  const vertices=[
    {reference:[0,0,2],position:[0,0,2]},
    {reference:[2,0,2],position:[2,0,2]},
    {reference:[0,2,2],position:[0,2,2]},
    {reference:[.2,.2,0],position:[.2,.2,0]},
    {reference:[1.8,.2,0],position:[1.8,.2,0]},
    {reference:[.2,1.8,0],position:[.2,1.8,0]}
  ];
  const mesh={vertices,triangles:[
    {indices:[0,1,2],decision:'PRESENT'},
    {indices:[3,4,5],decision:'PRESENT'}
  ],unresolved:[]};
  const project=([x,y,z])=>({x,y,depth:z});
  const before=prepareProofTriangles(mesh,project,{
    visibilityCacheKey:'same',reusePrepared:true
  }).map(t=>t.index);
  for(let i=0;i<3;i++)vertices[i].reference[2]=-1;
  for(let i=3;i<6;i++)vertices[i].reference[2]=3;
  const after=prepareProofTriangles(mesh,project,{
    visibilityCacheKey:'same',reusePrepared:true
  }).map(t=>t.index);
  assert.deepEqual(before,[1,0]);
  assert.deepEqual(after,[0,1]);
});


test('PERF audit regression FG-PERF-010: shallow-frozen mesh with mutable nested coordinates is never cacheable',()=>{
  const refs=[
    [0,0,2],[2,0,2],[0,2,2],
    [.2,.2,0],[1.8,.2,0],[.2,1.8,0]
  ];
  const vertices=Object.freeze(refs.map(reference=>Object.freeze({
    reference,
    position:Object.freeze([...reference])
  })));
  const triangles=Object.freeze([
    Object.freeze({indices:Object.freeze([0,1,2]),decision:'PRESENT'}),
    Object.freeze({indices:Object.freeze([3,4,5]),decision:'PRESENT'})
  ]);
  const mesh=Object.freeze({vertices,triangles});
  const project=([x,y,z])=>({x,y,depth:z});
  const before=prepareProofTriangles(mesh,project,{
    visibilityCacheKey:'same',reusePrepared:true
  }).map(t=>t.index);
  refs.forEach((point,index)=>{point[2]=index<3?-1:3;});
  const stats={};
  const after=prepareProofTriangles(mesh,project,{
    visibilityCacheKey:'same',reusePrepared:true,stats
  }).map(t=>t.index);
  const fresh=prepareProofTriangles(mesh,project,{}).map(t=>t.index);
  assert.deepEqual(before,[1,0]);
  assert.deepEqual(fresh,[0,1]);
  assert.deepEqual(after,fresh);
  assert.equal(stats.visibilityCacheHit,false);
});

test('PERF audit regression FG-PERF-010: shallow-frozen mesh with mutable triangle normal never reuses stale style',()=>{
  const normal=[0,0,1];
  const vertices=Object.freeze([
    Object.freeze({reference:Object.freeze([0,0,0]),position:Object.freeze([0,0,0])}),
    Object.freeze({reference:Object.freeze([1,0,0]),position:Object.freeze([1,0,0])}),
    Object.freeze({reference:Object.freeze([0,1,0]),position:Object.freeze([0,1,0])})
  ]);
  const triangles=Object.freeze([
    Object.freeze({indices:Object.freeze([0,1,2]),decision:'PRESENT',normal})
  ]);
  const mesh=Object.freeze({vertices,triangles});
  const project=([x,y,z])=>({x,y,depth:z});
  const before=prepareProofTriangles(mesh,project,{reusePrepared:true})[0].light;
  normal[0]=1;normal[1]=0;normal[2]=0;
  const after=prepareProofTriangles(mesh,project,{reusePrepared:true})[0].light;
  assert.notEqual(after,before);
});
