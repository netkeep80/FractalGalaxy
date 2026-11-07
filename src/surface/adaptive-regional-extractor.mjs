import {DOMAIN,extractMaterialInterface} from '../fractal-matter.mjs';
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
function overlap1d(a0,a1,b0,b1){return [Math.max(a0,b0),Math.min(a1,b1)];}
function adjacency(a,b){
  for(let axis=0;axis<3;axis++){
    let side=0;
    if(a.max[axis]===b.min[axis])side=1;
    else if(a.min[axis]===b.max[axis])side=-1;
    else continue;
    const tang=[0,1,2].filter(i=>i!==axis);
    const u=overlap1d(a.min[tang[0]],a.max[tang[0]],b.min[tang[0]],b.max[tang[0]]);
    const v=overlap1d(a.min[tang[1]],a.max[tang[1]],b.min[tang[1]],b.max[tang[1]]);
    if(u[0]<u[1]&&v[0]<v[1])return {axis,tang,side,u,v};
  }
  return null;
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
function faceKey(a,b,axis,side){
  const left=side===1?a:b,right=side===1?b:a;
  return axis+':'+key(left.path)+'>'+key(right.path);
}
function exteriorKey(a,axis,side){return axis+':'+key(a.path)+':'+(side<0?'-':'+')+':OUT';}

export function enumerateAdaptiveRegionalFacePairs(cellPaths){
  const leaves=validateLeaves(cellPaths);
  const maxLeafDepth=Math.max(...leaves.map(p=>p.length));
  const boxes=leaves.map(path=>boxAt(path,maxLeafDepth));
  const faces=[];

  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
    const hit=adjacency(boxes[i],boxes[j]);
    if(!hit)continue;
    let a=boxes[i],b=boxes[j],side=hit.side;
    if(side===-1){[a,b]=[b,a];side=1;}
    const axis=AXES[hit.axis];
    const proofDepth=Math.max(a.path.length,b.path.length);
    const pathA=descendantForFace(a,b,axis,1,proofDepth);
    const pathB=descendantForFace(b,a,axis,-1,proofDepth);
    faces.push(Object.freeze({
      key:faceKey(a,b,axis,1),axis,side:1,
      rootPathA:Object.freeze([...a.path]),rootPathB:Object.freeze([...b.path]),
      pathA:Object.freeze(pathA),pathB:Object.freeze(pathB),
      coarseFine:a.path.length!==b.path.length,
      proofDepth
    }));
  }

  const size=2**maxLeafDepth;
  for(const leaf of boxes){
    for(let ai=0;ai<3;ai++){
      const axis=AXES[ai];
      if(leaf.min[ai]===0){
        faces.push(Object.freeze({
          key:exteriorKey(leaf,axis,-1),axis,side:-1,
          rootPathA:Object.freeze([...leaf.path]),rootPathB:null,
          pathA:Object.freeze([...leaf.path]),pathB:null,
          coarseFine:false,proofDepth:leaf.path.length
        }));
      }
      if(leaf.max[ai]===size){
        faces.push(Object.freeze({
          key:exteriorKey(leaf,axis,1),axis,side:1,
          rootPathA:Object.freeze([...leaf.path]),rootPathB:null,
          pathA:Object.freeze([...leaf.path]),pathB:null,
          coarseFine:false,proofDepth:leaf.path.length
        }));
      }
    }
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
