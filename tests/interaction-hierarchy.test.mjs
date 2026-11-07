import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeMemoryWorldStore,makeProceduralRef,makeFractalVertexDeformation,
  evaluateFractalVertex,worldStoreStats,ringIdsForPhysicalParent,
  serializePersistentWorldStore,loadPersistentWorldStore,ringIdsForProceduralSource
} from '../src/fractal-matter.mjs';
import {
  applyVertexInfluence,splitGeometryFractalRing,ringWorldTranslation,
  ringVertexWorldPosition,reparentRingPreservingGeometry,worldGeometryOffsets
} from '../src/rings/interaction-hierarchy.mjs';
const src=(address=[])=>makeProceduralRef({rootId:'test-world',address,algorithmId:'e0',algorithmVersion:'v1'});
const eq=(a,b)=>assert.deepEqual(a,b);
test('subthreshold and at-threshold gestures never create physical rings or persistent overrides',()=>{
  const original=makeMemoryWorldStore({resident:'none'}),source=src([7]);
  for(const v of [[.01,0,0],[.045,0,0],[0,0,0]]){
    const out=applyVertexInfluence(original,{source,reference:[1,1,1],influence:v,threshold:.045,compliance:1});
    assert.equal(out.store,original);
    eq(out.created,[]);
    assert.equal(worldStoreStats(out.store).persisted,0);
  }
});
test('above-threshold drag persists only excess and aggregates resulting vertex offset without event history',()=>{
  let store=makeMemoryWorldStore({resident:'none'});
  const a=applyVertexInfluence(store,{source:src([7]),reference:[1,1,1],influence:[.145,0,0],threshold:.045,compliance:2});
  store=a.store;
  assert.ok(Math.abs(a.offset[0]-.2)<1e-12);
  assert.deepEqual(a.offset.slice(1),[0,0]);
  assert.equal(worldStoreStats(store).persisted,1);
  const b=applyVertexInfluence(store,{source:src([7]),reference:[1,1,1],influence:[0,.095,0],threshold:.045,compliance:1});
  store=b.store;
  assert.equal(worldStoreStats(store).persisted,1);
  assert.ok(Math.abs(worldGeometryOffsets(store,src())[a.key][0]-.2)<1e-12);
  assert.ok(Math.abs(worldGeometryOffsets(store,src())[a.key][1]-.05)<1e-12);
  assert.equal(store.records[a.created[0]].overrides.geometryVertexOffsets[a.key].length,3);
  assert.equal(store.records[a.created[0]].overrides.events,undefined);
});
test('split into eight persistent child rings preserves every pre-existing deformed vertex world coordinate, including seams',()=>{
  let store=makeMemoryWorldStore({resident:'none'});
  const source=src([7]),reference=[1,.5,.5];
  const refs=[[1,.5,.5],[.5,1,.5],[1,1,1],[.5,.5,.5]];
  const offsets=[[.15,.04,-.06],[0,.1,0],[.04,0,.03],[0,.06,0]];
  let parent;
  for(let i=0;i<refs.length;i++){
    const out=applyVertexInfluence(store,{source,reference:refs[i],influence:offsets[i],threshold:0,compliance:1});
    store=out.store;
    parent??=out.created[0];
  }
  store={...store,records:{...store.records,[parent]:{...store.records[parent],position:[3,-2,7]}}};
  const procedural=reference=>evaluateFractalVertex(reference,{
    seed:231,randomAmplitude:.11,smoothingWeight:.33,smoothingTarget:({basePosition})=>basePosition
  }).position;
  const before=refs.map(ref=>ringVertexWorldPosition(store,parent,ref,procedural(ref)));
  const originalOffsets=worldGeometryOffsets(store,source);
  const result=splitGeometryFractalRing(store,parent),next=result.store;
  assert.equal(result.created.length,8);
  assert.equal(worldStoreStats(next).persisted,9);
  eq(worldGeometryOffsets(next,source),originalOffsets);
  for(const [index,ref] of refs.entries()){
    const children=result.created.filter(id=>{
      const r=next.records[id].source.address;
      const {min,max}=r.reduce((b,branch)=>{
        const m=b.min.map((v,i)=>(v+b.max[i])/2);
        return {min:b.min.map((v,i)=>((branch>>i)&1)?m[i]:v),
          max:b.max.map((v,i)=>((branch>>i)&1)?v:m[i])};
      },{min:[-1,-1,-1],max:[1,1,1]});
      return ref.every((x,i)=>x>=min[i]-1e-12&&x<=max[i]+1e-12);
    });
    assert.ok(children.length>=1);
    for(const id of children)eq(ringVertexWorldPosition(next,id,ref,procedural(ref)),before[index]);
  }
  assert.equal(Object.keys(next.records[parent].overrides.geometryVertexOffsets).length,0);
  const cold=loadPersistentWorldStore(serializePersistentWorldStore(next),{resident:'none'});
  eq(worldGeometryOffsets(cold,source),originalOffsets);
  assert.equal(worldStoreStats(cold).resident,0);
  eq(ringIdsForPhysicalParent(cold,parent),result.created);
  assert.equal(ringIdsForProceduralSource(cold,source).length,1);
});
test('reparent and detach geometry ring preserve world-space vertices with nonzero parent translations',()=>{
  let store=makeMemoryWorldStore({rings:[
    {id:'a',source:src([]),position:[4,2,-3]},
    {id:'b',source:src([]),position:[-2,1,5]},
    {id:'child',source:src([7]),physicalParentId:'a',position:[.3,-.1,.2],
      overrides:{geometryVertexOffsets:{'1,1,1':[.5,.7,-.2]}}}
  ]});
  const ref=[1,1,1],proc=[.4,.8,.2];
  const before=ringVertexWorldPosition(store,'child',ref,proc);
  store=reparentRingPreservingGeometry(store,'child','b');
  eq(ringVertexWorldPosition(store,'child',ref,proc),before);
  assert.equal(store.records.child.source.rootId,'test-world');
  assert.deepEqual(store.records.child.source.address,[7]);
  store=reparentRingPreservingGeometry(store,'child',null);
  eq(ringVertexWorldPosition(store,'child',ref,proc),before);
  assert.throws(()=>reparentRingPreservingGeometry(store,'a','a'),/cycle/);
});

test('second influence after split updates all shared copies and a subsequent nested split preserves geometry',()=>{
  const source=src([]),ref=[0,0,1],canonical=[.31,.02,.9];
  let store=makeMemoryWorldStore({resident:'none'});
  const first=applyVertexInfluence(store,{source,reference:ref,influence:[.25,0,0],threshold:.05});
  store=splitGeometryFractalRing(first.store,first.created[0]).store;
  const before=worldGeometryOffsets(store,source)['0,0,1'];
  const second=applyVertexInfluence(store,{source,reference:ref,influence:[0,.2,0],threshold:.05});
  store=second.store;
  assert.equal(second.created.length,0,'already materialized descendants must be updated rather than duplicated');
  assert.equal(second.updated.length,4,'shared upper-face center belongs to four child octants');
  const expected=worldGeometryOffsets(store,source)['0,0,1'];
  assert.equal(expected[0],before[0]);
  assert.ok(Math.abs(expected[1]-(before[1]+.15))<1e-12);
  assert.equal(expected[2],before[2]);
  const touching=second.updated;
  for(const id of touching){
    assert.deepEqual(ringVertexWorldPosition(store,id,ref,canonical),
      canonical.map((v,i)=>v+expected[i]));
  }
  const original=touching[0];
  const split=splitGeometryFractalRing(store,original);
  const nested=split.store;
  assert.equal(split.created.length,8);
  assert.deepEqual(worldGeometryOffsets(nested,source)['0,0,1'],expected);
  for(const id of split.created){
    const ring=nested.records[id];
    if(ring.overrides.geometryVertexOffsets['0,0,1']){
      assert.deepEqual(ringVertexWorldPosition(nested,id,ref,canonical),
        canonical.map((v,i)=>v+expected[i]));
    }
  }
  const cold=loadPersistentWorldStore(serializePersistentWorldStore(nested),{resident:'none'});
  assert.deepEqual(worldGeometryOffsets(cold,source)['0,0,1'],expected);
});
