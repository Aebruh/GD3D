// GD3D v0.81.7 — optional screen-space scene centering
// Keeps the scene bounds center anchored on screen without rotating the camera.
// This preserves the side-scroll renderer's fixed viewing direction and depth
// ordering while retaining depth-dependent parallax.
(function(){
  if(typeof window.projectWorld!=='function'||typeof window.geometryFaces!=='function')return;

  const baseProjectWorld=window.projectWorld;
  const baseDrawPerspective=window.drawPerspective;
  const baseUpdateJSON=window.updateJSON;
  const baseRenderAll=window.renderAll;
  let focusCache={valid:false,p:[0,0,0]};
  let offsetCache=new WeakMap();

  function mode(){
    const m=scene?.render?.center_lock;
    return m==='horizontal'||m==='full'?m:'off';
  }

  function invalidate(){
    focusCache.valid=false;
    offsetCache=new WeakMap();
  }

  function sceneFocus(){
    if(focusCache.valid)return focusCache.p;
    let mn=[Infinity,Infinity,Infinity],mx=[-Infinity,-Infinity,-Infinity],any=false;
    try{
      for(const f of geometryFaces())for(const p of f.v||[]){
        any=true;
        for(let i=0;i<3;i++){mn[i]=Math.min(mn[i],+p[i]);mx[i]=Math.max(mx[i],+p[i])}
      }
    }catch(e){}
    const p=any?mn.map((v,i)=>(v+mx[i])/2):[0,0,0];
    focusCache={valid:true,p};
    return p;
  }

  function exportOffset(k,b){
    if(mode()==='off')return [0,0];
    if(k&&typeof k==='object'&&offsetCache.has(k))return offsetCache.get(k);
    const f=sceneFocus(),pr=baseProjectWorld(f,k,b);
    let o=[0,0];
    if(pr&&pr.z>.0001&&Number.isFinite(pr.xy?.[0]+pr.xy?.[1])){
      o=[180-pr.xy[0],mode()==='full'?120-pr.xy[1]:0];
    }
    if(k&&typeof k==='object')offsetCache.set(k,o);
    return o;
  }

  // All normal/quick/general-camera exporters use projectWorld, so applying a
  // uniform screen-space offset here centers the scene without touching depth.
  window.projectWorld=function(p,k,b){
    const r=baseProjectWorld(p,k,b);
    if(mode()==='off')return r;
    const o=exportOffset(k,b);
    return {xy:[r.xy[0]+o[0],r.xy[1]+o[1]],z:r.z};
  };

  function previewOffset(eye,R,U,F,center,focal){
    if(mode()==='off')return [0,0];
    const p=sceneFocus(),d=sub(p,eye),z=dot(d,F);
    if(z<=.0001)return [0,0];
    const x=center[0]+dot(d,R)/z*focal,y=center[1]-dot(d,U)/z*focal;
    if(!Number.isFinite(x+y))return [0,0];
    return [center[0]-x,mode()==='full'?center[1]-y:0];
  }

  // Match the editor preview to the export. When centering is off, keep the
  // existing renderer byte-for-byte by calling the original function.
  window.drawPerspective=function(){
    if(mode()==='off')return baseDrawPerspective();
    const cv=$('#previewCanvas'),ctx=cv.getContext('2d');ctx.fillStyle='#11151c';ctx.fillRect(0,0,cv.width,cv.height);
    const t=+$('#timeSlider').value*duration(),cam=sampleCam(t),eye=cam.eye,target=cam.target,F=norm(sub(target,eye)),worldUp=Math.abs(F[1])>.98?[0,0,1]:[0,1,0],R=norm(cross(F,worldUp)),U=cross(R,F),scale=cv.width/560,center=[cv.width/2,cv.height/2],focal=263.055*scale,off=previewOffset(eye,R,U,F,center,focal),draw=[];
    const sol=previewBspSolution();
    if(sol&&sol.tree){
      for(const parent of bspPainter(sol.tree,eye)){
        if(dot(parent.n,eye)-parent.d<=BSP_EPS)continue;
        const pieces=sol.parentPieces.get(parent.key)||[parent];
        for(const piece of pieces){
          const q=piece.v.map(p=>{const d=sub(p,eye);return [dot(d,R),dot(d,U),dot(d,F)]});
          if(q.every(p=>p[2]<=.15))continue;
          const xy=[];let bad=false,dep=0;
          for(const p of q){const z=Math.max(.15,p[2]);dep+=z;const x=center[0]+p[0]/z*focal+off[0],y=center[1]-p[1]/z*focal+off[1];xy.push([x,y]);if(!Number.isFinite(x+y))bad=true}
          if(!bad)draw.push({xy,depth:dep/q.length,color:piece.color});
        }
      }
    }else{
      for(const f of geometryFaces()){
        if(f.v.length<3)continue;
        const n=cross(sub(f.v[1],f.v[0]),sub(f.v[2],f.v[0]));if(dot(n,sub(eye,f.v[0]))<=0)continue;
        const q=f.v.map(p=>{const d=sub(p,eye);return [dot(d,R),dot(d,U),dot(d,F)]});if(q.every(p=>p[2]<=.15))continue;
        const xy=[];let bad=false,dep=0;
        for(const p of q){const z=Math.max(.15,p[2]);dep+=z;const x=center[0]+p[0]/z*focal+off[0],y=center[1]-p[1]/z*focal+off[1];xy.push([x,y]);if(!Number.isFinite(x+y))bad=true}
        if(!bad)draw.push({xy,depth:dep/q.length,color:f.color});
      }
      draw.sort((a,b)=>b.depth-a.depth);
    }
    for(const f of draw){ctx.beginPath();ctx.moveTo(...f.xy[0]);for(let i=1;i<f.xy.length;i++)ctx.lineTo(...f.xy[i]);ctx.closePath();ctx.fillStyle='#'+f.color;ctx.fill()}
    ctx.strokeStyle='#ffffff33';ctx.strokeRect(0,0,cv.width,cv.height);
    $('#timeLabel').textContent=`${t.toFixed(2)} / ${duration().toFixed(2)} s • Center ${mode()==='horizontal'?'X':'XY'}`;
    renderPerfHud();
  };

  function injectUI(){
    if($('#centerLock'))return;
    if(!scene.render)scene.render={};
    if(!['off','horizontal','full'].includes(scene.render.center_lock))scene.render.center_lock='off';
    const vis=$('#visibility');if(!vis)return;
    const row=document.createElement('div');row.className='row';
    row.innerHTML='<label>Center Lock</label><select id="centerLock"><option value="off">Off</option><option value="horizontal">Horizontal</option><option value="full">Full Center</option></select>';
    vis.closest('.row')?.after(row);
    const sel=$('#centerLock');sel.value=mode();
    sel.onchange=()=>{
      scene.render.center_lock=sel.value;invalidate();
      try{drawPerspective()}catch(e){}
      try{baseUpdateJSON()}catch(e){}
      try{toast(sel.value==='off'?'Center Lock off':(sel.value==='horizontal'?'Horizontal Center Lock':'Full Center Lock'))}catch(e){}
    };
  }

  window.updateJSON=function(){
    invalidate();
    if($('#centerLock'))scene.render.center_lock=$('#centerLock').value;
    return baseUpdateJSON.apply(this,arguments);
  };

  window.renderAll=function(){
    const r=baseRenderAll.apply(this,arguments);
    injectUI();
    if($('#centerLock'))$('#centerLock').value=mode();
    return r;
  };

  injectUI();
  try{if($('#centerLock'))$('#centerLock').value=mode();drawPerspective();scheduleBudget()}catch(e){}
})();
