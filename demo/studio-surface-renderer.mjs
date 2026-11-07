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
const clipScratchA=new Float64Array(16);
const clipScratchB=new Float64Array(16);
function separatedOnAxis(a,b,nx,ny){
  if(Math.abs(nx)+Math.abs(ny)<1e-15)return false;
  let amin=Infinity,amax=-Infinity,bmin=Infinity,bmax=-Infinity;
  for(let i=0;i<3;i++){
    const av=a[i].x*nx+a[i].y*ny,bv=b[i].x*nx+b[i].y*ny;
    if(av<amin)amin=av;if(av>amax)amax=av;
    if(bv<bmin)bmin=bv;if(bv>bmax)bmax=bv;
  }
  return amax<bmin-1e-9||bmax<amin-1e-9;
}
function trianglesMayOverlapArea(a,b){
  for(let set=0;set<2;set++){
    const points=set===0?a:b;
    for(let i=0;i<3;i++){
      const p=points[i],q=points[(i+1)%3];
      if(separatedOnAxis(a,b,-(q.y-p.y),q.x-p.x))return false;
    }
  }
  return true;
}
function depthPlane(points,out=null){
  const a=points[0],b=points[1],c=points[2];
  const abx=b.x-a.x,aby=b.y-a.y,acz=b.depth-a.depth;
  const acx=c.x-a.x,acy=c.y-a.y,bcz=c.depth-a.depth;
  const determinant=abx*acy-acx*aby;
  if(Math.abs(determinant)<1e-12)return null;
  const plane=out??{};
  plane.x=a.x;plane.y=a.y;plane.depth=a.depth;
  plane.dx=(acz*acy-bcz*aby)/determinant;
  plane.dy=(abx*bcz-acx*acz)/determinant;
  return plane;
}
function depthAtPlane(plane,x,y){
  return plane.depth+plane.dx*(x-plane.x)+plane.dy*(y-plane.y);
}
// Same Sutherland-Hodgman overlap semantics as the original clipper.
// Depth interpolation uses one precomputed screen-space plane per triangle.
function projectedDepthRelation(a,b,counters=null){
  if(a.bounds.maxX<b.bounds.minX||b.bounds.maxX<a.bounds.minX
    ||a.bounds.maxY<b.bounds.minY||b.bounds.maxY<a.bounds.minY)return 0;
  if(!a.depthPlane||!b.depthPlane)return 0;
  if(!trianglesMayOverlapArea(a.points,b.points)){
    if(counters)counters.satRejected++;
    return 0;
  }
  if(counters)counters.clipCalls++;

  let input=clipScratchA,output=clipScratchB,count=3;
  for(let i=0;i<3;i++){
    input[i*2]=a.points[i].x;
    input[i*2+1]=a.points[i].y;
  }
  const orientation=signedArea(b.points)>=0?1:-1;
  for(let edge=0;edge<3&&count;edge++){
    const ca=b.points[edge],cb=b.points[(edge+1)%3];
    const edgeX=cb.x-ca.x,edgeY=cb.y-ca.y;
    let outCount=0;
    let previousX=input[(count-1)*2],previousY=input[(count-1)*2+1];
    let previousInside=orientation*(edgeX*(previousY-ca.y)-edgeY*(previousX-ca.x))>=-1e-9;
    for(let i=0;i<count;i++){
      const currentX=input[i*2],currentY=input[i*2+1];
      const currentInside=orientation*(edgeX*(currentY-ca.y)-edgeY*(currentX-ca.x))>=-1e-9;
      if(currentInside!==previousInside){
        const abx=currentX-previousX,aby=currentY-previousY;
        const denominator=abx*edgeY-aby*edgeX;
        let ix=currentX,iy=currentY;
        if(Math.abs(denominator)>=1e-12){
          const t=((ca.x-previousX)*edgeY-(ca.y-previousY)*edgeX)/denominator;
          ix=previousX+t*abx;iy=previousY+t*aby;
        }
        output[outCount*2]=ix;output[outCount*2+1]=iy;outCount++;
      }
      if(currentInside){
        output[outCount*2]=currentX;output[outCount*2+1]=currentY;outCount++;
      }
      previousX=currentX;previousY=currentY;previousInside=currentInside;
    }
    count=outCount;
    const swap=input;input=output;output=swap;
  }
  if(count<3)return 0;

  let twiceArea=0,sumX=0,sumY=0;
  for(let i=0;i<count;i++){
    const j=(i+1)%count;
    const x=input[i*2],y=input[i*2+1];
    twiceArea+=x*input[j*2+1]-input[j*2]*y;
    sumX+=x;sumY+=y;
  }
  if(Math.abs(twiceArea/2)<1e-6)return 0;

  let relation=0;
  for(let i=0;i<=count;i++){
    const x=i<count?input[i*2]:sumX/count;
    const y=i<count?input[i*2+1]:sumY/count;
    const delta=depthAtPlane(a.depthPlane,x,y)-depthAtPlane(b.depthPlane,x,y);
    if(Math.abs(delta)<1e-8)continue;
    const sign=Math.sign(delta);
    if(relation&&relation!==sign)return 0;
    relation=sign;
  }
  return relation;
}
function heapPush(heap,value,compare){
  let index=heap.length;
  heap.push(value);
  while(index>0){
    const parent=(index-1)>>1;
    if(compare(heap[parent],value)<=0)break;
    heap[index]=heap[parent];
    index=parent;
  }
  heap[index]=value;
}
function heapPop(heap,compare){
  if(!heap.length)return null;
  const root=heap[0];
  const last=heap.pop();
  if(heap.length){
    let index=0;
    while(true){
      const left=index*2+1,right=left+1;
      if(left>=heap.length)break;
      let child=left;
      if(right<heap.length&&compare(heap[right],heap[left])<0)child=right;
      if(compare(heap[child],last)>=0)break;
      heap[index]=heap[child];
      index=child;
    }
    heap[index]=last;
  }
  return root;
}
function intervalPriority(index){
  let value=(index+1)>>>0;
  value^=value>>>16;
  value=Math.imul(value,0x7feb352d);
  value^=value>>>15;
  value=Math.imul(value,0x846ca68b);
  value^=value>>>16;
  return value>>>0;
}
function intervalKeyCompare(minY,index,node){
  return minY-node.minY||index-node.index;
}
function intervalMax(node){
  return node?node.subtreeMaxY:-Infinity;
}
function intervalUpdate(node){
  if(node)node.subtreeMaxY=Math.max(node.maxY,intervalMax(node.left),intervalMax(node.right));
  return node;
}
function intervalRotateLeft(node){
  const right=node.right;
  node.right=right.left;
  right.left=intervalUpdate(node);
  return intervalUpdate(right);
}
function intervalRotateRight(node){
  const left=node.left;
  node.left=left.right;
  left.right=intervalUpdate(node);
  return intervalUpdate(left);
}
function intervalInsert(node,item){
  if(!node)return {
    index:item.index,minY:item.minY,maxY:item.maxY,
    priority:intervalPriority(item.index),subtreeMaxY:item.maxY,left:null,right:null
  };
  if(intervalKeyCompare(item.minY,item.index,node)<0){
    node.left=intervalInsert(node.left,item);
    if(node.left.priority<node.priority)node=intervalRotateRight(node);
  }else{
    node.right=intervalInsert(node.right,item);
    if(node.right.priority<node.priority)node=intervalRotateLeft(node);
  }
  return intervalUpdate(node);
}
function intervalRemove(node,minY,index){
  if(!node)return null;
  const compare=intervalKeyCompare(minY,index,node);
  if(compare<0)node.left=intervalRemove(node.left,minY,index);
  else if(compare>0)node.right=intervalRemove(node.right,minY,index);
  else{
    if(!node.left)return node.right;
    if(!node.right)return node.left;
    if(node.left.priority<node.right.priority){
      node=intervalRotateRight(node);
      node.right=intervalRemove(node.right,minY,index);
    }else{
      node=intervalRotateLeft(node);
      node.left=intervalRemove(node.left,minY,index);
    }
  }
  return intervalUpdate(node);
}
function intervalQuery(node,minY,maxY,visit,counters){
  if(!node)return;
  counters.indexVisits++;
  if(node.left&&node.left.subtreeMaxY>minY)intervalQuery(node.left,minY,maxY,visit,counters);
  if(node.minY<maxY&&node.maxY>minY)visit(node.index);
  if(node.minY<maxY)intervalQuery(node.right,minY,maxY,visit,counters);
}
function visibilityOrder(triangles,{broadPhase=true,stats=null}={}){
  const outgoing=new Array(triangles.length);
  const incoming=new Int32Array(triangles.length);
  const allPairs=triangles.length*(triangles.length-1)/2;
  let candidatePairs=0,relations=0,edges=0;
  let broadPhaseSortComparisons=0,broadPhaseExpireOperations=0;
  const broadPhaseCounters={indexVisits:0};
  const narrowCounters={satRejected:0,clipCalls:0};

  const comparePair=(a,b)=>{
    // Exact narrow-phase must always receive a pair in the same canonical
    // original-triangle order as exhaustive enumeration. This avoids
    // floating-point asymmetry when AABB sweep order differs from input order.
    const first=triangles[a].index<=triangles[b].index?a:b;
    const second=first===a?b:a;
    candidatePairs++;
    const relation=projectedDepthRelation(triangles[first],triangles[second],narrowCounters);
    if(!relation)return;
    relations++;
    // Larger projected depth is nearer. Painter draws far -> near.
    const from=relation>0?second:first,to=relation>0?first:second;
    if(outgoing[from])outgoing[from].push(to);
    else outgoing[from]=[to];
    incoming[to]++;
    edges++;
  };

  if(broadPhase){
    const sorted=triangles.map((_,index)=>index).sort((a,b)=>{
      broadPhaseSortComparisons++;
      return triangles[a].bounds.minX-triangles[b].bounds.minX||
        triangles[a].bounds.maxX-triangles[b].bounds.maxX||
        triangles[a].index-triangles[b].index;
    });
    const expiry=[];
    const expiryCompare=(a,b)=>a.maxX-b.maxX||a.index-b.index;
    let yRoot=null;
    for(const index of sorted){
      const current=triangles[index];
      while(expiry.length&&expiry[0].maxX<=current.bounds.minX){
        const expired=heapPop(expiry,expiryCompare);
        broadPhaseExpireOperations++;
        yRoot=intervalRemove(yRoot,triangles[expired.index].bounds.minY,expired.index);
      }
      intervalQuery(
        yRoot,current.bounds.minY,current.bounds.maxY,
        otherIndex=>comparePair(otherIndex,index),
        broadPhaseCounters
      );
      yRoot=intervalInsert(yRoot,{
        index,minY:current.bounds.minY,maxY:current.bounds.maxY
      });
      heapPush(expiry,{index,maxX:current.bounds.maxX},expiryCompare);
    }
  }else{
    for(let a=0;a<triangles.length;a++)for(let b=a+1;b<triangles.length;b++)comparePair(a,b);
  }

  const fallback=(a,b)=>triangles[a].depth-triangles[b].depth||triangles[a].index-triangles[b].index;
  const available=[];
  const remaining=new Uint8Array(triangles.length);
  remaining.fill(1);
  let orderOperations=0;
  for(let index=0;index<triangles.length;index++){
    if(incoming[index]===0){
      heapPush(available,index,fallback);
      orderOperations++;
    }
  }
  const fallbackOrder=triangles.map((_,index)=>index).sort(fallback);
  let fallbackCursor=0,cycleBreaks=0;
  const order=[];
  while(order.length<triangles.length){
    let chosen=null;
    while(available.length){
      orderOperations++;
      const candidate=heapPop(available,fallback);
      if(remaining[candidate]&&incoming[candidate]===0){
        chosen=candidate;
        break;
      }
    }
    if(chosen===null){
      while(fallbackCursor<fallbackOrder.length&&!remaining[fallbackOrder[fallbackCursor]]){
        fallbackCursor++;
        orderOperations++;
      }
      chosen=fallbackOrder[fallbackCursor++];
      cycleBreaks++;
      orderOperations++;
    }
    remaining[chosen]=0;
    order.push(chosen);
    const outgoingList=outgoing[chosen];
    if(outgoingList)for(const to of outgoingList){
      orderOperations++;
      incoming[to]--;
      if(incoming[to]===0&&remaining[to]){
        heapPush(available,to,fallback);
        orderOperations++;
      }
    }
  }
  if(stats&&typeof stats==='object')Object.assign(stats,{
    triangles:triangles.length,
    allPairs,
    candidatePairs,
    relations,
    edges,
    orderOperations,
    cycleBreaks,
    broadPhase:Boolean(broadPhase),
    broadPhaseSortComparisons,
    broadPhaseIndexVisits:broadPhaseCounters.indexVisits,
    broadPhaseExpireOperations,
    broadPhaseOperations:broadPhaseSortComparisons+broadPhaseCounters.indexVisits+broadPhaseExpireOperations,
    satRejected:narrowCounters.satRejected,
    clipCalls:narrowCounters.clipCalls
  });
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
const meshStyleCache=new WeakMap();
const meshVisibilityOrderCache=new WeakMap();
const meshPreparedFrameCache=new WeakMap();
function cachedVisibilityOrder(mesh,key){
  if(key===null||key===undefined)return null;
  return meshVisibilityOrderCache.get(mesh)?.get(String(key))??null;
}
function storeVisibilityOrder(mesh,key,order){
  if(key===null||key===undefined)return;
  let cache=meshVisibilityOrderCache.get(mesh);
  if(!cache){cache=new Map();meshVisibilityOrderCache.set(mesh,cache);}
  if(cache.size>=8&&!cache.has(String(key)))cache.delete(cache.keys().next().value);
  cache.set(String(key),Object.freeze([...order]));
}
function triangleStyles(mesh){
  let cached=meshStyleCache.get(mesh);
  if(cached)return cached;
  cached=mesh.triangles.map(triangle=>{
    if(!Array.isArray(triangle.normal)||triangle.normal.length!==3)return null;
    const light=triangleLight(triangle.normal);
    const rgb=[Math.round(43*light),Math.round(215*light),Math.round(163*light)];
    return {light,fill:'rgb('+rgb.join(',')+')'};
  });
  meshStyleCache.set(mesh,cached);
  return cached;
}
function createPreparedFrame(mesh){
  const projectedVertices=mesh.vertices.map(()=>({x:0,y:0,depth:0}));
  const styles=triangleStyles(mesh);
  const prepared=mesh.triangles.map((triangle,index)=>{
    const points=triangle.indices.map(i=>projectedVertices[i]);
    const style=styles[index];
    return {
      index,
      points,
      bounds:{minX:0,maxX:0,minY:0,maxY:0},
      depth:0,
      depthPlane:null,
      depthPlaneStorage:{x:0,y:0,depth:0,dx:0,dy:0},
      light:style?.light??0,
      fill:style?.fill??null
    };
  });
  return {projectedVertices,prepared};
}
function preparedFrame(mesh){
  let frame=meshPreparedFrameCache.get(mesh);
  if(!frame){frame=createPreparedFrame(mesh);meshPreparedFrameCache.set(mesh,frame);}
  return frame;
}
function projectInto(project,point,out){
  const value=project(point,out);
  const source=value??out;
  out.x=source.x;out.y=source.y;out.depth=source.depth;
  if(!Number.isFinite(out.x)||!Number.isFinite(out.y)||!Number.isFinite(out.depth)){
    throw new Error('invalid projection');
  }
}
export function prepareProofTriangles(mesh,project,{
  deformed=false,broadPhase=true,stats=null,visibilityCacheKey=null,reusePrepared=false
}={}){
  if(!mesh||!Array.isArray(mesh.vertices)||!Array.isArray(mesh.triangles)
    ||typeof project!=='function')throw new Error('proven mesh and projection required');
  const spatialVertices=mesh.vertices.map(vertex=>{
    if(!vertex)throw new Error('missing canonical mesh vertex');
    return deformed?vertex.position:vertex.reference;
  });
  const styles=triangleStyles(mesh);
  let projectedVertices,prepared;
  if(reusePrepared){
    const frame=preparedFrame(mesh);
    projectedVertices=frame.projectedVertices;
    prepared=frame.prepared;
    for(let i=0;i<spatialVertices.length;i++)projectInto(project,spatialVertices[i],projectedVertices[i]);
    for(let index=0;index<mesh.triangles.length;index++){
      const triangle=mesh.triangles[index],record=prepared[index];
      if(triangle.decision!=='PRESENT')throw new Error('renderer received unproven triangle');
      const p0=record.points[0],p1=record.points[1],p2=record.points[2],bounds=record.bounds;
      bounds.minX=Math.min(p0.x,p1.x,p2.x);bounds.maxX=Math.max(p0.x,p1.x,p2.x);
      bounds.minY=Math.min(p0.y,p1.y,p2.y);bounds.maxY=Math.max(p0.y,p1.y,p2.y);
      record.depth=(p0.depth+p1.depth+p2.depth)/3;
      record.depthPlane=depthPlane(record.points,record.depthPlaneStorage);
      let style=styles[index];
      if(!style){
        const spatial=triangle.indices.map(i=>spatialVertices[i]);
        const light=triangleLight(triangleNormal(spatial));
        const rgb=[Math.round(43*light),Math.round(215*light),Math.round(163*light)];
        style={light,fill:'rgb('+rgb.join(',')+')'};
      }
      record.light=style.light;record.fill=style.fill;
    }
  }else{
    projectedVertices=spatialVertices.map(point=>{
      const projected=project(point);
      if(!Number.isFinite(projected.x)||!Number.isFinite(projected.y)||!Number.isFinite(projected.depth)){
        throw new Error('invalid projection');
      }
      return projected;
    });
    prepared=mesh.triangles.map((triangle,index)=>{
      if(triangle.decision!=='PRESENT')throw new Error('renderer received unproven triangle');
      const points=triangle.indices.map(i=>projectedVertices[i]);
      let style=styles[index];
      if(!style){
        const spatial=triangle.indices.map(i=>spatialVertices[i]);
        const light=triangleLight(triangleNormal(spatial));
        const rgb=[Math.round(43*light),Math.round(215*light),Math.round(163*light)];
        style={light,fill:'rgb('+rgb.join(',')+')'};
      }
      return {
        index,points,
        bounds:{
          minX:Math.min(points[0].x,points[1].x,points[2].x),
          maxX:Math.max(points[0].x,points[1].x,points[2].x),
          minY:Math.min(points[0].y,points[1].y,points[2].y),
          maxY:Math.max(points[0].y,points[1].y,points[2].y)
        },
        depth:(points[0].depth+points[1].depth+points[2].depth)/3,
        depthPlane:depthPlane(points),
        light:style.light,
        fill:style.fill
      };
    });
  }
  const cachedOrder=cachedVisibilityOrder(mesh,visibilityCacheKey);
  if(cachedOrder&&cachedOrder.length===prepared.length){
    if(stats&&typeof stats==='object')Object.assign(stats,{
      triangles:prepared.length,
      allPairs:prepared.length*(prepared.length-1)/2,
      candidatePairs:0,relations:0,edges:0,orderOperations:0,cycleBreaks:0,
      broadPhase:Boolean(broadPhase),broadPhaseSortComparisons:0,
      broadPhaseIndexVisits:0,broadPhaseExpireOperations:0,broadPhaseOperations:0,
      satRejected:0,clipCalls:0,visibilityCacheHit:true
    });
    return cachedOrder.map(index=>prepared[index]);
  }
  const ordered=visibilityOrder(prepared,{broadPhase,stats});
  storeVisibilityOrder(mesh,visibilityCacheKey,ordered.map(triangle=>triangle.index));
  if(stats&&typeof stats==='object')stats.visibilityCacheHit=false;
  return ordered;
}
export function paintProvenSurface(context,mesh,project,options={}){
  const tris=prepareProofTriangles(mesh,project,options);
  context.save();
  for(const t of tris){
    const fill=t.fill;
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
