import {makeProceduralRef,proceduralIdentityKey} from '../procedural/source-ref.mjs';
import {makeFractalRing} from './fractal-ring.mjs';
import {setFractalRingVertexOffset,geometryVertexOffsets} from './geometry-overrides.mjs';
import {referenceVertexKey} from '../geometry/surface-patch.mjs';
import {octreeBoundsForPath} from '../volume/octree-address.mjs';
import {evaluateGeometryInfluence,geometryInfluenceCreatesOverride} from '../geometry/influence-threshold.mjs';
import {validateWorldStore,putFractalRingRecord,ringIdsForPhysicalParent} from '../storage/world-store.mjs';

const zero=()=>[0,0,0];
const add=(a,b)=>a.map((n,i)=>n+b[i]);
const sub=(a,b)=>a.map((n,i)=>n-b[i]);
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
function vec3(value,name){
  if(!Array.isArray(value)||value.length!==3||!value.every(Number.isFinite))throw new Error(name+' must be finite vec3');
  return [...value];
}
const prefix=(a,b)=>a.length<=b.length&&a.every((n,i)=>n===b[i]);
function sameFamily(a,b){
  return a.rootId===b.rootId&&a.algorithmId===b.algorithmId&&a.algorithmVersion===b.algorithmVersion;
}
function inside(reference,path){
  const {min,max}=octreeBoundsForPath(path);
  return reference.every((v,i)=>v>=min[i]-1e-12&&v<=max[i]+1e-12);
}
function sourceId(source){
  const s=makeProceduralRef(source);
  return 'geometry:'+encodeURIComponent(proceduralIdentityKey(s));
}
function sourceCandidates(store,source,reference){
  const candidates=Object.values(store.records).filter(r=>
    sameFamily(r.source,source)&&
    prefix(source.address,r.source.address)&&inside(reference,r.source.address));
  const deepest=Math.max(-1,...candidates.map(r=>r.source.address.length));
  return candidates.filter(r=>r.source.address.length===deepest);
}

/** Collect the canonical RESULT field; never replay interaction events. */
export function worldGeometryOffsets(store,source){
  validateWorldStore(store);
  const base=makeProceduralRef(source);
  const offsets=Object.create(null);
  for(const ring of Object.values(store.records).sort((a,b)=>a.id.localeCompare(b.id))){
    if(!sameFamily(ring.source,base))continue;
    for(const [key,value] of Object.entries(geometryVertexOffsets(ring))){
      const offset=vec3(value,'geometry offset');
      if(offsets[key]&&!same(offsets[key],offset))throw new Error('conflicting shared vertex offset '+key);
      offsets[key]=offset;
    }
  }
  return offsets;
}

/**
 * Apply only the excess above threshold. One drag gesture is one influence;
 * subthreshold gestures do not accumulate into persistent plastic deformation.
 * No ring is created when the result is blocked.
 */
export function applyVertexInfluence(store,{source,reference,influence,threshold=0,compliance=1}={}){
  validateWorldStore(store);
  const src=makeProceduralRef(source);
  const point=vec3(reference,'reference');
  if(!inside(point,src.address))throw new RangeError('vertex outside source region');
  const evaluated=evaluateGeometryInfluence(influence,{threshold,compliance});
  if(!geometryInfluenceCreatesOverride(evaluated)){
    return {store,created:[],updated:[],result:evaluated};
  }
  const key=referenceVertexKey(point);
  const previous=worldGeometryOffsets(store,src)[key]??zero();
  const nextOffset=add(previous,evaluated.offset);
  let targets=sourceCandidates(store,src,point);
  let nextStore=store;
  const created=[],updated=[];
  if(!targets.length){
    const id=sourceId(src);
    if(store.records[id])throw new Error('source ID collision');
    const closest=Object.values(store.records)
      .filter(r=>sameFamily(r.source,src)&&prefix(r.source.address,src.address))
      .sort((a,b)=>b.source.address.length-a.source.address.length)[0]??null;
    const ring=makeFractalRing({id,source:src,physicalParentId:closest?.id??null});
    nextStore=putFractalRingRecord(nextStore,ring);
    targets=[ring];
    created.push(id);
  }
  const affected=new Map();
  // Every already-persisted copy of a shared vertex must stay identical.
  for(const ring of Object.values(nextStore.records)){
    if(!sameFamily(ring.source,src))continue;
    if(geometryVertexOffsets(ring)[key])affected.set(ring.id,ring);
  }
  for(const target of targets)affected.set(target.id,target);
  for(const ring of affected.values()){
    nextStore=putFractalRingRecord(nextStore,setFractalRingVertexOffset(ring,point,nextOffset));
    updated.push(ring.id);
  }
  return {store:nextStore,created,updated,result:evaluated,key,offset:nextOffset};
}

/** Explicit subdivision of *persistent individualization*, not an octree LOD request. */
export function splitGeometryFractalRing(store,ringId){
  validateWorldStore(store);
  const ring=store.records[ringId];
  if(!ring)throw new Error('missing FractalRing: '+ringId);
  if(ring.source.address.length>=30)throw new RangeError('octree depth unsupported');
  if(ringIdsForPhysicalParent(store,ringId).length)throw new Error('already has physical children');
  const originals=geometryVertexOffsets(ring);
  if(Object.keys(originals).some(key=>!inside(key.split(',').map(Number),ring.source.address))){
    throw new Error('ring has offsets outside source region');
  }
  // Include geometry already visible from adjacent materialized regions.
  // Otherwise a newly split ring could lose a shared boundary vertex even
  // though it had no local copy of that persistent canonical displacement.
  const effective=worldGeometryOffsets(store,ring.source);
  const transferred=Object.entries(effective).filter(([key])=>
    inside(key.split(',').map(Number),ring.source.address)
  ).map(([key,offset])=>({
    reference:key.split(',').map(Number),
    offset:vec3(offset,'effective offset')
  }));
  let nextStore=putFractalRingRecord(store,{
    ...ring,overrides:{...ring.overrides,geometryVertexOffsets:{}}
  },{resident:Boolean(store.residentIds[ringId])});
  const created=[];
  for(let branch=0;branch<8;branch++){
    const childSource=makeProceduralRef({
      ...ring.source,address:[...ring.source.address,branch]
    });
    const childId=ringId+'/octant-'+branch;
    if(nextStore.records[childId])throw new Error('child already exists '+childId);
    const offsets=Object.create(null);
    for(const {reference,offset} of transferred){
      if(inside(reference,childSource.address))offsets[referenceVertexKey(reference)]=offset;
    }
    // Child local translation is zero; it inherits the exact parent world frame.
    const child=makeFractalRing({
      id:childId,source:childSource,physicalParentId:ringId,
      materialId:ring.materialId,overrides:{geometryVertexOffsets:offsets}
    });
    nextStore=putFractalRingRecord(nextStore,child);
    created.push(childId);
  }
  return {store:nextStore,parentId:ringId,created};
}
export function ringWorldTranslation(store,ringId){
  validateWorldStore(store);
  let current=store.records[ringId];
  if(!current)throw new Error('missing ring '+ringId);
  let result=zero();
  while(current){
    result=add(result,current.position);
    current=current.physicalParentId?store.records[current.physicalParentId]:null;
  }
  return result;
}
export function ringVertexWorldPosition(store,ringId,reference,proceduralPosition){
  const ref=vec3(reference,'reference');
  const canonical=vec3(proceduralPosition,'proceduralPosition');
  const ring=store.records[ringId];
  if(!ring)throw new Error('missing ring');
  if(!inside(ref,ring.source.address))throw new RangeError('reference outside ring');
  const offset=geometryVertexOffsets(ring)[referenceVertexKey(ref)]??zero();
  return add(add(canonical,offset),ringWorldTranslation(store,ringId));
}
/** Preserve world coordinates when changing a ring's physical parent; translation-only model. */
export function reparentRingPreservingGeometry(store,ringId,newParentId=null){
  validateWorldStore(store);
  const ring=store.records[ringId];
  if(!ring)throw new Error('missing ring');
  if(newParentId!==null&&!store.records[newParentId])throw new Error('missing physical parent');
  if(newParentId===ringId)throw new Error('physical cycle');
  let ancestor=newParentId;
  while(ancestor){
    if(ancestor===ringId)throw new Error('physical cycle');
    ancestor=store.records[ancestor].physicalParentId;
  }
  const global=ringWorldTranslation(store,ringId);
  const newParentGlobal=newParentId?ringWorldTranslation(store,newParentId):zero();
  const next=putFractalRingRecord(store,{
    ...ring,physicalParentId:newParentId,position:sub(global,newParentGlobal)
  },{resident:Boolean(store.residentIds[ringId])});
  return next;
}
