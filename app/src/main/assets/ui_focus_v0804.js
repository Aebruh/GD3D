// GD3D v0.80.4 — compact bars + viewport focus mode
(function(){
  const $q=(s)=>document.querySelector(s);
  const top=$q('#top'),tabs=$q('#tabs'),scene=$q('#scene'),canvas=$q('#topCanvas');
  if(!top||!tabs||!scene||!canvas||document.getElementById('gd3dUiFocusStyle')) return;

  const style=document.createElement('style');
  style.id='gd3dUiFocusStyle';
  style.textContent=`
    #gd3dBarsBtn{order:998;background:linear-gradient(#567083,#344754)!important;min-width:78px}
    #gd3dViewportBtn{background:linear-gradient(#42b9ef,#1877bd)!important;border-color:#114f7a!important}
    body.gd3d-bars-min #top{min-height:42px!important;padding:4px 7px!important;display:flex!important;gap:5px!important;align-items:center!important}
    body.gd3d-bars-min #top>*{display:none!important}
    body.gd3d-bars-min #top>#undoBtn,
    body.gd3d-bars-min #top>#redoBtn,
    body.gd3d-bars-min #top>#gd3dBarsBtn{display:inline-flex!important}
    body.gd3d-bars-min #tabs{display:none!important}
    body.gd3d-bars-min .view.active{padding-top:4px!important}

    #gd3dFocusBar{display:none;position:fixed;z-index:10003;left:50%;top:8px;transform:translateX(-50%);max-width:calc(100vw - 18px);padding:5px;background:#182128e8;border:2px solid #667987;border-radius:10px;box-shadow:0 3px 12px #000a;gap:4px;align-items:center;overflow-x:auto;scrollbar-width:none;white-space:nowrap}
    #gd3dFocusBar::-webkit-scrollbar{display:none}
    #gd3dFocusBar button{padding:6px 9px!important;min-height:32px!important;font-size:11px!important;white-space:nowrap!important}
    #gd3dFocusBar .gd3d-focus-tool.activeTool{background:linear-gradient(#f2cc49,#c48922)!important;border-color:#765016!important}
    #gd3dFocusExit{background:linear-gradient(#ff7a69,#c93d38)!important;border-color:#711f1b!important}

    body.gd3d-viewport-full{overflow:hidden!important}
    body.gd3d-viewport-full #top,
    body.gd3d-viewport-full #tabs,
    body.gd3d-viewport-full #camera,
    body.gd3d-viewport-full #preview{display:none!important}
    body.gd3d-viewport-full #scene{display:block!important;position:fixed!important;inset:0!important;z-index:10000!important;padding:0!important;margin:0!important;background:#0b0e13!important}
    body.gd3d-viewport-full #scene>.grid2{display:block!important;height:100%!important;margin:0!important;padding:0!important}
    body.gd3d-viewport-full #scene>.grid2>.card:first-child{position:absolute!important;inset:0!important;margin:0!important;padding:0!important;border:0!important;border-radius:0!important;box-shadow:none!important;background:#0b0e13!important}
    body.gd3d-viewport-full #scene>.grid2>.card:first-child>.toolbar{display:none!important}
    body.gd3d-viewport-full #scene>.grid2>.card:nth-child(2){display:none!important}
    body.gd3d-viewport-full #scene .canvasWrap{position:absolute!important;inset:0!important;border:0!important;border-radius:0!important;box-shadow:none!important}
    body.gd3d-viewport-full #topCanvas{width:100vw!important;height:100vh!important;min-height:0!important;border:0!important;border-radius:0!important}
    body.gd3d-viewport-full #gd3dFocusBar{display:flex!important}
    body.gd3d-viewport-full #sceneBadge{top:52px!important;left:8px!important;max-width:52vw!important}
    body.gd3d-viewport-full #budgetHud{top:52px!important;right:8px!important}
    body.gd3d-viewport-full #perfHud{bottom:8px!important;right:8px!important}
    @media(max-width:760px){
      #gd3dFocusBar{top:5px;padding:4px;gap:3px}
      #gd3dFocusBar button{font-size:9px!important;padding:5px 7px!important;min-height:29px!important}
      body.gd3d-viewport-full #sceneBadge{top:43px!important;font-size:8px!important;max-width:48vw!important}
      body.gd3d-viewport-full #budgetHud{top:43px!important}
    }
  `;
  document.head.appendChild(style);

  // Compact-bars button lives in the normal top bar.
  const barsBtn=document.createElement('button');
  barsBtn.id='gd3dBarsBtn';
  top.appendChild(barsBtn);
  function applyBars(min){
    document.body.classList.toggle('gd3d-bars-min',!!min);
    barsBtn.textContent=min?'▾ Show UI':'▴ Minimize';
    try{localStorage.setItem('gd3d-bars-min',min?'1':'0')}catch(e){}
  }
  barsBtn.onclick=()=>applyBars(!document.body.classList.contains('gd3d-bars-min'));
  let savedMin=false;try{savedMin=localStorage.getItem('gd3d-bars-min')==='1'}catch(e){}
  applyBars(savedMin);

  // Fullscreen viewport button sits in the existing BUILD toolbar.
  const sceneToolbar=scene.querySelector('.toolbar');
  const viewportBtn=document.createElement('button');
  viewportBtn.id='gd3dViewportBtn'; viewportBtn.textContent='⛶ Viewport';
  sceneToolbar && sceneToolbar.appendChild(viewportBtn);

  // Floating controls shown only in viewport focus mode. These proxy the proven
  // editor controls rather than reimplementing any transform logic.
  const focus=document.createElement('div');focus.id='gd3dFocusBar';
  const controls=[
    ['↶','Undo','#undoBtn'],['↷','Redo','#redoBtn'],
    ['Move','Move','#modeMove','move'],['Rotate','Rotate','#modeRotate','rotate'],['Scale','Scale','#modeScale','scale'],
    ['Frame','Frame All','#fitBtn'],['Camera','Camera Edit','#cameraEditBtn']
  ];
  for(const [label,title,target,mode] of controls){
    const b=document.createElement('button');b.textContent=label;b.title=title;b.className='gd3d-focus-tool';
    if(mode)b.dataset.mode=mode;
    b.onclick=()=>{const t=$q(target);if(t)t.click();syncTools()};focus.appendChild(b);
  }
  const exit=document.createElement('button');exit.id='gd3dFocusExit';exit.textContent='✕ Exit';exit.onclick=()=>setViewportFull(false);focus.appendChild(exit);
  document.body.appendChild(focus);

  const originalSize={w:canvas.width,h:canvas.height};
  function resizeCanvas(full){
    if(full){
      // Keep rendering crisp without allocating a huge phone-native framebuffer.
      const ratio=Math.min(window.devicePixelRatio||1,1.6);
      const w=Math.min(1800,Math.max(900,Math.round(innerWidth*ratio)));
      const h=Math.min(1100,Math.max(520,Math.round(innerHeight*ratio)));
      canvas.width=w;canvas.height=h;
    }else{canvas.width=originalSize.w;canvas.height=originalSize.h}
    try{renderScene3D()}catch(e){try{renderTop()}catch(_) {}}
  }
  function syncTools(){
    focus.querySelectorAll('[data-mode]').forEach(b=>{const t=document.querySelector('#mode'+b.dataset.mode[0].toUpperCase()+b.dataset.mode.slice(1));b.classList.toggle('activeTool',!!t&&t.classList.contains('primary'))});
  }
  function setViewportFull(on){
    document.body.classList.toggle('gd3d-viewport-full',!!on);
    viewportBtn.textContent=on?'✕ Exit Viewport':'⛶ Viewport';
    resizeCanvas(!!on);syncTools();
  }
  viewportBtn.onclick=()=>setViewportFull(!document.body.classList.contains('gd3d-viewport-full'));
  window.addEventListener('resize',()=>{if(document.body.classList.contains('gd3d-viewport-full'))resizeCanvas(true)});

  // Android back exits viewport focus before leaving the editor.
  const oldBack=window.GD3DApp&&window.GD3DApp.onAndroidBack;
  if(window.GD3DApp){
    window.GD3DApp.onAndroidBack=function(){
      if(document.body.classList.contains('gd3d-viewport-full')){setViewportFull(false);return true}
      return oldBack?oldBack():false;
    };
  }
  syncTools();
})();
