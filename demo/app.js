import {
  E0_VERSION,
  EMPTY,
  addressForPoint,
  stateForPath,
  makeGamma,
  makeMaterial,
  queryMaterial,
  splitMaterial,
  integrateMass
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

function render() {
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
  input.addEventListener(input.type === 'range' ? 'input' : 'change', render);
}
controls.seed.addEventListener('change', render);

$('reset').addEventListener('click', () => {
  controls.seed.value = '0x12345678';
  controls.alpha.value = '0';
  controls.zSlice.value = '0';
  controls.fixture.value = 'height';
  controls.editD.checked = false;
  controls.mode.value = 'matter';
  render();
});

render();
