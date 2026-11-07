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
  cubeToSphereDeformation,
  classifyMaterialRegion,
  adjacentOctreePath,
  octreeBoundsForPath,
  extractMaterialInterface
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
  source: $('interfaceSource'),
  probeDepth: $('probeDepth'),
  axis: $('faceAxis'),
  side: $('faceSide'),
  mediumA: $('mediumA'),
  mediumB: $('mediumB'),
  deformBlend: $('deformBlend')
};

$('version').textContent = E0_VERSION;

let selectedPoint = [0, 0, 0];

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
  selectedPoint = [selectedPoint[0], selectedPoint[1], z];
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
  inspect(model, selectedPoint);
  renderGeometryLab();
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
  selectedPoint = [x, y, z];
  inspect(buildModel(), selectedPoint);
  renderGeometryLab();
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
  selectedPoint = [0, 0, 0];
  renderMaterialView();
});

// ---- E1 Surface / Geometry Lab ------------------------------------------------

const referenceCanvas = $('referenceView');
const deformedCanvas = $('deformedView');
const camera = { yaw: -0.66, pitch: 0.46, zoom: 1 };
let drag = null;
let currentSurfaceExtraction = { present: [], unresolved: [], stats: { visitedPairs: 0 } };

function classificationFor(value) {
  return value === 'MIXED' ? mixedVolume() : homogeneousVolume(value);
}

function mediumLabel(medium) {
  if (medium === 'EMPTY') return 'EMPTY';
  const match = /^SOLID:([^:]+):(.+)$/.exec(medium ?? '');
  return match ? `${match[1]} ρ=${match[2]}` : String(medium);
}

function classificationLabel(result) {
  const classification = result.classification ?? result;
  return classification.kind === 'HOMOGENEOUS'
    ? `HOMOGENEOUS · ${mediumLabel(classification.medium)}`
    : 'MIXED';
}

function refinementLabel(result) {
  if (!result?.stats) return 'manual';
  return `nodes=${result.stats.inspectedNodes}, depth=${result.stats.deepestDepth}`;
}

function currentProbeContext() {
  const depth = Number(lab.probeDepth.value);
  const axis = lab.axis.value;
  const side = Number(lab.side.value);
  const pathA = addressForPoint(selectedPoint, depth).path;
  const pathB = adjacentOctreePath(pathA, axis, side);
  return {
    depth,
    axis,
    side,
    pathA,
    pathB,
    boundsA: octreeBoundsForPath(pathA, { min: -1, max: 1 }),
    boundsB: pathB ? octreeBoundsForPath(pathB, { min: -1, max: 1 }) : null
  };
}

function facePointForBounds(bounds, axis, side, u, v) {
  const ai = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const other = [0, 1, 2].filter(index => index !== ai);
  const point = [0, 0, 0];
  point[ai] = side === 1 ? bounds.max[ai] : bounds.min[ai];
  point[other[0]] = bounds.min[other[0]] + ((u + 1) / 2) * (bounds.max[other[0]] - bounds.min[other[0]]);
  point[other[1]] = bounds.min[other[1]] + ((v + 1) / 2) * (bounds.max[other[1]] - bounds.min[other[1]]);
  return point;
}

function facePoint(axis, side, u, v) {
  return facePointForBounds({ min: [-1,-1,-1], max: [1,1,1] }, axis, side, u, v);
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

function drawBox(context, canvasElement, bounds, deformed, stroke = 'rgba(118,174,210,.46)', width = 1.2) {
  const corners = [];
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) corners.push([x,y,z]);
    }
  }
  for (let i = 0; i < corners.length; i++) {
    for (let j = i + 1; j < corners.length; j++) {
      const diff = corners[i].filter((value, axis) => value !== corners[j][axis]).length;
      if (diff === 1) drawLine(context, canvasElement, corners[i], corners[j], { deformed, stroke, width });
    }
  }
}

function facePatchCorners(bounds, axis, side, patch) {
  const u0 = -1 + 2 * patch.u0;
  const u1 = -1 + 2 * patch.u1;
  const v0 = -1 + 2 * patch.v0;
  const v1 = -1 + 2 * patch.v1;
  return [
    facePointForBounds(bounds, axis, side, u0, v0),
    facePointForBounds(bounds, axis, side, u1, v0),
    facePointForBounds(bounds, axis, side, u1, v1),
    facePointForBounds(bounds, axis, side, u0, v1)
  ];
}

function drawSurfacePatch(context, canvasElement, bounds, axis, side, patch, deformed, fill, stroke) {
  const points = facePatchCorners(bounds, axis, side, patch)
    .map(point => rotateProject(mapGeometry(point, deformed), canvasElement));

  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) context.lineTo(points[i].x, points[i].y);
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = stroke;
  context.lineWidth = 1.4;
  context.stroke();
}

function drawExtractedSurface(context, canvasElement, bounds, axis, side, deformed) {
  for (const item of currentSurfaceExtraction.present ?? []) {
    drawSurfacePatch(
      context, canvasElement, bounds, axis, side, item.patch, deformed,
      'rgba(71, 231, 177, .20)', 'rgba(93, 244, 193, .88)'
    );
  }
  for (const item of currentSurfaceExtraction.unresolved ?? []) {
    drawSurfacePatch(
      context, canvasElement, bounds, axis, side, item.patch, deformed,
      'rgba(255, 178, 74, .16)', 'rgba(255, 190, 91, .88)'
    );
  }
}

function drawSelectedFace(context, canvasElement, deformed) {
  const probe = currentProbeContext();
  const { axis, side, pathA, boundsA } = probe;
  const stroke = 'rgba(102, 235, 190, .95)';

  drawBox(context, canvasElement, boundsA, deformed, 'rgba(92,176,211,.62)', 1.4);
  drawExtractedSurface(context, canvasElement, boundsA, axis, side, deformed);
  if (probe.boundsB) {
    drawBox(context, canvasElement, probe.boundsB, deformed, 'rgba(255,185,88,.30)', 1);
  }

  for (const t of [-1, 0, 1]) {
    drawLine(
      context,
      canvasElement,
      facePointForBounds(boundsA, axis, side, -1, t),
      facePointForBounds(boundsA, axis, side, 1, t),
      { deformed, stroke, width: t === 0 ? 2.2 : 1.7 }
    );
    drawLine(
      context,
      canvasElement,
      facePointForBounds(boundsA, axis, side, t, -1),
      facePointForBounds(boundsA, axis, side, t, 1),
      { deformed, stroke, width: t === 0 ? 2.2 : 1.7 }
    );
  }

  const incident = incidentOctantsForFace(axis, side);
  context.font = '700 12px ui-monospace, SFMono-Regular, Menlo, monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  for (const branch of incident) {
    const childBounds = octreeBoundsForPath([...pathA, branch], { min: -1, max: 1 });
    const childCenter = childBounds.min.map((value, i) => (value + childBounds.max[i]) / 2);
    const ai = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    childCenter[ai] = side === 1 ? boundsA.max[ai] : boundsA.min[ai];

    const p = rotateProject(mapGeometry(childCenter, deformed), canvasElement);
    context.fillStyle = 'rgba(5, 15, 22, .84)';
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
  const probe = currentProbeContext();
  const { axis, side, pathA, pathB } = probe;
  const model = buildModel();
  const live = lab.source.value === 'procedural';

  let aResult;
  let bResult;

  if (live) {
    aResult = classifyMaterialRegion(model.root, pathA, { maxDepth: 5 });
    bResult = pathB
      ? classifyMaterialRegion(model.root, pathB, { maxDepth: 5 })
      : {
          classification: homogeneousVolume('EMPTY'),
          stats: { inspectedNodes: 0, deepestDepth: probe.depth, reasons: { 'outside-domain': 1 } },
          outsideDomain: true
        };

    currentSurfaceExtraction = extractMaterialInterface(model.root, {
      pathA,
      pathB,
      axis,
      side,
      maxDepth: 5,
      outsideMedium: 'EMPTY'
    });
  } else {
    aResult = { classification: classificationFor(lab.mediumA.value) };
    bResult = { classification: classificationFor(lab.mediumB.value) };
    const decision = classifyMaterialInterface(aResult.classification, bResult.classification);
    currentSurfaceExtraction = decision.kind === 'PRESENT'
      ? {
          present: [{ patch: makeReferenceFacePatch(), decision }],
          unresolved: [],
          stats: { visitedPairs: 1 }
        }
      : decision.kind === 'REFINE'
        ? {
            present: [],
            unresolved: [{ patch: makeReferenceFacePatch(), decision }],
            stats: { visitedPairs: 1 }
          }
        : {
            present: [],
            unresolved: [],
            stats: { visitedPairs: 1 }
          };
  }

  const rootDecision = classifyMaterialInterface(aResult.classification, bResult.classification);
  const incidentA = incidentOctantsForFace(axis, side);
  const incidentB = incidentOctantsForFace(axis, -side);
  const patches = subdivideReferenceFacePatch(makeReferenceFacePatch());

  lab.mediumA.disabled = live;
  lab.mediumB.disabled = live;
  $('probeDepthOut').value = String(probe.depth);
  $('selectedCell').textContent = '[' + pathA.join(',') + ']';
  $('neighborCell').textContent = pathB ? '[' + pathB.join(',') + ']' : 'OUTSIDE → EMPTY';
  $('classificationA').textContent = classificationLabel(aResult);
  $('classificationB').textContent = classificationLabel(bResult);
  $('refinementA').textContent = refinementLabel(aResult);
  $('refinementB').textContent = bResult.outsideDomain ? 'outside domain' : refinementLabel(bResult);
  $('incidentA').textContent = '[' + incidentA.join(', ') + ']';
  $('incidentB').textContent = '[' + incidentB.join(', ') + ']';
  $('surfacePatches').textContent = String(patches.length);
  $('presentPatches').textContent = String(currentSurfaceExtraction.present.length);
  $('unresolvedPatches').textContent = String(currentSurfaceExtraction.unresolved.length);
  $('visitedPairs').textContent = String(currentSurfaceExtraction.stats.visitedPairs ?? 0);
  $('interfaceDecision').textContent = describeInterface(rootDecision);
  $('deformOut').value = Math.round(Number(lab.deformBlend.value) * 100) + '%';

  const finalKind = currentSurfaceExtraction.unresolved.length > 0
    ? 'REFINE'
    : currentSurfaceExtraction.present.length > 0
      ? 'PRESENT'
      : 'NONE';
  const badge = $('interfaceBadge');
  badge.textContent = finalKind;
  badge.className = 'interface-badge ' + finalKind.toLowerCase();

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
