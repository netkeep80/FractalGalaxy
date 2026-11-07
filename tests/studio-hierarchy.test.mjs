import test from 'node:test';
import assert from 'node:assert/strict';
import {makeMemoryWorldStore,validateWorldStore,ringRecordState,ringIdsForPhysicalParent} from '../src/fractal-matter.mjs';
const core={validateWorldStore,ringRecordState,ringIdsForPhysicalParent};
import {octreeKey,octreeTreeRows,expandedForOctreeSelection,e0SplitTreeRows,fractalRingTreeRows} from '../demo/studio-hierarchy.mjs';

test('octree tree is lazy, has exactly eight children per expanded node and never materializes rings',()=>{
  const root=octreeTreeRows();
  assert.equal(root.length,1);
  assert.deepEqual(root[0].path,[]);
  assert.equal(octreeTreeRows({expanded:new Set([octreeKey([])])}).length,9);
  const path=[5,2,7,3], expanded=expandedForOctreeSelection(new Set(),path);
  const visible=octreeTreeRows({expanded,selected:path});
  assert.ok(visible.some(row=>row.selected && row.key===octreeKey(path)));
  assert.equal(visible.filter(x=>x.selected).length,1);
  assert.equal(visible.filter(x=>x.path.length===4).length,8);
  assert.ok(visible.every(x=>x.virtual===true));
  assert.ok(visible.every(x=>x.path.length<=4));
  assert.throws(()=>octreeTreeRows({maxDepth:6}),/depth/);
});

test('E0 Split tree contains actual owner leaf ids but is not physical FractalRing parenthood',()=>{
  const model={root:{id:'root'},left:{id:'left'},rb:{id:'rb'},rt:{id:'rt'}};
  const rows=e0SplitTreeRows(model);
  assert.deepEqual(rows.map(r=>r.key),['split:root','split:left','split:right','split:rb','split:rt']);
  assert.deepEqual(rows.filter(r=>r.kind==='split-leaf').map(r=>r.owner),['left','rb','rt']);
  assert.deepEqual(e0SplitTreeRows(model,{expanded:new Set()}).map(r=>r.key),['split:root']);
});

function fixture(){
  return makeMemoryWorldStore({resident:['planet'],rings:[
    {id:'planet',source:{rootId:'planet-source',address:[],algorithmId:'g',algorithmVersion:'1'}},
    {id:'piece',physicalParentId:'planet',source:{rootId:'planet-source',address:[5,2,7,3],algorithmId:'g',algorithmVersion:'1'}},
    {id:'cargo',source:{rootId:'other-source',address:[1],algorithmId:'g',algorithmVersion:'2'}}
  ]});
}
test('physical FractalRing view follows physicalParentId, independently of source paths/residency',()=>{
  const store=fixture();
  assert.equal(fractalRingTreeRows(makeMemoryWorldStore(),{core}).length,0);
  const roots=fractalRingTreeRows(store,{core});
  assert.deepEqual(roots.map(row=>row.ringId),['cargo','planet']);
  const rows=fractalRingTreeRows(store,{expanded:new Set(['ring:planet']),core});
  assert.deepEqual(rows.map(row=>row.ringId),['cargo','planet','piece']);
  assert.equal(rows.find(row=>row.ringId==='piece').status,'UNLOADED');
  assert.equal(rows.find(row=>row.ringId==='planet').status,'RESIDENT');
});
test('source tree builds virtual addresses, never invents intermediate rings',()=>{
  const store=fixture();
  let rows=fractalRingTreeRows(store,{relation:'source',core});
  assert.equal(rows.length,2);
  const group=rows.find(row=>row.label.startsWith('planet-source'));
  assert.ok(group);
  const expanded=new Set([group.key]);
  for(const segment of ['','/5','/5/2','/5/2/7','/5/2/7/3']){
    rows=fractalRingTreeRows(store,{relation:'source',expanded,core});
    const node=rows.find(row=>row.kind==='source'&&row.label.includes('planet-source')&&segment==='')??rows.find(row=>row.kind==='source'&&'/'+row.path.join('/')===segment);
    if(node)expanded.add(node.key);
  }
  rows=fractalRingTreeRows(store,{relation:'source',expanded,core});
  assert.ok(rows.some(row=>row.kind==='ring'&&row.ringId==='piece'));
  assert.equal(rows.filter(row=>row.kind==='ring'&&row.ringId==='piece').length,1);
  assert.ok(rows.some(row=>row.kind==='source'&&row.path?.join('/')==='5/2/7'));
  assert.equal(Object.keys(store.records).length,3);
});
