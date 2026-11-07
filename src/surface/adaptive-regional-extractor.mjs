import {DOMAIN,classifyMaterialRegion,extractMaterialInterface} from '../fractal-matter.mjs';
import {octreePathToGrid,octreeGridToPath} from '../volume/octree-address.mjs';

const AXES=Object.freeze(['x','y','z']);
const AXIS_INDEX=Object.freeze({x:0,y:1,z:2});

function key(path){return path.length?path.join('.'):'root';}
function cmpPath(a,b){
  const n=Math.min(a.length,b.length);
  for(let i=0;i<n;i++)if(a[i]!==b[i])return a[i]-b[i];
  return a.length-b.length;
}
function prefix(a,b){return a.length<=b.length&&a.every((v,i)=>v===b[i]);}
function validateLeaves(cellPaths){
  if(!Array.isArray(cellPaths)||cellPaths.length===0)throw new Error('adaptive region must be non-empty');
  const seen=new Set();
  const leaves=cellPaths.map(input=>{
    if(!Array.isArray(input))throw new Error('adaptive region cell must be an octree path');
    const path=[...input];
    octreePathToGrid(path);
    if(path.length>DOMAIN.depth)throw new Error('adaptive region depth exceeds E0 domain');
    const k=key(path);
    if(seen.has(k))throw new Error('duplicate adaptive region cell');
    seen.add(k);return path;
  }).sort(cmpPath);
  for(let i=0;i<leaves.length;i++)for(let j=i+1;j<leaves.length;j++){
    if(prefix(leaves[i],leaves[j])||prefix(leaves[j],leaves[i])){
      throw new Error('adaptive region leaves must not overlap by ancestry');
    }
  }
  return leaves;
}
function boxAt(path,depth){
  const g=octreePathToGrid(path);
  const scale=2**(depth-g.depth);
  return {
    depth:g.depth,path,
    min:[g.x*scale,g.y*scale,g.z*scale],
    max:[(g.x+1)*scale,(g.y+1)*scale,(g.z+1)*scale]
  };
}
function descendantForFace(owner,other,axis,side,targetDepth){
  if(owner.path.length===targetDepth)return [...owner.path];
  const scale=2**(targetDepth-owner.path.length);
  const otherGrid=octreePathToGrid(other.path);
  const coords=[otherGrid.x,otherGrid.y,otherGrid.z];
  const oi=AXIS_INDEX[axis];
  const ownerGrid=octreePathToGrid(owner.path);
  const names=['x','y','z'];
  coords[oi]=side===1?(ownerGrid[names[oi]]+1)*scale-1:ownerGrid[names[oi]]*scale;
  return octreeGridToPath({depth:targetDepth,x:coords[0],y:coords[1],z:coords[2]});
}
function faceKey(a,b,axis){return axis+':'+key(a.path)+'>'+key(b.path);}
function exteriorKey(a,axis,side){return axis+':'+key(a.path)+':'+(side<0?'-':'+')+':OUT';}
function flatIndex(x,y,z,size){return x+size*(y+size*z);}

export function discoverAdaptiveRegionalLeaves(material,{cellPaths,maxDepth=DOMAIN.depth}={}){
  const roots=validateLeaves(cellPaths);
  if(!Number.isInteger(maxDepth)||maxDepth<Math.max(...roots.map(path=>path.length))||maxDepth>DOMAIN.depth){
    throw new RangeError('regional discovery maxDepth must cover roots and remain within E0 domain');
  }
  const leaves=[],unresolvedCells=[];
  let inspectedCells=0;
  const visit=path=>{
    inspectedCells++;
    const result=classifyMaterialRegion(material,path,{maxDepth:path.length});
    if(result.classification.kind!=='MIXED'){
      leaves.push(Object.freeze([...path]));
      return;
    }
    if(path.length===maxDepth){
      const record=Object.freeze({
        path:Object.freeze([...path]),
        classification:result.classification,
        stats:result.stats
      });
      leaves.push(record.path);
      unresolvedCells.push(record);
      return;
    }
    for(let branch=0;branch<8;branch++)visit([...path,branch]);
  };
  for(const root of roots)visit(root);
  leaves.sort(cmpPath);
  unresolvedCells.sort((a,b)=>cmpPath(a.path,b.path));
  return Object.freeze({
    leaves:Object.freeze(leaves),
    unresolvedCells:Object.freeze(unresolvedCells),
    stats:Object.freeze({
      rootCells:roots.length,
      leaves:leaves.length,
      unresolvedCells:unresolvedCells.length,
      inspectedCells,
      minLeafDepth:Math.min(...leaves.map(path=>path.length)),
      maxLeafDepth:Math.max(...leaves.map(path=>path.length))
    })
  });
}

export function enumerateAdaptiveRegionalFacePairs(cellPaths){
  const leaves=validateLeaves(cellPaths);
  const maxLeafDepth=Math.max(...leaves.map(p=>p.length));
  const size=2**maxLeafDepth;
  const boxes=leaves.map(path=>boxAt(path,maxLeafDepth));
  const owners=new Int32Array(size*size*size);
  owners.fill(-1);

  for(let owner=0;owner<boxes.length;owner++){
    const box=boxes[owner];
    for(let z=box.min[2];z<box.max[2];z++)
      for(let y=box.min[1];y<box.max[1];y++)
        for(let x=box.min[0];x<box.max[0];x++){
          const index=flatIndex(x,y,z,size);
          if(owners[index]!==-1&&owners[index]!==owner)throw new Error('adaptive region leaves overlap');
          owners[index]=owner;
        }
  }

  const internal=new Map(),exterior=new Map();
  const coords=[0,0,0];
  for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const owner=owners[flatIndex(x,y,z,size)];
    if(owner<0)continue;
    coords[0]=x;coords[1]=y;coords[2]=z;
    for(let ai=0;ai<3;ai++){
      const axis=AXES[ai];
      if(coords[ai]===0)exterior.set(owner+'|'+axis+'|-1',{owner,axis,side:-1});
      if(coords[ai]===size-1)exterior.set(owner+'|'+axis+'|1',{owner,axis,side:1});
      if(coords[ai]===size-1)continue;
      const next=[x,y,z];next[ai]++;
      const other=owners[flatIndex(next[0],next[1],next[2],size)];
      if(other<0||other===owner)continue;
      internal.set(owner+'|'+other+'|'+axis,{lower:owner,upper:other,axis});
    }
  }

  const faces=[];
  for(const item of internal.values()){
    const a=boxes[item.lower],b=boxes[item.upper],axis=item.axis;
    const proofDepth=Math.max(a.path.length,b.path.length);
    const pathA=descendantForFace(a,b,axis,1,proofDepth);
    const pathB=descendantForFace(b,a,axis,-1,proofDepth);
    faces.push(Object.freeze({
      key:faceKey(a,b,axis),axis,side:1,
      rootPathA:Object.freeze([...a.path]),rootPathB:Object.freeze([...b.path]),
      pathA:Object.freeze(pathA),pathB:Object.freeze(pathB),
      coarseFine:a.path.length!==b.path.length,
      proofDepth
    }));
  }
  for(const item of exterior.values()){
    const leaf=boxes[item.owner];
    faces.push(Object.freeze({
      key:exteriorKey(leaf,item.axis,item.side),axis:item.axis,side:item.side,
      rootPathA:Object.freeze([...leaf.path]),rootPathB:null,
      pathA:Object.freeze([...leaf.path]),pathB:null,
      coarseFine:false,proofDepth:leaf.path.length
    }));
  }
  faces.sort((a,b)=>a.key.localeCompare(b.key));
  return Object.freeze(faces);
}

function decorate(face,item){
  return Object.freeze({
    ...item,
    faceKey:face.key,
    rootPathA:face.rootPathA,
    rootPathB:face.rootPathB,
    startPathA:face.pathA,
    startPathB:face.pathB,
    axis:face.axis,side:face.side,
    coarseFine:face.coarseFine
  });
}

export function extractAdaptiveRegionalMaterialInterfaces(material,{
  cellPaths,maxDepth=DOMAIN.depth,outsideMedium='EMPTY'
}={}){
  const leaves=validateLeaves(cellPaths);
  if(!Number.isInteger(maxDepth)||maxDepth<Math.max(...leaves.map(p=>p.length))||maxDepth>DOMAIN.depth){
    throw new RangeError('adaptive regional maxDepth must cover every leaf and remain within E0 domain');
  }
  const facePairs=enumerateAdaptiveRegionalFacePairs(leaves);
  const present=[],unresolved=[],faces=[];
  let visitedPairs=0,discardedPatches=0;
  for(const face of facePairs){
    const extraction=extractMaterialInterface(material,{
      pathA:face.pathA,pathB:face.pathB,axis:face.axis,side:face.side,
      maxDepth,outsideMedium
    });
    for(const item of extraction.present)present.push(decorate(face,item));
    for(const item of extraction.unresolved)unresolved.push(decorate(face,item));
    visitedPairs+=extraction.stats.visitedPairs??0;
    discardedPatches+=extraction.stats.discardedPatches??0;
    faces.push(Object.freeze({
      ...face,presentPatches:extraction.present.length,
      unresolvedPatches:extraction.unresolved.length
    }));
  }
  const exteriorFaces=faces.filter(f=>f.rootPathB===null).length;
  const coarseFineFaces=faces.filter(f=>f.coarseFine).length;
  return Object.freeze({
    faces:Object.freeze(faces),present:Object.freeze(present),unresolved:Object.freeze(unresolved),
    stats:Object.freeze({
      cells:leaves.length,minLeafDepth:Math.min(...leaves.map(p=>p.length)),
      maxLeafDepth:Math.max(...leaves.map(p=>p.length)),
      facePairs:faces.length,internalFaces:faces.length-exteriorFaces,exteriorFaces,coarseFineFaces,
      provenPatches:present.length,unresolvedPatches:unresolved.length,visitedPairs,discardedPatches
    })
  });
}

export function extractDiscoveredRegionalMaterialInterfaces(material,{
  cellPaths,maxDepth=DOMAIN.depth,outsideMedium='EMPTY'
}={}){
  const discovery=discoverAdaptiveRegionalLeaves(material,{cellPaths,maxDepth});
  const extraction=extractAdaptiveRegionalMaterialInterfaces(material,{
    cellPaths:discovery.leaves,maxDepth,outsideMedium
  });
  return Object.freeze({
    ...extraction,
    leaves:discovery.leaves,
    unresolvedCells:discovery.unresolvedCells,
    stats:Object.freeze({
      ...extraction.stats,
      rootCells:discovery.stats.rootCells,
      discoveredLeaves:discovery.stats.leaves,
      unresolvedCells:discovery.stats.unresolvedCells,
      inspectedCells:discovery.stats.inspectedCells,
      minLeafDepth:discovery.stats.minLeafDepth,
      maxLeafDepth:discovery.stats.maxLeafDepth
    })
  });
}
