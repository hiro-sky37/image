/* Evenly resample a closed outline, then build a periodic cubic spline.
   The final segment and first segment share exactly the same tangent. */
function smoothContour(points, spacing=2) {
  const clean=points.filter((p,i)=>!i||Math.hypot(p.x-points[i-1].x,p.y-points[i-1].y)>0.001);
  if(clean.length<3)return null;
  const area=Math.abs(clean.reduce((sum,p,i)=>{const q=clean[(i+1)%clean.length];return sum+p.x*q.y-q.x*p.y;},0))/2;
  if(area<spacing*spacing)return null;
  const lengths=clean.map((p,i)=>{const q=clean[(i+1)%clean.length];return Math.hypot(q.x-p.x,q.y-p.y);});
  const perimeter=lengths.reduce((a,b)=>a+b,0);
  if(perimeter<spacing*3)return null;
  const count=Math.min(1800,Math.max(3,Math.ceil(perimeter/spacing))),step=perimeter/count;
  const samples=[];let segment=0,offset=0;
  for(let i=0;i<count;i++){
    const distance=i*step;
    while(segment<clean.length-1&&offset+lengths[segment]<distance){offset+=lengths[segment++];}
    const a=clean[segment],b=clean[(segment+1)%clean.length],t=lengths[segment]?(distance-offset)/lengths[segment]:0;
    samples.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
  }
  const segments=samples.map((p,i)=>{
    const previous=samples[(i+count-1)%count],next=samples[(i+1)%count],after=samples[(i+2)%count];
    return {from:p,c1:{x:p.x+(next.x-previous.x)/6,y:p.y+(next.y-previous.y)/6},c2:{x:next.x-(after.x-p.x)/6,y:next.y-(after.y-p.y)/6},to:next};
  });
  return {segments};
}
function traceContour(context,contour,append=false){
  if(!append)context.beginPath();
  const first=contour.segments[0].from;context.moveTo(first.x,first.y);
  for(const s of contour.segments)context.bezierCurveTo(s.c1.x,s.c1.y,s.c2.x,s.c2.y,s.to.x,s.to.y);
  context.closePath();
}
if(typeof module!=='undefined')module.exports={smoothContour,traceContour};
