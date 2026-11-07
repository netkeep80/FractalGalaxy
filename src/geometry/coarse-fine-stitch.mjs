import {identityDeformation} from './deformation.mjs';
import {buildSurfacePatchGeometry} from './surface-patch.mjs';
import {makeReferenceFacePatch} from '../surface/interface.mjs';

const E0_MIN=-1;
const E0_MAX=1;
const E0_DEPTH=5;
const EPS=1e-12;

function finiteBounds(bounds,name){
  if(!bounds||!Array.isArray(bounds.min)||!Array.isArray(bounds.max)
    ||bounds.min.length!==3||bounds.max.length!==3
    ||!bounds.min.every(Number.isFinite)||!bounds.max.every(Number.isFinite)){
    throw new Error(name+' bounds must contain finite min/max vec3');
  }
  if(bounds.min.some((value,axis)=>!(value<bounds.max[axis]))){
    throw new Error(name+' bounds must be increasing');
  }
  return {min:[...bounds.min],max:[...bounds.max]};
}

function axisIndex(axis){
  if(axis==='x')return 0;
  if(axis==='y')return 1;
  if(axis==='z')return 2;
  throw new Error('axis must be x, y, or z');
}

function cellSize(bounds){
  return bounds.max.map((value,axis)=>value-bounds.min[axis]);
}

function exactCube(bounds,name){
  const size=cellSize(bounds);
  if(!(Math.abs(size[0]-size[1])<=EPS&&Math.abs(size[1]-size[2])<=EPS)){
    throw new Error(name+' must be an octree cube');
  }
  return size[0];
}

function octreeDepthAndAlignment(bounds,name,{allowDepth=E0_DEPTH}={}){
  const size=exactCube(bounds,name);
  const depth=Math.log2((E0_MAX-E0_MIN)/size);
  const rounded=Math.round(depth);
  if(Math.abs(depth-rounded)>EPS||rounded<0||rounded>allowDepth){
    throw new Error(name+' must have a dyadic E0 octree size');
  }
  for(let axis=0;axis<3;axis++){
    if(bounds.min[axis]<E0_MIN-EPS||bounds.max[axis]>E0_MAX+EPS){
      throw new Error(name+' must stay inside the E0 domain');
    }
    const grid=(bounds.min[axis]-E0_MIN)/size;
    if(Math.abs(grid-Math.round(grid))>EPS){
      throw new Error(name+' must be aligned to the E0 octree grid');
    }
  }
  return rounded;
}

function validateFace(face,name){
  if(!face||!['x','y','z'].includes(face.axis)||![-1,1].includes(face.side)){
    throw new Error(name+' must define axis and side');
  }
  return {
    id:face.id??null,
    bounds:finiteBounds(face.bounds,name),
    axis:face.axis,
    side:face.side
  };
}

function facePlane(face){
  const normal=axisIndex(face.axis);
  return face.side===1?face.bounds.max[normal]:face.bounds.min[normal];
}

function normalizeZero(value){
  return Object.is(value,-0)?0:value;
}

function normalizedFinePatch(coarse,fine){
  const normal=axisIndex(coarse.axis);
  const tangent=[0,1,2].filter(index=>index!==normal);
  const patch={};
  for(const [name,axis] of [['u',tangent[0]],['v',tangent[1]]]){
    const span=coarse.bounds.max[axis]-coarse.bounds.min[axis];
    patch[name+'0']=normalizeZero((fine.bounds.min[axis]-coarse.bounds.min[axis])/span);
    patch[name+'1']=normalizeZero((fine.bounds.max[axis]-coarse.bounds.min[axis])/span);
  }
  return patch;
}

function patchKey(patch){
  return [patch.u0,patch.u1,patch.v0,patch.v1].join(',');
}

function freezeVec3(point){
  return Object.freeze([...point]);
}

function sameVec3(a,b){
  return a.length===3&&a.every((value,index)=>value===b[index]||Object.is(value,b[index]));
}

const EXPECTED_PATCHES=Object.freeze([
  Object.freeze({u0:0,u1:.5,v0:0,v1:.5}),
  Object.freeze({u0:.5,u1:1,v0:0,v1:.5}),
  Object.freeze({u0:0,u1:.5,v0:.5,v1:1}),
  Object.freeze({u0:.5,u1:1,v0:.5,v1:1})
]);
const EXPECTED_KEYS=new Set(EXPECTED_PATCHES.map(patchKey));

export function stitchCoarseFineInterface({
  coarse,
  fineFaces,
  deformation=identityDeformation
}={}){
  if(typeof deformation!=='function')throw new Error('deformation must be a function');
  const coarseFace=validateFace(coarse,'coarse face');
  const coarseDepth=octreeDepthAndAlignment(coarseFace.bounds,'coarse face',{allowDepth:E0_DEPTH-1});
  const coarseSize=exactCube(coarseFace.bounds,'coarse face');

  if(!Array.isArray(fineFaces)||fineFaces.length!==4){
    throw new Error('S3-B 1:4 seam requires exactly four fine faces');
  }

  const fineSize=coarseSize/2;
  const normalized=[];
  const coverage=new Set();

  for(const input of fineFaces){
    const fine=validateFace(input,'fine face');
    const fineDepth=octreeDepthAndAlignment(fine.bounds,'fine face');
    if(fineDepth!==coarseDepth+1){
      throw new Error('fine faces must be exactly one octree level deeper');
    }
    if(fine.axis!==coarseFace.axis||fine.side!==-coarseFace.side){
      throw new Error('fine face must use the opposite side of the same axis');
    }
    if(Math.abs(facePlane(fine)-facePlane(coarseFace))>EPS){
      throw new Error('coarse/fine faces must be coplanar on one canonical plane');
    }
    if(Math.abs(exactCube(fine.bounds,'fine face')-fineSize)>EPS){
      throw new Error('fine faces must be exactly one octree level deeper');
    }

    const patch=normalizedFinePatch(coarseFace,fine);
    const k=patchKey(patch);
    if(coverage.has(k))throw new Error('duplicate coarse/fine coverage patch');
    coverage.add(k);
    if(!EXPECTED_KEYS.has(k)){
      throw new Error('fine faces must provide exact canonical 1:4 coverage');
    }
    normalized.push({fine,patch});
  }

  if(coverage.size!==EXPECTED_KEYS.size||[...EXPECTED_KEYS].some(k=>!coverage.has(k))){
    throw new Error('fine faces must provide complete canonical 1:4 coverage');
  }

  normalized.sort((a,b)=>a.patch.v0-b.patch.v0||a.patch.u0-b.patch.u0);

  const vertices=[];
  const byKey=new Map();
  const tiles=[];

  for(const {fine,patch} of normalized){
    const coarseGeometry=buildSurfacePatchGeometry({
      bounds:coarseFace.bounds,
      axis:coarseFace.axis,
      side:coarseFace.side,
      patch,
      deformation
    });
    const fineGeometry=buildSurfacePatchGeometry({
      bounds:fine.bounds,
      axis:fine.axis,
      side:fine.side,
      patch:makeReferenceFacePatch(),
      deformation
    });

    if(coarseGeometry.vertexKeys.length!==fineGeometry.vertexKeys.length
      ||coarseGeometry.vertexKeys.some((k,index)=>k!==fineGeometry.vertexKeys[index])){
      throw new Error('coarse/fine canonical vertex identity mismatch');
    }
    for(let index=0;index<coarseGeometry.deformedVertices.length;index++){
      if(!sameVec3(coarseGeometry.deformedVertices[index],fineGeometry.deformedVertices[index])){
        throw new Error('coarse/fine deformed vertex mismatch at '+coarseGeometry.vertexKeys[index]);
      }
    }

    const vertexIndices=[];
    for(let index=0;index<coarseGeometry.vertexKeys.length;index++){
      const k=coarseGeometry.vertexKeys[index];
      const reference=coarseGeometry.referenceVertices[index];
      const position=coarseGeometry.deformedVertices[index];
      if(byKey.has(k)){
        const existing=vertices[byKey.get(k)];
        if(!sameVec3(existing.reference,reference)||!sameVec3(existing.position,position)){
          throw new Error('conflicting canonical stitch vertex '+k);
        }
        vertexIndices.push(byKey.get(k));
      }else{
        const vertexIndex=vertices.length;
        vertices.push(Object.freeze({
          key:k,
          reference:freezeVec3(reference),
          position:freezeVec3(position)
        }));
        byKey.set(k,vertexIndex);
        vertexIndices.push(vertexIndex);
      }
    }

    tiles.push(Object.freeze({
      patch:Object.freeze({...patch}),
      coarseVertexKeys:Object.freeze([...coarseGeometry.vertexKeys]),
      fineVertexKeys:Object.freeze([...fineGeometry.vertexKeys]),
      coarsePositions:Object.freeze(coarseGeometry.deformedVertices.map(freezeVec3)),
      finePositions:Object.freeze(fineGeometry.deformedVertices.map(freezeVec3)),
      vertexIndices:Object.freeze(vertexIndices)
    }));
  }

  return Object.freeze({
    vertices:Object.freeze(vertices),
    tiles:Object.freeze(tiles),
    stats:Object.freeze({
      tiles:tiles.length,
      vertices:vertices.length,
      cracks:0
    })
  });
}
