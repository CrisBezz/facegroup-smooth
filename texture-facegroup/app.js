import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';

const $=id=>document.getElementById(id), viewport=$('viewport');
const scene=new THREE.Scene();scene.background=new THREE.Color(0x111820);
const camera=new THREE.PerspectiveCamera(45,1,.01,10000);camera.position.set(3,2,4);
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;viewport.appendChild(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;
scene.add(new THREE.HemisphereLight(0xffffff,0x334455,2.2));const sun=new THREE.DirectionalLight(0xffffff,2.6);sun.position.set(4,8,6);scene.add(sun);const grid=new THREE.GridHelper(20,40,0x536272,0x2b3540);scene.add(grid);

const BASE_GROUPS=[
  {key:'skin',name:'Skin',colour:0xe3aa91},
  {key:'hair',name:'Hair',colour:0x513229},
  {key:'lips',name:'Lips',colour:0xc75672},
  {key:'eyes',name:'Eyes',colour:0x7fa2bd},
  {key:'brows',name:'Brows / Lashes',colour:0x302521},
  {key:'other',name:'Other',colour:0x909aa3}
];
const EXTRA_EYES=[
  {key:'sclera',name:'Eye White',colour:0xd8e1e5},
  {key:'iris',name:'Iris',colour:0x6689a3},
  {key:'pupil',name:'Pupil',colour:0x171b20}
];
const app={root:null,name:'model.glb',parts:[],uploaded:null,groups:[],classified:0};

function status(t){$('status').textContent=t;$('statusPill').textContent=t}
function resize(){const b=viewport.getBoundingClientRect();if(!b.width)return;camera.aspect=b.width/b.height;camera.updateProjectionMatrix();renderer.setSize(b.width,b.height,false)}
new ResizeObserver(resize).observe(viewport);resize();(function loop(){requestAnimationFrame(loop);controls.update();renderer.render(scene,camera)})();

const toLinear=x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4;
function lab(c){let[r,g,b]=c,x=(r*.4124+g*.3576+b*.1805)/.95047,y=r*.2126+g*.7152+b*.0722,z=(r*.0193+g*.1192+b*.9505)/1.08883,f=t=>t>.008856?Math.cbrt(t):7.787*t+16/116;x=f(x);y=f(y);z=f(z);return[116*y-16,500*(x-y),200*(y-z)]}
function delta(a,b){const A=lab(a),B=lab(b);return Math.hypot(A[0]-B[0],A[1]-B[1],A[2]-B[2])}
function luminance(c){return .2126*c[0]+.7152*c[1]+.0722*c[2]}
function medianColour(list){if(!list.length)return[.6,.45,.38];const out=[];for(let k=0;k<3;k++){const a=list.map(c=>c[k]).sort((x,y)=>x-y);out[k]=a[Math.floor(a.length/2)]}return out}
function textureData(image){const c=document.createElement('canvas'),x=c.getContext('2d',{willReadFrequently:true});c.width=image.width;c.height=image.height;x.drawImage(image,0,0);return{w:c.width,h:c.height,d:x.getImageData(0,0,c.width,c.height).data}}
function sample(tex,u,v){u=((u%1)+1)%1;v=((v%1)+1)%1;const x=Math.round(u*(tex.w-1)),y=Math.round((1-v)*(tex.h-1)),i=(y*tex.w+x)*4;return[toLinear(tex.d[i]/255),toLinear(tex.d[i+1]/255),toLinear(tex.d[i+2]/255)]}
function adjacency(pos){const n=pos.count/3,map=new Map(),a=Array.from({length:n},()=>new Set()),key=i=>`${Math.round(pos.getX(i)*1e5)},${Math.round(pos.getY(i)*1e5)},${Math.round(pos.getZ(i)*1e5)}`;for(let f=0;f<n;f++){const v=[key(f*3),key(f*3+1),key(f*3+2)];for(const[i,j]of[[0,1],[1,2],[2,0]]){const e=v[i]<v[j]?v[i]+'|'+v[j]:v[j]+'|'+v[i];if(!map.has(e))map.set(e,[]);map.get(e).push(f)}}for(const fs of map.values())for(let i=0;i<fs.length;i++)for(let j=i+1;j<fs.length;j++)a[fs[i]].add(fs[j]),a[fs[j]].add(fs[i]);return a}
function material(c){return new THREE.MeshStandardMaterial({color:c instanceof THREE.Color?c:new THREE.Color(c),roughness:.72,side:THREE.DoubleSide})}

async function prepare(mesh){const original=mesh.material,g=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone();g.computeVertexNormals();mesh.geometry=g;const mats=Array.isArray(original)?original:[original],map=mats.find(m=>m?.map)?.map,tex=map?.image?textureData(map.image):null;return{mesh,original,pos:g.attributes.position,norm:g.attributes.normal,uv:g.attributes.uv,faceCount:g.attributes.position.count/3,adj:adjacency(g.attributes.position),tex,colours:[],centres:[],labels:null,confidence:null,materials:[]}}
function clear(){if(app.root)scene.remove(app.root);app.root=null;app.parts=[];app.groups=[];app.classified=0;$('meshName').textContent='No mesh loaded';$('textureMeta').textContent='No model loaded.';renderList();stats()}
function frame(){if(!app.root)return;const b=new THREE.Box3().setFromObject(app.root),s=b.getSize(new THREE.Vector3()),m=b.getCenter(new THREE.Vector3()),d=Math.max(s.x,s.y,s.z)||1;controls.target.copy(m);camera.position.copy(m).add(new THREE.Vector3(d*1.5,d*.9,d*1.5));camera.near=Math.max(d/1000,.001);camera.far=d*1000;camera.updateProjectionMatrix()}
function stats(){const tris=app.parts.reduce((n,p)=>n+p.faceCount,0);$('trianglesStat').textContent=tris.toLocaleString();$('groupsStat').textContent=app.groups.length.toLocaleString();$('classifiedStat').textContent=Math.round(app.classified*100)+'%';$('meshesStat').textContent=app.parts.length;for(const id of['frameBtn','generateBtn'])$(id).disabled=!app.root;$('exportBtn').disabled=!app.groups.length}
function faceColour(p,f){const tex=app.uploaded||p.tex;if(tex&&p.uv){let u=0,v=0;for(let k=0;k<3;k++){u+=p.uv.getX(f*3+k)/3;v+=p.uv.getY(f*3+k)/3}return sample(tex,u,v)}const m=Array.isArray(p.original)?p.original[0]:p.original,c=m?.color||new THREE.Color(1,1,1);return[c.r,c.g,c.b]}
function centroid(p,f){const q=new THREE.Vector3();for(let k=0;k<3;k++)q.add(new THREE.Vector3(p.pos.getX(f*3+k),p.pos.getY(f*3+k),p.pos.getZ(f*3+k)));return q.multiplyScalar(1/3)}
function axes(){const up=$('upAxis').value,front=$('frontAxis').value;const U=up==='y'?1:2;let F=2,sign=1;if(front.startsWith('x'))F=0;if(front.startsWith('z'))F=2;if(front.endsWith('-'))sign=-1;const W=[0,1,2].find(i=>i!==U&&i!==F);return{U,F,W,sign}}
function normalizePart(p){const b=new THREE.Box3().setFromBufferAttribute(p.pos),min=b.min,max=b.max,{U,F,W,sign}=axes(),range=[max.x-min.x,max.y-min.y,max.z-min.z];return p.centres.map(v=>{const a=[v.x,v.y,v.z],n=[(a[0]-min.x)/(range[0]||1),(a[1]-min.y)/(range[1]||1),(a[2]-min.z)/(range[2]||1)];const u=n[U],w=n[W]-.5,f=sign>0?n[F]:1-n[F];return{u,w,f}})}
function classifyPart(p,defs){p.colours=Array.from({length:p.faceCount},(_,f)=>faceColour(p,f));p.centres=Array.from({length:p.faceCount},(_,f)=>centroid(p,f));const npos=normalizePart(p),sens=+$('featureSensitivity').value,eyeW=+$('eyeWidth').value/100,eyeH=+$('eyeHeight').value/100,lipS=+$('lipScale').value/100,skinTol=+$('skinTolerance').value,hairTol=+$('hairTolerance').value;
  const skinSamples=[],hairSamples=[];
  for(let f=0;f<p.faceCount;f++){const q=npos[f],c=p.colours[f];if(q.f>.58&&Math.abs(q.w)<.23&&q.u>.38&&q.u<.78)skinSamples.push(c);if((q.u>.72||Math.abs(q.w)>.34||q.f<.45)&&luminance(c)<.42)hairSamples.push(c)}
  const skin=medianColour(skinSamples),hair=medianColour(hairSamples.length?hairSamples:p.colours.filter(c=>luminance(c)<luminance(skin)*.72));
  const Ls=lab(skin),Lh=lab(hair);p.labels=new Int16Array(p.faceCount);p.confidence=new Float32Array(p.faceCount);p.labels.fill(defs.findIndex(x=>x.key==='other'));
  const idx=key=>defs.findIndex(x=>x.key===key),skinI=idx('skin'),hairI=idx('hair'),lipI=idx('lips'),eyeI=idx('eyes'),browI=idx('brows'),scleraI=idx('sclera'),irisI=idx('iris'),pupilI=idx('pupil');
  for(let f=0;f<p.faceCount;f++){const q=npos[f],c=p.colours[f],Lc=lab(c),ds=delta(c,skin),dh=delta(c,hair),front=q.f>.52,central=Math.abs(q.w)<.42;
    let label=skinI,conf=Math.max(0,1-ds/(skinTol*1.8));
    const hairZone=q.u>.69||Math.abs(q.w)>.31||q.f<.45;
    if((dh<hairTol&&dh<ds*.95)||(hairZone&&dh<skinTol*1.25)){label=hairI;conf=Math.max(.45,1-dh/(hairTol*1.8))}
    const lipZone=front&&Math.abs(q.w)<.16*lipS&&q.u>.34&&q.u<.49;
    const redShift=Lc[1]-Ls[1],lipDark=Ls[0]-Lc[0];
    if(lipZone&&redShift>5/sens&&lipDark>-8&&ds>6){label=lipI;conf=Math.min(1,(redShift/24+Math.max(0,lipDark)/30)*sens)}
    const eyeZone=front&&Math.abs(q.w)>.07&&Math.abs(q.w)<.31*eyeW&&q.u>.53&&q.u<.69*eyeH;
    const eyeContrast=ds;
    if(eyeZone&&eyeContrast>8/sens){
      if(scleraI>=0){const lum=luminance(c);if(lum>luminance(skin)*.78&&Math.abs(Lc[1])<18)label=scleraI;else if(lum<.12)label=pupilI;else label=irisI>=0?irisI:eyeI}else label=eyeI;
      conf=Math.min(1,eyeContrast/28*sens)
    }
    const browZone=front&&Math.abs(q.w)>.07&&Math.abs(q.w)<.34&&q.u>.66&&q.u<.77;
    if(browZone&&luminance(c)<luminance(skin)*.62&&dh<ds*1.35){label=browI;conf=Math.min(1,(luminance(skin)-luminance(c))/.35)}
    if(!central&&q.u<.25&&label===skinI&&ds>skinTol)label=idx('other');
    p.labels[f]=label;p.confidence[f]=Math.max(.05,conf)
  }
  semanticSmooth(p,Math.max(0,+$('semanticPasses').value));
  return{skin,hair,Ls,Lh}
}
function semanticSmooth(p,passes){const protectedKeys=new Set(['lips','eyes','sclera','iris','pupil','brows']),defs=app.groups;for(let z=0;z<passes;z++){const next=new Int16Array(p.labels);let changes=0;for(let f=0;f<p.faceCount;f++){const current=defs[p.labels[f]]?.key;if(protectedKeys.has(current)&&p.confidence[f]>.35)continue;const votes=new Map();for(const n of p.adj[f]){const l=p.labels[n];votes.set(l,(votes.get(l)||0)+p.confidence[n])}let best=p.labels[f],score=0;votes.forEach((v,k)=>{if(v>score){score=v;best=k}});if(best!==p.labels[f]&&score>1.4){next[f]=best;changes++}}p.labels=next;if(!changes)break}}
function rebuildSemantic(p){const P=[],N=[],U=[],g=new THREE.BufferGeometry();let start=0;p.materials.forEach(m=>m.dispose());p.materials=[];for(let gi=0;gi<app.groups.length;gi++){const faces=[];for(let f=0;f<p.faceCount;f++)if(p.labels[f]===gi)faces.push(f);if(!faces.length)continue;for(const f of faces)for(let k=0;k<3;k++){const q=f*3+k;P.push(p.pos.getX(q),p.pos.getY(q),p.pos.getZ(q));N.push(p.norm.getX(q),p.norm.getY(q),p.norm.getZ(q));if(p.uv)U.push(p.uv.getX(q),p.uv.getY(q))}g.addGroup(start,faces.length*3,gi);start+=faces.length*3;const m=material(app.groups[gi].colour);m.name=app.groups[gi].name;p.materials[gi]=m}g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(N,3));if(U.length)g.setAttribute('uv',new THREE.Float32BufferAttribute(U,2));p.mesh.geometry=g;p.mesh.material=p.materials}
function classify(){if(!app.root)return;try{status('Detecting skin, hair and facial feature zones…');app.groups=$('separateEyes').checked?[...BASE_GROUPS.filter(g=>g.key!=='eyes'),...EXTRA_EYES]:BASE_GROUPS.map(g=>({...g}));const notes=[];for(const p of app.parts){const seeds=classifyPart(p,app.groups);rebuildSemantic(p);notes.push(`Skin seed ΔE reference: ${lab(seeds.skin)[0].toFixed(1)} L* · Hair seed: ${lab(seeds.hair)[0].toFixed(1)} L*`)}const total=app.parts.reduce((n,p)=>n+p.faceCount,0),classified=app.parts.reduce((n,p)=>n+Array.from(p.labels).filter(x=>app.groups[x]?.key!=='other').length,0);app.classified=classified/Math.max(1,total);renderList();preview();stats();$('detectionNotes').innerHTML=notes.join('<br>')+'<br><br>Eye and lip labels are created directly at face level before smoothing.';status(`Automatic classification complete: ${app.groups.length} final groups.`)}catch(e){console.error(e);status('Classification failed: '+(e.message||e))}}
function preview(){const mode=$('previewMode').value;for(const p of app.parts){if(mode==='original'){p.mesh.material=p.original;continue}if(mode==='semantic'){p.mesh.material=p.materials;continue}const mats=app.groups.map((g,i)=>{const faces=Array.from(p.labels).map((l,f)=>l===i?p.confidence[f]:null).filter(v=>v!==null),avg=faces.length?faces.reduce((a,b)=>a+b,0)/faces.length:0;return material(new THREE.Color(avg,avg,avg))});p.mesh.material=mats}}
function renderList(){const list=$('groupList');list.innerHTML='';if(!app.groups.length){list.innerHTML='<div class="empty">Load a model and run automatic classification.</div>';return}app.groups.forEach((g,i)=>{let faces=0;app.parts.forEach(p=>{if(p.labels)for(const l of p.labels)if(l===i)faces++});const row=document.createElement('div');row.className='groupRow';row.innerHTML=`<div class="swatch" style="background:#${new THREE.Color(g.colour).getHexString()}"></div><div><div>${g.name}</div><small>${faces.toLocaleString()} faces</small></div><small>${faces?Math.round(faces/app.parts.reduce((n,p)=>n+p.faceCount,0)*100):0}%</small>`;list.appendChild(row)})}
async function load(file){if(!file)return;if(!file.name.toLowerCase().endsWith('.glb')){status('Please choose a .glb file.');return}clear();app.name=file.name;status('Loading GLB…');try{const buffer=await file.arrayBuffer(),gltf=await new Promise((res,rej)=>new GLTFLoader().parse(buffer,'',res,rej));app.root=gltf.scene||gltf.scenes?.[0];if(!app.root)throw new Error('No scene found.');scene.add(app.root);const meshes=[];app.root.traverse(o=>{if(o.isMesh&&o.geometry)meshes.push(o)});if(!meshes.length)throw new Error('No mesh geometry found.');for(const m of meshes)app.parts.push(await prepare(m));$('meshName').textContent=file.name;$('textureMeta').textContent=app.parts.some(p=>p.tex)?'Embedded albedo detected.':'No embedded albedo detected — load a replacement albedo.';frame();stats();status(`Loaded ${meshes.length} mesh part${meshes.length===1?'':'s'}.`)}catch(e){console.error(e);clear();status('Load failed: '+(e.message||e))}}
function exportGLB(){if(!app.groups.length)return;new GLTFExporter().parse(app.root,b=>{const url=URL.createObjectURL(new Blob([b],{type:'model/gltf-binary'})),a=document.createElement('a');a.href=url;a.download=app.name.replace(/\.glb$/i,'')+'-automatic-facegroups.glb';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('Exported automatic facegroup GLB.')},e=>status('Export failed: '+e.message),{binary:true})}

$('openGlbBtn').onclick=()=>{$('glbInput').value='';$('glbInput').click()};$('glbInput').onchange=async e=>{const f=e.target.files?.[0];await load(f);e.target.value=''};$('openTextureBtn').onclick=()=>{$('textureInput').value='';$('textureInput').click()};$('textureInput').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;try{const b=await createImageBitmap(f);app.uploaded=textureData(b);$('textureMeta').textContent=`Replacement albedo loaded: ${f.name}`;status('Replacement albedo ready.')}catch(err){status('Albedo load failed: '+err.message)}e.target.value=''};$('frameBtn').onclick=frame;$('generateBtn').onclick=classify;$('exportBtn').onclick=exportGLB;$('previewMode').onchange=preview;$('gridToggle').onchange=e=>grid.visible=e.target.checked;const dz=$('dropZone');dz.onclick=()=>$('openGlbBtn').click();dz.ondragover=e=>e.preventDefault();dz.ondrop=e=>{e.preventDefault();load(e.dataTransfer.files?.[0])};status('Ready — load a UV-mapped character-head GLB.');renderList();stats();
