import * as THREE from 'three';

export function weldedAdjacency(position, percent) {
  const faceCount = position.count / 3;
  const box = new THREE.Box3().setFromBufferAttribute(position);
  const diagonal = box.getSize(new THREE.Vector3()).length() || 1;
  const tolerance = Math.max(diagonal * percent / 100, diagonal * 1e-8);
  const inv = 1 / tolerance;
  const buckets = new Map();
  const representatives = [];
  const welded = new Uint32Array(position.count);
  const key = (x, y, z) => `${x},${y},${z}`;

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const gx = Math.floor(x * inv), gy = Math.floor(y * inv), gz = Math.floor(z * inv);
    let id = -1;
    for (let dx = -1; dx <= 1 && id < 0; dx++) {
      for (let dy = -1; dy <= 1 && id < 0; dy++) {
        for (let dz = -1; dz <= 1 && id < 0; dz++) {
          const list = buckets.get(key(gx + dx, gy + dy, gz + dz));
          if (!list) continue;
          for (const candidate of list) {
            const r = representatives[candidate];
            const ox = x - r[0], oy = y - r[1], oz = z - r[2];
            if (ox * ox + oy * oy + oz * oz <= tolerance * tolerance) { id = candidate; break; }
          }
        }
      }
    }
    if (id < 0) {
      id = representatives.length;
      representatives.push([x, y, z]);
      const bucketKey = key(gx, gy, gz);
      if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
      buckets.get(bucketKey).push(id);
    }
    welded[i] = id;
  }

  const edges = new Map();
  const adjacency = Array.from({ length: faceCount }, () => new Set());
  for (let face = 0; face < faceCount; face++) {
    const a = welded[face * 3], b = welded[face * 3 + 1], c = welded[face * 3 + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      if (u === v) continue;
      const edgeKey = u < v ? `${u}|${v}` : `${v}|${u}`;
      if (!edges.has(edgeKey)) edges.set(edgeKey, []);
      edges.get(edgeKey).push(face);
    }
  }
  edges.forEach((faces) => {
    for (let i = 0; i < faces.length; i++) {
      for (let j = i + 1; j < faces.length; j++) {
        adjacency[faces[i]].add(faces[j]);
        adjacency[faces[j]].add(faces[i]);
      }
    }
  });
  return { adj: adjacency, welded: representatives.length, tolerance };
}

const colourDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function smoothLabels(part, labels, palette, options = {}) {
  const passes = Math.max(0, options.passes ?? 8);
  const majority = Math.min(1, Math.max(0.34, options.majority ?? 0.6));
  const protectContrast = options.protectContrast !== false;
  const contrastThreshold = Math.max(0, options.contrastThreshold ?? 55);
  let totalChanges = 0;

  for (let pass = 0; pass < passes; pass++) {
    const next = new Uint16Array(labels);
    let changes = 0;
    for (let face = 0; face < part.faceCount; face++) {
      const neighbours = part.adjacency[face];
      if (!neighbours || neighbours.size === 0) continue;
      const votes = new Map();
      let sameCount = 0;
      for (const neighbour of neighbours) {
        const label = labels[neighbour];
        votes.set(label, (votes.get(label) || 0) + 1);
        if (label === labels[face]) sameCount++;
      }
      let winner = labels[face], winnerCount = sameCount;
      votes.forEach((count, label) => {
        if (count > winnerCount) { winner = label; winnerCount = count; }
      });
      if (winner === labels[face]) continue;
      const ratio = winnerCount / neighbours.size;
      if (ratio < majority) continue;
      const contrast = colourDistance(palette[labels[face]], palette[winner]);
      const isolated = sameCount === 0;
      if (protectContrast && contrast > contrastThreshold && !isolated) continue;
      next[face] = winner;
      changes++;
    }
    labels.set(next);
    totalChanges += changes;
    if (!changes) break;
  }
  return totalChanges;
}

export function paletteGroups(part, labels) {
  const groups = new Map();
  for (let face = 0; face < part.faceCount; face++) {
    const paletteIndex = labels[face];
    if (!groups.has(paletteIndex)) groups.set(paletteIndex, []);
    groups.get(paletteIndex).push(face);
  }
  return [...groups].map(([paletteIndex, faces]) => ({ paletteIndex, faces }));
}

export function islands(part, labels) {
  const seen = new Uint8Array(part.faceCount);
  const groups = [];
  for (let seed = 0; seed < part.faceCount; seed++) {
    if (seen[seed]) continue;
    const paletteIndex = labels[seed];
    const queue = [seed], faces = [];
    seen[seed] = 1;
    while (queue.length) {
      const face = queue.pop();
      faces.push(face);
      for (const neighbour of part.adjacency[face]) {
        if (!seen[neighbour] && labels[neighbour] === paletteIndex) {
          seen[neighbour] = 1;
          queue.push(neighbour);
        }
      }
    }
    groups.push({ paletteIndex, faces });
  }
  return groups;
}

export function cleanup(part, labels, palette, minSize, passes) {
  let groups = islands(part, labels);
  for (let pass = 0; pass < passes; pass++) {
    const faceGroup = new Int32Array(part.faceCount);
    groups.forEach((group, index) => group.faces.forEach((face) => { faceGroup[face] = index; }));
    let changes = 0;
    const small = groups.map((group, index) => ({ group, index }))
      .filter((item) => item.group.faces.length < minSize)
      .sort((a, b) => a.group.faces.length - b.group.faces.length);

    for (const item of small) {
      const boundary = new Map();
      for (const face of item.group.faces) {
        for (const neighbour of part.adjacency[face]) {
          const target = faceGroup[neighbour];
          if (target !== item.index) boundary.set(target, (boundary.get(target) || 0) + 1);
        }
      }
      let best = -1, bestScore = -Infinity;
      boundary.forEach((shared, target) => {
        const colourPenalty = colourDistance(palette[item.group.paletteIndex], palette[groups[target].paletteIndex]);
        const targetSizeBonus = Math.log1p(groups[target].faces.length) * 2;
        const score = shared * 1000 - colourPenalty * 2 + targetSizeBonus;
        if (score > bestScore) { bestScore = score; best = target; }
      });
      if (best >= 0) {
        const newPalette = groups[best].paletteIndex;
        item.group.faces.forEach((face) => { labels[face] = newPalette; });
        changes++;
      }
    }
    if (!changes) break;
    groups = islands(part, labels);
  }
  return groups;
}
