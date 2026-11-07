import {referenceVertexKey} from './surface-patch.mjs';
import {deformReferencePoint,identityDeformation} from './deformation.mjs';

const EPS=1e-12;
const MAX_TOPOLOGY_SUBDIVISIONS=512;

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
function dot(a,b){return a.reduce((sum,value,i)=>sum+value*b[i],0);}
function sub(a,b){return a.map((value,i)=>value-b[i]);}
function add(a,b){return a.map((value,i)=>value+b[i]);}
function mul(a,s){return a.map(value=>value*s);}
function distance(a,b){return Math.hypot(...a.map((value,i)=>value-b[i]));}
function segmentParameter(point,a,b){
  const delta=sub(b,a);
  let axis=0;
  for(let i=1;i<3;i++)if(Math.abs(delta[i])>Math.abs(delta[axis]))axis=i;
  if(Math.abs(delta[axis])<=EPS)return 0;
  return (point[axis]-a[axis])/delta[axis];
}
function pointOnSegment(point,a,b){
  const t=segmentParameter(point,a,b);
  if(t<-EPS||t>1+EPS)return false;
  return distance(point,lerp3(a,b,Math.max(0,Math.min(1,t))))<=EPS;
}
function pushUniquePoint(points,keys,point){
  const key=referenceVertexKey(point);
  if(keys.has(key))return;
  keys.add(key);
  points.push([...point]);
}
function segmentIntersections(a0,a1,b0,b1){
  const intersections=[],keys=new Set();
  for(const point of [a0,a1])if(pointOnSegment(point,b0,b1))pushUniquePoint(intersections,keys,point);
  for(const point of [b0,b1])if(pointOnSegment(point,a0,a1))pushUniquePoint(intersections,keys,point);

  const u=sub(a1,a0),v=sub(b1,b0),w=sub(a0,b0);
  const aa=dot(u,u),bb=dot(u,v),cc=dot(v,v),dd=dot(u,w),ee=dot(v,w);
  const determinant=aa*cc-bb*bb;
  if(aa>EPS&&cc>EPS&&Math.abs(determinant)>EPS){
    const s=(bb*ee-cc*dd)/determinant;
    const t=(aa*ee-bb*dd)/determinant;
    if(s>=-EPS&&s<=1+EPS&&t>=-EPS&&t<=1+EPS){
      const pa=add(a0,mul(u,Math.max(0,Math.min(1,s))));
      const pb=add(b0,mul(v,Math.max(0,Math.min(1,t))));
      if(distance(pa,pb)<=EPS)pushUniquePoint(
        intersections,keys,pa.map((value,i)=>(value+pb[i])/2)
      );
    }
  }
  return intersections;
}
function validateSubdivisions(value,name='topology subdivisions'){
  if(!Number.isInteger(value)||value<1||value>MAX_TOPOLOGY_SUBDIVISIONS){
    throw new RangeError(name+' must be 1..'+MAX_TOPOLOGY_SUBDIVISIONS);
  }
  return value;
}

export function buildCanonicalTopologyLines({
  lines,subdivisions=2,deformation=identityDeformation
}={}){
  if(!Array.isArray(lines)||lines.length===0)throw new Error('topology lines required');
  validateSubdivisions(subdivisions);
  if(typeof deformation!=='function')throw new Error('topology deformation must be a function');

  const prepared=lines.map(input=>{
    const a=validatePoint(input.a,'topology line start');
    const b=validatePoint(input.b,'topology line end');
    const lineSubdivisions=input.subdivisions===undefined
      ? subdivisions
      : validateSubdivisions(input.subdivisions,'topology line subdivisions');
    const meta={...input};
    delete meta.a;delete meta.b;delete meta.subdivisions;
    return {a,b,subdivisions:lineSubdivisions,meta,mandatory:[],mandatoryKeys:new Set()};
  });

  for(let i=0;i<prepared.length;i++)for(let j=i+1;j<prepared.length;j++){
    for(const point of segmentIntersections(
      prepared[i].a,prepared[i].b,prepared[j].a,prepared[j].b
    )){
      pushUniquePoint(prepared[i].mandatory,prepared[i].mandatoryKeys,point);
      pushUniquePoint(prepared[j].mandatory,prepared[j].mandatoryKeys,point);
    }
  }

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

  for(const line of prepared){
    const samples=new Map();
    for(let i=0;i<=line.subdivisions;i++){
      const point=lerp3(line.a,line.b,i/line.subdivisions);
      samples.set(referenceVertexKey(point),point);
    }
    for(const point of line.mandatory)samples.set(referenceVertexKey(point),point);
    const ordered=[...samples.values()]
      .sort((p,q)=>segmentParameter(p,line.a,line.b)-segmentParameter(q,line.a,line.b));
    output.push(Object.freeze({
      ...line.meta,
      vertexIndices:Object.freeze(ordered.map(addPoint))
    }));
  }
  return Object.freeze({
    vertices:Object.freeze(vertices),
    lines:Object.freeze(output),
    stats:Object.freeze({
      subdivisions,
      maxSubdivisions:Math.max(...prepared.map(line=>line.subdivisions)),
      vertices:vertices.length,
      lines:output.length
    })
  });
}

export function buildCanonicalTopologyGrid({
  steps=4,curveSubdivisions=2,deformation=identityDeformation
}={}){
  if(!Number.isInteger(steps)||steps<1||steps>32)throw new RangeError('topology grid steps must be 1..32');
  if(!Number.isInteger(curveSubdivisions)||curveSubdivisions<1||curveSubdivisions>16){
    throw new RangeError('topology curveSubdivisions must be 1..16');
  }
  const segments=steps*curveSubdivisions;
  validateSubdivisions(segments,'topology grid segments');
  const lines=[];
  for(const axis of ['x','y','z'])for(const side of [-1,1]){
    for(let i=0;i<=steps;i++){
      const t=-1+2*i/steps;
      lines.push({a:facePoint(axis,side,-1,t),b:facePoint(axis,side,1,t),axis,side,direction:'u',gridIndex:i});
      lines.push({a:facePoint(axis,side,t,-1),b:facePoint(axis,side,t,1),axis,side,direction:'v',gridIndex:i});
    }
  }
  const grid=buildCanonicalTopologyLines({
    lines,subdivisions:segments,deformation
  });
  return Object.freeze({
    ...grid,
    stats:Object.freeze({
      steps,curveSubdivisions,segmentsPerLine:segments,
      vertices:grid.vertices.length,lines:grid.lines.length
    })
  });
}
