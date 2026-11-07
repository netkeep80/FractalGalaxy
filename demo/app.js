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
  extractMaterialInterface,
  buildSurfacePatchGeometry,
  triangulateSurfacePatchGeometry,
  makeFractalVertexDeformation,
  evaluateGeometryInfluence,
  referenceVertexKey,
  makeMemoryWorldStore,
  ringRecordState,
  ringIdsForPhysicalParent,
  validateWorldStore,
  makeProceduralRef,
  applyVertexInfluence,
  splitGeometryFractalRing,
  ringVertexWorldPosition,
  worldGeometryOffsets,
  worldStoreStats,
  geometryVertexOffsets,
  assembleProvenSurfaceMesh,
  octreePathsAtDepth,
  extractDiscoveredRegionalMaterialInterfaces,
  assembleRegionalSurfaceMesh,
  buildCanonicalTopologyLines,
  buildCanonicalTopologyGrid
} from './src/fractal-matter.mjs';
import {paintProvenSurface,proofGapBoundaryVertices} from './studio-surface-renderer.mjs';
import {editableFaceVertices,cameraPlaneDrag,pickFaceVertex} from './studio-vertex-editor.mjs';
import {createStudioHierarchyUI} from './studio-tree.mjs';
import { pickReferenceCube, centerOfPath, parentPath, childPath, formatPath } from './studio-picking.mjs';
import { localeFor, translate, validateTranslations } from './studio-i18n.mjs';

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
  deformBlend: $('deformBlend'),
  rndAmplitude: $('rndAmplitude'),
  smoothingWeight: $('smoothingWeight'),
  influenceMagnitude: $('influenceMagnitude'),
  influenceThreshold: $('influenceThreshold'),
  influenceCompliance: $('influenceCompliance'),
  showTriangulation: $('showTriangulation'),
  showReferenceGrid: $('showReferenceGrid')
};

const versionBadge=$('version');
versionBadge.textContent=E0_VERSION;

async function renderProjectVersion(){
  try{
    const response=await fetch('./version.json',{cache:'no-store'});
    if(!response.ok)throw new Error('HTTP '+response.status);
    const payload=await response.json();
    const projectVersion=payload?.version;
    if(!/^\d+\.\d+\.\d+$/.test(projectVersion??'')){
      throw new Error('invalid project version');
    }
    versionBadge.dataset.projectVersion=projectVersion;
    versionBadge.textContent='v'+projectVersion+' · '+E0_VERSION;
  }catch(error){
    versionBadge.dataset.projectVersion='';
    versionBadge.textContent=E0_VERSION;
    versionBadge.title='Project version unavailable: '+error.message;
  }
}
void renderProjectVersion();

let selectedPoint = [0, 0, 0];
let activeLocale = localeFor({ saved: readSavedLanguage(), languages: navigator.languages ?? [navigator.language] });
function readSavedLanguage() { try { return localStorage.getItem('fractalgalaxy.locale'); } catch { return null; } }
const tr = key => translate(activeLocale, key);

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

  // 2D and 3D views share one canonical selected cell.
  const path = addressForPoint(selectedPoint, Number(lab.probeDepth.value)).path;
  const bounds = octreeBoundsForPath(path);
  const px = (bounds.min[0] + 1) * canvas.width / 2;
  const py = (1 - bounds.max[1]) * canvas.height / 2;
  const w = (bounds.max[0] - bounds.min[0]) * canvas.width / 2;
  const h = (bounds.max[1] - bounds.min[1]) * canvas.height / 2;
  ctx.strokeStyle = 'rgba(255,235,144,.96)';
  ctx.lineWidth = 2;
  ctx.strokeRect(px + 1, py + 1, Math.max(0,w-2), Math.max(0,h-2));
  const markerX = (selectedPoint[0] + 1) * canvas.width / 2;
  const markerY = (1 - selectedPoint[1]) * canvas.height / 2;
  ctx.strokeStyle = 'rgba(255,255,255,.95)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(markerX-6, markerY); ctx.lineTo(markerX+6, markerY);
  ctx.moveTo(markerX, markerY-6); ctx.lineTo(markerX, markerY+6);
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
      ['#43d5ff', tr('studio.legend.left')],
      ['#ffaf4a', tr('studio.legend.rightBottom')],
      ['#e15cff', tr('studio.legend.rightTop')],
      ['#06101a', tr('studio.media.EMPTY')]
    ].map(([c,t]) => `<span style="--swatch:${c}">${t}</span>`).join('');
  } else {
    legend.innerHTML = [
      ['#58d7a9', tr('studio.media.SOLID')],
      ['#06101a', tr('studio.media.EMPTY')]
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
  if (value.kind === 'SOLID') return `${tr('studio.media.SOLID')}(${value.materialId}, ρ=${value.density})`;
  if (value.kind === 'EMPTY') return tr('studio.media.EMPTY');
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
  // A selection changes both inspector and 2D selection overlay.
  // Re-render the owning view instead of updating only the downstream 3D scene.
  renderMaterialView();
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
let studioUi = null;
let studioTreeUi = null;
// E0 material Split is not a FractalRing overlay. No persistent rings are invented for display.
let demoWorldStore = makeMemoryWorldStore({resident:'none'});
let selectedVertexReference=null;
let activeImpactRingId=null;
let lastInfluenceResult=null;
let currentSurfaceExtraction = { present: [], unresolved: [], stats: { visitedPairs: 0 } };
let currentSurfaceMesh = { reference: null, deformed: null };
let currentRegionalExtraction = { faces: [], present: [], unresolved: [], stats: { facePairs: 0 } };
let currentRegionalMesh = { reference: null, deformed: null };
let studioSurfaceMode = 'surface';
const SURFACE_TESSELLATION_DEPTH=1;
const REGIONAL_CELL_DEPTH=2;
const REGIONAL_MAX_DEPTH=5;

function classificationFor(value) {
  return value === 'MIXED' ? mixedVolume() : homogeneousVolume(value);
}

function mediumLabel(medium) {
  if (medium === 'EMPTY') return tr('studio.media.EMPTY');
  const match = /^SOLID:([^:]+):(.+)$/.exec(medium ?? '');
  if (!match) return String(medium);
  const id = match[1].toUpperCase();
  return `${id === 'ROCK' || id === 'ICE' ? tr('studio.media.' + id) : match[1]} ρ=${match[2]}`;
}

function classificationLabel(result) {
  const classification = result.classification ?? result;
  return classification.kind === 'HOMOGENEOUS'
    ? `${tr('studio.classification.homogeneous')} · ${mediumLabel(classification.medium)}`
    : tr('studio.classification.mixed');
}

function refinementLabel(result) {
  if (!result?.stats) return tr('studio.refinement.manual');
  return `${tr('studio.refinement.nodes')}=${result.stats.inspectedNodes}, ${tr('studio.refinement.depth')}=${result.stats.deepestDepth}`;
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

function baseGeometryDeformation(point) {
  const blend = Number(lab.deformBlend.value);
  const sphere = cubeToSphereDeformation(point);
  return point.map((value, i) => value + (sphere[i] - value) * blend);
}

function currentImpact() {
  const probe = currentProbeContext();
  const reference = facePointForBounds(probe.boundsA, probe.axis, probe.side, -1, -1);
  const normal = probe.axis === 'x'
    ? [probe.side, 0, 0]
    : probe.axis === 'y'
      ? [0, probe.side, 0]
      : [0, 0, probe.side];
  const magnitude = Number(lab.influenceMagnitude.value);
  const result = evaluateGeometryInfluence(
    normal.map(value => value * magnitude),
    {
      threshold: Number(lab.influenceThreshold.value),
      compliance: Number(lab.influenceCompliance.value)
    }
  );
  return { reference, result };
}

function studioGeometrySource(path=currentProbeContext().pathA) {
  return makeProceduralRef({
    rootId:'studio-e0',address:path,
    algorithmId:'e0',algorithmVersion:E0_VERSION
  });
}
function persistentVertexOffsets() {
  return worldGeometryOffsets(demoWorldStore,studioGeometrySource());
}
function plusOffsets(offsets,reference,delta) {
  const key=referenceVertexKey(reference);
  const existing=offsets[key]??[0,0,0];
  offsets[key]=existing.map((v,i)=>v+delta[i]);
}
function currentVertexDeformation() {
  const impact=currentImpact();
  const interactionOffsets={...persistentVertexOffsets()};
  if(impact.result.active)plusOffsets(interactionOffsets,impact.reference,impact.result.offset);
  if(drag?.kind==='vertex' && drag.influence) {
    const preview=evaluateGeometryInfluence(drag.influence,{
      threshold:Number(lab.influenceThreshold.value),
      compliance:Number(lab.influenceCompliance.value)
    });
    if(preview.active)plusOffsets(interactionOffsets,drag.reference,preview.offset);
  }
  return makeFractalVertexDeformation({
    baseDeformation:baseGeometryDeformation,
    seed:parseSeed(),
    randomAmplitude:Number(lab.rndAmplitude.value),
    smoothingWeight:Number(lab.smoothingWeight.value),
    smoothingTarget:({basePosition})=>basePosition,
    interactionOffsets
  });
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
  return deformed ? currentVertexDeformation()(point) : point;
}

function canonicalReferenceDepth(reference) {
  for (let depth = 0; depth <= REGIONAL_MAX_DEPTH; depth++) {
    const step = 2 / (2 ** depth);
    if (reference.every(value => {
      const coordinate = (value + 1) / step;
      return Math.abs(coordinate - Math.round(coordinate)) < 1e-9;
    })) return depth;
  }
  return REGIONAL_MAX_DEPTH;
}

function canonicalKeyDepth(key) {
  const reference = String(key).split(',').map(Number);
  return reference.length === 3 && reference.every(Number.isFinite)
    ? canonicalReferenceDepth(reference)
    : 0;
}

function regionalSamplingTargetDepth(probe, extraction) {
  const proofDepth = Math.max(
    0,
    ...(extraction.present ?? []).map(item => item.depth ?? 0),
    ...(extraction.unresolved ?? []).map(item => item.depth ?? 0),
    ...(extraction.unresolvedCells ?? []).map(item => item.path?.length ?? 0)
  );
  const persistedDepth = Math.max(
    0,
    ...Object.keys(persistentVertexOffsets()).map(canonicalKeyDepth)
  );
  const previewDepth = drag?.kind === 'vertex'
    ? canonicalReferenceDepth(drag.reference)
    : 0;
  const editableDepth = $('studioVertexEdit')?.checked
    ? Math.min(REGIONAL_MAX_DEPTH, probe.depth + 1)
    : 0;
  return Math.max(proofDepth, persistedDepth, previewDepth, editableDepth);
}

function topologyDisplayDepth() {
  return Math.min(REGIONAL_MAX_DEPTH, currentProbeContext().depth + 1);
}

function topologySpatialStep() {
  return 2 / (2 ** topologyDisplayDepth());
}

function topologyLineSubdivisions(a,b) {
  const span=Math.max(...a.map((value,index)=>Math.abs(b[index]-value)));
  return Math.max(1,Math.round(span/topologySpatialStep()));
}

function drawCanonicalTopologyLines(
  context,
  canvasElement,
  lines,
  { deformed = false, stroke = 'rgba(121,150,174,.30)', width = 1, subdivisions = null, dash = [] } = {}
) {
  const topologyLines=lines.map(line=>({
    ...line,
    subdivisions:subdivisions??topologyLineSubdivisions(line.a,line.b)
  }));
  const topology = buildCanonicalTopologyLines({
    lines:topologyLines,
    subdivisions:subdivisions??1,
    deformation: deformed ? currentVertexDeformation() : point => point
  });
  context.save();
  context.strokeStyle = stroke;
  context.setLineDash(dash);
  for (const line of topology.lines) {
    const points = line.vertexIndices.map(index => {
      const vertex = topology.vertices[index];
      return rotateProject(deformed ? vertex.position : vertex.reference, canvasElement);
    });
    context.lineWidth = line.width ?? width;
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) context.lineTo(point.x, point.y);
    context.stroke();
  }
  context.restore();
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
  const samplingDepth=topologyDisplayDepth();
  const rootSegments=Math.max(4,2**samplingDepth);
  const grid=buildCanonicalTopologyGrid({
    steps:4,
    curveSubdivisions:rootSegments/4,
    deformation:deformed?currentVertexDeformation():point=>point
  });
  context.strokeStyle='rgba(121,150,174,.30)';
  context.lineWidth=1;
  for(const line of grid.lines){
    const points=line.vertexIndices.map(index=>{
      const vertex=grid.vertices[index];
      return rotateProject(deformed?vertex.position:vertex.reference,canvasElement);
    });
    context.beginPath();
    context.moveTo(points[0].x,points[0].y);
    for(const point of points.slice(1))context.lineTo(point.x,point.y);
    context.stroke();
  }
}

function drawBox(
  context, canvasElement, bounds, deformed,
  stroke = 'rgba(118,174,210,.46)', width = 1.2, dash = []
) {
  const corners = [];
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) corners.push([x,y,z]);
    }
  }
  const lines = [];
  for (let i = 0; i < corners.length; i++) {
    for (let j = i + 1; j < corners.length; j++) {
      const diff = corners[i].filter((value, axis) => value !== corners[j][axis]).length;
      if (diff === 1) lines.push({a:corners[i],b:corners[j]});
    }
  }
  drawCanonicalTopologyLines(context, canvasElement, lines, {
    deformed, stroke, width, dash
  });
}

function drawSurfacePatch(context, canvasElement, bounds, axis, side, patch, deformed, fill, stroke, triangulate = false) {
  const geometry = buildSurfacePatchGeometry({
    bounds,
    axis,
    side,
    patch,
    deformation: deformed ? currentVertexDeformation() : point => point
  });
  const sourceVertices = deformed ? geometry.deformedVertices : geometry.referenceVertices;
  const points = sourceVertices.map(point => rotateProject(point, canvasElement));

  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) context.lineTo(points[i].x, points[i].y);
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = stroke;
  context.lineWidth = 1.4;
  context.stroke();

  if (triangulate && lab.showTriangulation.checked) {
    const mesh = triangulateSurfacePatchGeometry(geometry);
    const [a, b] = mesh.diagonal;
    context.strokeStyle = 'rgba(215, 255, 241, .72)';
    context.lineWidth = 1;
    context.setLineDash([4, 3]);
    context.beginPath();
    context.moveTo(points[a].x, points[a].y);
    context.lineTo(points[b].x, points[b].y);
    context.stroke();
    context.setLineDash([]);
  }
}

function drawExtractedSurface(context, canvasElement, bounds, axis, side, deformed) {
  for (const item of currentSurfaceExtraction.present ?? []) {
    drawSurfacePatch(
      context, canvasElement, bounds, axis, side, item.patch, deformed,
      'rgba(71, 231, 177, .20)', 'rgba(93, 244, 193, .88)', true
    );
  }
  for (const item of currentSurfaceExtraction.unresolved ?? []) {
    drawSurfacePatch(
      context, canvasElement, bounds, axis, side, item.patch, deformed,
      'rgba(255, 178, 74, .16)', 'rgba(255, 190, 91, .88)', false
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
    drawBox(context, canvasElement, probe.boundsB, deformed, 'rgba(128,160,246,.48)', 1);
  }

  const selectedGridLines = [];
  for (const t of [-1, 0, 1]) {
    selectedGridLines.push({
      a:facePointForBounds(boundsA, axis, side, -1, t),
      b:facePointForBounds(boundsA, axis, side, 1, t),
      width:t === 0 ? 2.2 : 1.7
    });
    selectedGridLines.push({
      a:facePointForBounds(boundsA, axis, side, t, -1),
      b:facePointForBounds(boundsA, axis, side, t, 1),
      width:t === 0 ? 2.2 : 1.7
    });
  }
  drawCanonicalTopologyLines(context, canvasElement, selectedGridLines, {
    deformed,
    stroke
  });

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
  context.save();
  context.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  context.textAlign = 'start';
  context.textBaseline = 'alphabetic';
  for (const [a,b,label] of axes) {
    drawLine(context, canvasElement, a, b, { deformed: false, stroke: 'rgba(255,255,255,.24)', width: 1 });
    const p = rotateProject(b, canvasElement);
    context.fillStyle = '#637b90';
    context.fillText(label, p.x + 4, p.y - 4);
  }
  context.restore();
}

function drawContextHierarchy(context, canvasElement, deformed) {
  const path = currentProbeContext().pathA;
  for (let depth = 0; depth < path.length; depth++) {
    const bounds = octreeBoundsForPath(path.slice(0, depth), { min:-1, max:1 });
    drawBox(context, canvasElement, bounds, deformed,
      `rgba(90,132,158,${(0.14 + 0.04*depth).toFixed(3)})`, 1);
  }
}

function selectedFaceHandles() {
  const probe=currentProbeContext();
  return editableFaceVertices(probe.boundsA,probe.axis,probe.side,referenceVertexKey);
}
function drawEditableVertices(context,canvasElement) {
  if(!$('studioVertexEdit')?.checked)return;
  const deformation=currentVertexDeformation();
  for(const vertex of selectedFaceHandles()){
    const projected=rotateProject(deformation(vertex.reference),canvasElement);
    const selected=selectedVertexReference&&referenceVertexKey(selectedVertexReference)===vertex.key;
    context.fillStyle=selected?'#ffe3a1':'#84d8fa';
    context.strokeStyle=selected?'#ffad4b':'#123247';
    context.lineWidth=2;
    context.beginPath();
    context.arc(projected.x,projected.y,selected?7:5,0,2*Math.PI);
    context.fill();context.stroke();
  }
}
function nearestEditableVertex(canvasElement,x,y) {
  const deformation=currentVertexDeformation();
  return pickFaceVertex({
    x,y,vertices:selectedFaceHandles(),
    project:reference=>rotateProject(deformation(reference),canvasElement),
    tolerance:14
  });
}
function updateVertexInspector() {
  const state=$('studioVertexState');
  if(!state)return;
  const count=worldStoreStats(demoWorldStore).persisted;
  $('studioRingCount').textContent=String(count);
  $('studioVertexKey').textContent=selectedVertexReference?referenceVertexKey(selectedVertexReference):'—';
  state.textContent=lastInfluenceResult===null
    ? tr('studio.vertex.ready')
    : lastInfluenceResult.active?tr('studio.vertex.persisted'):tr('studio.vertex.blocked');
  const ring=activeImpactRingId&&demoWorldStore.records[activeImpactRingId];
  $('studioSplitRing').disabled=!ring||
    Object.keys(geometryVertexOffsets(ring)).length===0||
    ringIdsForPhysicalParent(demoWorldStore,activeImpactRingId).length>0;
}

function drawProofGaps(context,canvasElement,bounds,axis,side,deformed){
  const deform=deformed?currentVertexDeformation():point=>point;
  context.save();
  context.lineWidth=2;
  context.setLineDash([6,5]);
  context.strokeStyle='#f3b35c';
  // No fill. Boundary sampling matches the proven mesh tessellation but
  // never creates unresolved quads/triangles or changes material proof.
  for(const item of currentSurfaceExtraction.unresolved){
    const boundary=proofGapBoundaryVertices({
      bounds,axis,side,patch:item.patch,deformation:deform,
      tessellationDepth:SURFACE_TESSELLATION_DEPTH
    });
    const projected=boundary
      .map(vertex=>rotateProject(deformed?vertex.position:vertex.reference,canvasElement));
    context.beginPath();
    context.moveTo(projected[0].x,projected[0].y);
    for(const p of projected.slice(1))context.lineTo(p.x,p.y);
    context.closePath();
    context.stroke();
  }
  context.restore();
}
function drawProofSurface(context,canvasElement,deformed){
  const probe=currentProbeContext();
  const mesh=deformed?currentSurfaceMesh.deformed:currentSurfaceMesh.reference;
  if(!mesh)return;
  drawBox(context,canvasElement,probe.boundsA,deformed,'rgba(84,141,160,.25)',.8);
  paintProvenSurface(context,mesh,point=>rotateProject(point,canvasElement),{deformed});
  drawProofGaps(context,canvasElement,probe.boundsA,probe.axis,probe.side,deformed);
}
function drawRegionalProofGaps(context,canvasElement,deformed){
  const deform=deformed?currentVertexDeformation():point=>point;
  const mesh=deformed?currentRegionalMesh.deformed:currentRegionalMesh.reference;
  const targetDepth=mesh?.stats.targetDepth??0;
  context.save();
  context.lineWidth=1.8;
  context.setLineDash([6,5]);
  context.strokeStyle='#f3b35c';
  for(const item of currentRegionalExtraction.unresolved){
    const bounds=octreeBoundsForPath(item.pathA,{min:-1,max:1});
    const tessellationDepth=targetDepth-item.depth;
    if(!Number.isInteger(tessellationDepth)||tessellationDepth<0||tessellationDepth>4){
      throw new Error('regional proof-gap sampling must match the regional mesh target depth');
    }
    const boundary=proofGapBoundaryVertices({
      bounds,axis:item.axis,side:item.side,patch:makeReferenceFacePatch(),
      deformation:deform,tessellationDepth
    });
    const points=boundary.map(vertex=>rotateProject(deformed?vertex.position:vertex.reference,canvasElement));
    context.beginPath();context.moveTo(points[0].x,points[0].y);
    for(const point of points.slice(1))context.lineTo(point.x,point.y);
    context.closePath();context.stroke();
  }
  context.restore();
  for(const cell of currentRegionalExtraction.unresolvedCells??[]){
    drawBox(
      context,canvasElement,octreeBoundsForPath(cell.path,{min:-1,max:1}),deformed,
      '#f3b35c',1.2,[4,4]
    );
  }
}
function drawRegionalProofSurface(context,canvasElement,deformed){
  const mesh=deformed?currentRegionalMesh.deformed:currentRegionalMesh.reference;
  if(!mesh)return;
  paintProvenSurface(context,mesh,point=>rotateProject(point,canvasElement),{deformed});
  drawRegionalProofGaps(context,canvasElement,deformed);
}
function surfaceProofLabel(mesh){
  if(!mesh)return '—';
  const unresolved=(mesh.stats.unresolvedPatches??0)+(mesh.stats.unresolvedCells??0);
  if(unresolved){
    return mesh.stats.provenPatches
      ? tr('studio.surface.partial')
      : tr('studio.surface.undetermined');
  }
  return mesh.stats.provenPatches
    ? tr('studio.surface.proven')
    : tr('studio.surface.absent');
}
function refreshSurfaceDisplayInfo(){
  const regional=studioSurfaceMode==='regional';
  const mesh=regional?currentRegionalMesh.deformed:currentSurfaceMesh.deformed;
  if(!mesh)return;
  $('studioSurfaceStatus').textContent=surfaceProofLabel(mesh);
  $('studioMeshTriangles').textContent=String(mesh.triangles.length);
  $('studioMeshVertices').textContent=String(mesh.vertices.length);
  if($('studioRegionalFaces'))$('studioRegionalFaces').textContent=String(currentRegionalExtraction.stats.facePairs??0);
  if($('studioRegionalUnresolved'))$('studioRegionalUnresolved').textContent=String(
    currentRegionalExtraction.unresolved.length+(currentRegionalExtraction.unresolvedCells?.length??0)
  );
}

function drawGeometry(canvasElement, deformed) {
  const context = canvasElement.getContext('2d');
  context.clearRect(0, 0, canvasElement.width, canvasElement.height);
  context.save();
  try {

  const gradient = context.createRadialGradient(
    canvasElement.width * .48, canvasElement.height * .42, 10,
    canvasElement.width * .48, canvasElement.height * .42, canvasElement.width * .55
  );
  gradient.addColorStop(0, '#0b1a25');
  gradient.addColorStop(1, '#03090f');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvasElement.width, canvasElement.height);

  if(lab.showReferenceGrid.checked)drawCubeGrid(context,canvasElement,deformed);
  else if(studioSurfaceMode==='debug')drawContextHierarchy(context,canvasElement,deformed);
  if(studioSurfaceMode==='surface')drawProofSurface(context,canvasElement,deformed);
  else if(studioSurfaceMode==='regional')drawRegionalProofSurface(context,canvasElement,deformed);
  else drawSelectedFace(context,canvasElement,deformed);
  drawAxes(context,canvasElement,deformed);
  if(deformed)drawEditableVertices(context,canvasElement);
  } finally {
    context.restore();
  }
}

function describeInterface(result) {
  if (result.kind === 'NONE') return `${tr('studio.interface.none')} · ${mediumLabel(result.medium)}`;
  if (result.kind === 'PRESENT') return `${tr('studio.interface.present')} · ${mediumLabel(result.leftMedium)} ↔ ${mediumLabel(result.rightMedium)}`;
  return tr('studio.interface.refine');
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
  $('neighborCell').textContent = pathB ? '[' + pathB.join(',') + ']' : `${tr('studio.outside')} → ${tr('studio.media.EMPTY')}`;
  $('classificationA').textContent = classificationLabel(aResult);
  $('classificationB').textContent = classificationLabel(bResult);
  $('refinementA').textContent = refinementLabel(aResult);
  $('refinementB').textContent = bResult.outsideDomain ? tr('studio.outside') : refinementLabel(bResult);
  $('incidentA').textContent = '[' + incidentA.join(', ') + ']';
  $('incidentB').textContent = '[' + incidentB.join(', ') + ']';
  $('surfacePatches').textContent = String(patches.length);
  $('presentPatches').textContent = String(currentSurfaceExtraction.present.length);
  $('unresolvedPatches').textContent = String(currentSurfaceExtraction.unresolved.length);
  $('visitedPairs').textContent = String(currentSurfaceExtraction.stats.visitedPairs ?? 0);
  $('interfaceDecision').textContent = describeInterface(rootDecision);
  $('deformOut').value = Math.round(Number(lab.deformBlend.value) * 100) + '%';
  $('rndOut').value = Number(lab.rndAmplitude.value).toFixed(3);
  $('smoothOut').value = Math.round(Number(lab.smoothingWeight.value) * 100) + '%';
  $('influenceOut').value = Number(lab.influenceMagnitude.value).toFixed(3);
  $('thresholdOut').value = Number(lab.influenceThreshold.value).toFixed(3);
  $('complianceOut').value = Number(lab.influenceCompliance.value).toFixed(2);
  const impact = currentImpact();
  $('impactGate').textContent = impact.result.active
    ? `${tr('studio.impact.active')} · ${tr('studio.impact.excess')}=${impact.result.excess.toFixed(3)}`
    : tr('studio.impact.blocked');
  $('impactOffset').textContent = '[' + impact.result.offset.map(value => value.toFixed(3)).join(', ') + ']';

  const geometryOptions={
    extraction:currentSurfaceExtraction,bounds:probe.boundsA,axis,side,
    // Geometric-only 2×2 sampling includes the central editable face vertex.
    // Does not materialize new material patches or expand unresolved regions.
    tessellationDepth:SURFACE_TESSELLATION_DEPTH
  };
  currentSurfaceMesh={
    reference:assembleProvenSurfaceMesh({...geometryOptions}),
    deformed:assembleProvenSurfaceMesh({...geometryOptions,deformation:currentVertexDeformation()})
  };
  if(live){
    currentRegionalExtraction=extractDiscoveredRegionalMaterialInterfaces(model.root,{
      cellPaths:octreePathsAtDepth(REGIONAL_CELL_DEPTH),
      maxDepth:REGIONAL_MAX_DEPTH,
      outsideMedium:'EMPTY'
    });
    const regionalTargetDepth=regionalSamplingTargetDepth(probe,currentRegionalExtraction);
    currentRegionalMesh={
      reference:assembleRegionalSurfaceMesh({
        extraction:currentRegionalExtraction,
        targetDepth:regionalTargetDepth
      }),
      deformed:assembleRegionalSurfaceMesh({
        extraction:currentRegionalExtraction,
        deformation:currentVertexDeformation(),
        targetDepth:regionalTargetDepth
      })
    };
  }else{
    currentRegionalExtraction={faces:[],present:[],unresolved:[],stats:{facePairs:0}};
    currentRegionalMesh={
      reference:assembleRegionalSurfaceMesh({extraction:currentRegionalExtraction}),
      deformed:assembleRegionalSurfaceMesh({extraction:currentRegionalExtraction,deformation:currentVertexDeformation()})
    };
  }
  refreshSurfaceDisplayInfo();

  const finalKind = currentSurfaceExtraction.unresolved.length > 0
    ? 'REFINE'
    : currentSurfaceExtraction.present.length > 0
      ? 'PRESENT'
      : 'NONE';
  const badge = $('interfaceBadge');
  badge.dataset.kind = finalKind;
  badge.textContent = tr('studio.status.' + finalKind);
  badge.className = 'interface-badge ' + finalKind.toLowerCase();

  drawGeometry(referenceCanvas, false);
  drawGeometry(deformedCanvas, true);
  syncStudioSelection(probe);
  updateVertexInspector();
}

for (const input of Object.values(lab)) {
  input.addEventListener(input.type === 'range' ? 'input' : 'change', renderGeometryLab);
}

function attachCameraControls(canvasElement) {
  canvasElement.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    const rect=canvasElement.getBoundingClientRect();
    if(canvasElement===deformedCanvas && $('studioVertexEdit')?.checked){
      const hit=nearestEditableVertex(canvasElement,
        (event.clientX-rect.left)*canvasElement.width/rect.width,
        (event.clientY-rect.top)*canvasElement.height/rect.height);
      if(hit){
        canvasElement.setPointerCapture(event.pointerId);
        selectedVertexReference=[...hit.reference];
        drag={kind:'vertex',id:event.pointerId,reference:[...hit.reference],
          source:studioGeometrySource(),startX:event.clientX,startY:event.clientY,
          influence:[0,0,0],moved:false};
        renderGeometryLab();
        return;
      }
    }
    canvasElement.setPointerCapture(event.pointerId);
    drag={kind:'camera',id:event.pointerId,startX:event.clientX,startY:event.clientY,
      x:event.clientX,y:event.clientY,moved:false};
  });

  canvasElement.addEventListener('pointermove',event=>{
    if(!drag || drag.id!==event.pointerId)return;
    if(drag.kind==='vertex'){
      const rect=canvasElement.getBoundingClientRect();
      const dx=(event.clientX-drag.startX)*canvasElement.width/rect.width;
      const dy=(event.clientY-drag.startY)*canvasElement.height/rect.height;
      drag.influence=cameraPlaneDrag(dx,dy,camera,canvasElement.width,canvasElement.height);
      drag.moved=Math.hypot(dx,dy)>0;
      renderGeometryLab();
      return;
    }
    if(Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)>5)drag.moved=true;
    if(!drag.moved)return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    drag.x=event.clientX;drag.y=event.clientY;
    camera.yaw+=dx*.01;
    camera.pitch=Math.max(-1.35,Math.min(1.35,camera.pitch+dy*.01));
    renderGeometryLab();
  });

  canvasElement.addEventListener('pointerup',event=>{
    if(!drag || drag.id!==event.pointerId)return;
    const completed=drag;
    drag=null;
    if(completed.kind==='vertex'){
      if(completed.moved){
        const outcome=applyVertexInfluence(demoWorldStore,{
          source:completed.source,reference:completed.reference,
          influence:completed.influence,
          threshold:Number(lab.influenceThreshold.value),
          compliance:Number(lab.influenceCompliance.value)
        });
        demoWorldStore=outcome.store;
        lastInfluenceResult=outcome.result;
        if(outcome.updated.length){
          activeImpactRingId=outcome.created[0]??outcome.updated[0];
          studioTreeUi?.onStoreChanged({source:completed.source,
            ringId:activeImpactRingId,
            physicalParentId:demoWorldStore.records[activeImpactRingId]?.physicalParentId});
          studioTreeUi?.open('impact');
        }
      }
      renderGeometryLab();
      return;
    }
    const wasClick=!completed.moved&&
      Math.hypot(event.clientX-completed.startX,event.clientY-completed.startY)<=5;
    if(wasClick && canvasElement===referenceCanvas){
      const rect=canvasElement.getBoundingClientRect();
      const hit=pickReferenceCube({
        x:(event.clientX-rect.left)*canvasElement.width/rect.width,
        y:(event.clientY-rect.top)*canvasElement.height/rect.height,
        width:canvasElement.width,height:canvasElement.height,camera
      });
      if(hit){
        const path=addressForPoint(hit.inside,Number(lab.probeDepth.value)).path;
        selectStudioPath(path,hit.axis,hit.side);
      }
    }
  });
  canvasElement.addEventListener('pointercancel',event=>{
    if(drag?.id===event.pointerId){
      drag=null;renderGeometryLab();
    }
  });

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

function createStudioWorkspace() {
  const grid = document.querySelector('.lab-grid');
  const referencePanel = referenceCanvas.closest('.geometry-view');
  const deformedPanel = deformedCanvas.closest('.geometry-view');
  const views = document.createElement('section');
  views.className = 'studio-views';
  views.dataset.mode = 'reference';
  views.innerHTML = `
    <div class="studio-toolbar">
      <div class="studio-view-modes" role="group" aria-label="Viewport mode">
        <button type="button" data-view="reference">Каркас</button>
        <button type="button" data-view="deformed">Деформация</button>
        <button type="button" data-view="split">Сравнение</button>
      </div>
      <div class="studio-surface-modes" role="group" aria-label="Режим поверхности">
        <button type="button" data-surface-mode="surface">Поверхность</button>
        <button type="button" data-surface-mode="regional">Регион</button>
        <button type="button" data-surface-mode="debug">Диагностика</button>
      </div>
      <label class="studio-language"><span>Язык интерфейса</span>
        <select id="studioLanguage" aria-label="Язык интерфейса"><option value="ru">Русский</option><option value="en">English</option></select>
      </label>
    </div>
    <div class="studio-vertex-toolbar">
      <label><input type="checkbox" id="studioVertexEdit">
        <span id="studioVertexEditLabel">Редактировать вершины</span></label>
      <button type="button" id="studioSplitRing" disabled>Разделить кольцо</button>
      <span id="studioVertexState" role="status"></span>
    </div>
    <div class="studio-surface-legend">
      <span class="studio-swatch-proven" id="studioLegendProven">Доказанная поверхность</span>
      <span class="studio-swatch-unresolved" id="studioLegendUnresolved">Не определено</span>
      <strong id="studioSurfaceStatus" role="status">—</strong>
    </div>
    <div class="studio-viewports"></div>
    <p class="studio-picking-help" id="studioPickingHelp"></p>
  `;
  grid.insertBefore(views, referencePanel);
  const viewports = views.querySelector('.studio-viewports');
  viewports.append(referencePanel, deformedPanel);

  const inspector = document.createElement('section');
  inspector.className = 'panel studio-inspector';
  inspector.innerHTML = `
    <h3 id="studioInspectorHeading">Инспектор</h3>
    <dl class="studio-selection">
      <div><dt id="studioLevelLabel">Уровень</dt><dd id="studioLevel">—</dd></div>
      <div><dt id="studioPathLabel">Octree-адрес</dt><dd id="studioPath">—</dd></div>
      <div><dt id="studioFaceLabel">Грань</dt><dd id="studioFace">—</dd></div>
    </dl>
    <nav id="studioBreadcrumbs" class="studio-breadcrumbs" aria-label="Octree breadcrumb"></nav>
    <div class="studio-navigation">
      <button type="button" id="studioParent">↑ Родитель</button>
      <label><span id="studioChildLabel">Дочерняя область</span>
        <select id="studioChildOctant" aria-label="Child octant">
          ${Array.from({length:8}, (_,i)=>`<option value="${i}">${i}</option>`).join('')}
        </select>
      </label>
      <button type="button" id="studioChildButton" aria-label="Enter selected octant">↓</button>
    </div>
    <div class="studio-vertex-readout">
      <span id="studioVertexKeyLabel">Вершина</span>
      <output id="studioVertexKey">—</output>
      <span id="studioRingCountLabel">Колец</span>
      <output id="studioRingCount">0</output>
    </div>
    <div class="studio-mesh-readout">
      <span id="studioTrianglesLabel">Треугольников</span>
      <output id="studioMeshTriangles">0</output>
      <span id="studioVerticesLabel">Канонических вершин</span>
      <output id="studioMeshVertices">0</output>
      <span id="studioRegionalFacesLabel">Региональных граней</span>
      <output id="studioRegionalFaces">0</output>
      <span id="studioRegionalUnresolvedLabel">Неразрешённых в регионе</span>
      <output id="studioRegionalUnresolved">0</output>
    </div>
    <h4 id="studioDiagnosticsHeading">Состояние</h4>
  `;
  inspector.append(document.querySelector('.lab-readout'));
  grid.append(inspector);
  const treeMount=document.createElement('section');
  treeMount.className='studio-tree-widget';
  inspector.insertBefore(treeMount,$('studioDiagnosticsHeading'));
  studioTreeUi=createStudioHierarchyUI({
    mount:treeMount,translate:tr,getLocale:()=>activeLocale,
    getSelectedPath:()=>currentProbeContext().pathA,
    getSelectedOwner:()=>ownerAt(buildModel(),selectedPoint).name,
    getSplitModel:buildModel,
    getWorldStore:()=>demoWorldStore,
    core:{ringRecordState,ringIdsForPhysicalParent,validateWorldStore},
    onSelectRing:id=>{activeImpactRingId=id;updateVertexInspector();},
    onSelectOctree:path=>selectStudioPath(path),
    onSelectSplit:owner=>{
      // Split leaf means a currently materialized owner, not merely the XY region.
      // For this E0 height fixture z=-0.75 is below the entire permitted height
      // interval (including Γ alpha_neighbor in [-8,8]); it is also outside D[7].
      const z=-0.75;
      selectedPoint=owner==='left'?[-0.5,0,z]:owner==='rb'?[0.5,-0.5,z]:[0.5,0.5,z];
      controls.zSlice.value=String(z);
      controls.mode.value='owners';
      renderMaterialView();
    }
  });

  const buttons = [...views.querySelectorAll('[data-view]')];
  const setMode = mode => {
    views.dataset.mode = mode;
    for (const button of buttons) {
      button.setAttribute('aria-pressed', String(button.dataset.view === mode));
    }
  };
  for (const button of buttons) button.addEventListener('click', () => setMode(button.dataset.view));
  setMode('reference');
  const renderButtons=[...views.querySelectorAll('button[data-surface-mode]')];
  const setSurfaceMode=mode=>{
    studioSurfaceMode=mode;
    views.dataset.surfaceMode=mode;
    for(const button of renderButtons){
      button.setAttribute('aria-pressed',String(button.dataset.surfaceMode===mode));
    }
    renderGeometryLab();
  };
  for(const button of renderButtons){
    button.addEventListener('click',()=>setSurfaceMode(button.dataset.surfaceMode));
  }
  // The filled proof-aware surface, not debug patches, is the default.
  studioSurfaceMode='surface';
  views.dataset.surfaceMode='surface';
  for(const button of renderButtons){
    button.setAttribute('aria-pressed',String(button.dataset.surfaceMode==='surface'));
  }
  $('studioVertexEdit').addEventListener('change',()=>{
    if($('studioVertexEdit').checked)setMode('deformed');
    renderGeometryLab();
  });
  $('studioSplitRing').addEventListener('click',()=>{
    if(!activeImpactRingId || !demoWorldStore.records[activeImpactRingId])return;
    const source=demoWorldStore.records[activeImpactRingId].source;
    const prior=worldGeometryOffsets(demoWorldStore,source);
    const result=splitGeometryFractalRing(demoWorldStore,activeImpactRingId);
    const next=worldGeometryOffsets(result.store,source);
    // A split is forbidden from altering any canonical offset.
    for(const key of Object.keys(prior)){
      if(JSON.stringify(prior[key])!==JSON.stringify(next[key]))throw Error('vertex changed during ring split: '+key);
    }
    demoWorldStore=result.store;
    // Expand every affected source branch, not only the parent prefix.
    // Source/impact trees remain sparse and display only records already in WorldStore.
    for(const id of result.created) {
      studioTreeUi?.onStoreChanged({source:demoWorldStore.records[id].source});
    }
    studioTreeUi?.onStoreChanged({source,ringId:activeImpactRingId,physicalParentId:activeImpactRingId});
    studioTreeUi?.open('physical');
    renderGeometryLab();
  });

  $('studioParent').addEventListener('click', () => {
    const parent = parentPath(currentProbeContext().pathA);
    if (parent) selectStudioPath(parent);
  });
  $('studioChildButton').addEventListener('click', () => {
    const next = childPath(currentProbeContext().pathA, Number($('studioChildOctant').value));
    if (next) selectStudioPath(next);
  });
  $('studioBreadcrumbs').addEventListener('click', event => {
    const button = event.target.closest('button[data-depth]');
    if (!button) return;
    const path = currentProbeContext().pathA.slice(0, Number(button.dataset.depth));
    selectStudioPath(path);
  });
  $('studioLanguage').value = activeLocale;
  $('studioLanguage').addEventListener('change', event => {
    activeLocale = event.target.value;
    try { localStorage.setItem('fractalgalaxy.locale', activeLocale); } catch { /* private mode */ }
    applyStudioLocale();
    renderMaterialView();
  });
  return { views, inspector };
}

function selectStudioPath(path, axis = lab.axis.value, side = Number(lab.side.value)) {
  const center = centerOfPath(path);
  selectedPoint = center;
  lab.probeDepth.value = String(path.length);
  lab.axis.value = axis;
  lab.side.value = String(side);
  controls.zSlice.value = String(center[2]);
  renderMaterialView();
}

function syncStudioSelection(probe) {
  if (!studioUi) return;
  $('studioLevel').textContent = String(probe.depth);
  $('studioPath').textContent = formatPath(probe.pathA);
  $('studioFace').textContent = probe.axis.toUpperCase() + (probe.side > 0 ? '+' : '−');
  const parent = parentPath(probe.pathA);
  $('studioParent').disabled = parent === null;
  $('studioChildButton').disabled = probe.depth >= 4;
  $('studioChildOctant').disabled = probe.depth >= 4;
  const nav = $('studioBreadcrumbs');
  nav.replaceChildren();
  for (let depth = 0; depth <= probe.depth; depth++) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.depth = String(depth);
    button.textContent = depth === 0 ? tr('studio.root') : String(probe.pathA[depth - 1]);
    button.setAttribute('aria-current', String(depth === probe.depth));
    nav.append(button);
  }
  studioTreeUi?.sync();
}

function replaceVisibleText(element, value) {
  if (!element) throw new Error('missing localized Studio element');
  // Dynamic outputs keep their nodes; long descriptions replace all old-language
  // fragments rather than leaving stale markup from the previous locale.
  if (!element.querySelector('output')) {
    element.textContent = value;
    return;
  }
  const first = [...element.childNodes].find(node => node.nodeType === 3);
  if (first) first.nodeValue = value + ' ';
  else element.prepend(document.createTextNode(value + ' '));
}

function applyStudioLocale() {
  validateTranslations();
  document.documentElement.lang = activeLocale;
  document.title = 'FractalGalaxy — ' + tr('studio.workspace');
  const direct = [
    ['studio.material', '.controls h2'],
    ['studio.slice', '.viewport-head h2'],
    ['studio.point', '.inspector h2'],
    ['studio.mass', '.inspector h2:nth-of-type(2)'],
    ['studio.heading', '.section-heading h2'],
    ['studio.subtitle', '.section-heading p'],
    ['studio.interface', '.lab-controls h3'],
    ['studio.reference', '#referenceView', '.view-label strong'],
    ['studio.reference.help', '#referenceView', '.view-label span'],
    ['studio.deformed', '#deformedView', '.view-label strong'],
    ['studio.deformed.help', '#deformedView', '.view-label span'],
    ['studio.cameraReset', '#resetCamera'],
    ['studio.reset', '#reset'],
    ['studio.picking.help', '#studioPickingHelp'],
    ['studio.helpLive', '.lab-controls .note:first-of-type'],
    ['studio.helpDrag', '.lab-controls .note:nth-of-type(2)'],
    ['studio.e0Help', '.viewport-head p'],
    ['studio.footer', 'footer span'],
    ['studio.header.eyebrow', '.hero .eyebrow'],
    ['studio.header.title', '.hero h1'],
    ['studio.header.lede', '.hero .lede'],
    ['studio.e1Label', '.section-heading .eyebrow'],
    ['studio.massHelp', '.inspector .note'],
    ['studio.footerLink', 'footer a'],
    ['studio.inspector', '#studioInspectorHeading'],
    ['studio.level', '#studioLevelLabel'],
    ['studio.path', '#studioPathLabel'],
    ['studio.face', '#studioFaceLabel'],
    ['studio.parent', '#studioParent'],
    ['studio.child', '#studioChildLabel'],
    ['studio.status', '#studioDiagnosticsHeading'],
    ['studio.language', '.studio-language span'],
    ['studio.vertex.edit', '#studioVertexEditLabel'],
    ['studio.vertex.split', '#studioSplitRing'],
    ['studio.vertex.key', '#studioVertexKeyLabel'],
    ['studio.vertex.rings', '#studioRingCountLabel'],
    ['studio.surface.triangles', '#studioTrianglesLabel'],
    ['studio.surface.vertices', '#studioVerticesLabel'],
    ['studio.surface.regionalFaces', '#studioRegionalFacesLabel'],
    ['studio.surface.regionalUnresolved', '#studioRegionalUnresolvedLabel'],
    ['studio.surface.legendProven', '#studioLegendProven'],
    ['studio.surface.legendUnresolved', '#studioLegendUnresolved']
  ];
  for (const [key, selector, descendant] of direct) {
    const el = descendant
      ? document.querySelector(selector)?.closest('.geometry-view')?.querySelector(descendant)
      : document.querySelector(selector);
    if (el) replaceVisibleText(el, tr(key));
  }
  for (const [id,key] of Object.entries({
    seed:'studio.seed',alpha:'studio.alpha',zSlice:'studio.z',
    fixture:'studio.fixture',editD:'studio.editD',mode:'studio.mode',
    interfaceSource:'studio.source',probeDepth:'studio.probeDepth',
    faceAxis:'studio.axis',faceSide:'studio.side',
    mediumA:'studio.mediumA',mediumB:'studio.mediumB',
    deformBlend:'studio.deform',rndAmplitude:'studio.rnd',
    smoothingWeight:'studio.smooth',influenceMagnitude:'studio.influence',
    influenceThreshold:'studio.threshold',influenceCompliance:'studio.compliance',
    showTriangulation:'studio.triangulation',
    showReferenceGrid:'studio.showGrid'
  })) {
    const el = $(id).closest('label').querySelector('span');
    replaceVisibleText(el, tr(key));
  }
  const readoutKeys = ['cell','neighbor','a','b','refineA','refineB','octA','octB',
    'children','proven','unresolved','visited','impact','offset','decision'];
  const names = document.querySelectorAll('.lab-readout > div > span');
  readoutKeys.forEach((key,i) => replaceVisibleText(names[i], tr('studio.readout.'+key)));
  const modeOptions = controls.mode.options;
  modeOptions[0].textContent = tr('studio.mode.matter');
  modeOptions[1].textContent = tr('studio.mode.owners');
  lab.source.options[0].textContent = tr('studio.source.live');
  lab.source.options[1].textContent = tr('studio.source.manual');
  controls.fixture.options[0].textContent = tr('studio.fixture.height');
  controls.fixture.options[1].textContent = tr('studio.fixture.solid');
  document.querySelectorAll('.studio-view-modes button').forEach(button => {
    button.textContent = tr('studio.view.' + button.dataset.view);
  });
  document.querySelector('.studio-surface-modes').setAttribute('aria-label',tr('studio.surface.group'));
  document.querySelectorAll('.studio-surface-modes button').forEach(button=>{
    button.textContent=tr('studio.surface.mode.'+button.dataset.surfaceMode);
  });
  refreshSurfaceDisplayInfo();
  document.querySelectorAll('.explain-strip div span').forEach((span,index) => {
    replaceVisibleText(span, tr('studio.explain'+(index+1)));
  });
  const labels = document.querySelectorAll('.inspector dt');
  if (labels.length >= 10) {
    replaceVisibleText(labels[0], tr('studio.coordinate'));
    replaceVisibleText(labels[1], tr('studio.path'));
    replaceVisibleText(labels[2], tr('studio.generatorState'));
    replaceVisibleText(labels[4], tr('studio.owner'));
    replaceVisibleText(labels[5], tr('studio.beforeSplit'));
    replaceVisibleText(labels[9], tr('studio.totalParts'));
  }
  $('studioLanguage').setAttribute('aria-label', tr('studio.language'));
  $('studioVertexEdit').setAttribute('aria-label',tr('studio.vertex.edit'));
  $('view').setAttribute('aria-label', tr('studio.slice'));
  $('studioBreadcrumbs').setAttribute('aria-label', tr('studio.breadcrumb'));
  $('studioChildButton').setAttribute('aria-label', tr('studio.enterChild'));
  document.querySelector('.studio-view-modes').setAttribute('aria-label', tr('studio.viewMode'));
  referenceCanvas.setAttribute('aria-label', tr('studio.reference'));
  deformedCanvas.setAttribute('aria-label', tr('studio.deformed'));
  $('interfaceBadge').setAttribute('title', tr('studio.status'));
  const probe = currentProbeContext();
  syncStudioSelection(probe);
}

studioUi = createStudioWorkspace();
applyStudioLocale();
renderMaterialView();

