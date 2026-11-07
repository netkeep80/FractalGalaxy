import test from 'node:test';
import assert from 'node:assert/strict';
import {
  E0_VERSION, derive32, addressForPoint, stateForPath, makeGamma, baseValue,
  makeMaterial, queryMaterial, splitMaterial, integrateMass, solid, EMPTY,
  makePhysicalNode, makeWorld, contact, attach, detach, saveWorld, loadWorld
} from '../src/fractal-matter.mjs';

const hex = n => '0x' + n.toString(16).padStart(8,'0');

test('Derive32: опубликованные векторы и многошаговый путь', () => {
  const branches=[0,1,3,7];
  assert.deepEqual(branches.map(i=>hex(derive32(0,i))), ['0x01fce552','0x04f8d29e','0x6ba5a157','0x60f3d8ca']);
  assert.deepEqual(branches.map(i=>hex(derive32(0x12345678,i))), ['0x8ff7a29e','0x7d0ecaf2','0x31e4401c','0x7f73ae6e']);
  assert.equal(hex(stateForPath(0,[7,0,1,3,2])), '0x581ab388');
});

test('координата однозначно задаёт octree-путь bx+2by+4bz', () => {
  assert.deepEqual(addressForPoint([1/32,-31/32,-1/64],5).path, [1,4,4,4,4]);
});

test('Γ реально влияет на M, а не только на диагностический h', () => {
  const p=[1/32,-31/32,-1/64];
  const a=baseValue(p, makeGamma({rootSeed:0, alphaNeighbor:0}));
  const b=baseValue(p, makeGamma({rootSeed:0, alphaNeighbor:-1}));
  assert.equal(a.kind,'SOLID');
  assert.equal(b.kind,'EMPTY');
});

test('D: наиболее глубокая запись перекрывает предка', () => {
  const gamma=makeGamma({fixture:'solid'});
  const m=makeMaterial({id:'m',gamma,edits:[
    {path:[0],value:EMPTY},
    {path:[0,7],value:solid('ore',2)},
  ]});
  assert.equal(queryMaterial(m,[-0.75,-0.75,-0.75]).kind,'EMPTY');
  const q=queryMaterial(m,[-0.25,-0.25,-0.25]);
  assert.equal(q.kind,'SOLID'); assert.equal(q.materialId,'ore'); assert.equal(q.density,2);
});

test('повторный Split пересекает новую плоскость с текущей маской', () => {
  const root=makeMaterial({id:'root',gamma:makeGamma({fixture:'solid'})});
  const s1=splitMaterial(root,{normal:[1,0,0],offset:0},{leftId:'L',rightId:'R'});
  const s2=splitMaterial(s1.right,{normal:[0,1,0],offset:0},{leftId:'RB',rightId:'RT'});
  assert.equal(integrateMass(s1.left),4);
  assert.equal(integrateMass(s2.left),2);
  assert.equal(integrateMass(s2.right),2);
  assert.equal(queryMaterial(s2.left,[-0.5,-0.5,0]).kind,'NOT_OWNED');
  assert.equal(queryMaterial(s2.left,[0.5,-0.5,0]).kind,'SOLID');
});

test('Contact ничего не меняет; Attach создаёт K; Detach наследует жёсткую скорость', () => {
  const gamma=makeGamma({fixture:'solid'});
  const ma=makeMaterial({id:'ma',gamma}), mb=makeMaterial({id:'mb',gamma});
  const A=makePhysicalNode({id:'A',materialId:'ma',position:[-1,0,0],velocity:[0,-1,0],angularVelocity:[0,0,1]});
  const B=makePhysicalNode({id:'B',materialId:'mb',position:[1,0,0],velocity:[0,1,0],angularVelocity:[0,0,1]});
  const w=makeWorld({materials:[ma,mb],nodes:[A,B]});
  assert.deepEqual(contact(w,'A','B'),w);
  const joined=attach(w,'A','B','K');
  assert.deepEqual(joined.nodes.K.children,['A','B']);
  assert.deepEqual(joined.nodes.K.velocity,[0,0,0]);
  const separated=detach(joined,'B');
  assert.equal(separated.nodes.B.parentId,null);
  assert.deepEqual(separated.nodes.B.velocity,[0,1,0]);
  assert.deepEqual(separated.nodes.B.angularVelocity,[0,0,1]);
});

test('Save/Load сохраняет Γ, маску, D и физический лес; bad version отвергается', () => {
  const gamma=makeGamma({rootSeed:123,alphaNeighbor:1,boundaryKey:'g:1'});
  const root=makeMaterial({id:'root',gamma,edits:[{path:[7],value:EMPTY}]});
  const {left,right}=splitMaterial(root,{normal:[1,0,0],offset:0},{leftId:'left',rightId:'right'});
  const A=makePhysicalNode({id:'A',materialId:'left',position:[-0.5,0,0]});
  const B=makePhysicalNode({id:'B',materialId:'right',position:[0.5,0,0]});
  const world=attach(makeWorld({materials:[left,right],nodes:[A,B]}),'A','B','K');
  const loaded=loadWorld(saveWorld(world));
  assert.equal(loaded.version,E0_VERSION);
  assert.deepEqual(queryMaterial(loaded.materials.left,[-0.25,0.1,-0.2]), queryMaterial(left,[-0.25,0.1,-0.2]));
  const bad=JSON.parse(saveWorld(world)); bad.version='unknown';
  assert.throws(()=>loadWorld(JSON.stringify(bad)),/unsupported world version/);
});
