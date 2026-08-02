import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const $ = (id) => document.getElementById(id);
const viewport = $('viewport');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101820);
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
camera.position.set(3, 2, 4);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
viewport.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 2.0));
const sun = new THREE.DirectionalLight(0xffffff, 2.4); sun.position.set(4, 8, 6); scene.add(sun);
const grid = new THREE.GridHelper(20, 40, 0x536272, 0x2b3540); scene.add(grid);

const app = {
  root: null,
  sourceName: 'model.glb',
  parts: [],
  uploadedTexture: null,
  uploadedTextureInfo: null,
  quantised: null,
  wireHelpers: [],
  generatedGroupCount: 0,
};

function setStatus(message) {
  $('status').textContent = message;
  $('statusPill').textContent = message;
}

function resize() {
  const rect = viewport.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
  renderer.setSize(rect.width, rect.height, false);
}
new ResizeObserver(resize).observe(viewport); resize();

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

function clearWire() { app.wireHelpers.forEach(w => scene.remove(w)); app.wireHelpers = []; }

function clearGeneratedMaterials(part) {
  (part.generatedMaterials || []).forEach((m) => m.dispose());
  part.generatedMaterials = [];
  if (part.quantisedMap) part.quantisedMap.dispose();
  part.quantisedMap = null;
}

function clearModel() {
  clearWire();
  if (app.root) scene.remove(app.root);
  app.parts.forEach(clearGeneratedMaterials);
  app.root = null;
  app.parts = [];
  app.generatedGroupCount = 0;
  app.quantised = null;
  $('meshName').textContent = 'No model loaded';
  updateTextureMeta(); updatePaletteUI(); updateStats(); updatePreview();
}

function frameModel() {
  if (!app.root) return;
  const box = new THREE.Box3().setFromObject(app.root);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const diameter = Math.max(size.x, size.y, size.z) || 1;
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(diameter * 1.5, diameter * 0.9, diameter * 1.5));
  camera.near = Math.max(diameter / 1000, 0.001);
  camera.far = diameter * 1000;
  camera.updateProjectionMatrix();
}

function updateStats() {
  let tris = 0; app.parts.forEach(p => tris += p.faceCount);
  $('trianglesStat').textContent = tris.toLocaleString();
  $('groupsStat').textContent = app.generatedGroupCount.toLocaleString();
  $('paletteStat').textContent = (app.quantised?.palette?.length || 0).toLocaleString();
  $('meshPartsStat').textContent = app.parts.length.toLocaleString();
  const loaded = !!app.root;
  $('frameBtn').disabled = !loaded;
  $('quantiseBtn').disabled = !loaded;
  $('exportGlbBtn').disabled = !loaded || !app.generatedGroupCount;
  $('exportPngBtn').disabled = !loaded || !app.quantised;
}

function updateTextureMeta() {
  const lines = [];
  if (!app.root) { $('textureMeta').textContent = 'No model loaded.'; return; }
  if (app.uploadedTextureInfo) lines.push(`Replacement: ${app.uploadedTextureInfo.name} (${app.uploadedTextureInfo.width}×${app.uploadedTextureInfo.height})`);
  const emb = app.parts.find(p => p.embeddedTextureInfo)?.embeddedTextureInfo;
  if (emb) lines.push(`Embedded: ${emb.name} (${emb.width}×${emb.height})`);
  if (app.quantised) lines.push(`Quantised palette: ${app.quantised.palette.length} colours`);
  if (!lines.length) lines.push('No albedo texture found.');
  $('textureMeta').innerHTML = lines.join('<br>');
}

function updatePaletteUI() {
  const list = $('paletteList'); list.innerHTML = '';
  if (!app.quantised?.palette?.length) {
    list.innerHTML = '<div class="empty">Quantise the texture to see palette colours.</div>';
    const ctx = $('texturePreview').getContext('2d'); ctx.clearRect(0,0,$('texturePreview').width,$('texturePreview').height);
    return;
  }
  app.quantised.palette.forEach((rgb, i) => {
    const row = document.createElement('div'); row.className = 'paletteRow';
    const hex = `#${rgb.map(v => v.toString(16).padStart(2,'0')).join('')}`;
    const usage = app.quantised.indexCounts?.[i] || 0;
    row.innerHTML = `<div class="swatch" style="background:${hex}"></div><div><div>Palette ${i+1}</div><small>${hex}</small></div><small>${usage.toLocaleString()}</small>`;
    list.appendChild(row);
  });
  const canvas = $('texturePreview');
  const ctx = canvas.getContext('2d');
  const src = app.quantised.canvas;
  const scale = Math.min(canvas.width / src.width, canvas.height / src.height);
  const w = src.width * scale, h = src.height * scale;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, (canvas.width - w)/2, (canvas.height - h)/2, w, h);
}

function updatePreview() {
  const mode = $('previewMode').value;
  app.parts.forEach((part) => {
    if (mode === 'original') {
      part.mesh.material = part.originalMaterial;
    } else if (mode === 'quantisedTexture' && part.quantisedTexturedMaterial) {
      part.mesh.material = part.quantisedTexturedMaterial;
    } else if ((mode === 'paletteModel' || mode === 'randomGroups') && part.generatedMaterials?.length) {
      part.mesh.material = part.generatedMaterials;
    } else {
      part.mesh.material = part.originalMaterial;
    }
  });
  clearWire();
  if ($('wireToggle').checked) {
    app.root?.updateMatrixWorld(true);
    app.parts.forEach((part) => {
      const helper = new THREE.LineSegments(new THREE.WireframeGeometry(part.mesh.geometry), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28 }));
      helper.applyMatrix4(part.mesh.matrixWorld);
      scene.add(helper); app.wireHelpers.push(helper);
    });
  }
}

function parseGLB(arrayBuffer) { return new Promise((resolve, reject) => new GLTFLoader().parse(arrayBuffer, '', resolve, reject)); }

async function createTextureCanvasFromImage(image) {
  if (!image) return null;
  await image.decode?.().catch(() => {});
  const width = image.width || image.videoWidth, height = image.height || image.videoHeight;
  if (!width || !height) return null;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0, width, height);
  const imageData = ctx.getImageData(0,0,width,height);
  return { canvas, ctx, width, height, imageData };
}

function createTextureCanvasFromBitmap(bitmap) {
  const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0,0,bitmap.width,bitmap.height);
  return { canvas, ctx, width: bitmap.width, height: bitmap.height, imageData };
}

function getMeshes() {
  const meshes = []; app.root?.traverse((o) => { if (o.isMesh && o.geometry) meshes.push(o); }); return meshes;
}

function vertexKey(position, index) {
  return `${Math.round(position.getX(index)*1e5)},${Math.round(position.getY(index)*1e5)},${Math.round(position.getZ(index)*1e5)}`;
}

function buildAdjacency(position) {
  const faceCount = position.count / 3;
  const edgeMap = new Map();
  const adjacency = Array.from({ length: faceCount }, () => new Set());
  for (let face = 0; face < faceCount; face++) {
    const ids = [vertexKey(position, face*3), vertexKey(position, face*3+1), vertexKey(position, face*3+2)];
    [[0,1],[1,2],[2,0]].forEach(([a,b]) => {
      const key = ids[a] < ids[b] ? `${ids[a]}|${ids[b]}` : `${ids[b]}|${ids[a]}`;
      if (!edgeMap.has(key)) edgeMap.set(key, []);
      edgeMap.get(key).push(face);
    });
  }
  edgeMap.forEach((faces) => { for (let i=0;i<faces.length;i++) for (let j=i+1;j<faces.length;j++) { adjacency[faces[i]].add(faces[j]); adjacency[faces[j]].add(faces[i]); } });
  return adjacency;
}

async function preparePart(mesh) {
  const originalMaterial = mesh.material;
  const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  geometry.computeVertexNormals(); mesh.geometry = geometry;
  const position = geometry.attributes.position; const normal = geometry.attributes.normal; const uv = geometry.attributes.uv;
  const materials = Array.isArray(originalMaterial) ? originalMaterial : [originalMaterial];
  const embeddedTexture = materials.find(m => m?.map)?.map || null;
  const embeddedCanvas = embeddedTexture ? await createTextureCanvasFromImage(embeddedTexture.image) : null;
  return {
    mesh, originalMaterial, position, normal, uv,
    faceCount: position.count / 3,
    adjacency: buildAdjacency(position),
    embeddedTextureCanvas: embeddedCanvas,
    embeddedTextureInfo: embeddedCanvas ? { name: embeddedTexture.name || 'Embedded albedo', width: embeddedCanvas.width, height: embeddedCanvas.height } : null,
    generatedMaterials: [], quantisedTexturedMaterial: null, quantisedMap: null,
  };
}

function pixelsFromImageData(imageData) {
  const d = imageData.data, pixels = [];
  const maxSamples = 250000;
  const step = Math.max(1, Math.floor((d.length / 4) / maxSamples));
  for (let px = 0; px < d.length / 4; px += step) {
    const i = px * 4;
    if (d[i+3] < 8) continue;
    pixels.push([d[i], d[i+1], d[i+2]]);
  }
  return pixels;
}

function colourRange(pixels) {
  const min = [255,255,255], max = [0,0,0];
  pixels.forEach((p) => { for (let i=0;i<3;i++) { if (p[i] < min[i]) min[i]=p[i]; if (p[i] > max[i]) max[i]=p[i]; } });
  return [max[0]-min[0], max[1]-min[1], max[2]-min[2]];
}

function averageColour(pixels) {
  const out=[0,0,0]; if (!pixels.length) return out;
  pixels.forEach((p)=>{out[0]+=p[0]; out[1]+=p[1]; out[2]+=p[2];});
  return out.map(v => Math.round(v / pixels.length));
}

function medianCutQuantize(imageData, paletteSize) {
  const pixels = pixelsFromImageData(imageData);
  let boxes = [{ pixels }];
  while (boxes.length < paletteSize) {
    boxes.sort((a,b) => {
      const ra = colourRange(a.pixels), rb = colourRange(b.pixels);
      return Math.max(...rb) - Math.max(...ra);
    });
    const box = boxes.shift();
    if (!box || box.pixels.length <= 1) { if (box) boxes.push(box); break; }
    const ranges = colourRange(box.pixels);
    const channel = ranges.indexOf(Math.max(...ranges));
    box.pixels.sort((p1,p2)=>p1[channel]-p2[channel]);
    const mid = Math.floor(box.pixels.length / 2);
    boxes.push({ pixels: box.pixels.slice(0, mid) }, { pixels: box.pixels.slice(mid) });
    if (boxes.every(b => b.pixels.length <= 1)) break;
  }
  const palette = boxes.map(b => averageColour(b.pixels));
  return applyPalette(imageData, palette);
}

function nearestPaletteIndexRGB(rgb, palette) {
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const dr = rgb[0]-p[0], dg = rgb[1]-p[1], db = rgb[2]-p[2];
    const d = dr*dr + dg*dg + db*db;
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

function applyPalette(imageData, palette) {
  const width = imageData.width, height = imageData.height;
  const src = imageData.data;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const out = ctx.createImageData(width, height);
  const indexMap = new Uint16Array(width * height);
  const counts = new Uint32Array(palette.length);
  for (let i = 0, px = 0; i < src.length; i += 4, px++) {
    if (src[i+3] < 8) { out.data[i+3] = 0; continue; }
    const idx = nearestPaletteIndexRGB([src[i], src[i+1], src[i+2]], palette);
    indexMap[px] = idx; counts[idx]++;
    const p = palette[idx];
    out.data[i] = p[0]; out.data[i+1] = p[1]; out.data[i+2] = p[2]; out.data[i+3] = src[i+3];
  }
  ctx.putImageData(out, 0, 0);
  return { canvas, ctx, imageData: out, width, height, palette, indexMap, indexCounts: Array.from(counts) };
}

function quantizeTexture(sourceTexture, paletteSize) {
  return medianCutQuantize(sourceTexture.imageData, paletteSize);
}

function samplePatterns(count) {
  if (count <= 1) return [[1/3,1/3,1/3]];
  if (count <= 4) return [[1/3,1/3,1/3],[0.65,0.175,0.175],[0.175,0.65,0.175],[0.175,0.175,0.65]];
  if (count <= 7) return [[1/3,1/3,1/3],[0.7,0.15,0.15],[0.15,0.7,0.15],[0.15,0.15,0.7],[0.5,0.5,0],[0,0.5,0.5],[0.5,0,0.5]];
  return [[1/3,1/3,1/3],[0.7,0.15,0.15],[0.15,0.7,0.15],[0.15,0.15,0.7],[0.5,0.5,0],[0,0.5,0.5],[0.5,0,0.5],[0.6,0.2,0.2],[0.2,0.6,0.2],[0.2,0.2,0.6],[0.4,0.4,0.2],[0.4,0.2,0.4],[0.2,0.4,0.4]];
}

function sampleIndexMap(indexedTexture, u, v) {
  const uu = ((u % 1) + 1) % 1;
  const vv = ((v % 1) + 1) % 1;
  const x = Math.min(indexedTexture.width - 1, Math.max(0, Math.round(uu * (indexedTexture.width - 1))));
  const y = Math.min(indexedTexture.height - 1, Math.max(0, Math.round((1 - vv) * (indexedTexture.height - 1))));
  return indexedTexture.indexMap[y * indexedTexture.width + x];
}

function facePaletteIndex(part, face, indexedTexture, sampleCount, decisionMode) {
  if (!part.uv) return 0;
  const pattern = samplePatterns(sampleCount);
  if (decisionMode === 'centre') {
    const b = pattern[0];
    let u = 0, v = 0;
    for (let k=0;k<3;k++) { u += part.uv.getX(face*3+k)*b[k]; v += part.uv.getY(face*3+k)*b[k]; }
    return sampleIndexMap(indexedTexture, u, v);
  }
  const votes = new Map();
  pattern.forEach((b) => {
    let u = 0, v = 0;
    for (let k=0;k<3;k++) { u += part.uv.getX(face*3+k)*b[k]; v += part.uv.getY(face*3+k)*b[k]; }
    const idx = sampleIndexMap(indexedTexture, u, v);
    votes.set(idx, (votes.get(idx) || 0) + 1);
  });
  let best = 0, bestVotes = -1;
  votes.forEach((count, idx) => { if (count > bestVotes) { bestVotes = count; best = idx; } });
  return best;
}

function createMaterialFromRGB(rgb) {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(rgb[0]/255, rgb[1]/255, rgb[2]/255), roughness: 0.72, metalness: 0, side: THREE.DoubleSide });
}
function createRandomMaterial(seed) {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL((seed * 0.61803398875) % 1, 0.65, 0.55), roughness: 0.72, metalness: 0, side: THREE.DoubleSide });
}

function faceGroupsByPalette(part, paletteIndices) {
  const groupMap = new Map();
  for (let face=0; face<part.faceCount; face++) {
    const idx = paletteIndices[face];
    if (!groupMap.has(idx)) groupMap.set(idx, []);
    groupMap.get(idx).push(face);
  }
  return Array.from(groupMap.entries()).map(([paletteIndex, faces]) => ({ paletteIndex, faces }));
}

function connectedIslandsByPalette(part, paletteIndices) {
  const visited = new Uint8Array(part.faceCount);
  const groups = [];
  for (let seed = 0; seed < part.faceCount; seed++) {
    if (visited[seed]) continue;
    const paletteIndex = paletteIndices[seed];
    const queue = [seed], faces = [];
    visited[seed] = 1;
    while (queue.length) {
      const face = queue.pop(); faces.push(face);
      part.adjacency[face].forEach((nb) => {
        if (!visited[nb] && paletteIndices[nb] === paletteIndex) { visited[nb] = 1; queue.push(nb); }
      });
    }
    groups.push({ paletteIndex, faces });
  }
  return groups;
}

function mergeTinyIslands(groups, part, paletteIndices, minSize) {
  if (minSize <= 1) return groups;
  const faceToGroup = new Int32Array(part.faceCount);
  groups.forEach((group, gi) => group.faces.forEach((f) => { faceToGroup[f] = gi; }));
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    if (!group.faces.length || group.faces.length >= minSize) continue;
    const votes = new Map();
    group.faces.forEach((face) => {
      part.adjacency[face].forEach((nb) => {
        const other = faceToGroup[nb];
        if (other !== gi) votes.set(other, (votes.get(other) || 0) + 1);
      });
    });
    let best = -1, bestVotes = -1;
    votes.forEach((count, idx) => { if (count > bestVotes) { bestVotes = count; best = idx; } });
    if (best >= 0) {
      group.faces.forEach((face) => { paletteIndices[face] = groups[best].paletteIndex; });
    }
  }
  return connectedIslandsByPalette(part, paletteIndices);
}

function rebuildGeometryForGroups(part, groups, palette, previewMode) {
  clearGeneratedMaterials(part);
  const { position, normal, uv } = part;
  const newGeometry = new THREE.BufferGeometry();
  const newPos = [], newNorm = [], newUv = [];
  let start = 0;
  groups.forEach((group, index) => {
    group.faces.forEach((face) => {
      for (let k=0;k<3;k++) {
        const i = face*3 + k;
        newPos.push(position.getX(i), position.getY(i), position.getZ(i));
        newNorm.push(normal.getX(i), normal.getY(i), normal.getZ(i));
        if (uv) newUv.push(uv.getX(i), uv.getY(i));
      }
    });
    newGeometry.addGroup(start, group.faces.length * 3, index);
    start += group.faces.length * 3;
  });
  newGeometry.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3));
  newGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(newNorm, 3));
  if (newUv.length) newGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(newUv, 2));
  part.mesh.geometry = newGeometry;
  part.generatedMaterials = groups.map((group, i) => previewMode === 'randomGroups' ? createRandomMaterial(i + 1) : createMaterialFromRGB(palette[group.paletteIndex]));
  part.generatedMaterials.forEach((m, i) => { m.name = `Palette_${groups[i].paletteIndex + 1}`; });
}

function buildQuantisedTextureMaterial(part, quantisedTexture) {
  if (part.quantisedTexturedMaterial) part.quantisedTexturedMaterial.dispose();
  const tex = new THREE.CanvasTexture(quantisedTexture.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.needsUpdate = true;
  part.quantisedMap = tex;
  part.quantisedTexturedMaterial = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.72, metalness: 0, side: THREE.DoubleSide });
}

async function loadGLB(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.glb')) { setStatus('Please choose a .glb file.'); return; }
  clearModel(); app.sourceName = file.name;
  setStatus(`Loading ${file.name}…`);
  try {
    const gltf = await parseGLB(await file.arrayBuffer());
    app.root = gltf.scene || gltf.scenes?.[0];
    if (!app.root) throw new Error('No scene found in GLB.');
    scene.add(app.root);
    const meshes = getMeshes();
    if (!meshes.length) throw new Error('No mesh geometry found.');
    for (let i=0;i<meshes.length;i++) app.parts.push(await preparePart(meshes[i]));
    $('meshName').textContent = file.name;
    frameModel(); updateTextureMeta(); updateStats(); updatePreview();
    setStatus(`Loaded ${meshes.length} mesh part${meshes.length === 1 ? '' : 's'}.`);
  } catch (error) {
    console.error(error); clearModel(); setStatus(`Load failed: ${error?.message || error}`);
  } finally { $('glbInput').value = ''; }
}

async function loadReplacementTexture(file) {
  if (!file) return;
  try {
    const bitmap = await createImageBitmap(file);
    app.uploadedTexture = createTextureCanvasFromBitmap(bitmap);
    app.uploadedTextureInfo = { name: file.name, width: bitmap.width, height: bitmap.height };
    updateTextureMeta(); updateStats(); setStatus(`Loaded replacement texture: ${file.name}.`);
  } catch (error) {
    console.error(error); setStatus(`Could not read replacement texture: ${error?.message || error}`);
  } finally { $('textureInput').value = ''; }
}

function getSourceTexture() {
  if (app.uploadedTexture) return app.uploadedTexture;
  return app.parts.find(p => p.embeddedTextureCanvas)?.embeddedTextureCanvas || null;
}

function buildFacegroups() {
  if (!app.parts.length) return;
  const sourceTexture = getSourceTexture();
  if (!sourceTexture) { setStatus('No albedo texture available.'); return; }
  const paletteSize = Math.max(2, +$('paletteSize').value || 12);
  const sampleCount = +$('sampleCount').value;
  const decisionMode = $('decisionMode').value;
  const groupMode = $('groupMode').value;
  const cleanupIslands = $('cleanupIslands').checked;
  const minIslandSize = Math.max(1, +$('minIslandSize').value || 1);
  setStatus('Quantising texture image…');
  app.quantised = quantizeTexture(sourceTexture, paletteSize);
  let totalGroups = 0;
  app.parts.forEach((part) => {
    if (!part.uv) throw new Error('A mesh part has no UV coordinates.');
    setStatus('Transposing palette indices to mesh faces…');
    const paletteIndices = new Uint16Array(part.faceCount);
    for (let face=0; face<part.faceCount; face++) paletteIndices[face] = facePaletteIndex(part, face, app.quantised, sampleCount, decisionMode);
    let groups = groupMode === 'islands' ? connectedIslandsByPalette(part, paletteIndices) : faceGroupsByPalette(part, paletteIndices);
    if (groupMode === 'islands' && cleanupIslands) groups = mergeTinyIslands(groups, part, paletteIndices, minIslandSize);
    part.facePaletteIndices = paletteIndices;
    part.groups = groups;
    buildQuantisedTextureMaterial(part, app.quantised);
    rebuildGeometryForGroups(part, groups, app.quantised.palette, $('previewMode').value);
    totalGroups += groups.length;
  });
  app.generatedGroupCount = totalGroups;
  updateTextureMeta(); updatePaletteUI(); updateStats(); updatePreview();
  setStatus(`Built ${totalGroups} facegroups from a ${app.quantised.palette.length}-colour quantised texture.`);
}

function exportGLB() {
  if (!app.root || !app.generatedGroupCount) return;
  setStatus('Exporting GLB…');
  const exporter = new GLTFExporter();
  exporter.parse(app.root, (result) => {
    const blob = new Blob([result], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = app.sourceName.replace(/\.glb$/i, '') + '-quantised-facegroups.glb'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('Exported GLB.');
  }, (error) => setStatus(`Export failed: ${error?.message || error}`), { binary: true, onlyVisible: true });
}

function exportPNG() {
  if (!app.quantised) return;
  const a = document.createElement('a');
  a.href = app.quantised.canvas.toDataURL('image/png');
  a.download = app.sourceName.replace(/\.glb$/i, '') + '-quantised.png';
  a.click();
}

$('openGlbBtn').addEventListener('click', () => { $('glbInput').value = ''; $('glbInput').click(); });
$('openTextureBtn').addEventListener('click', () => { $('textureInput').value = ''; $('textureInput').click(); });
$('glbInput').addEventListener('change', (e) => loadGLB(e.target.files?.[0]));
$('textureInput').addEventListener('change', (e) => loadReplacementTexture(e.target.files?.[0]));
$('frameBtn').addEventListener('click', frameModel);
$('quantiseBtn').addEventListener('click', () => { try { buildFacegroups(); } catch (e) { console.error(e); setStatus(`Build failed: ${e?.message || e}`); } });
$('exportGlbBtn').addEventListener('click', exportGLB);
$('exportPngBtn').addEventListener('click', exportPNG);
$('previewMode').addEventListener('change', () => {
  if ($('previewMode').value === 'randomGroups' && app.parts.length && app.quantised) {
    app.parts.forEach((part) => { if (part.groups) rebuildGeometryForGroups(part, part.groups, app.quantised.palette, 'randomGroups'); });
  } else if (app.parts.length && app.quantised) {
    app.parts.forEach((part) => { if (part.groups) rebuildGeometryForGroups(part, part.groups, app.quantised.palette, 'paletteModel'); });
  }
  updatePreview();
});
$('gridToggle').addEventListener('change', (e) => { grid.visible = e.target.checked; });
$('wireToggle').addEventListener('change', updatePreview);

const dropZone = $('dropZone');
dropZone.addEventListener('click', () => { $('glbInput').value = ''; $('glbInput').click(); });
['dragenter','dragover'].forEach(name => dropZone.addEventListener(name, (e) => { e.preventDefault(); dropZone.classList.add('drag'); }));
['dragleave','drop'].forEach(name => dropZone.addEventListener(name, (e) => { e.preventDefault(); dropZone.classList.remove('drag'); }));
dropZone.addEventListener('drop', (e) => loadGLB(e.dataTransfer?.files?.[0]));

setStatus('Ready — load a textured GLB.');
updateTextureMeta(); updatePaletteUI(); updateStats();
