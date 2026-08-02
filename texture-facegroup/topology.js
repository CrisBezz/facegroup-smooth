import * as THREE from 'three';

export function weldedAdjacency(position, percent) {
  const faceCount = position.count / 3;
  const box = new THREE.Box3().setFromBufferAttribute(position);
  const diagonal = box.getSize(new THREE.Vector3()).length() || 1;
  const tolerance = Math.max(diagonal * percent / 100, diagonal * 1e-8);
  const inv = 1 / tolerance;
  const buckets = new Map(), representatives = [];
  const welded = new Uint32Array(position.count);
  const key = (x,y,z) => `${x},${y},${z}`;
  for (let i=0;i<position.count;i++) {
    const x=position.getX(i),y=position.getY(i),z=position.getZ(i);
    const gx=Math.floor(x*inv),gy=Math.floor(y*inv),gz=Math.floor(z*inv);
    let id=-1;
    for(let dx=-1;dx<=1&&id<0;dx++)for(let dy=-1;dy<=1&&id<0;dy++)for(let dz=-1;dz<=1&&id<0;dz++){
      const list=buckets.get(key(gx+dx,gy+dy,gz+dz)); if(!list) continue;
      for(const c of list){const r=representatives[c],ox=x-r[0],oy=y-r[1],oz=z-r[2];if(ox*ox+oy*oy+oz*oz<=tolerance*tolerance){id=c;break;}}
    }
    if(id<0){id=representatives.length;representatives.push([x,y,z]);const k=key(gx,gy,gz);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(id);}
    welded[i]=id;
  }
  const edges=new Map(), adjacency=Array.from({length:faceCount},()=>new Set());
  for(let f=0;f<faceCount;f++){
    const a=welded[f*3],b=welded[f*3+1],c=welded[f*3+2];
    for(const [u,v] of [[a,b],[b,c],[c,a]]){if(u===v)continue;const k=u<v?`${u}|${v}`:`${v}|${u}`;if(!edges.has(k))edges.set(k,[]);edges.get(k).push(f);}
  }
  edges.forEach(fs=>{for(let i=0;i<fs.length;i++)for(let j=i+1;j<fs.length;j++){adjacency[fs[i]].add(fs[j]);adjacency[fs[j]].add(fs[i]);}});
  return {adj:adjacency,welded:representatives.length,tolerance};
}

export const colourDistance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);

export function smoothLabels(part,labels,palette,{passes=8,majority=.6,protectContrast=true,contrastThreshold=55}={}){
  let total=0; majority=Math.min(1,Math.max(.34,majority));
  for(let pass=0;pass<passes;pass++){
    const next=new Uint16Array(labels);let changes=0;
    for(let f=0;f<part.faceCount;f++){
      const ns=part.adjacency[f];if(!ns?.size)continue;const votes=new Map();let same=0;
      for(const n of ns){const l=labels[n];votes.set(l,(votes.get(l)||0)+1);if(l===labels[f])same++;}
      let winner=labels[f],count=same;votes.forEach((v,k)=>{if(v>count){count=v;winner=k;}});
      if(winner===labels[f]||count/ns.size<majority)continue;
      const contrast=colourDistance(palette[labels[f]],palette[winner]);
      if(protectContrast&&contrast>contrastThreshold&&same>0)continue;
      next[f]=winner;changes++;
    }
    labels.set(next);total+=changes;if(!changes)break;
  }
  return total;
}

export function paletteGroups(part,labels){const m=new Map();for(let f=0;f<part.faceCount;f++){const p=labels[f];if(!m.has(p))m.set(p,[]);m.get(p).push(f);}return[...m].map(([paletteIndex,faces])=>({paletteIndex,faces}));}

export function islands(part,labels){
  const seen=new Uint8Array(part.faceCount),groups=[];
  for(let seed=0;seed<part.faceCount;seed++){
    if(seen[seed])continue;const p=labels[seed],q=[seed],faces=[];seen[seed]=1;
    while(q.length){const f=q.pop();faces.push(f);for(const n of part.adjacency[f])if(!seen[n]&&labels[n]===p){seen[n]=1;q.push(n);}}
    groups.push({paletteIndex:p,faces});
  }
  return groups;
}

function groupGraph(part,groups){
  const faceGroup=new Int32Array(part.faceCount);groups.forEach((g,i)=>g.faces.forEach(f=>faceGroup[f]=i));
  const boundaries=Array.from({length:groups.length},()=>new Map());
  for(let f=0;f<part.faceCount;f++)for(const n of part.adjacency[f]){
    if(n<f)continue;const a=faceGroup[f],b=faceGroup[n];if(a===b)continue;
    boundaries[a].set(b,(boundaries[a].get(b)||0)+1);boundaries[b].set(a,(boundaries[b].get(a)||0)+1);
  }
  return {faceGroup,boundaries};
}

export function cleanup(part,labels,palette,minSize,passes){
  let groups=islands(part,labels);
  for(let pass=0;pass<passes;pass++){
    const {boundaries}=groupGraph(part,groups);let changed=0;
    const order=groups.map((g,i)=>({g,i})).filter(x=>x.g.faces.length<minSize).sort((a,b)=>a.g.faces.length-b.g.faces.length);
    for(const {g,i} of order){let best=-1,bestScore=-Infinity;
      boundaries[i].forEach((shared,t)=>{const d=colourDistance(palette[g.paletteIndex],palette[groups[t].paletteIndex]);const score=shared*1000-d*2+Math.log1p(groups[t].faces.length)*2;if(score>bestScore){bestScore=score;best=t;}});
      if(best>=0){g.faces.forEach(f=>labels[f]=groups[best].paletteIndex);changed++;}
    }
    if(!changed)break;groups=islands(part,labels);
  }
  return groups;
}

export function reduceRegions(part,labels,palette,options={}){
  const target=Math.max(1,options.target??120),passes=Math.max(1,options.passes??12),maxColour=Math.max(0,options.maxColour??70),preferBelow=Math.max(1,options.preferBelow??1200),protect=options.protect!==false,protectSize=Math.max(1,options.protectSize??500),protectContrast=Math.max(0,options.protectContrast??80);
  let groups=islands(part,labels), merges=0;
  for(let pass=0;pass<passes&&groups.length>target;pass++){
    const {boundaries}=groupGraph(part,groups);
    const candidates=groups.map((g,i)=>({g,i})).sort((a,b)=>a.g.faces.length-b.g.faces.length);
    let changed=0;
    for(const {g,i} of candidates){
      if(groups.length-changed<=target)break;
      if(g.faces.length>preferBelow&&pass<passes-1)continue;
      let maxBoundaryContrast=0;
      boundaries[i].forEach((_,t)=>{maxBoundaryContrast=Math.max(maxBoundaryContrast,colourDistance(palette[g.paletteIndex],palette[groups[t].paletteIndex]));});
      if(protect&&g.faces.length<=protectSize&&maxBoundaryContrast>=protectContrast)continue;
      let best=-1,bestScore=-Infinity;
      boundaries[i].forEach((shared,t)=>{
        const d=colourDistance(palette[g.paletteIndex],palette[groups[t].paletteIndex]);
        if(d>maxColour) return;
        const ratio=shared/Math.max(1,Math.sqrt(g.faces.length));
        const score=ratio*1000-d*8+Math.log1p(groups[t].faces.length)*3;
        if(score>bestScore){bestScore=score;best=t;}
      });
      if(best>=0){g.faces.forEach(f=>labels[f]=groups[best].paletteIndex);changed++;}
    }
    if(!changed)break;merges+=changed;groups=islands(part,labels);
  }
  return {groups,merges};
}
