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

export function buildCanonicalTopologyGrid({
  steps=4,curveSubdivisions=2,deformation=identityDeformation
}={}){
  if(!Number.isInteger(steps)||steps<1||steps>32)throw new RangeError('topology grid steps must be 1..32');
  if(!Number.isInteger(curveSubdivisions)||curveSubdivisions<1||curveSubdivisions>16){
    throw new RangeError('topology curveSubdivisions must be 1..16');
  }
  if(typeof deformation!=='function')throw new Error('topology deformation must be a function');
  const vertices=[],byKey=new Map(),lines=[];
  const segments=steps*curveSubdivisions;
  const addPoint=reference=>{
    const key=referenceVertexKey(reference);
    if(byKey.has(key))return byKey.get(key);
    const index=vertices.length;
    vertices.push(Object.freeze({
      key,reference:freeze3(reference),
      position:freeze3(deformReferencePoint(reference,deformation))
    }));
    byKey.set(key,index);return index;
  };
  const addLine=(a,b,meta)=>{
    const indices=[];
    for(let i=0;i<=segments;i++)indices.push(addPoint(lerp3(a,b,i/segments)));
    lines.push(Object.freeze({...meta,vertexIndices:Object.freeze(indices)}));
  };

  for(const axis of ['x','y','z'])for(const side of [-1,1]){
    for(let i=0;i<=steps;i++){
      const t=-1+2*i/steps;
      addLine(facePoint(axis,side,-1,t),facePoint(axis,side,1,t),{axis,side,direction:'u',gridIndex:i});
      addLine(facePoint(axis,side,t,-1),facePoint(axis,side,t,1),{axis,side,direction:'v',gridIndex:i});
    }
  }
  return Object.freeze({
    vertices:Object.freeze(vertices),lines:Object.freeze(lines),
    stats:Object.freeze({steps,curveSubdivisions,segmentsPerLine:segments,vertices:vertices.length,lines:lines.length})
  });
}
