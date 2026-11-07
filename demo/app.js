import {
  E0_VERSION,
  EMPTY,
  addressForPoint,
  stateForPath,
  makeGamma,
  makeMaterial,
  queryMaterial,
  splitMaterial,
  integrateMass,
  homogeneousVolume,
  mixedVolume,
  classifyMaterialInterface,
  incidentOctantsForFace,
  makeReferenceFacePatch,
  subdivideReferenceFacePatch,
  cubeToSphereDeformation
} from './src/fractal-matter.mjs';

const $ = id => document.getElementById(id);
const canvas = $('view');
const ctx = canvas.getContext('2d', { alpha: false });

const controls = {
  seed: $('seed'),
  alpha: $('alpha'),
  zSlice: $('zSlice'),
  fixture: $('fixture'),
  editD: $('editD'),
  mode: $('mode')
};

const lab = {
  axis: $('faceAxis'),
  side: $('faceSide'),
  mediumA: $('mediumA'),
  mediumB: $('mediumB'),
  deformBlend: $('deformBlend')
};

$('version').textContent = E0_VERSION;

const ownerColors = {
  left: [67, 213, 255],
  rb: [255, 175, 74],
  rt: [225, 92, 255]
};

function parseSeed() {
  const raw = controls.seed.value.trim();
  const value = raw.toLowerCase().startsWith('0x')
    ? Number.parseInt(raw.slice(2), 16)
    : Number(raw);
  if (!Number.isFinite(value)) throw new Error('Некорректный seed');
  return value >>> 0;
}

function buildModel() {
  const gamma = makeGamma({
    rootSeed: parseSeed(),
    alphaNeighbor: Number(controls.alpha.value),
    boundaryKey: 'demo:shared-boundary',
    fixture: controls.fixture.value
  });

  const edits = controls.editD.checked
    ? [{ path: [7], value: EMPTY }]
    : [];

  const root = makeMaterial({ id: 'root', gamma, edits });
  const first = splitMaterial(
    root,
    { normal: [1, 0, 0], offset: 0 },
    { leftId: 'left', rightId: 'right' }
  );
  const second = splitMaterial(
    first.right,
    { normal: [0, 1, 0], offset: 0 },
    { leftId: 'rb', rightId: 'rt' }
  );

  return { gamma, root, left: first.left, rb: second.left, rt: second.right };
}

function ownerAt(model, point) {
  const checks = [
    ['left', model.left],
    ['rb', model.rb],
    ['rt', model.rt]
  ];
  for (const [name, material] of checks) {
    const value = queryMaterial(material, point);
    if (value.kind !== 'NOT_OWNED') return { name, value };
  }
  return { name: 'none', value: { kind: 'NOT_OWNED' } };
}

function materialColor(value) {
  if (value.kind === 'EMPTY') return [6, 14, 22];
  if (value.kind === 'SOLID') {
    const d = Math.min(1, value.density / 2);
    return [Math.round(42 + 46*d), Math.round(151 + 80*d), Math.round(112 + 88*d)];
  }
  return [18, 26, 34];
}

function renderMaterialView() {
  let model;
  try {
    model = buildModel();
    controls.seed.setCustomValidity('');
  } catch (error) {
    controls.seed.setCustomValidity(error.message);
    controls.seed.reportValidity();
    return;
  }

  $('alphaOut').value = controls.alpha.value;
  const z = Number(controls.zSlice.value);
  $('zOut').value = z.toFixed(2);

  const size = 128;
  const image = ctx.createImageData(size, size);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = -1 + (px + 0.5) * (2 / size);
      const y = 1 - (py + 0.5) * (2 / size);
      const point = [x, y, z];

      let color;
      if (controls.mode.value === 'owners') {
        const own = ownerAt(model, point);
        if (own.value.kind === 'SOLID') color = ownerColors[own.name];
        else if (own.value.kind === 'EMPTY') color = [6, 14, 22];
        else color = [18, 26, 34];
      } else {
        color = materialColor(queryMaterial(model.root, point));
      }

      const i = (py * size + px) * 4;
      image.data[i] = color[0];
      image.data[i+1] = color[1];
      image.data[i+2] = color[2];
      image.data[i+3] = 255;
    }
  }

  const temp = document.createElement('canvas');
  temp.width = size;
  temp.height = size;
  temp.getContext('2d').putImageData(image, 0, 0);

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(temp, 0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = 'rgba(255,255,255,.32)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(canvas.width / 2, 0);
  ctx.lineTo(canvas.width / 2, canvas.height);
  if (controls.mode.value === 'owners') {
    ctx.moveTo(canvas.width / 2, canvas.height / 2);
    ctx.lineTo(canvas.width, canvas.height / 2);
  }
  ctx.stroke();

  updateLegend();
  updateMasses(model);
  inspect(model, [0, 0, z]);
}

function updateLegend() {
  const legend = $('legend');
  if (controls.mode.value === 'owners') {
    legend.innerHTML = [
      ['#43d5ff', 'left: x < 0'],
      ['#ffaf4a', 'right-bottom: x ≥ 0, y < 0'],
      ['#e15cff', 'right-top: x ≥ 0, y ≥ 0'],
      ['#06101a', 'EMPTY']
    ].map(([c,t]) => `<span style="--swatch:${c}">${t}</span>`).join('');
  } else {
    legend.innerHTML = [
      ['#58d7a9', 'SOLID'],
      ['#06101a', 'EMPTY']
    ].map(([c,t]) => `<span style="--swatch:${c}">${t}</span>`).join('');
  }
}

function fmt(n) {
  return Number(n).toFixed(6).replace(/0+$/,'').replace(/\.$/,'');
}

function updateMasses(model) {
  const depth = 4;
  const root = integrateMass(model.root, depth);
  const left = integrateMass(model.left, depth);
  const rb = integrateMass(model.rb, depth);
  const rt = integrateMass(model.rt, depth);
  $('massRoot').textContent = fmt(root);
  $('massLeft').textContent = fmt(left);
  $('massRB').textContent = fmt(rb);
  $('massRT').textContent = fmt(rt);
  $('massSum').textContent = `${fmt(left + rb + rt)}  (Δ ${fmt(left + rb + rt - root)})`;
}

function describeMatter(value) {
  if (value.kind === 'SOLID') return `SOLID(${value.materialId}, ρ=${value.density})`;
  return value.kind;
}

function inspect(model, point) {
  const { path } = addressForPoint(point, 5);
  const state = stateForPath(model.gamma.rootSeed, path);
  const value = queryMaterial(model.root, point);
  const own = ownerAt(model, point);

  $('point').textContent = point.map(v => v.toFixed(4)).join(', ');
  $('path').textContent = '[' + path.join(',') + ']';
  $('state').textContent = '0x' + state.toString(16).padStart(8, '0');
  $('matter').textContent = describeMatter(value);
  $('owner').textContent = value.kind === 'EMPTY' ? '— (EMPTY)' : own.name;
}

canvas.addEventListener('click', event => {
  const rect = canvas.getBoundingClientRect();
  const x = -1 + 2 * ((event.clientX - rect.left) / rect.width);
  const y = 1 - 2 * ((event.clientY - rect.top) / rect.height);
  const z = Number(controls.zSlice.value);
  inspect(buildModel(), [x, y, z]);
});

for (const input of Object.values(controls)) {
  input.addEventListener(input.type === 'range' ? 'input' : 'change', renderMaterialView);
}
controls.seed.addEventListener('change', renderMaterialView);

$('reset').addEventListener('click', () => {
  controls.seed.value = '0x12345678';
  controls.alpha.value = '0';
  controls.zSlice.value = '0';
  controls.fixture.value = 'height';
  controls.editD.checked = false;
  controls.mode.value = 'matter';
  renderMaterialView();
});

// ---- E1 Surface / Geometry Lab ------------------------------------------------

const referenceCanvas = $('referenceView');
const deformedCanvas = $('deformedView');
const camera = { yaw: -0.66, pitch: 0.46, zoom: 1 };
let drag = null;

function classificationFor(value) {
  return value === 'MIXED' ? mixedVolume() : homogeneousVolume(value);
}

function facePoint(axis, side, u, v) {
  if (axis === 'x') return [side, u, v];
  if (axis === 'y') return [u, side, v];
  return [u, v, side];
}

function octantForPoint([x, y, z]) {
  return (x >= 0 ? 1 : 0) + (y >= 0 ? 2 : 0) + (z >= 0 ? 4 : 0);
}

function blendedDeformation(point) {
  const blend = Number(lab.deformBlend.value);
  const sphere = cubeToSphereDeformation(point);
  return point.map((value, i) => value + (sphere[i] - value) * blend);
}

function rotateProject(point, canvasElement) {
  const [x, y, z] = point;
  const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw);
  const cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);

  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  const y1 = y * cp - z1 * sp;
  const depth = y * sp + z1 * cp;

  const scale = Math.min(canvasElement.width, canvasElement.height) * 0.30 * camera.zoom;
  return {
    x: canvasElement.width / 2 + x1 * scale,
    y: canvasElement.height / 2 - y1 * scale,
    depth
  };
}

function mapGeometry(point, deformed) {
  return deformed ? blendedDeformation(point) : point;
}

function drawLine(context, canvasElement, a, b, { deformed = false, stroke = 'rgba(121,150,174,.30)', width = 1 } = {}) {
  const pa = rotateProject(mapGeometry(a, deformed), canvasElement);
  const pb = rotateProject(mapGeometry(b, deformed), canvasElement);
  context.strokeStyle = stroke;
  context.lineWidth = width;
  context.beginPath();
  context.moveTo(pa.x, pa.y);
  context.lineTo(pb.x, pb.y);
  context.stroke();
}

function drawCubeGrid(context, canvasElement, deformed) {
  const steps = 4;
  for (const axis of ['x', 'y', 'z']) {
    for (const side of [-1, 1]) {
      for (let i = 0; i <= steps; i++) {
        const t = -1 + 2 * i / steps;
        drawLine(context, canvasElement, facePoint(axis, side, -1, t), facePoint(axis, side, 1, t), { deformed });
        drawLine(context, canvasElement, facePoint(axis, side, t, -1), facePoint(axis, side, t, 1), { deformed });
      }
    }
  }
}

function drawSelectedFace(context, canvasElement, deformed) {
  const axis = lab.axis.value;
  const side = Number(lab.side.value);
  const stroke = 'rgba(102, 235, 190, .95)';

  for (const t of [-1, 0, 1]) {
    drawLine(context, canvasElement, facePoint(axis, side, -1, t), facePoint(axis, side, 1, t), {
      deformed, stroke, width: t === 0 ? 2.2 : 1.7
    });
    drawLine(context, canvasElement, facePoint(axis, side, t, -1), facePoint(axis, side, t, 1), {
      deformed, stroke, width: t === 0 ? 2.2 : 1.7
    });
  }

  const incident = incidentOctantsForFace(axis, side);
  const centers = [
    [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]
  ];

  context.font = '700 12px ui-monospace, SFMono-Regular, Menlo, monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  for (const [u, v] of centers) {
    const source = facePoint(axis, side, u, v);
    const branch = octantForPoint(source);
    if (!incident.includes(branch)) continue;
    const p = rotateProject(mapGeometry(source, deformed), canvasElement);
    context.fillStyle = 'rgba(5, 15, 22, .82)';
    context.beginPath();
    context.arc(p.x, p.y, 13, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#a7ffe1';
    context.fillText(String(branch), p.x, p.y + 0.5);
  }
}

function drawAxes(context, canvasElement, deformed) {
  const axes = [
    [[0,0,0], [1.25,0,0], 'X'],
    [[0,0,0], [0,1.25,0], 'Y'],
    [[0,0,0], [0,0,1.25], 'Z']
  ];
  context.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  for (const [a,b,label] of axes) {
    drawLine(context, canvasElement, a, b, { deformed: false, stroke: 'rgba(255,255,255,.24)', width: 1 });
    const p = rotateProject(b, canvasElement);
    context.fillStyle = '#637b90';
    context.fillText(label, p.x + 4, p.y - 4);
  }
}

function drawGeometry(canvasElement, deformed) {
  const context = canvasElement.getContext('2d');
  context.clearRect(0, 0, canvasElement.width, canvasElement.height);

  const gradient = context.createRadialGradient(
    canvasElement.width * .48, canvasElement.height * .42, 10,
    canvasElement.width * .48, canvasElement.height * .42, canvasElement.width * .55
  );
  gradient.addColorStop(0, '#0b1a25');
  gradient.addColorStop(1, '#03090f');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvasElement.width, canvasElement.height);

  drawCubeGrid(context, canvasElement, deformed);
  drawSelectedFace(context, canvasElement, deformed);
  drawAxes(context, canvasElement, deformed);
}

function describeInterface(result) {
  if (result.kind === 'NONE') return `NONE · ${result.medium}`;
  if (result.kind === 'PRESENT') return `PRESENT · ${result.leftMedium} ↔ ${result.rightMedium}`;
  return 'REFINE · volume is MIXED';
}

function renderGeometryLab() {
  const axis = lab.axis.value;
  const side = Number(lab.side.value);
  const a = classificationFor(lab.mediumA.value);
  const b = classificationFor(lab.mediumB.value);
  const decision = classifyMaterialInterface(a, b);
  const incidentA = incidentOctantsForFace(axis, side);
  const incidentB = incidentOctantsForFace(axis, -side);
  const patches = subdivideReferenceFacePatch(makeReferenceFacePatch());

  $('incidentA').textContent = '[' + incidentA.join(', ') + ']';
  $('incidentB').textContent = '[' + incidentB.join(', ') + ']';
  $('surfacePatches').textContent = String(patches.length);
  $('interfaceDecision').textContent = describeInterface(decision);
  $('deformOut').value = Math.round(Number(lab.deformBlend.value) * 100) + '%';

  const badge = $('interfaceBadge');
  badge.textContent = decision.kind;
  badge.className = 'interface-badge ' + decision.kind.toLowerCase();

  drawGeometry(referenceCanvas, false);
  drawGeometry(deformedCanvas, true);
}

for (const input of Object.values(lab)) {
  input.addEventListener(input.type === 'range' ? 'input' : 'change', renderGeometryLab);
}

function attachCameraControls(canvasElement) {
  canvasElement.addEventListener('pointerdown', event => {
    canvasElement.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
  });

  canvasElement.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    camera.yaw += dx * 0.01;
    camera.pitch = Math.max(-1.35, Math.min(1.35, camera.pitch + dy * 0.01));
    renderGeometryLab();
  });

  const end = event => {
    if (drag?.id === event.pointerId) drag = null;
  };
  canvasElement.addEventListener('pointerup', end);
  canvasElement.addEventListener('pointercancel', end);

  canvasElement.addEventListener('wheel', event => {
    event.preventDefault();
    camera.zoom = Math.max(0.55, Math.min(2.2, camera.zoom * Math.exp(-event.deltaY * 0.001)));
    renderGeometryLab();
  }, { passive: false });
}

attachCameraControls(referenceCanvas);
attachCameraControls(deformedCanvas);

$('resetCamera').addEventListener('click', () => {
  camera.yaw = -0.66;
  camera.pitch = 0.46;
  camera.zoom = 1;
  renderGeometryLab();
});

renderMaterialView();
renderGeometryLab();
