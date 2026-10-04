/* Pure image processing, run in a worker so editing never blocks the UI. */
function processBackground(input) {
  const { width:w, height:h, pixels, mask, tolerance, removeIslands } = input;
  const n=w*h, data=new Uint8ClampedArray(pixels), before=new Uint8ClampedArray(mask), result=new Uint8ClampedArray(before);
  const colors=[];
  // Median corner patches are less sensitive to noise than a single corner pixel.
  const patch=Math.max(1,Math.min(7,Math.floor(Math.min(w,h)/20)));
  for(const [cx,cy] of [[0,0],[w-patch,0],[0,h-patch],[w-patch,h-patch]]){
    const samples=[[],[],[]];
    for(let y=cy;y<cy+patch;y++) for(let x=cx;x<cx+patch;x++) {
      const p=(y*w+x)*4;
      if(data[p+3]>16) for(let c=0;c<3;c++) samples[c].push(data[p+c]);
    }
    if(samples[0].length) colors.push(samples.map(a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)]));
  }
  const visited=new Uint8Array(n), queue=new Int32Array(n); let head=0,tail=0;
  const limit=tolerance*tolerance;
  const matches=i=>{
    const p=i*4;
    if(data[p+3]===0 || result[i]===0) return true;
    return colors.some(c=>{const r=data[p]-c[0],g=data[p+1]-c[1],b=data[p+2]-c[2];return r*r+g*g+b*b<=limit;});
  };
  const add=i=>{if(!visited[i]){visited[i]=1;if(matches(i)){queue[tail++]=i;result[i]=0;}}};
  for(let x=0;x<w;x++){add(x);add((h-1)*w+x);}
  for(let y=0;y<h;y++){add(y*w);add(y*w+w-1);}
  while(head<tail){const i=queue[head++],x=i%w;if(x>0)add(i-1);if(x<w-1)add(i+1);if(i>=w)add(i-w);if(i<n-w)add(i+w);}
  // Fine-detail mode only recovers plausible mixed edge pixels erased by
  // the standard pass. Existing retained pixels are never eroded or blurred.
  const edgeIndices=[],edgeColors=[];let refinedPixels=0;
  if(input.fineDetails && colors.length){
    const standard=result.slice();
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x,p=i*4;
      if(standard[i]!==0||before[i]===0||data[p+3]===0)continue;
      let background=colors[0],backgroundDistance=Infinity;
      for(const color of colors){const distance=(data[p]-color[0])**2+(data[p+1]-color[1])**2+(data[p+2]-color[2])**2;if(distance<backgroundDistance){backgroundDistance=distance;background=color;}}
      // Ignore nearly uniform background and compression noise.
      if(backgroundDistance<36)continue;
      let best=null;
      for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
        if(!dx&&!dy||dx*dx+dy*dy>10||x+dx<0||x+dx>=w||y+dy<0||y+dy>=h)continue;
        const j=(y+dy)*w+x+dx,q=j*4;
        if(standard[j]<250||data[q+3]<250)continue;
        const vector=[data[q]-background[0],data[q+1]-background[1],data[q+2]-background[2]];
        const length=vector.reduce((sum,v)=>sum+v*v,0);
        if(length<Math.max(1600,limit*2.25))continue;
        const observed=[data[p]-background[0],data[p+1]-background[1],data[p+2]-background[2]];
        const coverage=observed.reduce((sum,v,c)=>sum+v*vector[c],0)/length;
        if(coverage<0.025||coverage>0.85)continue;
        const residual=observed.reduce((sum,v,c)=>sum+(v-coverage*vector[c])**2,0);
        if(residual>16)continue;
        const score=residual+(dx*dx+dy*dy)*0.1;
        if(!best||score<best.score)best={coverage,q,score};
      }
      if(!best)continue;
      result[i]=Math.min(before[i],Math.round(best.coverage*255));
      edgeIndices.push(i);edgeColors.push(data[best.q],data[best.q+1],data[best.q+2]);
    }
  }
  let removedRegions=0;
  if(removeIslands){
    // Eight-neighbour connectivity preserves diagonal strands and removes all
    // separate fragments, rather than leaving remote specks after flood filling.
    const labels=new Int32Array(n);let id=0,best=0,bestSize=0;
    const visible=i=>result[i]>0 && data[i*4+3]>0;
    for(let start=0;start<n;start++){
      if(labels[start] || !visible(start))continue;
      id++;head=0;tail=1;queue[0]=start;labels[start]=id;
      while(head<tail){const i=queue[head++],x=i%w,y=Math.floor(i/w);
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          if((!dx&&!dy)||x+dx<0||x+dx>=w||y+dy<0||y+dy>=h)continue;
          const k=i+dy*w+dx;if(!labels[k]&&visible(k)){labels[k]=id;queue[tail++]=k;}
        }
      }
      if(tail>bestSize){bestSize=tail;best=id;}
    }
    for(let i=0;i<n;i++)if(labels[i]!==best)result[i]=0;
    removedRegions=Math.max(0,id-1);
  }
  const keptIndices=[],keptColors=[];
  for(let e=0;e<edgeIndices.length;e++)if(result[edgeIndices[e]]){keptIndices.push(edgeIndices[e]);keptColors.push(...edgeColors.slice(e*3,e*3+3));}
  refinedPixels=keptIndices.length;
  let remaining=0,removed=0;
  for(let i=0;i<n;i++){if(result[i] && data[i*4+3])remaining++;if(result[i]<before[i])removed++;}
  return {mask:result,removedRegions,remaining,removed,refinedPixels,edgeIndices:new Uint32Array(keptIndices),edgeColors:new Uint8ClampedArray(keptColors)};
}
if(typeof module!=='undefined')module.exports={processBackground};
