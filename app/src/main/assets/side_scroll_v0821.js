// GD3D v0.82.1 — chunk renderer routing + large-scene preview fix
(function(){
  if(typeof window.gd3dChunkedSideScrollBuild!=='function')return;

  const baseGeneral=window.generalBuildGmd;
  const baseDraw=window.drawPerspective;
  const isChunk=()=>scene?.render?.mode==='side_scroll_chunked';

  // Critical routing fix:
  // the stock budget/export pipeline calls General/Exact whenever Quick Build
  // returns an error. For an explicitly selected chunk renderer that is wrong:
  // it can send a 3000+ face side-scroll map into full-scene BSP preprocessing.
  // Keep explicit chunk mode inside the chunk renderer all the way through.
  window.generalBuildGmd=function(skipUpdate=false){
    if(isChunk())return window.gd3dChunkedSideScrollBuild(skipUpdate);
    return baseGeneral(skipUpdate);
  };

  function previewChunked(){
    const cv=$('#previewCanvas'),ctx=cv.getContext('2d');
    ctx.fillStyle='#11151c';ctx.fillRect(0,0,cv.width,cv.height);

    const t=+$('#timeSlider').value*duration(),cam=sampleCam(t),eye=cam.eye,target=cam.target;
    const F=norm(sub(target,eye)),worldUp=Math.abs(F[1])>.98?[0,0,1]:[0,1,0],R=norm(cross(F,worldUp)),U=cross(R,F);
    const scale=cv.width/560,center=[cv.width/2,cv.height/2],focal=263.055*scale;
    const fs=geometryFaces();

    const keys=scene.camera.keys||[],first=keys[0]||cam,last=keys[keys.length-1]||cam,total=sub(last.eye,first.eye);
    let S=Math.hypot(...total)>1e-8?norm(total):R.slice();
    const sf=dot(S,F);S=norm(S.map((x,i)=>x-F[i]*sf));
    if(Math.hypot(...S)<1e-8)S=R.slice();

    const w=Math.max(4,+scene.render.side_scroll_chunk_width||18),radius=clamp(Math.round(+scene.render.side_scroll_chunk_radius||1),0,6);
    const cs=dot(eye,S),pad=(radius+1.15)*w;

    let mn=[Infinity,Infinity,Infinity],mx=[-Infinity,-Infinity,-Infinity];
    for(const f of fs)for(const p of f.v||[])for(let i=0;i<3;i++){mn[i]=Math.min(mn[i],p[i]);mx[i]=Math.max(mx[i],p[i])}
    const focus=mn[0]!==Infinity?mn.map((v,i)=>(v+mx[i])/2):[0,0,0];
    let off=[0,0],mode=scene.render.center_lock||'off';
    if(mode==='horizontal'||mode==='full'){
      const d=sub(focus,eye),z=dot(d,F);
      if(z>.0001){
        const x=center[0]+dot(d,R)/z*focal,y=center[1]-dot(d,U)/z*focal;
        if(Number.isFinite(x+y))off=[center[0]-x,mode==='full'?center[1]-y:0];
      }
    }

    const draw=[];
    for(const f of fs){
      if(!f.v||f.v.length<3)continue;
      const n=cross(sub(f.v[1],f.v[0]),sub(f.v[2],f.v[0]));
      if(dot(n,sub(eye,f.v[0]))<=0)continue;

      let lo=Infinity,hi=-Infinity;
      for(const p of f.v){const q=dot(p,S);lo=Math.min(lo,q);hi=Math.max(hi,q)}
      const global=(hi-lo)>w*12;
      if(!global&&(hi<cs-pad||lo>cs+pad))continue;

      const xy=[];let dep=0,bad=false;
      for(const p of f.v){
        const d=sub(p,eye),z=dot(d,F);
        if(z<=.15){bad=true;break}
        dep+=z;
        const x=center[0]+dot(d,R)/z*focal+off[0],y=center[1]-dot(d,U)/z*focal+off[1];
        if(!Number.isFinite(x+y)){bad=true;break}
        xy.push([x,y]);
      }
      if(!bad)draw.push({xy,depth:dep/f.v.length,color:hex6(f.color)});
    }

    draw.sort((a,b)=>b.depth-a.depth);
    for(const f of draw){
      ctx.beginPath();ctx.moveTo(...f.xy[0]);
      for(let i=1;i<f.xy.length;i++)ctx.lineTo(...f.xy[i]);
      ctx.closePath();ctx.fillStyle='#'+f.color;ctx.fill();
    }
    ctx.strokeStyle='#ffffff33';ctx.strokeRect(0,0,cv.width,cv.height);
    $('#timeLabel').textContent=t.toFixed(2)+' / '+duration().toFixed(2)+' s • Chunked Side Scroll';
    try{renderPerfHud()}catch(e){}
  }

  window.drawPerspective=function(){
    if(isChunk())return previewChunked();
    return baseDraw.apply(this,arguments);
  };

  // Make the actual APK renderer version visible. The underlying editor HTML
  // still carries its old v0.78 badge, which made version verification confusing.
  function stamp(){
    const pill=document.querySelector('.brand .pill');
    if(pill)pill.textContent='v0.82.1';
    const rm=$('#renderMode');
    if(rm&&isChunk())rm.value='side_scroll_chunked';
  }

  const baseRenderAll=window.renderAll;
  window.renderAll=function(){
    const r=baseRenderAll.apply(this,arguments);stamp();return r;
  };

  stamp();
  try{drawPerspective();scheduleBudget()}catch(e){}
})();