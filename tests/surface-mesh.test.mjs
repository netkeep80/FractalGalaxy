import test from 'node:test';
import assert from 'node:assert/strict';
import {
  homogeneousVolume,mixedVolume,extractInterfacePatches,makeReferenceFacePatch,
  makeFractalVertexDeformation,makeMemoryWorldStore,makeProceduralRef,
  applyVertexInfluence,splitGeometryFractalRing,worldGeometryOffsets
} from '../src/fractal-matter.mjs';
import {assembleProvenSurfaceMesh} from '../src/geometry/surface-mesh.mjs';

const bounds={min:[-1,-1,-1],max:[1,1,1]};
const cfg={bounds,axis:'z',side:1};
const classified=(a,b,maxDepth=2)=>extractInterfacePatches({
  pathA:[0],pathB:[4],axis:'z',side:1,maxDepth,
  classifyA:a,classifyB:b
});
const rock=()=>homogeneousVolume('ROCK');
const empty=()=>homogeneousVolume('EMPTY');

test('proof boundary: same material produces zero mesh, different media produce 2 triangles',()=>{
  const none=assembleProvenSurfaceMesh({...cfg,extraction:classified(rock,rock)});
  assert.equal(none.triangles.length,0);assert.equal(none.vertices.length,0);
  const present=assembleProvenSurfaceMesh({...cfg,extraction:classified(rock,empty)});
  assert.deepEqual(present.stats,{provenPatches:1,unresolvedPatches:0,vertices:4,triangles:2});
  assert.equal(new Set(present.vertices.map(v=>v.key)).size,4);
  assert.ok(present.triangles.every(t=>t.decision==='PRESENT'&&t.indices.length===3));
});
test('MIXED never fabricates triangles and preserves proof gaps at finite depth',()=>{
  const extract=classified(()=>mixedVolume(),empty,2);
  assert.equal(extract.unresolved.length,4);
  const m=assembleProvenSurfaceMesh({...cfg,extraction:extract});
  assert.deepEqual(m.stats,{provenPatches:0,unresolvedPatches:4,vertices:0,triangles:0});
  assert.ok(m.unresolved.every(p=>p.decision==='REFINE'));
  assert.throws(()=>assembleProvenSurfaceMesh({...cfg,extraction:{
    present:[{patch:makeReferenceFacePatch(),decision:{kind:'REFINE'}}],unresolved:[]}
  }),/proven PRESENT/);
  assert.throws(()=>assembleProvenSurfaceMesh({...cfg,extraction:{
    present:[],unresolved:[{patch:makeReferenceFacePatch(),decision:{kind:'PRESENT'}}]}
  }),/REFINE/);
});
test('two adjacent proven patches share one exact canonical edge under RND, smoothing and persistent displacement',()=>{
  const first={patch:{u0:0,u1:.5,v0:0,v1:.5},decision:{kind:'PRESENT'}};
  const second={patch:{u0:.5,u1:1,v0:0,v1:.5},decision:{kind:'PRESENT'}};
  const deformation=makeFractalVertexDeformation({
    seed:997,randomAmplitude:.11,smoothingWeight:.35,
    smoothingTarget:({basePosition})=>basePosition,
    interactionOffsets:{'0,-1,1':[.13,.22,-.07]}
  });
  const extraction={present:[first,second],unresolved:[]};
  const m=assembleProvenSurfaceMesh({...cfg,extraction,deformation});
  assert.deepEqual(m.stats,{provenPatches:2,unresolvedPatches:0,vertices:6,triangles:4});
  const common=m.patches[0].vertexIndices.filter(i=>m.patches[1].vertexIndices.includes(i));
  assert.equal(common.length,2,'shared edge must use the same actual vertex indices');
  assert.ok(common.some(i=>m.vertices[i].key==='0,-1,1'));
  const reversed=assembleProvenSurfaceMesh({...cfg,extraction:{present:[second,first],unresolved:[]},deformation});
  const values=Object.fromEntries(m.vertices.map(v=>[v.key,v.position]));
  assert.deepEqual(Object.fromEntries(reversed.vertices.map(v=>[v.key,v.position])),values);
});
test('mesh geometry is unchanged after real persistent FractalRing split and cold reinterpretation',()=>{
  const source=makeProceduralRef({rootId:'S2',address:[],algorithmId:'e0',algorithmVersion:'v1'});
  const reference=[1,1,1];
  let store=makeMemoryWorldStore({resident:'none'});
  const influence=applyVertexInfluence(store,{source,reference,influence:[.25,.08,0],threshold:.03});
  store=influence.store;
  const extraction=classified(rock,empty);
  const evaluate=s=>makeFractalVertexDeformation({
    seed:78,randomAmplitude:.06,smoothingWeight:.4,
    smoothingTarget:({basePosition})=>basePosition,
    interactionOffsets:worldGeometryOffsets(s,source)
  });
  const before=assembleProvenSurfaceMesh({...cfg,extraction,deformation:evaluate(store)});
  const split=splitGeometryFractalRing(store,influence.created[0]);
  const after=assembleProvenSurfaceMesh({...cfg,extraction,deformation:evaluate(split.store)});
  assert.deepEqual(after,before);
  assert.equal(after.triangles.length,2);
  assert.ok(after.vertices.some(v=>v.key==='1,1,1'));
});
test('constant mesh evaluator is deterministic and returns nondegenerate surface normal',()=>{
 const extract=classified(rock,empty);
 const m1=assembleProvenSurfaceMesh({...cfg,extraction:extract});
 const m2=assembleProvenSurfaceMesh({...cfg,extraction:extract});
 assert.deepEqual(m1,m2);
 assert.ok(m1.triangles.every(t=>Math.hypot(...t.normal)>0));
 assert.throws(()=>assembleProvenSurfaceMesh({...cfg,extraction:extract,deformation:42}),/deformation/);
});
