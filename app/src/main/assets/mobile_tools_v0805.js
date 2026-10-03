// GD3D v0.80.5 — mobile fullscreen selection dock
(function(){
  if(document.getElementById('gd3dSelectionDock')) return;
  const $q=(s)=>document.querySelector(s);

  const style=document.createElement('style');
  style.id='gd3dMobileToolsStyle';
  style.textContent=`
    #gd3dSelectionDock{display:none;position:fixed;z-index:10004;left:8px;bottom:8px;max-width:calc(100vw - 16px);background:#182128e8;border:2px solid #667987;border-radius:11px;box-shadow:0 3px 12px #000a;padding:6px;gap:7px;align-items:center;overflow-x:auto;scrollbar-width:none;white-space:nowrap}
    #gd3dSelectionDock::-webkit-scrollbar{display:none}
    body.gd3d-viewport-full #gd3dSelectionDock{display:flex}
    #gd3dSelInfo{min-width:150px;max-width:280px;padding:2px 7px;line-height:1.25;color:#dce9f4;overflow:hidden;text-overflow:ellipsis}
    #gd3dSelInfo strong{display:block;color:#fff;font-size:12px;overflow:hidden;text-overflow:ellipsis}
    #gd3dSelInfo span{font-size:9px;color:#aebfce}
    #gd3dSelectionDock button{padding:6px 9px!important;min-height:32px!important;font-size:10px!important;white-space:nowrap!important}
    #gd3dSelDelete{background:linear-gradient(#ff7568,#c93d38)!important;border-color:#711f1b!important}
    #gd3dSelMulti.activeTool{background:linear-gradient(#f2cc49,#c48922)!important;border-color:#765016!important;color:#fff!important}
    #gd3dSelectionDock button:disabled{opacity:.38!important;filter:saturate(.4)}
    @media(max-width:760px){
      #gd3dSelectionDock{left:5px;bottom:5px;right:5px;max-width:none;padding:4px;gap:3px}
      #gd3dSelInfo{min-width:108px;max-width:165px;padding:1px 5px}
      #gd3dSelInfo strong{font-size:9px}
      #gd3dSelInfo span{font-size:7px}
      #gd3dSelectionDock button{font-size:8px!important;padding:5px 7px!important;min-height:29px!important}
    }
  `;
  document.head.appendChild(style);

  const dock=document.createElement('div'); dock.id='gd3dSelectionDock';
  const info=document.createElement('div'); info.id='gd3dSelInfo'; dock.appendChild(info);

  function mk(id,label,title,fn){
    const b=document.createElement('button'); b.id=id; b.textContent=label; b.title=title; b.onclick=fn; dock.appendChild(b); return b;
  }

  const focusBtn=mk('gd3dSelFocus','◎ Focus','Frame selected object(s)',()=>{
    const ids=typeof selectedIndices==='function'?selectedIndices():[];
    if(!ids.length){try{toast('Select an object first')}catch(e){} return;}
    const p=typeof selectionPivot==='function'?selectionPivot():null; if(!p)return;
    editorView.target=p.slice();
    let radius=1.2;
    for(const i of ids){
      const o=scene.objects[i],c=v3(o.center),dc=Math.hypot(c[0]-p[0],c[1]-p[1],c[2]-p[2]);
      let s=1;
      if(o.type==='box') s=Math.hypot(...(o.size||[1,1,1]).map(Number))*.5;
      else if(o.type==='plane') s=Math.hypot(...(o.size||[1,1]).map(Number))*.5;
      else if(o.type==='cylinder') s=Math.hypot((+o.radius||.5)*2,+o.height||1)*.5;
      radius=Math.max(radius,dc+s);
    }
    editorView.distance=Math.max(2.6,Math.min(120,radius*2.8));
    try{renderScene3D()}catch(e){renderTop()}
  });

  const dupBtn=mk('gd3dSelDuplicate','⧉ Duplicate','Duplicate selection',()=>{
    const ids=typeof selectedIndices==='function'?selectedIndices():[];
    if(!ids.length){try{toast('Select an object first')}catch(e){} return;}
    pushHistory();
    const start=scene.objects.length,copies=[];
    for(const i of ids){
      const o=deep(scene.objects[i]);
      o.name=(o.name||o.type||'object')+'_copy';
      o.center=v3(o.center);o.center[0]+=0.6;o.center[2]+=0.6;
      if(o.editor_group) delete o.editor_group;
      copies.push(o);
    }
    scene.objects.push(...copies);
    selObjs=new Set(copies.map((_,j)=>start+j)); selObj=start;
    renderAll(); try{toast(`Duplicated ${copies.length} object${copies.length===1?'':'s'}`)}catch(e){}
  });

  const delBtn=mk('gd3dSelDelete','Delete','Delete selection',()=>{
    const ids=typeof selectedIndices==='function'?selectedIndices():[];
    if(!ids.length){try{toast('Select an object first')}catch(e){} return;}
    pushHistory();
    const gone=new Set(ids),first=Math.min(...ids);
    scene.objects=scene.objects.filter((_,i)=>!gone.has(i));
    if(scene.objects.length){selObj=Math.min(first,scene.objects.length-1);selObjs=new Set([selObj])}
    else{selObj=-1;selObjs=new Set()}
    renderAll(); try{toast(`Deleted ${ids.length} object${ids.length===1?'':'s'}`)}catch(e){}
  });

  const multiBtn=mk('gd3dSelMulti','Multi','Toggle multi-select',()=>{
    multiSelectMode=!multiSelectMode;
    if(!multiSelectMode&&selObj>=0) selObjs=new Set([selObj]);
    syncDock(); renderAll();
    try{toast(multiSelectMode?'Multi-select on':'Multi-select off')}catch(e){}
  });

  document.body.appendChild(dock);

  function activeIds(){try{return selectedIndices()}catch(e){return []}}
  function syncDock(){
    const ids=activeIds(),has=ids.length>0;
    focusBtn.disabled=dupBtn.disabled=delBtn.disabled=!has;
    multiBtn.classList.toggle('activeTool',!!multiSelectMode);
    if(!has){info.innerHTML='<strong>No object selected</strong><span>Tap an object in the viewport</span>';return}
    const o=scene.objects[selObj>=0?selObj:ids[0]];
    if(!o){info.innerHTML=`<strong>${ids.length} selected</strong><span>Multi-selection</span>`;return}
    const c=v3(o.center),name=o.name||o.type||'Object';
    info.innerHTML=ids.length>1
      ?`<strong>${ids.length} selected · ${name}</strong><span>Active: ${o.type} · X ${c[0].toFixed(2)} · Y ${c[1].toFixed(2)} · Z ${c[2].toFixed(2)}</span>`
      :`<strong>${name}</strong><span>${o.type} · X ${c[0].toFixed(2)} · Y ${c[1].toFixed(2)} · Z ${c[2].toFixed(2)}</span>`;
  }

  // Keep the dock live during selection changes and gizmo drags without
  // touching the existing editor interaction system.
  const oldRenderAll=window.renderAll;
  if(typeof oldRenderAll==='function') window.renderAll=function(){const r=oldRenderAll.apply(this,arguments);syncDock();return r};
  const oldRenderScene3D=window.renderScene3D;
  if(typeof oldRenderScene3D==='function') window.renderScene3D=function(){const r=oldRenderScene3D.apply(this,arguments);syncDock();return r};

  syncDock();
})();
