import { makeGamma, makeMaterial, splitMaterial, integrateMass, makePhysicalNode, makeWorld, attach, saveWorld } from '../src/fractal-matter.mjs';

const gamma = makeGamma({ rootSeed: 0x12345678, alphaNeighbor: 0, fixture: 'solid' });
const planet = makeMaterial({ id: 'planet', gamma });
const first = splitMaterial(planet, { normal:[1,0,0], offset:0 }, { leftId:'planet:L', rightId:'planet:R' });
const second = splitMaterial(first.right, { normal:[0,1,0], offset:0 }, { leftId:'planet:RB', rightId:'planet:RT' });

console.log('masses', {
  left: integrateMass(first.left),
  rightBottom: integrateMass(second.left),
  rightTop: integrateMass(second.right),
});

const A = makePhysicalNode({ id:'A', materialId:first.left.id, position:[-0.5,0,0] });
const B = makePhysicalNode({ id:'B', materialId:second.left.id, position:[0.5,-0.5,0] });
const world = attach(makeWorld({ materials:[first.left, second.left, second.right], nodes:[A,B] }), 'A', 'B', 'K');
console.log(saveWorld(world));
