// GD3D v0.80.6 — fullscreen camera workflow + camera/order cost analyzer
(function(){
  if(document.getElementById('gd3dCameraDock')) return;
  const $q=(s)=>document.querySelector(s);

  const style=document.createElement('style');
  style.id='gd3dCameraToolsStyle';
  style.textContent=`
    #gd3dCameraDock{display:none;position:fixed;z-index:10005;left:7px;right:7px;bottom:7px;background:#182128f2;border:2px solid #667987;border-radius:11px;box-shadow:0 3px 13px #000b;padding:6px;gap:6px;flex-direction:column;color:#dce9f4}
    body.gd3d-viewport-full.gd3d-camera-active #gd3dCameraDock{display:flex}
    body.gd3d-viewport-full.gd3d-camera-active #gd3dSelectionDock{display:none!important}
    #gd3dCamTop{display:flex;gap:5px;align-items:center;overflow-x:auto;scrollbar-width:none;white-space:nowrap}
    #gd3dCamTop::-webkit-scrollbar{display:none}
    #gd3dCamTop button{padding:5px 8px!important;min-height:30px!important;font-size:9px!important;white-space:nowrap!important}
    #gd3dCamTop .activeTool{background:linear-gradient(#f2cc49,#c48922)!important;border-color:#765016!important}
    #gd3dCamInfo{min-width:190px;line-height:1.2;padding:0 5px}
    #gd3dCamInfo strong{display:block;font-size:10px;color:#fff}
    #gd3dCamInfo span{font-size:8px;color:#aebfce}
    #gd3dCamComplexity{font-weight:700}
    #gd3dCamComplexity.low{color:#72e48b}#gd3dCamComplexity.medium{color:#ffd35a}#gd3dCamComplexity.high{color:#ff9f52}#gd3dCamComplexity.extreme{color:#ff6f69}
    #gd3dCamTimeline{position:relative;height:42px;background:#0f151c;border:1px solid #405160;border-radius:8px;overflow:hidden;touch-action:manipulation}
    #gd3dCamTimelineLine{position:absolute;left:14px;right:14px;top:20px;height:2px;background:#536575}
    .gd3d-cam-key{position:absolute;top:7px;transform:translateX(-50%);width:27px;height:27px;border-radius:14px!important;padding:0!important;min-height:27px!important;font-size:8px!important;display:flex!important;align-items:center!important;justify-content:center!important;background:linear-gradient(#536779,#2d3a45)!important;border:2px solid #8194a3!important;color:#fff!important;z-index:2}
    .gd3d-cam-key.active{background:linear-gradient(#53c9ff,#1f7fbd)!important;border-color:#a8e9ff!important;box-shadow:0 0 0 2px #1b6c9e88}
    #gd3dCamTimeHead{position:absolute;top:1px;left:6px;font-size:7px;color:#758797;pointer-events:none}
    #gd3dCamTimeTail{position:absolute;top:1px;right:6px;font-size:7px;color:#758797;pointer-events:none}
    @media(max-width:760px){
      #gd3dCameraDock{left:4px;right:4px;bottom:4px;padding:4px;gap:4px}
      #gd3dCamTop{gap:3px}
      #gd3dCamTop button{font-size:7px!important;padding:4px 6px!important;min-height:27px!important}
      #gd3dCamInfo{min-width:142px;max-width:190px}
      #gd3dCamInfo strong{font-size:8px}#gd3dCamInfo span{font-size:6.5px}
      #gd3dCamTimeline{height:37px}.gd3d-cam-key{top:6px;width:24px;height:24px;min-height:24px!important;font-size:7px!important}
      #gd3dCamTimelineLine{top:18px}
    }
  `;
  document.head.appendChild(style);

  const dock=document.createElement('div');dock.id='gd3dCameraDock';
  const top=document.createElement('div');top.id='gd3dCamTop';dock.appendChild(top);
  const info=document.createElement('div');info.id='gd3dCamInfo';top.appendChild(info);
  const mk=(id,label,title,fn)=>{const b=document.createElement('button');b.id=id;b.textContent=label;b.title=title;b.onclick=fn;top.appendChild(b);return b};

  const prevBtn=mk('gd3dCamPrev','◀ Key','Previous camera key',()=>selectKey(Math.max(0,selKey-1)));
  const nextBtn=mk('gd3dCamNext','Key ▶','Next camera key',()=>selectKey(Math.min(scene.camera.keys.length-1,selKey+1)));
  const addBtn=mk('gd3dCamAdd','＋ Key','Insert key at current preview time',addKeyAtCurrentTime);
  const delBtn=mk('gd3dCamDelete','Delete','Delete selected camera key',deleteCurrentKey);
  const eyeBtn=mk('gd3dCamEye','Eye','Edit selected key eye position',()=>setPointKind('eye'));
  const targetBtn=mk('gd3dCamTarget','Target','Edit selected key target position',()=>setPointKind('target'));
  const simplifyBtn=mk('gd3dCamSimplify','Simplify','Remove redundant camera keys conservatively',simplifyCamera);

  const timeline=document.createElement('div');timeline.id='gd3dCamTimeline';timeline.innerHTML='<div id="gd3dCamTimelineLine"></div><div id="gd3dCamTimeHead"></div><div id="gd3dCamTimeTail"></div>';dock.appendChild(timeline);
  document.body.appendChild(dock);

  function vdist(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2])}
  function vmix(a,b,q){return a.map((v,i)=>v+(b[i]-v)*q)}
  function dirFor(k){return norm(sub(v3(k.target),v3(k.eye)))}
  function angleDeg(a,b){return Math.acos(clamp(dot(a,b),-1,1))*180/Math.PI}

  function selectKey(i){
    const n=scene.camera.keys.length;if(!n)return;
    selKey=clamp(i,0,n-1);camPointSel={i:selKey,kind:camPointSel?.kind||'eye'};
    const d=duration(),k=scene.camera.keys[selKey],ts=$q('#timeSlider');if(ts)ts.value=d>0?k.t/d:0;
    renderAll();syncCameraUi();
  }
  function setPointKind(kind){
    if(!scene.camera.keys.length)return;
    camPointSel={i:selKey,kind};
    if(!camEditMode)setCamEdit(true);renderScene3D();syncCameraUi();
    try{toast(kind==='eye'?'Editing camera eye':'Editing camera target')}catch(e){}
  }
  function addKeyAtCurrentTime(){
    const keys=scene.camera.keys;if(!keys.length)return;
    const d=duration(),slider=$q('#timeSlider'),t=clamp((slider?+slider.value:0)*d,0,d);
    let nearest=0,best=Infinity;keys.forEach((k,i)=>{const e=Math.abs(k.t-t);if(e<best){best=e;nearest=i}});
    if(best<0.015){selectKey(nearest);try{toast('Camera key already here')}catch(e){}return}
    pushHistory();const s=sampleCam(t),k={t:+t.toFixed(4),eye:v3(s.eye),target:v3(s.target)};
    keys.push(k);keys.sort((a,b)=>a.t-b.t);selKey=keys.indexOf(k);camPointSel={i:selKey,kind:'eye'};renderAll();syncCameraUi();
    try{toast('Camera key inserted')}catch(e){}
  }
  function deleteCurrentKey(){
    const keys=scene.camera.keys;if(keys.length<=1){try{toast('Keep at least one camera key')}catch(e){}return}
    pushHistory();keys.splice(selKey,1);selKey=clamp(selKey,0,keys.length-1);camPointSel={i:selKey,kind:'eye'};renderAll();syncCameraUi();
    try{toast('Camera key deleted')}catch(e){}
  }

  function simplifyCamera(){
    const keys=scene.camera.keys;if(keys.length<=2){try{toast('Camera already minimal')}catch(e){}return}
    const before=keys.length;pushHistory();let changed=true,guard=0;
    while(changed&&guard++<64){
      changed=false;
      for(let i=1;i<keys.length-1;i++){
        const a=keys[i-1],b=keys[i],c=keys[i+1],span=c.t-a.t;if(span<=1e-6)continue;
        const q=(b.t-a.t)/span,pe=vmix(a.eye,c.eye,q),pt=vmix(a.target,c.target,q);
        const eyeErr=vdist(b.eye,pe),tarErr=vdist(b.target,pt);
        const pred={eye:pe,target:pt},ang=angleDeg(dirFor(b),dirFor(pred));
        if(eyeErr<=0.14&&tarErr<=0.14&&ang<=0.8){keys.splice(i,1);changed=true;break}
      }
    }
    const removed=before-keys.length;
    if(!removed){undoStack.pop();updateUndoButtons();try{toast('No redundant camera keys found')}catch(e){}return}
    selKey=clamp(selKey,0,keys.length-1);camPointSel={i:selKey,kind:'eye'};renderAll();syncCameraUi();
    try{toast(`Simplified camera: removed ${removed} key${removed===1?'':'s'} · Undo available`)}catch(e){}
  }

  function cameraOrderStats(){
    let states=null,gradients=null,faces=null;
    try{faces=typeof generalFaces==='function'?generalFaces().length:null}catch(e){}
    try{const sol=typeof previewBspSolution==='function'?previewBspSolution():null;if(sol&&typeof bspDepthStates==='function')states=bspDepthStates(sol,scene.camera.keys).length}catch(e){}
    try{
      if(window.liveBudget?.ok)gradients=+liveBudget.report.gradients;
      else if(window.liveBudget?.error){const m=String(liveBudget.error).match(/needs\s+([0-9,]+)\s+reusable Gradient placements/i);if(m)gradients=+m[1].replace(/,/g,'')}
    }catch(e){}
    const keys=scene.camera.keys.length;
    let score=0;if(states!=null)score+=Math.min(4,states/5);if(gradients!=null)score+=Math.min(6,gradients/180);score+=Math.min(2,Math.max(0,keys-2)/4);
    let level='low';if(score>=7||gradients>=900)level='extreme';else if(score>=4.5||gradients>=600)level='high';else if(score>=2.2||gradients>=250)level='medium';
    return {states,gradients,faces,keys,level};
  }

  function renderTimeline(){
    timeline.querySelectorAll('.gd3d-cam-key').forEach(e=>e.remove());
    const keys=scene.camera.keys,d=Math.max(.001,duration());
    const h=$q('#gd3dCamTimeHead'),t=$q('#gd3dCamTimeTail');if(h)h.textContent='0s';if(t)t.textContent=d.toFixed(1)+'s';
    keys.forEach((k,i)=>{
      const b=document.createElement('button');b.className='gd3d-cam-key'+(i===selKey?' active':'');b.textContent=String(i+1);b.title=`Key ${i+1} · ${k.t.toFixed(2)}s`;
      b.style.left=(2.8+94.4*clamp(k.t/d,0,1))+'%';b.onclick=()=>selectKey(i);timeline.appendChild(b);
    });
  }

  function syncCameraUi(){
    const active=!!camEditMode;document.body.classList.toggle('gd3d-camera-active',active);
    const keys=scene.camera.keys||[],k=keys[selKey]||keys[0];
    prevBtn.disabled=!keys.length||selKey<=0;nextBtn.disabled=!keys.length||selKey>=keys.length-1;delBtn.disabled=keys.length<=1;
    eyeBtn.classList.toggle('activeTool',active&&camPointSel?.kind==='eye');targetBtn.classList.toggle('activeTool',active&&camPointSel?.kind==='target');
    const s=cameraOrderStats(),g=s.gradients==null?'…':s.gradients.toLocaleString(),ds=s.states==null?'…':s.states;
    const likelyCamHeavy=s.gradients!=null&&s.faces!=null&&s.faces<100&&s.gradients>999;
    info.innerHTML=`<strong>Camera ${keys.length?`${selKey+1}/${keys.length}`:'—'}${k?` · ${k.t.toFixed(2)}s`:''} · <span id="gd3dCamComplexity" class="${s.level}">${s.level.toUpperCase()}</span></strong><span>${ds} depth-order state${s.states===1?'':'s'} · ${g} Gradient${s.gradients===1?'':'s'}${likelyCamHeavy?' · camera/order heavy':''}</span>`;
    renderTimeline();
  }

  const oldSetCamEdit=window.setCamEdit;
  if(typeof oldSetCamEdit==='function')window.setCamEdit=function(on){const r=oldSetCamEdit.apply(this,arguments);syncCameraUi();return r};
  const oldRenderAll=window.renderAll;
  if(typeof oldRenderAll==='function')window.renderAll=function(){const r=oldRenderAll.apply(this,arguments);syncCameraUi();return r};
  const oldRenderBudgetHud=window.renderBudgetHud;
  if(typeof oldRenderBudgetHud==='function')window.renderBudgetHud=function(){const r=oldRenderBudgetHud.apply(this,arguments);syncCameraUi();return r};

  setInterval(()=>{if(document.body.classList.contains('gd3d-viewport-full')&&camEditMode)syncCameraUi()},1200);
  syncCameraUi();
})();
