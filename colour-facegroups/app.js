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
let originalMaterials = new Map();
let generatedMaterials = [];

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

function clearModel() {
  if (modelRoot) scene.remove(modelRoot);
  modelRoot = null;
  originalMaterials.clear();
  generatedMaterials.forEach((m) => m.dispose());
  generatedMaterials = [];
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

function getMeshes() {
  const meshes = [];
  modelRoot?.traverse((object) => {
    if (object.isMesh && object.geometry) meshes.push(object);
  });
  return meshes;
}

function updateStats() {
  const meshes = getMeshes();
  let triangles = 0;
  let textures = 0;
  meshes.forEach((mesh) => {
    const geometry = mesh.geometry;
    triangles += geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    textures += materials.filter((material) => material?.map).length;
  });
  el('faces').textContent = Math.round(triangles).toLocaleString();
  el('meshes').textContent = meshes.length.toLocaleString();
  el('textures').textContent = textures.toLocaleString();
  el('groups').textContent = generatedMaterials.length.toLocaleString();
  el('frameBtn').disabled = !modelRoot;
  el('analyseBtn').disabled = !modelRoot;
  el('exportBtn').disabled = !modelRoot;
}

function parseGLB(arrayBuffer) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.parse(arrayBuffer, '', resolve, reject);
  });
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
    const buffer = await file.arrayBuffer();
    setStatus('Parsing GLB…');
    const gltf = await parseGLB(buffer);
    const root = gltf.scene || gltf.scenes?.[0];
    if (!root) throw new Error('The GLB contains no scene.');

    modelRoot = root;
    const meshes = getMeshes();
    if (!meshes.length) throw new Error('The GLB contains no mesh geometry.');

    meshes.forEach((mesh) => originalMaterials.set(mesh, mesh.material));
    scene.add(modelRoot);
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

function randomColour(index) {
  return new THREE.Color().setHSL((index * 0.61803398875) % 1, 0.65, 0.55);
}

function generatePreviewGroups() {
  const meshes = getMeshes();
  generatedMaterials.forEach((m) => m.dispose());
  generatedMaterials = [];

  let groupNumber = 0;
  meshes.forEach((mesh) => {
    const geometry = mesh.geometry;
    const sourceMaterials = Array.isArray(originalMaterials.get(mesh))
      ? originalMaterials.get(mesh)
      : [originalMaterials.get(mesh)];

    const groupCount = geometry.groups.length || sourceMaterials.length || 1;
    const materials = [];
    for (let i = 0; i < groupCount; i += 1) {
      const material = new THREE.MeshStandardMaterial({
        color: randomColour(groupNumber),
        roughness: 0.72,
        metalness: 0,
        side: THREE.DoubleSide,
      });
      materials.push(material);
      generatedMaterials.push(material);
      groupNumber += 1;
    }
    mesh.material = materials.length === 1 ? materials[0] : materials;
  });

  el('showGroups').checked = true;
  updateGroupList();
  updateStats();
  setStatus(`Previewed ${generatedMaterials.length} existing mesh/material groups.`);
}

function showOriginal() {
  originalMaterials.forEach((material, mesh) => {
    mesh.material = material;
  });
  el('showGroups').checked = false;
  setStatus('Showing original model colours.');
}

function updateGroupList() {
  const list = el('groupList');
  list.innerHTML = '';
  generatedMaterials.forEach((material, index) => {
    const row = document.createElement('div');
    row.className = 'group';
    row.innerHTML = `<span class="swatch" style="background:#${material.color.getHexString()}"></span><span>Group ${index + 1}</span><small>#${index + 1}</small>`;
    list.appendChild(row);
  });
}

function exportGLB() {
  if (!modelRoot) return;
  setStatus('Exporting GLB…');
  const exporter = new GLTFExporter();
  exporter.parse(
    modelRoot,
    (result) => {
      const blob = new Blob([result], { type: 'model/gltf-binary' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = sourceName.replace(/\.glb$/i, '') + '-facegroups.glb';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus('Export complete.');
    },
    (error) => setStatus(`Export failed: ${error?.message || error}`),
    { binary: true, onlyVisible: true },
  );
}

function loadDemo() {
  clearModel();
  const geometry = new THREE.SphereGeometry(1, 48, 24);
  const material = new THREE.MeshStandardMaterial({ color: 0xcc5544, roughness: 0.75 });
  const mesh = new THREE.Mesh(geometry, material);
  modelRoot = new THREE.Group();
  modelRoot.add(mesh);
  originalMaterials.set(mesh, material);
  scene.add(modelRoot);
  sourceName = 'demo.glb';
  el('meshName').textContent = 'Demo sphere';
  frameModel();
  updateStats();
  setStatus('Demo loaded. The renderer and controls are working.');
}

el('fileInput').addEventListener('change', (event) => loadFile(event.target.files?.[0]));
el('openBtn').addEventListener('click', () => el('fileInput').click());
el('drop').addEventListener('click', () => el('fileInput').click());
el('drop').addEventListener('dragover', (event) => { event.preventDefault(); el('drop').classList.add('drag'); });
el('drop').addEventListener('dragleave', () => el('drop').classList.remove('drag'));
el('drop').addEventListener('drop', (event) => {
  event.preventDefault();
  el('drop').classList.remove('drag');
  loadFile(event.dataTransfer?.files?.[0]);
});
el('demoBtn').addEventListener('click', loadDemo);
el('frameBtn').addEventListener('click', frameModel);
el('analyseBtn').addEventListener('click', generatePreviewGroups);
el('originalBtn').addEventListener('click', showOriginal);
el('exportBtn').addEventListener('click', exportGLB);
el('gridToggle').addEventListener('change', (event) => { grid.visible = event.target.checked; });
el('variance').addEventListener('input', (event) => { el('varianceOut').textContent = `${event.target.value}%`; });

window.__COLOUR_FACEGROUPS_READY__ = true;
setStatus('Ready — choose an embedded GLB file.');
