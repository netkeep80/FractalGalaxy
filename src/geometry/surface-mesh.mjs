import {buildSurfacePatchGeometry,referenceVertexKey} from './surface-patch.mjs';
import {triangulateSurfacePatchGeometry,triangleNormal} from './triangulation.mjs';
import {identityDeformation} from './deformation.mjs';

function immutableVec3(p){return Object.freeze([...p]);}
function equalVec3(a,b){return a.length===3&&a.every((v,i)=>Object.is(v,b[i])||v===b[i]);}
function freezeRecord(record){return Object.freeze(record);}
function validRecords(extraction){
  if(!extraction||!Array.isArray(extraction.present)||!Array.isArray(extraction.unresolved))
    throw new Error('interface extraction with present/unresolved arrays required');
  for(const item of extraction.present){
    if(item?.decision?.kind!=='PRESENT')throw new Error('mesh input must be a proven PRESENT interface');
  }
  for(const item of extraction.unresolved){
    if(item?.decision?.kind!=='REFINE')throw new Error('unresolved input must carry REFINE decision');
  }
}

/**
 * Derives one indexed triangle mesh from one proved local interface face.
 * All vertex identity comes from canonical reference coordinates, not patch,
 * camera, physical parent, object ID, LOD, or interaction history.
 *
 * An unresolved patch is explicitly returned as a proof gap, never tessellated.
 * This is local same-depth geometry, not a watertight regional mesh.
 */
export function assembleProvenSurfaceMesh({
  extraction,bounds,axis,side,deformation=identityDeformation
}={}){
  validRecords(extraction);
  if(typeof deformation!=='function')throw new Error('deformation function required');

  const vertices=[];
  const byKey=new Map();
  const triangles=[];
  const patches=[];

  for(const item of extraction.present){
    const geometry=buildSurfacePatchGeometry({
      bounds,axis,side,patch:item.patch,deformation
    });
    const indexed=[];
    for(let k=0;k<geometry.vertexKeys.length;k++){
      const key=geometry.vertexKeys[k];
      const reference=geometry.referenceVertices[k];
      const deformed=geometry.deformedVertices[k];
      if(byKey.has(key)){
        const old=vertices[byKey.get(key)];
        if(!equalVec3(old.reference,reference)||!equalVec3(old.position,deformed))
          throw new Error('conflicting shared canonical vertex '+key);
        indexed.push(byKey.get(key));
      }else{
        const index=vertices.length;
        vertices.push(freezeRecord({key,reference:immutableVec3(reference),position:immutableVec3(deformed)}));
        byKey.set(key,index);
        indexed.push(index);
      }
    }
    const triangulated=triangulateSurfacePatchGeometry(geometry);
    const patchIndex=patches.length;
    const triIndices=[];
    for(const tri of triangulated.triangles){
      const indices=Object.freeze(tri.indices.map(i=>indexed[i]));
      const positions=indices.map(index=>vertices[index].position);
      const normal=immutableVec3(triangleNormal(positions));
      const triangle=freezeRecord({
        indices,normal,patchIndex,
        // Proof comes from the original extractor decision, not the renderer.
        decision:'PRESENT'
      });
      triIndices.push(triangles.length);
      triangles.push(triangle);
    }
    patches.push(freezeRecord({
      patch:freezeRecord({...item.patch}),
      depth:item.depth??null,
      pathA:item.pathA?Object.freeze([...item.pathA]):null,
      pathB:item.pathB?Object.freeze([...item.pathB]):null,
      vertexIndices:Object.freeze(indexed),triangleIndices:Object.freeze(triIndices)
    }));
  }
  return freezeRecord({
    vertices:Object.freeze(vertices),
    triangles:Object.freeze(triangles),
    patches:Object.freeze(patches),
    unresolved:Object.freeze(extraction.unresolved.map(item=>freezeRecord({
      patch:freezeRecord({...item.patch}),decision:'REFINE',
      depth:item.depth??null,
      pathA:item.pathA?Object.freeze([...item.pathA]):null
    }))),
    stats:freezeRecord({
      provenPatches:patches.length,
      unresolvedPatches:extraction.unresolved.length,
      vertices:vertices.length,
      triangles:triangles.length
    })
  });
}
