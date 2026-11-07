// Read-only hierarchy projections. No procedural expansion materializes a FractalRing.
import { formatPath } from './studio-picking.mjs';

export const MAX_STUDIO_TREE_DEPTH = 4;
function validPath(path) {
  if (!Array.isArray(path) || path.some(n => !Number.isInteger(n) || n < 0 || n > 7)) {
    throw new RangeError('invalid octree path');
  }
  return path;
}
export function octreeKey(path) { return 'octree:' + formatPath(validPath(path)); }
export function expandedForOctreeSelection(keys, path) {
  validPath(path);
  const next = new Set(keys);
  for (let depth=0; depth<path.length; depth++) next.add(octreeKey(path.slice(0,depth)));
  return next;
}
export function octreeTreeRows({ expanded = new Set(), selected = [], maxDepth = MAX_STUDIO_TREE_DEPTH } = {}) {
  validPath(selected);
  if (!Number.isInteger(maxDepth) || maxDepth<0 || maxDepth>5 || selected.length>maxDepth) {
    throw new RangeError('invalid tree depth');
  }
  const result = [];
  function visit(path) {
    const key=octreeKey(path);
    const canExpand=path.length < maxDepth;
    result.push({key, path:[...path], depth:path.length, kind:'octree',
      label:path.length ? String(path[path.length-1]) : 'Ω',
      hasChildren:canExpand, expanded:canExpand && expanded.has(key),
      selected:formatPath(path) === formatPath(selected), virtual:true});
    if (canExpand && expanded.has(key)) {
      for(let branch=0;branch<8;branch++) visit([...path,branch]);
    }
  }
  visit([]);
  return result;
}
// Read-only process provenance, not a FractalRing physical-parent relationship.
export function e0SplitTreeRows(model, { expanded = new Set(['split:root','split:right']) } = {}) {
  if (!model?.root?.id || !model?.left?.id || !model?.rb?.id || !model?.rt?.id) {
    throw new Error('E0 model with root/left/rb/rt required');
  }
  const nodes = [
    {key:'split:root', label:model.root.id, depth:0, hasChildren:true, kind:'split-stage'},
    {key:'split:left', label:model.left.id, depth:1, hasChildren:false, kind:'split-leaf', owner:'left'},
    {key:'split:right', label:'right', depth:1, hasChildren:true, kind:'split-stage'},
    {key:'split:rb', label:model.rb.id, depth:2, hasChildren:false, kind:'split-leaf',owner:'rb'},
    {key:'split:rt', label:model.rt.id, depth:2, hasChildren:false, kind:'split-leaf',owner:'rt'}
  ];
  const rows=[];
  for (const node of nodes) {
    if (node.key==='split:root' || (node.depth===1 && expanded.has('split:root'))
      || (node.depth===2 && expanded.has('split:root') && expanded.has('split:right'))) {
      rows.push({...node,expanded:node.hasChildren&&expanded.has(node.key),selected:false});
    }
  }
  return rows;
}
function stateRow(store, ring, depth, core) {
  return {key:'ring:'+ring.id,label:ring.id,ringId:ring.id,depth,kind:'ring',
    status:core.ringRecordState(store,ring.id),hasChildren:false,selected:false,
    impactedVertices:Object.keys(ring.overrides?.geometryVertexOffsets??{}).length};
}
export function fractalRingTreeRows(store,{relation='physical',expanded=new Set(),core,impactsOnly=false}={}) {
  if (!core?.validateWorldStore || !core?.ringRecordState || !core?.ringIdsForPhysicalParent) throw new Error('WorldStore API required');
  core.validateWorldStore(store);
  if (relation!=='physical' && relation!=='source') throw new RangeError('invalid ring relation');
  if (relation==='physical') {
    const result=[];
    const walk=(id,depth)=>{
      const record=store.records[id];
      const children=core.ringIdsForPhysicalParent(store,id);
      const key='ring:'+id;
      result.push({...stateRow(store,record,depth,core),hasChildren:children.length>0,expanded:children.length>0&&expanded.has(key)});
      if(expanded.has(key))for(const child of children) walk(child,depth+1);
    };
    for(const id of core.ringIdsForPhysicalParent(store,null))walk(id,0);
    return result;
  }
  // Virtual source-prefix nodes are strictly grouping labels, not materialized rings.
  const groups = new Map();
  for (const ring of Object.values(store.records)) {
    if(impactsOnly && !Object.keys(ring.overrides?.geometryVertexOffsets??{}).length)continue;
    const {rootId,algorithmId,algorithmVersion,address}=ring.source;
    const groupKey=JSON.stringify([rootId,algorithmId,algorithmVersion]);
    if(!groups.has(groupKey))groups.set(groupKey,{rootId,algorithmId,algorithmVersion,children:new Map(),rings:[]});
    let current=groups.get(groupKey);
    for(const part of address){
      if(!current.children.has(part))current.children.set(part,{children:new Map(),rings:[]});
      current=current.children.get(part);
    }
    current.rings.push(ring);
  }
  const result=[];
  for(const [id,group] of [...groups.entries()].sort(([a],[b])=>a.localeCompare(b))){
    const prefix='source:'+encodeURIComponent(id);
    const walk=(node,path,depth)=>{
      const key=prefix+':'+formatPath(path);
      const branches=[...node.children.entries()].sort(([a],[b])=>a-b);
      const rings=[...node.rings].sort((a,b)=>a.id.localeCompare(b.id));
      const children=branches.length+rings.length;
      result.push({key,label:depth===0?group.rootId+' · '+group.algorithmId+'@'+group.algorithmVersion:String(path[path.length-1]),
        path:[...path],depth,kind:'source',hasChildren:children>0,expanded:children>0&&expanded.has(key),virtual:true});
      if(expanded.has(key)){
        for(const [branch,child] of branches)walk(child,[...path,branch],depth+1);
        for(const ring of rings)result.push(stateRow(store,ring,depth+1,core));
      }
    };
    walk(group,[],0);
  }
  return result;
}
