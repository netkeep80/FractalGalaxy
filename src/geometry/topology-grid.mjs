import {referenceVertexKey} from './surface-patch.mjs';
import {deformReferencePoint,identityDeformation} from './deformation.mjs';

function facePoint(axis,side,u,v){
  const ai=axis==='x'?0:axis==='y'?1:2;
  const tangent=[0,1,2].filter(i=>i!==ai);
  const point=[0,0,0];
  point[ai]=side;
  point[tangent[0]]=u;point[tangent[1]]=v;
  return point;
}
function lerp3(a,b,t){return a.map((v,i)=>v+(b[i]-v)*t);}
function freeze3(v){return Object.freeze([...v]);}
function validatePoint(point,name){
  if(!Array.isArray(point)||point.length!==3||!point.every(Number.isFinite)){
    throw new Error(name+' must be a finite vec3');
  }
  return [...point];
}

export function buildCanonicalTopologyLines({
  lines,subdivisions=2,deformation=identityDeformation
}={}){
  if(!Array.isArray(lines)||lines.length===0)throw new Error('topology lines required');
  if(!Number.isInteger(subdivisions)||subdivisions<1||subdivisions>64){
    throw new RangeError('topology subdivisions must be 1..64');
  }
  if(typeof deformation!=='function')throw new Error('topology deformation must be a function');
  const vertices=[],byKey=new Map(),output=[];
  const addPoint=reference=>{
    const key=referenceVertexKey(reference);
    if(byKey.has(key))return byKey.get(key);
    const index=vertices.length;
    vertices.push(Object.freeze({
      key,reference:freeze3(reference),
      position:freeze3(deformReferencePoint(reference,deformation))
    }));
    byKey.set(key,index);
    return index;
  };
  for(const input of lines){
    const a=validatePoint(input.a,'topology line start');
    const b=validatePoint(input.b,'topology line end');
    const indices=[];
    for(let i=0;i<=subdivisions;i++)indices.push(addPoint(lerp3(a,b,i/subdivisions)));
    const meta={...input};
    delete meta.a;delete meta.b;
    output.push(Object.freeze({...meta,vertexIndices:Object.freeze(indices)}));
  }
  return Object.freeze({
    vertices:Object.freeze(vertices),
    lines:Object.freeze(output),
    stats:Object.freeze({subdivisions,vertices:vertices.length,lines:output.length})
  });
}

export function buildCanonicalTopologyGrid({
  steps=4,curveSubdivisions=2,deformation=identityDeformation
}={}){
  if(!Number.isInteger(steps)||steps<1||steps>32)throw new RangeError('topology grid steps must be 1..32');
  if(!Number.isInteger(curveSubdivisions)||curveSubdivisions<1||curveSubdivisions>16){
    throw new RangeError('topology curveSubdivisions must be 1..16');
  }
  const lines=[];
  for(const axis of ['x','y','z'])for(const side of [-1,1]){
    for(let i=0;i<=steps;i++){
      const t=-1+2*i/steps;
      lines.push({a:facePoint(axis,side,-1,t),b:facePoint(axis,side,1,t),axis,side,direction:'u',gridIndex:i});
      lines.push({a:facePoint(axis,side,t,-1),b:facePoint(axis,side,t,1),axis,side,direction:'v',gridIndex:i});
    }
  }
  const grid=buildCanonicalTopologyLines({
    lines,subdivisions:steps*curveSubdivisions,deformation
  });
  return Object.freeze({
    ...grid,
    stats:Object.freeze({
      steps,curveSubdivisions,segmentsPerLine:steps*curveSubdivisions,
      vertices:grid.vertices.length,lines:grid.lines.length
    })
  });
}
