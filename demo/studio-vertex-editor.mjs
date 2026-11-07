// Pure browser/node projection helpers: canonical key function is supplied by the core.
export function editableFaceVertices(bounds,axis,side,keyOf){
  if(typeof keyOf!=='function')throw new Error('canonical vertex key function required');
  if(!bounds?.min||!bounds?.max||!['x','y','z'].includes(axis)||![-1,1].includes(side))throw new Error('invalid selected face');
  const ai=['x','y','z'].indexOf(axis);
  const tangents=[0,1,2].filter(i=>i!==ai);
  const result=[];
  for(let v=0;v<=2;v++)for(let u=0;u<=2;u++){
    const reference=[0,0,0];
    reference[ai]=side===1?bounds.max[ai]:bounds.min[ai];
    reference[tangents[0]]=bounds.min[tangents[0]]+(bounds.max[tangents[0]]-bounds.min[tangents[0]])*u/2;
    reference[tangents[1]]=bounds.min[tangents[1]]+(bounds.max[tangents[1]]-bounds.min[tangents[1]])*v/2;
    result.push({reference,key:keyOf(reference)});
  }
  return result;
}
export function cameraPlaneDrag(dx,dy,{yaw,pitch,zoom},width,height){
  if(![dx,dy,yaw,pitch,zoom,width,height].every(Number.isFinite)||zoom<=0||width<=0||height<=0)throw new RangeError('invalid camera drag');
  const scale=Math.min(width,height)*.3*zoom;
  const x1=dx/scale,y1=-dy/scale;
  const cy=Math.cos(yaw),sy=Math.sin(yaw),sp=Math.sin(pitch),cp=Math.cos(pitch);
  return [x1*cy+y1*sp*sy,y1*cp,x1*sy-y1*sp*cy];
}
export function pickFaceVertex({x,y,vertices,project,tolerance=14}){
  if(![x,y,tolerance].every(Number.isFinite)||tolerance<0||!Array.isArray(vertices)||typeof project!=='function')throw Error('invalid vertex picker');
  const hits=vertices.map(vertex=>{
    const screen=project(vertex.reference);
    return {...vertex,distance:Math.hypot(screen.x-x,screen.y-y),depth:screen.depth??0};
  }).filter(hit=>hit.distance<=tolerance);
  hits.sort((a,b)=>a.distance-b.distance||b.depth-a.depth||a.key.localeCompare(b.key));
  return hits[0]??null;
}
