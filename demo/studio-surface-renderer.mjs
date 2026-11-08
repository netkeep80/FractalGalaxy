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
const overlapScratchA=Array.from({length:8},()=>({x:0,y:0}));
const overlapScratchB=Array.from({length:8},()=>({x:0,y:0}));
const centroidScratch={x:0,y:0};
function lineIntersectionInto(a,b,c,d,out){
  const abx=b.x-a.x,aby=b.y-a.y,cdx=d.x-c.x,cdy=d.y-c.y;
  const denominator=abx*cdy-aby*cdx;
  if(Math.abs(denominator)<1e-12){
    out.x=b.x;out.y=b.y;
    return out;
  }
  const t=((c.x-a.x)*cdy-(c.y-a.y)*cdx)/denominator;
  out.x=a.x+t*abx;out.y=a.y+t*aby;
  return out;
}
function triangleIntersectionPolygonScratch(subject,clip){
  let input=overlapScratchA,output=overlapScratchB,count=3;
  for(let i=0;i<3;i++){
    input[i].x=subject[i].x;
    input[i].y=subject[i].y;
  }
  const orientation=signedArea(clip)>=0?1:-1;
  for(let edge=0;edge<3&&count;edge++){
    const a=clip[edge],b=clip[(edge+1)%3];
    let outCount=0;
    for(let i=0;i<count;i++){
      const current=input[i],previous=input[(i+count-1)%count];
      const currentInside=orientation*edgeSide(a,b,current)>=-1e-9;
      const previousInside=orientation*edgeSide(a,b,previous)>=-1e-9;
      if(currentInside!==previousInside){
        lineIntersectionInto(previous,current,a,b,output[outCount]);
        outCount++;
      }
      if(currentInside){
        output[outCount].x=current.x;
        output[outCount].y=current.y;
        outCount++;
      }
    }
    count=outCount;
    const swap=input;input=output;output=swap;
  }
  return {points:input,count};
}
function signedAreaCount(points,count){
  let twice=0;
  for(let i=0;i<count;i++){
    const a=points[i],b=points[(i+1)%count];
    twice+=a.x*b.y-b.x*a.y;
  }
  return twice/2;
}
function interpolatedDepth(points,p){
  const [a,b,c]=points;
  const denominator=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);
  if(Math.abs(denominator)<1e-12)return null;
  const wa=((b.y-c.y)*(p.x-c.x)+(c.x-b.x)*(p.y-c.y))/denominator;
  const wb=((c.y-a.y)*(p.x-c.x)+(a.x-c.x)*(p.y-c.y))/denominator;
  return wa*a.depth+wb*b.depth+(1-wa-wb)*c.depth;
}
// Deliberately preserves the accepted BASE S2 arithmetic/order semantics.
// Scratch storage removes allocation churn only; clipping predicates,
// line-intersection arithmetic and barycentric depth formulas are unchanged.
function projectedDepthRelation(a,b,counters=null){
  if(a.bounds.maxX<b.bounds.minX||b.bounds.maxX<a.bounds.minX
    ||a.bounds.maxY<b.bounds.minY||b.bounds.maxY<a.bounds.minY)return 0;
  if(counters)counters.clipCalls++;
  const overlap=triangleIntersectionPolygonScratch(a.points,b.points);
  if(overlap.count<3||Math.abs(signedAreaCount(overlap.points,overlap.count))<1e-6)return 0;
  let sumX=0,sumY=0;
  for(let i=0;i<overlap.count;i++){
    sumX+=overlap.points[i].x;
    sumY+=overlap.points[i].y;
  }
  centroidScratch.x=sumX/overlap.count;
  centroidScratch.y=sumY/overlap.count;
  let relation=0;
  for(let i=0;i<=overlap.count;i++){
    const sample=i<overlap.count?overlap.points[i]:centroidScratch;
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
  const outgoing=triangles.map(()=>new Set());
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
    if(!outgoing[from].has(to)){
      outgoing[from].add(to);
      incoming[to]++;
      edges++;
    }
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
    for(const to of outgoing[chosen]){
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
const deeplyImmutableMeshCache=new WeakSet();
function frozenArray(value){return Array.isArray(value)&&Object.isFrozen(value);}
function cacheableMesh(mesh){
  if(deeplyImmutableMeshCache.has(mesh))return true;
  if(!Object.isFrozen(mesh)||!frozenArray(mesh.vertices)||!frozenArray(mesh.triangles))return false;
  for(const vertex of mesh.vertices){
    if(!vertex||typeof vertex!=='object'||!Object.isFrozen(vertex)
      ||!frozenArray(vertex.reference)||!frozenArray(vertex.position))return false;
  }
  for(const triangle of mesh.triangles){
    if(!triangle||typeof triangle!=='object'||!Object.isFrozen(triangle)
      ||!frozenArray(triangle.indices))return false;
    if(triangle.normal!==undefined&&triangle.normal!==null
      &&(!Array.isArray(triangle.normal)||!Object.isFrozen(triangle.normal)))return false;
  }
  deeplyImmutableMeshCache.add(mesh);
  return true;
}
function visibilityIdentity(key,deformed){
  if(key===null||key===undefined)return null;
  return (deformed?'deformed|':'reference|')+String(key);
}
function cachedVisibilityOrder(mesh,key,deformed){
  const identity=visibilityIdentity(key,deformed);
  if(identity===null||!cacheableMesh(mesh))return null;
  return meshVisibilityOrderCache.get(mesh)?.get(identity)??null;
}
function storeVisibilityOrder(mesh,key,deformed,order){
  const identity=visibilityIdentity(key,deformed);
  if(identity===null||!cacheableMesh(mesh))return;
  let cache=meshVisibilityOrderCache.get(mesh);
  if(!cache){cache=new Map();meshVisibilityOrderCache.set(mesh,cache);}
  if(cache.size>=12&&!cache.has(identity))cache.delete(cache.keys().next().value);
  cache.set(identity,Object.freeze([...order]));
}
function triangleStyles(mesh){
  let cached=cacheableMesh(mesh)?meshStyleCache.get(mesh):null;
  if(cached)return cached;
  cached=mesh.triangles.map(triangle=>{
    if(!Array.isArray(triangle.normal)||triangle.normal.length!==3)return null;
    const light=triangleLight(triangle.normal);
    const rgb=[Math.round(43*light),Math.round(215*light),Math.round(163*light)];
    return {light,fill:'rgb('+rgb.join(',')+')'};
  });
  if(cacheableMesh(mesh))meshStyleCache.set(mesh,cached);
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
      light:style?.light??0,
      fill:style?.fill??null
    };
  });
  return {projectedVertices,prepared};
}
function preparedFrame(mesh){
  if(!cacheableMesh(mesh))return createPreparedFrame(mesh);
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
        light:style.light,
        fill:style.fill
      };
    });
  }
  const cachedOrder=cachedVisibilityOrder(mesh,visibilityCacheKey,deformed);
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
  storeVisibilityOrder(mesh,visibilityCacheKey,deformed,ordered.map(triangle=>triangle.index));
  if(stats&&typeof stats==='object')stats.visibilityCacheHit=false;
  return ordered;
}
export function paintProvenSurface(context,mesh,project,options={}){
  const started=performance.now();
  const tris=prepareProofTriangles(mesh,project,options);
  const preparedAt=performance.now();
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
  if(options.stats&&typeof options.stats==='object'){
    options.stats.prepareMs=preparedAt-started;
    options.stats.paintMs=performance.now()-preparedAt;
  }
  return tris.length;
}
