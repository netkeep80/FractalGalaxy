// View-only two-sided Lambert-style shading of an already proven local mesh.
// This module never queries or mutates B, D, M, WorldStore or FractalRing.
function triangleNormal([a,b,c]){
  const ab=b.map((v,i)=>v-a[i]),ac=c.map((v,i)=>v-a[i]);
  return [ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
}
function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
const LIGHT=[.24,.6,.76];
const L=Math.hypot(...LIGHT);
const light=LIGHT.map(v=>v/L);
function triangleLight(normal){
  const n=Math.hypot(...normal);
  if(n===0)return .34;
  const diffuse=Math.abs(normal.reduce((sum,v,i)=>sum+v*light[i],0)/n);
  return clamp(.3+.7*diffuse,.3,1);
}
function signedArea(points){
  let twice=0;
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length];
    twice+=a.x*b.y-b.x*a.y;
  }
  return twice/2;
}
function edgeSide(a,b,p){return (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);}
function lineIntersection(a,b,c,d){
  const abx=b.x-a.x,aby=b.y-a.y,cdx=d.x-c.x,cdy=d.y-c.y;
  const denominator=abx*cdy-aby*cdx;
  if(Math.abs(denominator)<1e-12)return {x:b.x,y:b.y};
  const t=((c.x-a.x)*cdy-(c.y-a.y)*cdx)/denominator;
  return {x:a.x+t*abx,y:a.y+t*aby};
}
function triangleIntersectionPolygon(subject,clip){
  let polygon=subject.map(({x,y})=>({x,y}));
  const orientation=signedArea(clip)>=0?1:-1;
  for(let edge=0;edge<3&&polygon.length;edge++){
    const a=clip[edge],b=clip[(edge+1)%3],input=polygon;
    polygon=[];
    for(let i=0;i<input.length;i++){
      const current=input[i],previous=input[(i+input.length-1)%input.length];
      const currentInside=orientation*edgeSide(a,b,current)>=-1e-9;
      const previousInside=orientation*edgeSide(a,b,previous)>=-1e-9;
      if(currentInside!==previousInside)polygon.push(lineIntersection(previous,current,a,b));
      if(currentInside)polygon.push(current);
    }
  }
  return polygon;
}
function interpolatedDepth(points,p){
  const [a,b,c]=points;
  const denominator=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);
  if(Math.abs(denominator)<1e-12)return null;
  const wa=((b.y-c.y)*(p.x-c.x)+(c.x-b.x)*(p.y-c.y))/denominator;
  const wb=((c.y-a.y)*(p.x-c.x)+(a.x-c.x)*(p.y-c.y))/denominator;
  return wa*a.depth+wb*b.depth+(1-wa-wb)*c.depth;
}
// Returns +1 when a is consistently nearer than b over their projected overlap,
// -1 when b is nearer, and 0 when they do not overlap in area or cross each other.
function projectedDepthRelation(a,b){
  if(a.bounds.maxX<b.bounds.minX||b.bounds.maxX<a.bounds.minX
    ||a.bounds.maxY<b.bounds.minY||b.bounds.maxY<a.bounds.minY)return 0;
  const overlap=triangleIntersectionPolygon(a.points,b.points);
  if(overlap.length<3||Math.abs(signedArea(overlap))<1e-6)return 0;
  const samples=[...overlap,{
    x:overlap.reduce((sum,p)=>sum+p.x,0)/overlap.length,
    y:overlap.reduce((sum,p)=>sum+p.y,0)/overlap.length
  }];
  let relation=0;
  for(const sample of samples){
    const ad=interpolatedDepth(a.points,sample),bd=interpolatedDepth(b.points,sample);
    if(ad===null||bd===null)return 0;
    const delta=ad-bd;
    if(Math.abs(delta)<1e-8)continue;
    const sign=Math.sign(delta);
    if(relation&&relation!==sign)return 0;
    relation=sign;
  }
  return relation;
}
function visibilityOrder(triangles){
  const outgoing=triangles.map(()=>new Set()),incoming=triangles.map(()=>0);
  for(let a=0;a<triangles.length;a++)for(let b=a+1;b<triangles.length;b++){
    const relation=projectedDepthRelation(triangles[a],triangles[b]);
    if(!relation)continue;
    // Larger projected depth is nearer. Painter draws far -> near.
    const from=relation>0?b:a,to=relation>0?a:b;
    if(!outgoing[from].has(to)){outgoing[from].add(to);incoming[to]++;}
  }
  const remaining=new Set(triangles.map((_,index)=>index));
  const order=[];
  const fallback=(a,b)=>triangles[a].depth-triangles[b].depth||triangles[a].index-triangles[b].index;
  while(remaining.size){
    const available=[...remaining].filter(index=>incoming[index]===0).sort(fallback);
    // A cycle means projected triangles cross in depth. That is outside the
    // non-self-intersecting local S2 surface contract; keep deterministic output.
    const chosen=(available.length?available:[...remaining].sort(fallback))[0];
    remaining.delete(chosen);order.push(chosen);
    for(const to of outgoing[chosen])incoming[to]--;
  }
  return order.map(index=>triangles[index]);
}
function validPatch(patch){
  return patch&&[patch.u0,patch.u1,patch.v0,patch.v1].every(Number.isFinite)
    &&patch.u0>=0&&patch.u1<=1&&patch.v0>=0&&patch.v1<=1
    &&patch.u0<patch.u1&&patch.v0<patch.v1;
}
function validTessellationDepth(depth){return Number.isInteger(depth)&&depth>=0&&depth<=4;}
function normalizedFacePoint(bounds,axis,side,u,v){
  if(!bounds||!Array.isArray(bounds.min)||!Array.isArray(bounds.max)||bounds.min.length!==3||bounds.max.length!==3)
    throw new Error('bounds min/max required');
  if(!bounds.min.every(Number.isFinite)||!bounds.max.every(Number.isFinite)||bounds.min.some((value,i)=>!(value<bounds.max[i])))
    throw new Error('increasing finite bounds required');
  const normal=axis==='x'?0:axis==='y'?1:axis==='z'?2:-1;
  if(normal<0||!(side===-1||side===1))throw new Error('axis/side required');
  const tangent=[0,1,2].filter(index=>index!==normal),point=[0,0,0];
  point[normal]=side===1?bounds.max[normal]:bounds.min[normal];
  point[tangent[0]]=bounds.min[tangent[0]]+u*(bounds.max[tangent[0]]-bounds.min[tangent[0]]);
  point[tangent[1]]=bounds.min[tangent[1]]+v*(bounds.max[tangent[1]]-bounds.min[tangent[1]]);
  return point.map(value=>Object.is(value,-0)?0:value);
}
export function proofGapBoundaryVertices({
  bounds,axis,side,patch,deformation=point=>point,tessellationDepth=0
}={}){
  if(!validPatch(patch))throw new Error('proof-gap patch must use normalized face coordinates');
  if(!validTessellationDepth(tessellationDepth))throw new RangeError('render tessellation depth must be between 0 and 4');
  if(typeof deformation!=='function')throw new Error('deformation function required');
  const steps=2**tessellationDepth,uv=[];
  for(let i=0;i<steps;i++)uv.push([patch.u0+(patch.u1-patch.u0)*i/steps,patch.v0]);
  for(let i=0;i<steps;i++)uv.push([patch.u1,patch.v0+(patch.v1-patch.v0)*i/steps]);
  for(let i=0;i<steps;i++)uv.push([patch.u1-(patch.u1-patch.u0)*i/steps,patch.v1]);
  for(let i=0;i<steps;i++)uv.push([patch.u0,patch.v1-(patch.v1-patch.v0)*i/steps]);
  return Object.freeze(uv.map(([u,v])=>{
    const reference=Object.freeze(normalizedFacePoint(bounds,axis,side,u,v));
    const position=deformation(reference);
    if(!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite))throw new Error('invalid boundary deformation');
    return Object.freeze({reference,position:Object.freeze([...position])});
  }));
}
export function prepareProofTriangles(mesh,project,{deformed=false}={}){
  if(!mesh||!Array.isArray(mesh.vertices)||!Array.isArray(mesh.triangles)
    ||typeof project!=='function')throw new Error('proven mesh and projection required');
  const prepared=mesh.triangles.map((triangle,index)=>{
    if(triangle.decision!=='PRESENT')throw new Error('renderer received unproven triangle');
    const spatial=triangle.indices.map(i=>{
      const vertex=mesh.vertices[i];
      if(!vertex)throw new Error('missing canonical mesh vertex');
      return deformed?vertex.position:vertex.reference;
    });
    const points=spatial.map(p=>project(p));
    if(points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||!Number.isFinite(p.depth))){
      throw new Error('invalid projection');
    }
    return Object.freeze({
      index,points:Object.freeze(points),
      bounds:Object.freeze({
        minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),
        minY:Math.min(...points.map(p=>p.y)),maxY:Math.max(...points.map(p=>p.y))
      }),
      depth:points.reduce((sum,p)=>sum+p.depth,0)/3,
      light:triangleLight(triangleNormal(spatial))
    });
  });
  return visibilityOrder(prepared);
}
export function paintProvenSurface(context,mesh,project,options={}){
  const tris=prepareProofTriangles(mesh,project,options);
  context.save();
  for(const t of tris){
    const light=t.light;
    const rgb=[Math.round(43*light),Math.round(215*light),Math.round(163*light)];
    const fill='rgb('+rgb.join(',')+')';
    context.beginPath();
    context.moveTo(t.points[0].x,t.points[0].y);
    context.lineTo(t.points[1].x,t.points[1].y);
    context.lineTo(t.points[2].x,t.points[2].y);
    context.closePath();
    context.fillStyle=fill;
    context.fill();
    // Cover anti-aliased microseams inside the same proven patch.
    context.lineWidth=.6;
    context.strokeStyle=fill;
    context.stroke();
  }
  context.restore();
  return tris.length;
}
