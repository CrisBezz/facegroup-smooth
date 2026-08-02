export function buildTextureRegions(q,{minPixels=256,passes=6,eightConnected=true}={}){
  const {width,height,indexMap,palette}=q;
  let labels=new Int32Array(width*height);labels.fill(-1);
  const regions=[];
  const dirs=eightConnected?[[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]:[[1,0],[-1,0],[0,1],[0,-1]];
  let id=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=y*width+x;if(labels[p]>=0)continue;
    const colour=indexMap[p],queue=[p],pixels=[];labels[p]=id;
    while(queue.length){const cur=queue.pop(),cx=cur%width,cy=(cur/width)|0;pixels.push(cur);
      for(const[dX,dY]of dirs){const nx=cx+dX,ny=cy+dY;if(nx<0||ny<0||nx>=width||ny>=height)continue;const n=ny*width+nx;if(labels[n]<0&&indexMap[n]===colour){labels[n]=id;queue.push(n)}}
    }
    regions.push({id,paletteIndex:colour,pixels,size:pixels.length});id++;
  }

  let current=regions;
  for(let pass=0;pass<passes;pass++){
    const small=current.filter(r=>r.size<minPixels).sort((a,b)=>a.size-b.size);if(!small.length)break;
    const regionById=new Map(current.map(r=>[r.id,r]));let changed=0;
    for(const r of small){const boundary=new Map();
      for(const p of r.pixels){const x=p%width,y=(p/width)|0;for(const[dX,dY]of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dX,ny=y+dY;if(nx<0||ny<0||nx>=width||ny>=height)continue;const n=ny*width+nx,target=labels[n];if(target!==r.id)boundary.set(target,(boundary.get(target)||0)+1)}}
      let best=-1,bestScore=-Infinity;boundary.forEach((shared,target)=>{const tr=regionById.get(target);if(!tr)return;const a=palette[r.paletteIndex],b=palette[tr.paletteIndex];const d=Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);const score=shared*1000-d*3+Math.log1p(tr.size);if(score>bestScore){bestScore=score;best=target}});
      if(best>=0){for(const p of r.pixels)labels[p]=best;changed++}
    }
    if(!changed)break;
    const map=new Map();for(let p=0;p<labels.length;p++){const rid=labels[p];if(!map.has(rid))map.set(rid,[]);map.get(rid).push(p)}
    current=[...map].map(([rid,pixels])=>{const old=regionById.get(rid);return{id:rid,paletteIndex:old?.paletteIndex??indexMap[pixels[0]],pixels,size:pixels.length}});
  }

  const remap=new Map();current.forEach((r,i)=>remap.set(r.id,i));
  const regionMap=new Uint32Array(labels.length);for(let i=0;i<labels.length;i++)regionMap[i]=remap.get(labels[i]);
  const compact=current.map((r,i)=>({id:i,paletteIndex:r.paletteIndex,size:r.size,colour:palette[r.paletteIndex]}));
  return{width,height,regionMap,regions:compact,regionPalette:compact.map(r=>r.colour)};
}

const patterns={1:[[1/3,1/3,1/3]],4:[[1/3,1/3,1/3],[.65,.175,.175],[.175,.65,.175],[.175,.175,.65]],7:[[1/3,1/3,1/3],[.7,.15,.15],[.15,.7,.15],[.15,.15,.7],[.5,.5,0],[0,.5,.5],[.5,0,.5]],13:[[1/3,1/3,1/3],[.7,.15,.15],[.15,.7,.15],[.15,.15,.7],[.5,.5,0],[0,.5,.5],[.5,0,.5],[.6,.2,.2],[.2,.6,.2],[.2,.2,.6],[.4,.4,.2],[.4,.2,.4],[.2,.4,.4]]};
function sample(map,u,v){u=((u%1)+1)%1;v=((v%1)+1)%1;const x=Math.min(map.width-1,Math.max(0,Math.round(u*(map.width-1)))),y=Math.min(map.height-1,Math.max(0,Math.round((1-v)*(map.height-1))));return map.regionMap[y*map.width+x]}
export function faceTextureRegion(part,face,map,count=13){if(!part.uv)return 0;const ps=patterns[count]||patterns[13],votes=new Map();for(const b of ps){let u=0,v=0;for(let k=0;k<3;k++){u+=part.uv.getX(face*3+k)*b[k];v+=part.uv.getY(face*3+k)*b[k]}const r=sample(map,u,v);votes.set(r,(votes.get(r)||0)+1)}let best=0,n=-1;votes.forEach((c,r)=>{if(c>n){n=c;best=r}});return best}
