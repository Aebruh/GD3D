// GD3D v0.80.7 — mobile construction productivity tools
(function(){
  if(document.getElementById('gd3dBuildDock')) return;
  const $q=s=>document.querySelector(s);

  const style=document.createElement('style');
  style.id='gd3dBuildToolsStyle';
  style.textContent=`
    #gd3dToolsBtn{background:linear-gradient(#7868d8,#4a3ba7)!important;border-color:#33277b!important}
    #gd3dToolsBtn.activeTool{background:linear-gradient(#f2cc49,#c48922)!important;border-color:#765016!important}
    #gd3dBuildDock{display:none;position:fixed;z-index:10006;left:6px;right:6px;bottom:48px;background:#182128f4;border:2px solid #667987;border-radius:11px;box-shadow:0 3px 13px #000b;padding:5px;gap:4px;flex-direction:column;color:#dce9f4}
    body.gd3d-viewport-full.gd3d-tools-open:not(.gd3d-camera-active) #gd3dBuildDock{display:flex}
    #gd3dBuildDock .gd3d-tool-row{display:flex;gap:4px;align-items:center;overflow-x:auto;scrollbar-width:none;white-space:nowrap}
    #gd3dBuildDock .gd3d-tool-row::-webkit-scrollbar{display:none}
    #gd3dBuildDock button,#gd3dBuildDock select,#gd3dBuildDock input{min-height:29px!important;font-size:8px!important}
    #gd3dBuildDock button{padding:5px 7px!important;white-space:nowrap!important}
    #gd3dBuildDock select{width:72px!important;padding:3px 4px!important}
    #gd3dBuildDock input[type=number]{width:58px!important;padding:3px 5px!important}
    #gd3dBuildDock .gd3d-tool-label{font-size:8px;color:#aebfce;padding:0 2px}
    #gd3dBuildDock .axisX{border-color:#8f3439!important}.axisY{border-color:#347944!important}.axisZ{border-color:#315b9f!important}
    #gd3dHideSel,#gd3dLockSel{background:linear-gradient(#536779,#2d3a45)!important}
    #gd3dShowAll,#gd3dUnlockAll{background:linear-gradient(#4a8b68,#2d6048)!important}
    @media(max-width:760px){
      #gd3dBuildDock{left:4px;right:4px;bottom:42px;padding:4px;gap:3px}
      #gd3dBuildDock .gd3d-tool-row{gap:3px}
      #gd3dBuildDock button,#gd3dBuildDock select,#gd3dBuildDock input{font-size:7px!important;min-height:27px!important}
      #gd3dBuildDock button{padding:4px 6px!important}
      #gd3dBuildDock .gd3d-tool-label{font-size:7px}
    }
  `;
  document.head.appendChild(style);

  // Add a single Tools button to the existing fullscreen toolbar so the viewport
  // stays clean until construction helpers are actually needed.
  const focus=$q('#gd3dFocusBar');
  const exit=$q('#gd3dFocusExit');
  const toolsBtn=document.createElement('button');
  toolsBtn.id='gd3dToolsBtn';toolsBtn.textContent='Tools';toolsBtn.title='Construction tools';toolsBtn.className='gd3d-focus-tool';
  if(focus)focus.insertBefore(toolsBtn,exit||null);

  const dock=document.createElement('div');dock.id='gd3dBuildDock';
  const row1=document.createElement('div');row1.className='gd3d-tool-row';
  const row2=document.createElement('div');row2.className='gd3d-tool-row';
  dock.append(row1,row2);document.body.appendChild(dock);

  const lab=(row,text)=>{const s=document.createElement('span');s.className='gd3d-tool-label';s.textContent=text;row.appendChild(s);return s};
  const btn=(row,id,text,title,fn,cls='')=>{const b=document.createElement('button');b.id=id;b.textContent=text;b.title=title;b.className=cls;b.onclick=fn;row.appendChild(b);return b};

  // ----- snap controls -----
  lab(row1,'Snap');
  const snap=document.createElement('select');snap.id='gd3dQuickSnap';
  for(const [v,t] of [['0','Off'],['0.1','0.1'],['0.25','0.25'],['0.5','0.5'],['1','1'],['2','2']]){const o=document.createElement('option');o.value=v;o.textContent=t;snap.appendChild(o)}
  row1.appendChild(snap);
  function syncSnapFromEditor(){const e=$q('#moveSnap');if(e){const v=String(e.value||'0');if([...snap.options].some(o=>o.value===v))snap.value=v}}
  snap.onchange=()=>{const e=$q('#moveSnap');if(e){if(![...e.options].some(o=>o.value===snap.value)){const o=document.createElement('option');o.value=snap.value;o.textContent=snap.value;e.appendChild(o)}e.value=snap.value;e.dispatchEvent(new Event('change',{bubbles:true}))}try{toast(snap.value==='0'?'Move snap off':'Move snap '+snap.value)}catch(_){}};
  btn(row1,'gd3dSnapSel','Snap Sel','Snap selected object positions to the current grid',()=>{
    const ids=selectedIndices();const q=+snap.value||0;if(!ids.length)return toast('Select an object first');if(!q)return toast('Choose a snap size first');
    pushHistory();for(const i of ids){const c=v3(scene.objects[i].center);scene.objects[i].center=c.map(v=>+(Math.round(v/q)*q).toFixed(4))}renderAll();toast(`Snapped ${ids.length} object${ids.length===1?'':'s'}`);
  });

  // ----- duplicate along axis -----
  lab(row1,'Spacing');
  const spacing=document.createElement('input');spacing.id='gd3dDupSpacing';spacing.type='number';spacing.step='0.1';spacing.min='0.001';spacing.value='1';row1.appendChild(spacing);
  function duplicateAxis(axis,sign){
    const ids=selectedIndices();if(!ids.length)return toast('Select an object first');const d=Math.max(.001,Math.abs(+spacing.value||1))*sign;
    pushHistory();const start=scene.objects.length,copies=[];
    for(const i of ids){const o=deep(scene.objects[i]);o.center=v3(o.center);o.center[axis]=+(o.center[axis]+d).toFixed(4);o.name=(o.name||o.type||'object')+'_copy';delete o.editor_group;delete o._editor_locked;delete o._editor_hidden;copies.push(o)}
    scene.objects.push(...copies);selObjs=new Set(copies.map((_,j)=>start+j));selObj=start;renderAll();toast(`Duplicated ${copies.length} along ${'XYZ'[axis]}${sign>0?'+':'-'}`);
  }
  btn(row1,'gd3dDupXm','X−','Duplicate toward -X',()=>duplicateAxis(0,-1),'axisX');
  btn(row1,'gd3dDupXp','X+','Duplicate toward +X',()=>duplicateAxis(0,1),'axisX');
  btn(row1,'gd3dDupYm','Y−','Duplicate toward -Y',()=>duplicateAxis(1,-1),'axisY');
  btn(row1,'gd3dDupYp','Y+','Duplicate toward +Y',()=>duplicateAxis(1,1),'axisY');
  btn(row1,'gd3dDupZm','Z−','Duplicate toward -Z',()=>duplicateAxis(2,-1),'axisZ');
  btn(row1,'gd3dDupZp','Z+','Duplicate toward +Z',()=>duplicateAxis(2,1),'axisZ');

  // ----- align / distribute -----
  function alignAxis(axis){
    const ids=selectedIndices();if(ids.length<2)return toast('Select 2+ objects');const ai=(selObj>=0&&ids.includes(selObj))?selObj:ids[0],v=v3(scene.objects[ai].center)[axis];
    pushHistory();for(const i of ids)if(i!==ai){const c=v3(scene.objects[i].center);c[axis]=v;scene.objects[i].center=c}renderAll();toast(`Aligned ${ids.length} on ${'XYZ'[axis]}`);
  }
  function distributeAxis(axis){
    const ids=selectedIndices();if(ids.length<3)return toast('Select 3+ objects');const order=ids.slice().sort((a,b)=>v3(scene.objects[a].center)[axis]-v3(scene.objects[b].center)[axis]);
    const first=v3(scene.objects[order[0]].center)[axis],last=v3(scene.objects[order.at(-1)].center)[axis],step=(last-first)/(order.length-1);
    pushHistory();order.forEach((i,n)=>{const c=v3(scene.objects[i].center);c[axis]=+(first+step*n).toFixed(4);scene.objects[i].center=c});renderAll();toast(`Distributed ${ids.length} on ${'XYZ'[axis]}`);
  }
  lab(row2,'Align');
  btn(row2,'gd3dAlignX','X','Align selected to active X',()=>alignAxis(0),'axisX');btn(row2,'gd3dAlignY','Y','Align selected to active Y',()=>alignAxis(1),'axisY');btn(row2,'gd3dAlignZ','Z','Align selected to active Z',()=>alignAxis(2),'axisZ');
  lab(row2,'Distribute');
  btn(row2,'gd3dDistX','X','Evenly distribute selected on X',()=>distributeAxis(0),'axisX');btn(row2,'gd3dDistY','Y','Evenly distribute selected on Y',()=>distributeAxis(1),'axisY');btn(row2,'gd3dDistZ','Z','Evenly distribute selected on Z',()=>distributeAxis(2),'axisZ');
  btn(row2,'gd3dGroup','Group','Group selected objects',()=>{groupSelection();});
  btn(row2,'gd3dUngroup','Ungroup','Ungroup selected objects',()=>{ungroupSelection();});

  // ----- editor-only lock/hide -----
  // These flags affect picking and viewport drawing only. Export/compiler geometry
  // is deliberately left untouched, so hiding something while editing cannot
  // accidentally delete it from the .gmd render.
  function clearSelection(){selObj=-1;selObjs=new Set()}
  btn(row2,'gd3dLockSel','Lock','Lock selection from viewport picking',()=>{
    const ids=selectedIndices();if(!ids.length)return toast('Select an object first');pushHistory();ids.forEach(i=>scene.objects[i]._editor_locked=true);clearSelection();renderAll();toast(`Locked ${ids.length} object${ids.length===1?'':'s'}`);
  });
  btn(row2,'gd3dUnlockAll','Unlock All','Unlock all editor objects',()=>{
    const n=scene.objects.filter(o=>o._editor_locked).length;if(!n)return toast('Nothing is locked');pushHistory();scene.objects.forEach(o=>delete o._editor_locked);renderAll();toast(`Unlocked ${n}`);
  });
  btn(row2,'gd3dHideSel','Hide','Hide selection in editor viewport only',()=>{
    const ids=selectedIndices();if(!ids.length)return toast('Select an object first');pushHistory();ids.forEach(i=>scene.objects[i]._editor_hidden=true);clearSelection();renderAll();toast(`Hidden ${ids.length} in editor`);
  });
  btn(row2,'gd3dShowAll','Show All','Show all editor-hidden objects',()=>{
    const n=scene.objects.filter(o=>o._editor_hidden).length;if(!n)return toast('Nothing is hidden');pushHistory();scene.objects.forEach(o=>delete o._editor_hidden);renderAll();toast(`Shown ${n}`);
  });

  // Locked/hidden objects should not steal taps from editable objects behind them.
  window.hitEditorObject=function(px,py,cv){let bi=-1,bd=28;scene.objects.forEach((o,i)=>{if(o._editor_hidden||o._editor_locked)return;const p=editorProject(editorObjectCenter(o),cv);if(!p)return;const d=Math.hypot(px-p[0],py-p[1]);if(d<bd){bd=d;bi=i}});return bi};
  const oldSelectObject=window.selectObject;
  if(typeof oldSelectObject==='function')window.selectObject=function(i,add){const o=scene.objects[i];if(o&&o._editor_hidden)return; if(o&&o._editor_locked){try{toast('Object is locked')}catch(_){}return}return oldSelectObject.call(this,i,add)};

  // Filter editor-hidden objects only while the 3D editor viewport is drawing.
  // The scene is restored immediately afterwards, so budget/build/export still
  // sees every object exactly as before.
  const oldRenderScene3D=window.renderScene3D;
  if(typeof oldRenderScene3D==='function')window.renderScene3D=function(){
    const full=scene.objects;if(!full.some(o=>o._editor_hidden))return oldRenderScene3D.apply(this,arguments);
    const map=[];full.forEach((o,i)=>{if(!o._editor_hidden)map.push(i)});const rev=new Map(map.map((orig,vis)=>[orig,vis]));
    const oldActive=selObj,oldSet=selObjs;scene.objects=map.map(i=>full[i]);selObj=rev.has(oldActive)?rev.get(oldActive):-1;selObjs=new Set([...oldSet].filter(i=>rev.has(i)).map(i=>rev.get(i)));
    try{return oldRenderScene3D.apply(this,arguments)}finally{scene.objects=full;selObj=oldActive;selObjs=oldSet}
  };

  // Mirror the same hidden state in the small top-view canvas picking/drawing.
  const oldHitObject=window.hitObject;
  if(typeof oldHitObject==='function')window.hitObject=function(px,py,cv){let best=-1,bd=1e9;scene.objects.forEach((o,i)=>{if(o._editor_hidden||o._editor_locked)return;const f=objectFootprint(o),p=toCanvas(f.x,f.z,cv),d=Math.hypot(px-p[0],py-p[1]);if(d<Math.max(16,Math.min(45,Math.max(f.sx,f.sz)*topView.scale*.5))&&d<bd){best=i;bd=d}});return best};

  function setOpen(on){document.body.classList.toggle('gd3d-tools-open',!!on);toolsBtn.classList.toggle('activeTool',!!on);syncSnapFromEditor()}
  toolsBtn.onclick=()=>setOpen(!document.body.classList.contains('gd3d-tools-open'));
  syncSnapFromEditor();
})();
