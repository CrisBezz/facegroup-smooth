import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const el = (id) => document.getElementById(id);
const viewport = el('viewport');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111820);
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
camera.position.set(3, 2, 4);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
viewport.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.5);
sun.position.set(4, 8, 6);
scene.add(sun);
const grid = new THREE.GridHelper(20, 40, 0x536272, 0x2b3540);
scene.add(grid);

let modelRoot = null;
let sourceName = 'model.glb';
let parts = [];
let facegroups = [];
let wireHelpers = [];

function setStatus(message) {
  el('status').textContent = message;
  el('statusPill').textContent = message;
}
function resize() {
  const rect = viewport.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
  renderer.setSize(rect.width, rect.height, false);
}
new ResizeObserver(resize).observe(viewport);
resize();
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

function getMeshes() {
  const meshes = [];
  modelRoot?.traverse((object) => {
    if (object.isMesh && object.geometry) meshes.push(object);
  });
  return meshes;
}
function clearWire() {
  wireHelpers.forEach((wire) => {
    scene.remove(wire);
    wire.geometry.dispose();
    wire.material.dispose();
  });
  wireHelpers = [];
}
function clearModel() {
  clearWire();
  if (modelRoot) scene.remove(modelRoot);
  modelRoot = null;
  parts = [];
  facegroups = [];
  el('groupList').innerHTML = '<div class="hint">Load a model and click Separate Colours.</div>';
  updateStats();
}
function frameModel() {
  if (!modelRoot) return;
  const box = new THREE.Box3().setFromObject(modelRoot);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const diameter = Math.max(size.x, size.y, size.z) || 1;
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(diameter * 1.5, diameter * 0.9, diameter * 1.5));
  camera.near = Math.max(diameter / 1000, 0.001);
  camera.far = diameter * 1000;
  camera.updateProjectionMatrix();
  controls.update();
}
function updateStats() {
  let triangles = 0;
  let textures = 0;
  parts.forEach((part) => {
    triangles += part.faceCount;
    if (part.textureSource) textures += 1;
  });
  el('faces').textContent = Math.round(triangles).toLocaleString();
  el('meshes').textContent = parts.length.toLocaleString();
  el('textures').textContent = textures.toLocaleString();
  el('groups').textContent = facegroups.length.toLocaleString();
  el('frameBtn').disabled = !modelRoot;
  el('analyseBtn').disabled = !modelRoot;
  el('exportBtn').disabled = !facegroups.length;
}

function parseGLB(arrayBuffer) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(arrayBuffer, '', resolve, reject);
  });
}
async function imageToSampler(image) {
  if (!image) return null;
  await image.decode?.().catch(() => {});
  const width = image.width || image.videoWidth;
  const height = image.height || image.videoHeight;
  if (!width || !height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  try {
    context.drawImage(image, 0, 0, width, height);
    context.getImageData(0, 0, 1, 1);
    return { context, width, height };
  } catch {
    return null;
  }
}
function sampleTexture(sampler, u, v) {
  if (!sampler) return [1, 1, 1];
  const wrappedU = ((u % 1) + 1) % 1;
  const wrappedV = ((v % 1) + 1) % 1;
  const x = Math.min(sampler.width - 1, Math.max(0, Math.round(wrappedU * (sampler.width - 1))));
  const y = Math.min(sampler.height - 1, Math.max(0, Math.round((1 - wrappedV) * (sampler.height - 1))));
  const pixel = sampler.context.getImageData(x, y, 1, 1).data;
  return [pixel[0] / 255, pixel[1] / 255, pixel[2] / 255];
}
function positionKey(attribute, index) {
  return `${Math.round(attribute.getX(index) * 100000)},${Math.round(attribute.getY(index) * 100000)},${Math.round(attribute.getZ(index) * 100000)}`;
}
function buildAdjacency(position) {
  const faceCount = position.count / 3;
  const edgeMap = new Map();
  const adjacency = Array.from({ length: faceCount }, () => new Set());
  for (let face = 0; face < faceCount; face += 1) {
    const ids = [positionKey(position, face * 3), positionKey(position, face * 3 + 1), positionKey(position, face * 3 + 2)];
    [[0, 1], [1, 2], [2, 0]].forEach(([a, b]) => {
      const edge = ids[a] < ids[b] ? `${ids[a]}|${ids[b]}` : `${ids[b]}|${ids[a]}`;
      if (!edgeMap.has(edge)) edgeMap.set(edge, []);
      edgeMap.get(edge).push(face);
    });
  }
  edgeMap.forEach((faces) => {
    for (let i = 0; i < faces.length; i += 1) {
      for (let j = i + 1; j < faces.length; j += 1) {
        adjacency[faces[i]].add(faces[j]);
        adjacency[faces[j]].add(faces[i]);
      }
    }
  });
  return adjacency;
}
function rgbToLab(rgb) {
  let [r, g, b] = rgb.map((value) => value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
  let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  let y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const convert = (value) => value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
  x = convert(x); y = convert(y); z = convert(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
function colourDistance(a, b, ignoreBrightness) {
  const labA = rgbToLab(a);
  const labB = rgbToLab(b);
  return Math.hypot(ignoreBrightness ? 0 : labA[0] - labB[0], labA[1] - labB[1], labA[2] - labB[2]) / 1.5;
}
async function prepareMesh(mesh) {
  const originalMaterial = mesh.material;
  const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  geometry.computeVertexNormals();
  mesh.geometry = geometry;
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  const vertexColour = geometry.attributes.color;
  const materials = Array.isArray(originalMaterial) ? originalMaterial : [originalMaterial];
  const samplers = [];
  for (const material of materials) samplers.push(await imageToSampler(material?.map?.image));
  const faceCount = position.count / 3;
  const sourceGroups = geometry.groups.length ? geometry.groups : [{ start: 0, count: position.count, materialIndex: 0 }];
  const faceMaterial = new Int32Array(faceCount);
  sourceGroups.forEach((group) => {
    for (let face = group.start / 3; face < (group.start + group.count) / 3; face += 1) faceMaterial[face] = group.materialIndex || 0;
  });
  const barycentricSamples = [[1/3,1/3,1/3],[0.65,0.175,0.175],[0.175,0.65,0.175],[0.175,0.175,0.65]];
  const colours = [];
  for (let face = 0; face < faceCount; face += 1) {
    const materialIndex = faceMaterial[face];
    const material = materials[materialIndex] || materials[0];
    const base = material?.color || new THREE.Color(1, 1, 1);
    const samples = [];
    barycentricSamples.forEach((weights) => {
      let colour = [base.r, base.g, base.b];
      if (uv && samplers[materialIndex]) {
        let u = 0, v = 0;
        for (let corner = 0; corner < 3; corner += 1) {
          u += uv.getX(face * 3 + corner) * weights[corner];
          v += uv.getY(face * 3 + corner) * weights[corner];
        }
        const textureColour = sampleTexture(samplers[materialIndex], u, v);
        colour = colour.map((value, index) => value * textureColour[index]);
      }
      if (vertexColour) {
        const sampledVertex = [0, 0, 0];
        for (let corner = 0; corner < 3; corner += 1) {
          sampledVertex[0] += vertexColour.getX(face * 3 + corner) * weights[corner];
          sampledVertex[1] += vertexColour.getY(face * 3 + corner) * weights[corner];
          sampledVertex[2] += vertexColour.getZ(face * 3 + corner) * weights[corner];
        }
        colour = colour.map((value, index) => value * sampledVertex[index]);
      }
      samples.push(colour);
    });
    colours.push(samples.reduce((sum, colour) => sum.map((value, index) => value + colour[index]), [0, 0, 0]).map((value) => value / samples.length));
  }
  return {
    mesh,
    originalMaterial,
    faceCount,
    colours,
    adjacency: buildAdjacency(position),
    sourceAttributes: { position, normal, uv, vertexColour },
    textureSource: samplers.find(Boolean) || null,
    meanMaterials: null,
    randomMaterials: null,
  };
}

async function loadFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.glb')) {
    setStatus('Please choose an embedded .glb file.');
    return;
  }
  clearModel();
  sourceName = file.name;
  setStatus(`Reading ${file.name}…`);
  try {
    const gltf = await parseGLB(await file.arrayBuffer());
    modelRoot = gltf.scene || gltf.scenes?.[0];
    if (!modelRoot) throw new Error('The GLB contains no scene.');
    scene.add(modelRoot);
    const meshes = getMeshes();
    if (!meshes.length) throw new Error('The GLB contains no mesh geometry.');
    for (let index = 0; index < meshes.length; index += 1) {
      setStatus(`Sampling mesh ${index + 1} of ${meshes.length}…`);
      parts.push(await prepareMesh(meshes[index]));
    }
    el('meshName').textContent = file.name;
    frameModel();
    updateStats();
    setStatus(`Loaded ${meshes.length} mesh part${meshes.length === 1 ? '' : 's'}.`);
  } catch (error) {
    console.error(error);
    clearModel();
    setStatus(`Load failed: ${error?.message || error}`);
  } finally {
    el('fileInput').value = '';
  }
}

function rebuildPart(part, localGroups) {
  const { position, normal, uv, vertexColour } = part.sourceAttributes;
  const positions = [], normals = [], uvs = [], colours = [];
  const geometry = new THREE.BufferGeometry();
  const meanMaterials = [];
  const randomMaterials = [];
  let start = 0;
  localGroups.forEach((group) => {
    group.faces.forEach((face) => {
      for (let corner = 0; corner < 3; corner += 1) {
        const index = face * 3 + corner;
        positions.push(position.getX(index), position.getY(index), position.getZ(index));
        normals.push(normal.getX(index), normal.getY(index), normal.getZ(index));
        if (uv) uvs.push(uv.getX(index), uv.getY(index));
        if (vertexColour) colours.push(vertexColour.getX(index), vertexColour.getY(index), vertexColour.getZ(index));
      }
    });
    meanMaterials.push(new THREE.MeshStandardMaterial({ color: new THREE.Color(...group.mean), roughness: 0.72, metalness: 0, side: THREE.DoubleSide }));
    randomMaterials.push(new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(Math.random(), 0.65, 0.55), roughness: 0.72, metalness: 0, side: THREE.DoubleSide }));
    geometry.addGroup(start, group.faces.length * 3, meanMaterials.length - 1);
    start += group.faces.length * 3;
  });
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  if (uvs.length) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (colours.length) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  part.mesh.geometry = geometry;
  part.meanMaterials = meanMaterials;
  part.randomMaterials = randomMaterials;
}
function separateColours() {
  if (!parts.length) return;
  setStatus('Separating colours…');
  facegroups = [];
  const threshold = Number(el('variance').value);
  const ignoreBrightness = el('ignoreLight').checked;
  const mergeSmall = el('mergeSmall').checked;
  const minimumFaces = Math.max(1, Number(el('minFaces').value) || 1);
  parts.forEach((part, partIndex) => {
    const labels = new Int32Array(part.faceCount);
    labels.fill(-1);
    let localGroups = [];
    for (let seed = 0; seed < part.faceCount; seed += 1) {
      if (labels[seed] >= 0) continue;
      const groupIndex = localGroups.length;
      const queue = [seed];
      const faces = [];
      labels[seed] = groupIndex;
      let mean = part.colours[seed].slice();
      while (queue.length) {
        const face = queue.pop();
        faces.push(face);
        mean = mean.map((value, channel) => (value * (faces.length - 1) + part.colours[face][channel]) / faces.length);
        part.adjacency[face].forEach((neighbour) => {
          if (labels[neighbour] < 0 && colourDistance(part.colours[neighbour], mean, ignoreBrightness) <= threshold) {
            labels[neighbour] = groupIndex;
            queue.push(neighbour);
          }
        });
      }
      const finalMean = faces.reduce((sum, face) => sum.map((value, channel) => value + part.colours[face][channel]), [0, 0, 0]).map((value) => value / faces.length);
      localGroups.push({ faces, mean: finalMean });
    }
    if (mergeSmall) {
      localGroups.forEach((group, groupIndex) => {
        if (!group.faces.length || group.faces.length >= minimumFaces) return;
        const votes = new Map();
        group.faces.forEach((face) => part.adjacency[face].forEach((neighbour) => {
          const other = labels[neighbour];
          if (other !== groupIndex && localGroups[other]?.faces.length) votes.set(other, (votes.get(other) || 0) + 1);
        }));
        let target = -1, bestVotes = 0;
        votes.forEach((count, candidate) => {
          if (count > bestVotes) { bestVotes = count; target = candidate; }
        });
        if (target >= 0) {
          group.faces.forEach((face) => { labels[face] = target; localGroups[target].faces.push(face); });
          group.faces = [];
        }
      });
      localGroups = localGroups.filter((group) => group.faces.length);
      localGroups.forEach((group) => {
        group.mean = group.faces.reduce((sum, face) => sum.map((value, channel) => value + part.colours[face][channel]), [0, 0, 0]).map((value) => value / group.faces.length);
      });
    }
    rebuildPart(part, localGroups);
    localGroups.forEach((group, localIndex) => facegroups.push({ partIndex, localIndex, ...group }));
  });
  updateGroupList();
  updatePreview();
  updateStats();
  setStatus(`Separated into ${facegroups.length} facegroups.`);
}
function updatePreview() {
  const mode = el('previewMode').value;
  parts.forEach((part) => {
    if (mode === 'original' || !part.meanMaterials) part.mesh.material = part.originalMaterial;
    else if (mode === 'random') part.mesh.material = part.randomMaterials;
    else part.mesh.material = part.meanMaterials;
  });
  clearWire();
  if (el('wireToggle').checked) {
    parts.forEach((part) => {
      const wire = new THREE.LineSegments(new THREE.WireframeGeometry(part.mesh.geometry), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28 }));
      wire.applyMatrix4(part.mesh.matrixWorld);
      scene.add(wire);
      wireHelpers.push(wire);
    });
  }
}
function updateGroupList() {
  const list = el('groupList');
  list.innerHTML = '';
  facegroups.forEach((group, index) => {
    const colour = new THREE.Color(...group.mean);
    const row = document.createElement('div');
    row.className = 'group';
    row.innerHTML = `<span class="swatch" style="background:#${colour.getHexString()}"></span><span>Group ${index + 1}<div class="hint">${group.faces.length.toLocaleString()} faces</div></span><small>#${index + 1}</small>`;
    list.appendChild(row);
  });
}
function exportGLB() {
  if (!modelRoot || !facegroups.length) return;
  setStatus('Exporting GLB…');
  new GLTFExporter().parse(modelRoot, (result) => {
    const blob = new Blob([result], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = sourceName.replace(/\.glb$/i, '') + '-facegroups.glb';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('Export complete.');
  }, (error) => setStatus(`Export failed: ${error?.message || error}`), { binary: true, onlyVisible: true });
}
function loadDemo() {
  clearModel();
  const geometry = new THREE.SphereGeometry(1, 48, 24).toNonIndexed();
  const position = geometry.attributes.position;
  const colours = [];
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index), y = position.getY(index), z = position.getZ(index);
    let colour;
    if (y > 0.35) colour = new THREE.Color(0xcc3333).offsetHSL(0, 0, 0.06 * Math.sin(x * 6));
    else if (z > 0.15) colour = new THREE.Color(0x3388cc).offsetHSL(0, 0, 0.05 * Math.sin(y * 7));
    else colour = new THREE.Color(0x55aa55).offsetHSL(0, 0, 0.04 * Math.sin(x * 5));
    colours.push(colour.r, colour.g, colour.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }));
  modelRoot = new THREE.Group();
  modelRoot.add(mesh);
  scene.add(modelRoot);
  sourceName = 'demo.glb';
  prepareMesh(mesh).then((part) => {
    parts = [part];
    el('meshName').textContent = 'Painted demo sphere';
    frameModel();
    updateStats();
    setStatus('Demo loaded — click Separate Colours.');
  });
}

el('fileInput').addEventListener('change', (event) => loadFile(event.target.files?.[0]));
el('openBtn').addEventListener('click', () => el('fileInput').click());
el('drop').addEventListener('click', () => el('fileInput').click());
el('drop').addEventListener('dragover', (event) => { event.preventDefault(); el('drop').classList.add('drag'); });
el('drop').addEventListener('dragleave', () => el('drop').classList.remove('drag'));
el('drop').addEventListener('drop', (event) => { event.preventDefault(); el('drop').classList.remove('drag'); loadFile(event.dataTransfer?.files?.[0]); });
el('demoBtn').addEventListener('click', loadDemo);
el('frameBtn').addEventListener('click', frameModel);
el('analyseBtn').addEventListener('click', separateColours);
el('exportBtn').addEventListener('click', exportGLB);
el('gridToggle').addEventListener('change', (event) => { grid.visible = event.target.checked; });
el('wireToggle').addEventListener('change', updatePreview);
el('previewMode').addEventListener('change', updatePreview);
el('variance').addEventListener('input', (event) => { el('varianceOut').textContent = `${event.target.value}%`; });
window.__COLOUR_FACEGROUPS_READY__ = true;
setStatus('Ready — choose an embedded GLB file.');
