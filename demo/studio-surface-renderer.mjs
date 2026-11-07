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
export function prepareProofTriangles(mesh,project,{deformed=false}={}){
  if(!mesh||!Array.isArray(mesh.vertices)||!Array.isArray(mesh.triangles)
    ||typeof project!=='function')throw new Error('proven mesh and projection required');
  return mesh.triangles.map((triangle,index)=>{
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
      depth:points.reduce((sum,p)=>sum+p.depth,0)/3,
      light:triangleLight(triangleNormal(spatial))
    });
  }).sort((a,b)=>a.depth-b.depth||a.index-b.index);
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
