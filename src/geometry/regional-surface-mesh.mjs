import {octreeBoundsForPath} from '../volume/octree-address.mjs';
import {makeReferenceFacePatch} from '../surface/interface.mjs';
import {assembleProvenSurfaceMesh} from './surface-mesh.mjs';
import {identityDeformation} from './deformation.mjs';

function same3(a,b){return a.length===3&&a.every((v,i)=>v===b[i]||Object.is(v,b[i]));}
function freeze3(v){return Object.freeze([...v]);}
function validate(extraction){
  if(!extraction||!Array.isArray(extraction.present)||!Array.isArray(extraction.unresolved)){
    throw new Error('regional extraction with present/unresolved required');
  }
}
function unresolvedCellDepth(extraction){
  return Math.max(0,...(extraction.unresolvedCells??[]).map(item=>item.path.length));
}

export function assembleRegionalSurfaceMesh({
  extraction,deformation=identityDeformation,targetDepth=null
}={}){
  validate(extraction);
  if(typeof deformation!=='function')throw new Error('regional deformation must be a function');
  const all=[...extraction.present,...extraction.unresolved];
  const deepestProof=all.length?Math.max(...all.map(item=>item.depth)):0;
  const deepest=Math.max(deepestProof,unresolvedCellDepth(extraction));
  const target=targetDepth===null?deepest:targetDepth;
  if(!Number.isInteger(target)||target<deepest||target>5)throw new RangeError('regional targetDepth must cover proof/discovery depth and be <= 5');

  const vertices=[],triangles=[],patches=[];
  const byKey=new Map();
  for(const item of extraction.present){
    const delta=target-item.depth;
    if(delta>4)throw new RangeError('regional geometric promotion exceeds supported local tessellation depth');
    const local=assembleProvenSurfaceMesh({
      extraction:{present:[{
        patch:makeReferenceFacePatch(),decision:item.decision,
        depth:item.depth,pathA:item.pathA,pathB:item.pathB
      }],unresolved:[]},
      bounds:octreeBoundsForPath(item.pathA,{min:-1,max:1}),
      axis:item.axis,side:item.side,deformation,tessellationDepth:delta
    });
    const remap=[];
    for(const vertex of local.vertices){
      if(byKey.has(vertex.key)){
        const old=vertices[byKey.get(vertex.key)];
        if(!same3(old.reference,vertex.reference)||!same3(old.position,vertex.position)){
          throw new Error('regional canonical vertex conflict '+vertex.key);
        }
        remap.push(byKey.get(vertex.key));
      }else{
        const index=vertices.length;
        vertices.push(Object.freeze({
          key:vertex.key,reference:freeze3(vertex.reference),position:freeze3(vertex.position)
        }));
        byKey.set(vertex.key,index);remap.push(index);
      }
    }
    const patchIndex=patches.length;
    const triIndices=[];
    for(const tri of local.triangles){
      const indices=Object.freeze(tri.indices.map(index=>remap[index]));
      triIndices.push(triangles.length);
      triangles.push(Object.freeze({
        indices,normal:freeze3(tri.normal),patchIndex,decision:'PRESENT',faceKey:item.faceKey
      }));
    }
    patches.push(Object.freeze({
      faceKey:item.faceKey,axis:item.axis,side:item.side,depth:item.depth,
      pathA:Object.freeze([...item.pathA]),pathB:item.pathB?Object.freeze([...item.pathB]):null,
      rootPathA:item.rootPathA?Object.freeze([...item.rootPathA]):null,
      rootPathB:item.rootPathB?Object.freeze([...item.rootPathB]):null,
      vertexIndices:Object.freeze([...new Set(remap)]),triangleIndices:Object.freeze(triIndices)
    }));
  }
  const unresolvedCells=Object.freeze((extraction.unresolvedCells??[]).map(item=>Object.freeze({
    ...item,path:Object.freeze([...item.path])
  })));
  return Object.freeze({
    vertices:Object.freeze(vertices),triangles:Object.freeze(triangles),patches:Object.freeze(patches),
    unresolved:Object.freeze(extraction.unresolved.map(item=>Object.freeze({...item}))),
    unresolvedCells,
    stats:Object.freeze({
      targetDepth:target,faceRecords:extraction.faces?.length??null,
      provenPatches:extraction.present.length,unresolvedPatches:extraction.unresolved.length,
      unresolvedCells:unresolvedCells.length,
      vertices:vertices.length,triangles:triangles.length
    })
  });
}
