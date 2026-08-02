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
const sun = new THREE.DirectionalLight(0xffffff, 2.6);
sun.position.set(4, 8, 6);
scene.add(sun);
const grid = new THREE.GridHelper(20, 40, 0x536272, 0x2b3540);
scene.add(grid);

const sourceNames = {
  auto: 'Auto',
  embedded: 'Embedded albedo',
  uploaded: 'Uploaded albedo',
  vertex: 'Vertex colours',
  material: 'Material colours',
};

const app = {
  root: null,
  sourceName: 'model.glb',
  parts: [],
  generatedGroupCount: 0,
  uploadedTexture: null,
  uploadedTextureInfo: null,
  wireHelpers: [],
};

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

function clearWire() {
  app.wireHelpers.forEach((w) => scene.remove(w));
  app.wireHelpers = [];
}

function clearModel() {
  clearWire();
  if (app.root) scene.remove(app.root);
  app.root = null;
  app.parts.forEach((part) => {
    part.groupAverageMaterials?.forEach((m) => m.dispose());
    part.randomMaterials?.forEach((m) => m.dispose());
    part.faceAverageMaterials?.forEach((m) => m.dispose());
  });
  app.parts = [];
  app.generatedGroupCount = 0;
  el('meshName').textContent = 'No mesh loaded';
  updateTextureMeta();
  updateGroupList();
  updateStats();
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

function getMeshes() {
  const meshes = [];
  app.root?.traverse((object) => {
    if (object.isMesh && object.geometry) meshes.push(object);
  });
  return meshes;
}

function updateStats() {
  let triangles = 0;
  app.parts.forEach((part) => { triangles += part.faceCount; });
  el('trianglesStat').textContent = Math.round(triangles).toLocaleString();
  el('groupsStat').textContent = app.generatedGroupCount.toLocaleString();
  el('meshesStat').textContent = app.parts.length.toLocaleString();
  el('sourceStat').textContent = sourceNames[el('sourceMode').value] || '—';
  const loaded = !!app.root;
  const hasGroups = app.generatedGroupCount > 0;
  el('frameBtn').disabled = !loaded;
  el('generateBtn').disabled = !loaded;
  el('exportBtn').disabled = !loaded;
  el('showOriginalBtn').disabled = !loaded;
  el('randomiseBtn').disabled = !hasGroups;
}

function updateTextureMeta() {
  const lines = [];
  if (!app.root) {
    el('textureMeta').textContent = 'No texture loaded.';
    return;
  }
  if (app.uploadedTextureInfo) {
    lines.push(`Uploaded: ${app.uploadedTextureInfo.name} (${app.uploadedTextureInfo.width}×${app.uploadedTextureInfo.height})`);
  }
  const embedded = app.parts.some((part) => part.embeddedTextureInfo);
  if (embedded) {
    const info = app.parts.find((part) => part.embeddedTextureInfo)?.embeddedTextureInfo;
    lines.push(`Embedded: ${info.name || 'Base color texture'} (${info.width}×${info.height})`);
  }
  if (!lines.length) lines.push('No albedo texture detected. Vertex or material colours may still work.');
  lines.push(`Current source mode: ${sourceNames[el('sourceMode').value]}`);
  el('textureMeta').innerHTML = lines.join('<br>');
}

function parseGLB(arrayBuffer) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(arrayBuffer, '', resolve, reject);
  });
}

async function createTextureCanvasFromImage(image) {
  if (!image) return null;
  await image.decode?.().catch(() => {});
  const width = image.width || image.videoWidth;
  const height = image.height || image.videoHeight;
  if (!width || !height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);
  return { canvas, ctx, width, height };
}

function createTextureCanvasFromBitmap(bitmap) {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  return { canvas, ctx, width: bitmap.width, height: bitmap.height };
}

function srgbToLinear(v) {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(v) {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * (v ** (1 / 2.4)) - 0.055;
}

function rgbToHsl(rgb) {
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = ((h / 6) % 1 + 1) % 1;
  }
  return [h, s, l];
}

function hslToRgb(hsl) {
  const [h, s, l] = hsl;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h * 6) % 2 - 1));
  const m = l - c / 2;
  let rgb;
  if (h < 1 / 6) rgb = [c, x, 0];
  else if (h < 2 / 6) rgb = [x, c, 0];
  else if (h < 3 / 6) rgb = [0, c, x];
  else if (h < 4 / 6) rgb = [0, x, c];
  else if (h < 5 / 6) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgb.map((v) => v + m);
}

function simplifyColour(linearRgb) {
  if (!el('simplifyColours').checked) return linearRgb;
  const srgb = linearRgb.map((v) => Math.min(1, Math.max(0, linearToSrgb(v))));
  let [h, s, l] = rgbToHsl(srgb);
  const families = Math.max(2, +el('colourFamilies').value || 8);
  const tones = Math.max(1, +el('toneLevels').value || 2);
  const protect = el('protectNeutrals').checked;

  if (protect && s < 0.12) {
    const neutralLevels = Math.max(3, tones + 2);
    l = Math.round(l * (neutralLevels - 1)) / (neutralLevels - 1);
    s = 0;
  } else {
    h = (Math.round(h * families) % families) / families;
    s = s < 0.18 ? 0 : Math.min(1, Math.max(0.45, Math.round(s * 3) / 3));
    if (tones === 1) l = 0.5;
    else l = (Math.round(l * (tones - 1)) + 0.5) / tones;
    l = Math.min(0.9, Math.max(0.1, l));
  }
  return hslToRgb([h, s, l]).map(srgbToLinear);
}

function rgbToLab(rgb) {
  const [r, g, b] = rgb;
  let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  let y = (r * 0.2126 + g * 0.7152 + b * 0.0722);
  let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function colourDistance(a, b, ignoreBrightness) {
  const A = rgbToLab(a);
  const B = rgbToLab(b);
  const dL = ignoreBrightness ? 0 : A[0] - B[0];
  const da = A[1] - B[1];
  const db = A[2] - B[2];
  return Math.sqrt(dL * dL + da * da + db * db) / 1.5;
}

function vertexKey(position, index) {
  return `${Math.round(position.getX(index) * 1e5)},${Math.round(position.getY(index) * 1e5)},${Math.round(position.getZ(index) * 1e5)}`;
}

function buildAdjacency(position) {
  const faceCount = position.count / 3;
  const edgeMap = new Map();
  const adjacency = Array.from({ length: faceCount }, () => new Set());
  for (let face = 0; face < faceCount; face += 1) {
    const ids = [vertexKey(position, face * 3), vertexKey(position, face * 3 + 1), vertexKey(position, face * 3 + 2)];
    [[0, 1], [1, 2], [2, 0]].forEach(([a, b]) => {
      const key = ids[a] < ids[b] ? `${ids[a]}|${ids[b]}` : `${ids[b]}|${ids[a]}`;
      if (!edgeMap.has(key)) edgeMap.set(key, []);
      edgeMap.get(key).push(face);
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

function barycentricPatterns(count) {
  if (count <= 1) return [[1 / 3, 1 / 3, 1 / 3]];
  if (count <= 4) return [[1 / 3, 1 / 3, 1 / 3], [0.65, 0.175, 0.175], [0.175, 0.65, 0.175], [0.175, 0.175, 0.65]];
  return [[1 / 3, 1 / 3, 1 / 3], [0.7, 0.15, 0.15], [0.15, 0.7, 0.15], [0.15, 0.15, 0.7], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5]];
}

function bilinearSample(texture, u, v) {
  const x = u * (texture.width - 1);
  const y = (1 - v) * (texture.height - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(texture.width - 1, x0 + 1), y1 = Math.min(texture.height - 1, y0 + 1);
  const tx = x - x0, ty = y - y0;
  const samplePixel = (px, py) => {
    const d = texture.ctx.getImageData(px, py, 1, 1).data;
    return [srgbToLinear(d[0] / 255), srgbToLinear(d[1] / 255), srgbToLinear(d[2] / 255)];
  };
  const c00 = samplePixel(x0, y0), c10 = samplePixel(x1, y0), c01 = samplePixel(x0, y1), c11 = samplePixel(x1, y1);
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    const a = c00[i] * (1 - tx) + c10[i] * tx;
    const b = c01[i] * (1 - tx) + c11[i] * tx;
    out[i] = a * (1 - ty) + b * ty;
  }
  return out;
}

function nearestSample(texture, u, v) {
  const x = Math.min(texture.width - 1, Math.max(0, Math.round(u * (texture.width - 1))));
  const y = Math.min(texture.height - 1, Math.max(0, Math.round((1 - v) * (texture.height - 1))));
  const d = texture.ctx.getImageData(x, y, 1, 1).data;
  return [srgbToLinear(d[0] / 255), srgbToLinear(d[1] / 255), srgbToLinear(d[2] / 255)];
}

function sampleTexture(texture, u, v, mode) {
  if (!texture) return [1, 1, 1];
  const uu = ((u % 1) + 1) % 1;
  const vv = ((v % 1) + 1) % 1;
  return mode === 'nearest' ? nearestSample(texture, uu, vv) : bilinearSample(texture, uu, vv);
}

async function preparePart(mesh) {
  const originalMaterial = mesh.material;
  const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  geometry.computeVertexNormals();
  mesh.geometry = geometry;
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  const color = geometry.attributes.color;
  const materials = Array.isArray(originalMaterial) ? originalMaterial : [originalMaterial];
  const embeddedTexture = materials.find((m) => m?.map)?.map || null;
  const embeddedCanvas = embeddedTexture ? await createTextureCanvasFromImage(embeddedTexture.image) : null;
  const embeddedTextureInfo = embeddedCanvas ? {
    name: embeddedTexture.name || embeddedTexture.image?.currentSrc?.split('/').pop() || 'Embedded albedo',
    width: embeddedCanvas.width,
    height: embeddedCanvas.height,
  } : null;
  return {
    mesh,
    originalMaterial,
    originalAttributes: { position, normal, uv, color },
    faceCount: position.count / 3,
    adjacency: buildAdjacency(position),
    embeddedTextureCanvas: embeddedCanvas,
    embeddedTextureInfo,
    faceColours: null,
    sourceKindUsed: null,
    generatedGroups: [],
    groupAverageMaterials: [],
    randomMaterials: [],
    faceAverageMaterials: [],
  };
}

function resolveSourceForPart(part, mode) {
  if (mode === 'uploaded') return app.uploadedTexture ? { kind: 'uploaded', texture: app.uploadedTexture } : null;
  if (mode === 'embedded') return part.embeddedTextureCanvas ? { kind: 'embedded', texture: part.embeddedTextureCanvas } : null;
  if (mode === 'vertex') return part.originalAttributes.color ? { kind: 'vertex' } : null;
  if (mode === 'material') return { kind: 'material' };
  if (mode === 'auto') {
    if (app.uploadedTexture) return { kind: 'uploaded', texture: app.uploadedTexture };
    if (part.embeddedTextureCanvas) return { kind: 'embedded', texture: part.embeddedTextureCanvas };
    if (part.originalAttributes.color) return { kind: 'vertex' };
    return { kind: 'material' };
  }
  return null;
}

function baseMaterialColour(part) {
  const materials = Array.isArray(part.originalMaterial) ? part.originalMaterial : [part.originalMaterial];
  const color = materials[0]?.color || new THREE.Color(1, 1, 1);
  return [color.r, color.g, color.b];
}

function sampleFaceColour(part, faceIndex, source, samplePattern, filterMode) {
  const uv = part.originalAttributes.uv;
  const vertexColour = part.originalAttributes.color;
  const base = baseMaterialColour(part);
  const colours = [];
  for (const bary of samplePattern) {
    let colour = base.slice();
    if ((source.kind === 'embedded' || source.kind === 'uploaded') && uv && source.texture) {
      let u = 0, v = 0;
      for (let k = 0; k < 3; k += 1) {
        u += uv.getX(faceIndex * 3 + k) * bary[k];
        v += uv.getY(faceIndex * 3 + k) * bary[k];
      }
      colour = sampleTexture(source.texture, u, v, filterMode);
    } else if (source.kind === 'vertex' && vertexColour) {
      colour = [0, 0, 0];
      for (let k = 0; k < 3; k += 1) {
        colour[0] += vertexColour.getX(faceIndex * 3 + k) * bary[k];
        colour[1] += vertexColour.getY(faceIndex * 3 + k) * bary[k];
        colour[2] += vertexColour.getZ(faceIndex * 3 + k) * bary[k];
      }
    }
    colours.push(colour);
  }
  const avg = [0, 0, 0];
  colours.forEach((c) => {
    avg[0] += c[0]; avg[1] += c[1]; avg[2] += c[2];
  });
  return avg.map((v) => v / colours.length);
}

function computeFaceColours() {
  const sourceMode = el('sourceMode').value;
  const samplePattern = barycentricPatterns(+el('sampleCount').value);
  const filterMode = el('filterMode').value;
  const sourceKinds = new Set();
  for (const part of app.parts) {
    const source = resolveSourceForPart(part, sourceMode);
    if (!source) throw new Error('Requested colour source is unavailable for part of this model.');
    sourceKinds.add(source.kind);
    part.sourceKindUsed = source.kind;
    part.faceColours = new Array(part.faceCount);
    for (let face = 0; face < part.faceCount; face += 1) {
      part.faceColours[face] = simplifyColour(sampleFaceColour(part, face, source, samplePattern, filterMode));
    }
  }
  return Array.from(sourceKinds).join(', ');
}

function createMaterialFromLinear(linear) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(linear[0], linear[1], linear[2]),
    roughness: 0.72,
    metalness: 0,
    side: THREE.DoubleSide,
  });
}

function createRandomMaterial() {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(Math.random(), 0.65, 0.55),
    roughness: 0.72,
    metalness: 0,
    side: THREE.DoubleSide,
  });
}

function rebuildGeometryForGroups(part, groups) {
  part.groupAverageMaterials.forEach((m) => m.dispose());
  part.randomMaterials.forEach((m) => m.dispose());
  const { position, normal, uv, color } = part.originalAttributes;
  const newPos = [], newNorm = [], newUv = [], newCol = [];
  const newGeometry = new THREE.BufferGeometry();
  let start = 0;
  groups.forEach((group, index) => {
    group.faces.forEach((face) => {
      for (let k = 0; k < 3; k += 1) {
        const i = face * 3 + k;
        newPos.push(position.getX(i), position.getY(i), position.getZ(i));
        newNorm.push(normal.getX(i), normal.getY(i), normal.getZ(i));
        if (uv) newUv.push(uv.getX(i), uv.getY(i));
        if (color) newCol.push(color.getX(i), color.getY(i), color.getZ(i));
      }
    });
    newGeometry.addGroup(start, group.faces.length * 3, index);
    start += group.faces.length * 3;
  });
  newGeometry.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3));
  newGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(newNorm, 3));
  if (newUv.length) newGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(newUv, 2));
  if (newCol.length) newGeometry.setAttribute('color', new THREE.Float32BufferAttribute(newCol, 3));
  part.mesh.geometry = newGeometry;
  part.groupAverageMaterials = groups.map((g) => createMaterialFromLinear(g.mean));
  part.randomMaterials = groups.map(() => createRandomMaterial());
}

function mergeTinyGroups(part, groups, labels, minSize) {
  for (let gi = 0; gi < groups.length; gi += 1) {
    const group = groups[gi];
    if (!group || group.faces.length >= minSize || !group.faces.length) continue;
    const votes = new Map();
    group.faces.forEach((face) => {
      part.adjacency[face].forEach((nb) => {
        const other = labels[nb];
        if (other !== gi && groups[other]?.faces.length) votes.set(other, (votes.get(other) || 0) + 1);
      });
    });
    let target = -1;
    let best = -1;
    votes.forEach((count, idx) => {
      if (count > best) { best = count; target = idx; }
    });
    if (target >= 0) {
      group.faces.forEach((face) => {
        labels[face] = target;
        groups[target].faces.push(face);
      });
      group.faces = [];
    }
  }
  return groups.filter((g) => g.faces.length);
}

function regenerateGroups() {
  if (!app.parts.length) return;
  try {
    setStatus(el('simplifyColours').checked ? 'Simplifying and sampling texture colours…' : 'Sampling texture colours…');
    const sourceUsed = computeFaceColours();
    const threshold = +el('variance').value;
    const ignoreBrightness = el('ignoreBrightness').checked;
    const mergeTiny = el('mergeTiny').checked;
    const minGroupSize = Math.max(1, +el('minGroupSize').value || 1);
    let globalGroupCount = 0;

    for (const part of app.parts) {
      const labels = new Int32Array(part.faceCount);
      labels.fill(-1);
      let groups = [];
      for (let seed = 0; seed < part.faceCount; seed += 1) {
        if (labels[seed] >= 0) continue;
        const groupIndex = groups.length;
        const queue = [seed];
        const faces = [];
        labels[seed] = groupIndex;
        let mean = part.faceColours[seed].slice();
        while (queue.length) {
          const face = queue.pop();
          faces.push(face);
          mean = [
            (mean[0] * (faces.length - 1) + part.faceColours[face][0]) / faces.length,
            (mean[1] * (faces.length - 1) + part.faceColours[face][1]) / faces.length,
            (mean[2] * (faces.length - 1) + part.faceColours[face][2]) / faces.length,
          ];
          part.adjacency[face].forEach((nb) => {
            if (labels[nb] < 0 && colourDistance(part.faceColours[nb], mean, ignoreBrightness) <= threshold) {
              labels[nb] = groupIndex;
              queue.push(nb);
            }
          });
        }
        groups.push({ faces, mean });
      }

      if (mergeTiny) groups = mergeTinyGroups(part, groups, labels, minGroupSize);
      groups.forEach((group) => {
        group.mean = group.faces.reduce((acc, face) => {
          acc[0] += part.faceColours[face][0];
          acc[1] += part.faceColours[face][1];
          acc[2] += part.faceColours[face][2];
          return acc;
        }, [0, 0, 0]).map((v) => v / group.faces.length);
      });

      part.generatedGroups = groups.map((group, localIndex) => ({
        id: globalGroupCount + localIndex + 1,
        faces: group.faces,
        mean: group.mean,
      }));
      rebuildGeometryForGroups(part, part.generatedGroups);
      globalGroupCount += part.generatedGroups.length;
    }

    app.generatedGroupCount = globalGroupCount;
    updateGroupList();
    el('previewMode').value = 'groupAverage';
    updatePreview();
    updateStats();
    setStatus(`Generated ${globalGroupCount} facegroups from ${sourceUsed}${el('simplifyColours').checked ? ' using a simplified palette' : ''}.`);
  } catch (error) {
    console.error(error);
    setStatus(`Generation failed: ${error?.message || error}`);
  }
}

function updatePreview() {
  const mode = el('previewMode').value;
  for (const part of app.parts) {
    if (mode === 'original') part.mesh.material = part.originalMaterial;
    else if (mode === 'random' && part.randomMaterials.length) part.mesh.material = part.randomMaterials;
    else if (part.groupAverageMaterials.length) part.mesh.material = part.groupAverageMaterials;
    else part.mesh.material = part.originalMaterial;
  }
  clearWire();
  if (el('wireToggle').checked) {
    app.parts.forEach((part) => {
      const helper = new THREE.LineSegments(
        new THREE.WireframeGeometry(part.mesh.geometry),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28 }),
      );
      helper.applyMatrix4(part.mesh.matrixWorld);
      scene.add(helper);
      app.wireHelpers.push(helper);
    });
  }
}

function updateGroupList() {
  const list = el('groupList');
  list.innerHTML = '';
  const groups = app.parts.flatMap((part) => part.generatedGroups || []);
  if (!groups.length) {
    list.innerHTML = '<div class="empty">Generate facegroups to inspect colour regions.</div>';
    return;
  }
  groups.forEach((group) => {
    const row = document.createElement('div');
    row.className = 'groupRow';
    const color = new THREE.Color(group.mean[0], group.mean[1], group.mean[2]);
    row.innerHTML = `<div class="swatch" style="background:#${color.getHexString()}"></div><div><div>Group ${group.id}</div><small>${group.faces.length.toLocaleString()} faces</small></div><small>#${group.id}</small>`;
    list.appendChild(row);
  });
}

async function loadGLB(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.glb')) {
    setStatus('Please choose an embedded .glb file.');
    return;
  }
  clearModel();
  app.sourceName = file.name;
  setStatus(`Reading ${file.name}…`);
  try {
    const buffer = await file.arrayBuffer();
    const gltf = await parseGLB(buffer);
    const root = gltf.scene || gltf.scenes?.[0];
    if (!root) throw new Error('The GLB contains no scene.');
    app.root = root;
    scene.add(app.root);
    const meshes = getMeshes();
    if (!meshes.length) throw new Error('The GLB contains no mesh geometry.');
    for (let i = 0; i < meshes.length; i += 1) {
      setStatus(`Preparing mesh ${i + 1} of ${meshes.length}…`);
      app.parts.push(await preparePart(meshes[i]));
    }
    el('meshName').textContent = file.name;
    frameModel();
    updateTextureMeta();
    updateStats();
    setStatus(`Loaded ${meshes.length} mesh part${meshes.length === 1 ? '' : 's'}.`);
  } catch (error) {
    console.error(error);
    clearModel();
    setStatus(`Load failed: ${error?.message || error}`);
  } finally {
    el('glbInput').value = '';
  }
}

async function loadReplacementTexture(file) {
  if (!file) return;
  try {
    const bitmap = await createImageBitmap(file);
    app.uploadedTexture = createTextureCanvasFromBitmap(bitmap);
    app.uploadedTextureInfo = { name: file.name, width: bitmap.width, height: bitmap.height };
    updateTextureMeta();
    updateStats();
    setStatus(`Loaded replacement texture: ${file.name}.`);
  } catch (error) {
    console.error(error);
    setStatus(`Could not read replacement texture: ${error?.message || error}`);
  } finally {
    el('textureInput').value = '';
  }
}

function exportGLB() {
  if (!app.root) return;
  setStatus('Exporting GLB…');
  const exporter = new GLTFExporter();
  exporter.parse(
    app.root,
    (result) => {
      const blob = new Blob([result], { type: 'model/gltf-binary' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = app.sourceName.replace(/\.glb$/i, '') + '-texture-facegroups.glb';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus('Exported GLB.');
    },
    (error) => setStatus(`Export failed: ${error?.message || error}`),
    { binary: true, onlyVisible: true },
  );
}

function showOriginal() {
  el('previewMode').value = 'original';
  updatePreview();
  setStatus('Showing original model materials.');
}

function randomiseGroups() {
  app.parts.forEach((part) => {
    part.randomMaterials.forEach((mat) => {
      mat.color.setHSL(Math.random(), 0.55 + Math.random() * 0.2, 0.45 + Math.random() * 0.15);
    });
  });
  el('previewMode').value = 'random';
  updatePreview();
  setStatus('Randomised facegroup preview colours.');
}

function loadDemo() {
  clearModel();
  const geometry = new THREE.SphereGeometry(1, 48, 24).toNonIndexed();
  const position = geometry.attributes.position;
  const uv = [];
  for (let i = 0; i < position.count; i += 1) {
    const v = new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i)).normalize();
    uv.push(0.5 + Math.atan2(v.z, v.x) / (2 * Math.PI), 0.5 - Math.asin(v.y) / Math.PI);
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, size, 0);
  gradient.addColorStop(0, '#7e2424');
  gradient.addColorStop(0.25, '#c93f3f');
  gradient.addColorStop(0.5, '#f16a55');
  gradient.addColorStop(0.51, '#397dd5');
  gradient.addColorStop(0.75, '#2b5fa9');
  gradient.addColorStop(1, '#57a857');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.75 });
  const mesh = new THREE.Mesh(geometry, material);

  app.root = new THREE.Group();
  app.root.add(mesh);
  scene.add(app.root);
  app.sourceName = 'demo.glb';
  preparePart(mesh).then((part) => {
    app.parts = [part];
    el('meshName').textContent = 'Demo gradient sphere';
    frameModel();
    updateTextureMeta();
    updateStats();
    setStatus('Demo loaded — colour simplification will collapse the red gradient into fewer red families.');
  });
}

el('openGlbBtn').addEventListener('click', () => el('glbInput').click());
el('openTextureBtn').addEventListener('click', () => el('textureInput').click());
el('glbInput').addEventListener('change', (e) => loadGLB(e.target.files?.[0]));
el('textureInput').addEventListener('change', (e) => loadReplacementTexture(e.target.files?.[0]));
el('demoBtn').addEventListener('click', loadDemo);
el('frameBtn').addEventListener('click', frameModel);
el('generateBtn').addEventListener('click', regenerateGroups);
el('exportBtn').addEventListener('click', exportGLB);
el('showOriginalBtn').addEventListener('click', showOriginal);
el('randomiseBtn').addEventListener('click', randomiseGroups);
el('previewMode').addEventListener('change', updatePreview);
el('gridToggle').addEventListener('change', (e) => { grid.visible = e.target.checked; });
el('wireToggle').addEventListener('change', updatePreview);
el('sourceMode').addEventListener('change', () => { updateTextureMeta(); updateStats(); });
el('variance').addEventListener('input', (e) => { el('varianceOut').textContent = `${e.target.value}%`; });

const dropZone = el('dropZone');
dropZone.addEventListener('click', () => el('glbInput').click());
['dragenter', 'dragover'].forEach((name) => dropZone.addEventListener(name, (event) => {
  event.preventDefault();
  dropZone.classList.add('drag');
}));
['dragleave', 'drop'].forEach((name) => dropZone.addEventListener(name, (event) => {
  event.preventDefault();
  dropZone.classList.remove('drag');
}));
dropZone.addEventListener('drop', (event) => {
  loadGLB(event.dataTransfer?.files?.[0]);
});

setStatus('Ready — choose a GLB with UVs and an albedo texture.');
updateTextureMeta();
updateStats();
