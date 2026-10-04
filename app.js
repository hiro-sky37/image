'use strict';
const $=id=>document.getElementById(id);
const canvas=$('canvas'),ctx=canvas.getContext('2d'),overlay=$('overlay'),octx=overlay.getContext('2d');
const original=document.createElement('canvas'),originalCtx=original.getContext('2d',{willReadFrequently:true});
const maskCanvas=document.createElement('canvas'),mctx=maskCanvas.getContext('2d',{willReadFrequently:true});
let loaded=false,busy=false,tool='auto',filename='',w=0,h=0,selection=null,drag=null,showOriginal=false;
let past=[],future=[],historyBytes=0,renderPending=false,worker=null;
const HISTORY_LIMIT=48*1024*1024;
function status(message,error=false){$('status').classList.toggle('error',error);$('status').querySelector('span').textContent=message;}
function controls(){
  $('undo').disabled=busy||!past.length;$('redo').disabled=busy||!future.length;
  for(const id of ['reset','download','compare','auto-run'])$(id).disabled=!loaded||busy;
  $('choose').disabled=$('empty-choose').disabled=busy;
  $('apply-selection').disabled=$('cancel-selection').disabled=!selection||busy||!!drag;
  document.querySelectorAll('.tool').forEach(b=>b.disabled=busy);
  $('tolerance').disabled=$('islands').disabled=$('brush-size').disabled=busy;
  $('canvas-wrap').classList.toggle('working',busy);overlay.style.pointerEvents=busy?'none':'auto';
}
function setBusy(value){busy=value;$('busy').hidden=!value;controls();}
function alpha(){const d=mctx.getImageData(0,0,w,h).data,a=new Uint8ClampedArray(w*h);for(let i=0;i<a.length;i++)a[i]=d[i*4+3];return a;}
function putAlpha(a){const image=mctx.createImageData(w,h);for(let i=0;i<a.length;i++){const p=i*4;image.data[p]=image.data[p+1]=image.data[p+2]=255;image.data[p+3]=a[i];}mctx.putImageData(image,0,0);}
function snapshot(){const a=alpha();past.push(a);historyBytes+=a.byteLength;future=[];while(historyBytes>HISTORY_LIMIT&&past.length>1)historyBytes-=past.shift().byteLength;controls();}
function render(){
  ctx.clearRect(0,0,w,h);ctx.globalCompositeOperation='source-over';ctx.drawImage(original,0,0);
  if(!showOriginal){ctx.globalCompositeOperation='destination-in';ctx.drawImage(maskCanvas,0,0);ctx.globalCompositeOperation='source-over';}
}
function requestRender(){if(!renderPending){renderPending=true;requestAnimationFrame(()=>{renderPending=false;if(loaded)render();});}}
function fit(){if(!loaded)return;const stage=$('stage').getBoundingClientRect(),pad=window.innerWidth<700?24:48;const scale=Math.min((stage.width-pad)/w,(stage.height-pad)/h,1);$('canvas-wrap').style.width=`${Math.max(1,w*scale)}px`;$('canvas-wrap').style.height=`${Math.max(1,h*scale)}px`;$('scale-label').textContent=`${Math.round(scale*100)}%`;}
new ResizeObserver(fit).observe($('stage'));
function clearSelection(){selection=null;drag=null;octx.clearRect(0,0,w,h);controls();}
function outlineShape(){return document.querySelector('input[name="outline-shape"]:checked').value;}
function selectionHelp(){
  $('outline-shape').hidden=tool!=='rect';
  $('selection-help').textContent=tool==='rect'?(outlineShape()==='freehand'?'残したい部分を自由になぞって囲んでください。始点と終点を滑らかにつなぎ、外側だけを消します。':'ドラッグして残したい範囲を長方形で囲んでください。外側だけを消します。'):'消したい範囲をなぞって囲んでください。始点と終点を滑らかにつないで、内側を選択します。';
}
document.querySelectorAll('input[name="outline-shape"]').forEach(input=>input.onchange=()=>{clearSelection();selectionHelp();});
function setTool(next){
  if(busy)return;tool=next;clearSelection();
  if(showOriginal)toggleCompare(false);
  document.querySelectorAll('.tool').forEach(b=>{const selected=b.dataset.tool===tool;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',selected);});
  $('auto-settings').hidden=tool!=='auto';$('selection-settings').hidden=!['rect','lasso'].includes(tool);$('brush-settings').hidden=!['brush','restore'].includes(tool);
  selectionHelp();
  $('apply-selection').textContent=tool==='rect'?'枠の外側を削除':'囲んだ内側を削除';
  $('brush-help').textContent=tool==='restore'?'画像をなぞって、消した部分を元に戻します。':'画像をなぞって細部を消します。';
  if(loaded)status({auto:'許容範囲を調整して「背景を透過する」を押してください。',rect:'残したい範囲を囲んでください。線の外側だけを削除できます。',lasso:'消したい範囲をなぞって囲んでください。',brush:'なぞった部分を消します。',restore:'なぞった部分を元の画像に戻します。'}[tool]);
}
async function loadFile(file){
  if(busy||!file)return;
  if(file.size>30*1024*1024){status('30 MB以下の画像を選んでください。',true);return;}
  if(!/^image\/(png|jpeg|webp|avif|gif|bmp|x-ms-bmp)$/.test(file.type)&&!(/\.(png|jpe?g|webp|avif|gif|bmp)$/i.test(file.name))){status('PNG・JPG・WebPなどの画像ファイルを選んでください。',true);return;}
  setBusy(true);const url=URL.createObjectURL(file);
  try{
    const image=new Image();image.src=url;await image.decode();
    const scale=Math.min(1,3200/Math.max(image.naturalWidth,image.naturalHeight),Math.sqrt(6000000/(image.naturalWidth*image.naturalHeight)));
    w=Math.max(1,Math.round(image.naturalWidth*scale));h=Math.max(1,Math.round(image.naturalHeight*scale));
    for(const c of [canvas,overlay,original,maskCanvas]){c.width=w;c.height=h;}
    originalCtx.drawImage(image,0,0,w,h);mctx.fillStyle='#fff';mctx.fillRect(0,0,w,h);
    past=[];future=[];historyBytes=0;selection=null;drag=null;showOriginal=false;loaded=true;filename=file.name;
    $('filename').textContent=filename;$('dimensions').textContent=`${w} × ${h}`;$('empty').hidden=true;$('canvas-wrap').hidden=false;
    $('compare').setAttribute('aria-pressed','false');$('compare').textContent='元の画像を見る';render();fit();
    status(scale<1?`画像を開きました。編集しやすい ${w} × ${h} px に縮小しています。`:'画像を開きました。自動で透過するか、編集ツールを選んでください。');
  }catch(error){status('この画像を開けませんでした。別のPNG・JPG・WebP画像をお試しください。',true);}
  finally{URL.revokeObjectURL(url);setBusy(false);$('file').value='';}
}
$('choose').onclick=$('empty-choose').onclick=()=>$('file').click();
$('file').onchange=e=>loadFile(e.target.files[0]);
let dragDepth=0;
window.addEventListener('dragenter',e=>{if(e.dataTransfer?.types.includes('Files')){e.preventDefault();dragDepth++;$('drop-message').hidden=false;}});
window.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('Files')){e.preventDefault();e.dataTransfer.dropEffect=busy?'none':'copy';}});
window.addEventListener('dragleave',e=>{if(e.dataTransfer?.types.includes('Files')){dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)$('drop-message').hidden=true;}});
window.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;$('drop-message').hidden=true;loadFile(e.dataTransfer?.files[0]);});
document.querySelectorAll('.tool').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
$('tolerance').oninput=e=>$('tolerance-value').textContent=e.target.value;
$('brush-size').oninput=e=>$('brush-value').textContent=`${e.target.value} px`;
document.querySelectorAll('.swatch').forEach(b=>b.onclick=()=>{
  $('stage').classList.remove('checker','white','black');$('stage').classList.add(b.dataset.bg);
  document.querySelectorAll('.swatch').forEach(s=>{s.classList.toggle('selected',s===b);s.setAttribute('aria-pressed',s===b);});
});
function undo(){if(!past.length||busy)return;future.push(alpha());const a=past.pop();historyBytes-=a.byteLength;putAlpha(a);clearSelection();toggleCompare(false);render();controls();status('ひとつ前の状態に戻しました。');}
function redo(){if(!future.length||busy)return;const a=alpha();past.push(a);historyBytes+=a.byteLength;putAlpha(future.pop());clearSelection();toggleCompare(false);render();controls();status('編集をやり直しました。');}
$('undo').onclick=undo;$('redo').onclick=redo;
$('reset').onclick=()=>{if(!loaded||busy)return;snapshot();mctx.globalCompositeOperation='source-over';mctx.fillStyle='#fff';mctx.fillRect(0,0,w,h);clearSelection();toggleCompare(false);render();status('元の画像に戻しました。取り消しで編集を復元できます。');};
function toggleCompare(value=!showOriginal){showOriginal=value;$('compare').setAttribute('aria-pressed',value);$('compare').textContent=value?'編集画像に戻る':'元の画像を見る';octx.clearRect(0,0,w,h);if(!value)drawSelection();if(loaded)render();}
$('compare').onclick=()=>toggleCompare();
function runWorker(input){
  if(typeof Worker==='undefined')return new Promise(resolve=>setTimeout(()=>resolve(processBackground(input)),30));
  return new Promise((resolve,reject)=>{
    const blob=new Blob([`${processBackground.toString()}\nonmessage=e=>{try{const r=processBackground(e.data);postMessage(r,[r.mask.buffer]);}catch(error){postMessage({error:error.message});}};`],{type:'text/javascript'});
    const url=URL.createObjectURL(blob);worker=new Worker(url);URL.revokeObjectURL(url);
    const timeout=setTimeout(()=>{worker.terminate();worker=null;reject(new Error('timeout'));},60000);
    worker.onmessage=e=>{clearTimeout(timeout);worker.terminate();worker=null;e.data.error?reject(new Error(e.data.error)):resolve(e.data);};
    worker.onerror=e=>{clearTimeout(timeout);worker.terminate();worker=null;reject(new Error(e.message));};
    worker.postMessage(input,[input.pixels.buffer,input.mask.buffer]);
  });
}
async function autoRemove(){
  if(!loaded||busy)return;clearSelection();toggleCompare(false);setBusy(true);status('画像の端から背景色を判定しています…');
  try{
    const input={width:w,height:h,pixels:originalCtx.getImageData(0,0,w,h).data,mask:alpha(),tolerance:Number($('tolerance').value),removeIslands:$('islands').checked};
    const result=await runWorker(input);
    if(!result.remaining){status('すべてが背景と判定されました。許容範囲を下げるか、手動で範囲を選んでください。',true);return;}
    if(!result.removed){status('消せる背景が見つかりませんでした。許容範囲を広げるか、手動で調整してください。');return;}
    snapshot();putAlpha(result.mask);render();
    status(`背景を透過しました。${result.removedRegions?`離れた ${result.removedRegions} 個の領域も除去しました。`:''}なぞる・消しゴムで細部を調整できます。`);
  }catch(error){status('自動処理を完了できませんでした。手動編集を使うか、小さい画像でお試しください。',true);}
  finally{setBusy(false);}
}
$('auto-run').onclick=autoRemove;
function point(e){const r=overlay.getBoundingClientRect();return{x:Math.max(0,Math.min(w,(e.clientX-r.left)*w/r.width)),y:Math.max(0,Math.min(h,(e.clientY-r.top)*h/r.height))};}
function selectionPath(context,append=false){
  if(selection.type==='rect'){
    if(!append)context.beginPath();
    context.rect(selection.x,selection.y,selection.width,selection.height);
  }else if(selection.contour){traceContour(context,selection.contour,append);}
  else{
    if(!append)context.beginPath();
    const points=selection.points;context.moveTo(points[0].x,points[0].y);
    for(let i=1;i<points.length;i++)context.lineTo(points[i].x,points[i].y);
    context.closePath();
  }
}
function drawSelection(){
  octx.clearRect(0,0,w,h);if(!selection||showOriginal)return;
  const ratio=w/Math.max(1,overlay.getBoundingClientRect().width);
  octx.lineWidth=1.5*ratio;octx.setLineDash([6*ratio,4*ratio]);octx.strokeStyle='#5c8234';
  if(tool==='rect'){
    octx.beginPath();octx.rect(0,0,w,h);selectionPath(octx,true);
    octx.fillStyle='#242c293d';octx.fill('evenodd');
  }else{selectionPath(octx);octx.fillStyle='#5c823425';octx.fill('evenodd');}
  selectionPath(octx);octx.stroke();octx.setLineDash([]);
}
function stroke(a,b){
  mctx.save();mctx.globalCompositeOperation=tool==='restore'?'source-over':'destination-out';mctx.strokeStyle=mctx.fillStyle='#fff';
  mctx.lineWidth=Number($('brush-size').value)*w/overlay.getBoundingClientRect().width;mctx.lineCap=mctx.lineJoin='round';
  mctx.beginPath();mctx.moveTo(a.x,a.y);mctx.lineTo(b.x,b.y);mctx.stroke();mctx.beginPath();mctx.arc(b.x,b.y,mctx.lineWidth/2,0,Math.PI*2);mctx.fill();mctx.restore();requestRender();
}
overlay.addEventListener('pointerdown',e=>{
  if(!loaded||busy||tool==='auto'||e.button!==0)return;e.preventDefault();if(showOriginal)toggleCompare(false);
  overlay.setPointerCapture(e.pointerId);const p=point(e);drag={start:p,last:p,id:e.pointerId};
  if(['brush','restore'].includes(tool)){snapshot();stroke(p,p);}
  else{selection=tool==='rect'&&outlineShape()==='rectangle'?{type:'rect',x:p.x,y:p.y,width:0,height:0}:{type:'freehand',points:[p],contour:null};drawSelection();controls();}
});
overlay.addEventListener('pointermove',e=>{
  if(busy||!loaded)return;const p=point(e);
  if(drag){if(drag.id!==e.pointerId)return;
    if(['brush','restore'].includes(tool))stroke(drag.last,p);
    else if(selection.type==='rect'){selection={type:'rect',x:Math.min(drag.start.x,p.x),y:Math.min(drag.start.y,p.y),width:Math.abs(p.x-drag.start.x),height:Math.abs(p.y-drag.start.y)};drawSelection();}
    else{const ratio=w/overlay.getBoundingClientRect().width;const events=e.getCoalescedEvents?.()||[];for(const event of events.length?events:[e]){const q=point(event),last=selection.points.at(-1);if(Math.hypot(q.x-last.x,q.y-last.y)>=ratio*1.5)selection.points.push(q);}drawSelection();}
    drag.last=p;
  }else if(['brush','restore'].includes(tool)&&!showOriginal){octx.clearRect(0,0,w,h);octx.beginPath();octx.arc(p.x,p.y,Number($('brush-size').value)*w/overlay.getBoundingClientRect().width/2,0,Math.PI*2);octx.strokeStyle='#fff';octx.lineWidth=2*w/overlay.getBoundingClientRect().width;octx.stroke();octx.strokeStyle='#283727';octx.lineWidth=.8*w/overlay.getBoundingClientRect().width;octx.stroke();}
});
function finishPointer(e){
  if(!drag||drag.id!==e.pointerId)return;
  if(selection?.type==='freehand'){
    if(e.type==='pointerup'){const p=point(e),last=selection.points.at(-1);if(Math.hypot(p.x-last.x,p.y-last.y)>1)selection.points.push(p);}
    selection.contour=smoothContour(selection.points,2*w/overlay.getBoundingClientRect().width);
  }
  drag=null;
  if(selection&&((selection.type==='rect'&&(selection.width<2||selection.height<2))||(selection.type==='freehand'&&!selection.contour))){clearSelection();status('範囲を囲むように、もう少し長くなぞってください。');}
  else{drawSelection();controls();if(selection)status('始点と終点を滑らかにつなぎました。範囲を確認して削除してください。');else status(tool==='restore'?'なぞった部分を復元しました。':'なぞった部分を消しました。');}
}
overlay.addEventListener('pointerup',finishPointer);
overlay.addEventListener('pointercancel',e=>{if(drag?.id===e.pointerId){clearSelection();render();}});
overlay.addEventListener('lostpointercapture',finishPointer);
overlay.addEventListener('pointerleave',()=>{if(!drag)drawSelection();});
$('cancel-selection').onclick=()=>{clearSelection();status('選択を解除しました。');};
$('apply-selection').onclick=()=>{
  if(!selection||busy)return;snapshot();
  const area=document.createElement('canvas');area.width=w;area.height=h;
  const areaCtx=area.getContext('2d');areaCtx.fillStyle='#fff';selectionPath(areaCtx);areaCtx.fill('evenodd');
  mctx.save();mctx.globalCompositeOperation=tool==='rect'?'destination-in':'destination-out';mctx.drawImage(area,0,0);mctx.restore();
  clearSelection();render();status(tool==='rect'?'枠の外側を削除しました。':'囲んだ内側を削除しました。');
};
$('download').onclick=()=>{
  if(!loaded||busy)return;const output=document.createElement('canvas');output.width=w;output.height=h;const c=output.getContext('2d');c.drawImage(original,0,0);c.globalCompositeOperation='destination-in';c.drawImage(maskCanvas,0,0);
  $('download').disabled=true;
  output.toBlob(blob=>{controls();if(!blob){status('保存できませんでした。もう一度お試しください。',true);return;}
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename.replace(/\.[^.]+$/,'')+'-transparent.png';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);status('透過PNGを保存しました。確認背景の色は含まれません。');
  },'image/png');
};
window.addEventListener('keydown',e=>{
  if(busy)return;const key=e.key.toLowerCase();
  if((e.metaKey||e.ctrlKey)&&key==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}
  if((e.ctrlKey||e.metaKey)&&key==='y'){e.preventDefault();redo();return;}
  if(e.target.matches('input,textarea,select')||e.metaKey||e.ctrlKey||e.altKey)return;
  if(key==='escape'){clearSelection();if(showOriginal)toggleCompare(false);return;}
  const map={a:'auto',r:'rect',l:'lasso',e:'brush',b:'restore'};if(map[key])setTool(map[key]);
  if(key==='enter'&&selection){e.preventDefault();$('apply-selection').click();}
});
// Optional browser agent access uses the same visible actions and state.
if(document.modelContext?.registerTool){
  const lifecycle=new AbortController();window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
  const tools=[{
    name:'get_editor_state',description:'Read the currently loaded image and selected editing tool.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>({loaded,busy,tool,width:w,height:h,canUndo:past.length>0,hasSelection:!!selection})
  },{
    name:'remove_image_background',description:'Remove the border-connected background from the loaded image. Optionally remove all disconnected foreground regions except the largest.',inputSchema:{type:'object',properties:{tolerance:{type:'number',minimum:10,maximum:160},removeIslands:{type:'boolean'}},required:['tolerance','removeIslands'],additionalProperties:false},annotations:{readOnlyHint:false},async execute(input){if(!loaded||busy)throw new Error('Load an image and wait for editing to finish.');if(!input||!Number.isFinite(input.tolerance)||input.tolerance<10||input.tolerance>160||typeof input.removeIslands!=='boolean')throw new Error('Invalid settings');setTool('auto');$('tolerance').value=input.tolerance;$('tolerance-value').textContent=input.tolerance;$('islands').checked=input.removeIslands;await autoRemove();return{status:$('status').textContent.trim(),width:w,height:h};}
  }];
  for(const tool of tools){try{Promise.resolve(document.modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}}
}
controls();
