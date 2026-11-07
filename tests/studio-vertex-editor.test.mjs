import test from 'node:test';
import assert from 'node:assert/strict';
import {editableFaceVertices,cameraPlaneDrag,pickFaceVertex} from '../demo/studio-vertex-editor.mjs';
import {octreeBoundsForPath,referenceVertexKey} from '../src/fractal-matter.mjs';
test('selected face exposes nine deterministic canonical shared vertex keys',()=>{
 const vertices=editableFaceVertices(octreeBoundsForPath([7]),'z',1,referenceVertexKey);
 assert.equal(vertices.length,9);
 assert.equal(new Set(vertices.map(x=>x.key)).size,9);
 assert.ok(vertices.every(x=>x.reference[2]===1));
 assert.ok(vertices.some(x=>x.key==='1,1,1'));
 assert.ok(vertices.some(x=>x.key==='0,0,1'));
});
test('inverse camera-plane drag projects to exact requested XY screen movement without depth change',()=>{
 const cameras=[{yaw:0,pitch:0,zoom:1},{yaw:-.66,pitch:.46,zoom:1.3},{yaw:1.3,pitch:-.5,zoom:.7}];
 for(const camera of cameras){
   const [x,y,z]=cameraPlaneDrag(30,-20,camera,600,420);
   const cy=Math.cos(camera.yaw),sy=Math.sin(camera.yaw),cp=Math.cos(camera.pitch),sp=Math.sin(camera.pitch);
   const x1=x*cy+z*sy,z1=-x*sy+z*cy,y1=y*cp-z1*sp;
   const depth=y*sp+z1*cp,scale=420*.30*camera.zoom;
   assert.ok(Math.abs(x1*scale-30)<1e-10);
   assert.ok(Math.abs(-y1*scale+20)<1e-10);
   assert.ok(Math.abs(depth)<1e-12);
 }
});
test('vertex picking chooses nearest visible handle and rejects outside area',()=>{
 const vertices=editableFaceVertices(octreeBoundsForPath([]),'z',1,referenceVertexKey);
 const project=p=>({x:p[0]*50,y:p[1]*50,depth:p[2]});
 const hit=pickFaceVertex({x:0,y:0,vertices,project});
 assert.equal(hit.key,'0,0,1');
 assert.equal(pickFaceVertex({x:500,y:500,vertices,project}),null);
});
