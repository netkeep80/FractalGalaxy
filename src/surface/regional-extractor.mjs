import {DOMAIN,extractMaterialInterface} from '../fractal-matter.mjs';
import {adjacentOctreePath,octreePathToGrid} from '../volume/octree-address.mjs';

const AXES=Object.freeze(['x','y','z']);

function pathKey(path){
  return path.length?path.join('.'):'root';
}

function comparePaths(a,b){
  const n=Math.min(a.length,b.length);
  for(let i=0;i<n;i++){
    if(a[i]!==b[i])return a[i]-b[i];
  }
  return a.length-b.length;
}

function normalizeCellPaths(cellPaths){
  if(!Array.isArray(cellPaths)||cellPaths.length===0){
    throw new Error('regional cellPaths must be a non-empty array');
  }
  let depth=null;
  const seen=new Set();
  const cells=cellPaths.map(input=>{
    if(!Array.isArray(input))throw new Error('regional cell path must be an octree path');
    const path=[...input];
    octreePathToGrid(path);
    if(path.length>DOMAIN.depth)throw new Error('regional cell path exceeds E0 domain depth');
    if(depth===null)depth=path.length;
    if(path.length!==depth)throw new Error('regional cells must have same depth');
    const key=pathKey(path);
    if(seen.has(key))throw new Error('duplicate regional cell path');
    seen.add(key);
    return path;
  });
  cells.sort(comparePaths);
  return {depth,cells,set:new Set(cells.map(pathKey))};
}

function frozenPath(path){
  return path===null?null:Object.freeze([...path]);
}

function makeFace({depth,pathA,pathB,axis,side}){
  const key=pathB===null
    ? `d${depth}:${axis}:${pathKey(pathA)}:${side<0?'-':'+'}:OUT`
    : `d${depth}:${axis}:${pathKey(pathA)}>${pathKey(pathB)}`;
  return Object.freeze({
    key,axis,side,
    pathA:frozenPath(pathA),
    pathB:frozenPath(pathB)
  });
}

export function octreePathsAtDepth(depth){
  if(!Number.isInteger(depth)||depth<0||depth>DOMAIN.depth){
    throw new RangeError(`octree depth must be between 0 and ${DOMAIN.depth}`);
  }
  let paths=[[]];
  for(let level=0;level<depth;level++){
    const next=[];
    for(const path of paths){
      for(let branch=0;branch<8;branch++)next.push([...path,branch]);
    }
    paths=next;
  }
  return Object.freeze(paths.map(path=>Object.freeze(path)));
}

export function enumerateRegionalFacePairs(cellPaths){
  const {depth,cells,set}=normalizeCellPaths(cellPaths);
  const faces=[];
  for(const path of cells){
    for(const axis of AXES){
      const lower=adjacentOctreePath(path,axis,-1);
      if(lower===null){
        faces.push(makeFace({depth,pathA:path,pathB:null,axis,side:-1}));
      }

      const upper=adjacentOctreePath(path,axis,1);
      if(upper===null){
        faces.push(makeFace({depth,pathA:path,pathB:null,axis,side:1}));
      }else if(set.has(pathKey(upper))){
        faces.push(makeFace({depth,pathA:path,pathB:upper,axis,side:1}));
      }
    }
  }
  faces.sort((a,b)=>a.key.localeCompare(b.key));
  return Object.freeze(faces);
}

function regionalRecord(face,item){
  return Object.freeze({
    ...item,
    faceKey:face.key,
    rootPathA:face.pathA,
    rootPathB:face.pathB,
    axis:face.axis,
    side:face.side
  });
}

export function extractRegionalMaterialInterfaces(material,{
  cellPaths,
  maxDepth=DOMAIN.depth,
  outsideMedium='EMPTY'
}={}){
  const {depth}=normalizeCellPaths(cellPaths);
  if(!Number.isInteger(maxDepth)||maxDepth<depth||maxDepth>DOMAIN.depth){
    throw new RangeError('regional maxDepth must be >= cell depth and within E0 domain');
  }

  const facePairs=enumerateRegionalFacePairs(cellPaths);
  const faces=[];
  const present=[];
  const unresolved=[];
  let visitedPairs=0;
  let discardedPatches=0;

  for(const face of facePairs){
    const extraction=extractMaterialInterface(material,{
      pathA:face.pathA,
      pathB:face.pathB,
      axis:face.axis,
      side:face.side,
      maxDepth,
      outsideMedium
    });
    visitedPairs+=extraction.stats.visitedPairs??0;
    discardedPatches+=extraction.stats.discardedPatches??0;

    for(const item of extraction.present)present.push(regionalRecord(face,item));
    for(const item of extraction.unresolved)unresolved.push(regionalRecord(face,item));

    faces.push(Object.freeze({
      ...face,
      presentPatches:extraction.present.length,
      unresolvedPatches:extraction.unresolved.length,
      visitedPairs:extraction.stats.visitedPairs??0,
      discardedPatches:extraction.stats.discardedPatches??0
    }));
  }

  const exteriorFaces=facePairs.filter(face=>face.pathB===null).length;
  return Object.freeze({
    faces:Object.freeze(faces),
    present:Object.freeze(present),
    unresolved:Object.freeze(unresolved),
    stats:Object.freeze({
      cellDepth:depth,
      cells:cellPaths.length,
      facePairs:facePairs.length,
      internalFaces:facePairs.length-exteriorFaces,
      exteriorFaces,
      provenPatches:present.length,
      unresolvedPatches:unresolved.length,
      visitedPairs,
      discardedPatches
    })
  });
}
