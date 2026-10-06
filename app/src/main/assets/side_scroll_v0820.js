// GD3D v0.82.0 — long-scene side-scroll chunk renderer
//
// Purpose:
// - Preserve the proven fixed-direction side-scroll camera path.
// - Allow the total map to contain more than 999 renderable faces.
// - Only require the currently active chunk window to fit within 999 Gradient IDs.
// - Reuse Gradient IDs by far->near rank after a clean Disable-All redraw.
//
// This file intentionally does NOT replace the Exact BSP renderer. It only
// overrides Quick Build for the explicit "side_scroll_chunked" mode, and is an
// automatic fallback when ordinary Quick Build fails only because the full map
// exceeds the Gradient limit.
(function(){
  if(typeof window.quickBuildGmd!=='function')return;

  const baseQuick=window.quickBuildGmd;
  const baseUpdateJSON=window.updateJSON;
  const baseRenderAll=window.renderAll;

  function cfg(){
    const r=scene.render||(scene.render={});
    let w=+r.side_scroll_chunk_width;
    let radius=Math.round(+r.side_scroll_chunk_radius);
    if(!Number.isFinite(w)||w<4)w=18;
    if(!Number.isFinite(radius)||radius<0)radius=1;
    radius=clamp(radius,0,6);
    return {width:w,radius};
  }

  function addChunk(map,k,fi){
    let a=map.get(k);
    if(!a){a=[];map.set(k,a)}
    a.push(fi);
  }

  function sideCoord(p,S){return dot(p,S)}

  function chunkedSideScrollBuild(skipUpdate=false){
    if(!skipUpdate)updateJSON();
    const sc=cleanScene(),keys=sc.camera.keys;
    if(!keys||keys.length<2)return {ok:false,error:'Chunked Side Scroll needs at least two camera keyframes.'};
    for(let i=0;i<keys.length-1;i++)if(!(keys[i+1].t>keys[i].t))return {ok:false,error:'Camera keyframe times must strictly increase.'};

    const bases=keys.map(cameraBasis),F=bases[0].F;
    for(let i=1;i<bases.length;i++){
      if(dot(F,bases[i].F)<.9999995)return {ok:false,error:'Chunked Side Scroll requires a fixed camera direction. Use Exact for orbit/tilt cameras.'};
    }
    for(let i=0;i<keys.length-1;i++){
      const de=sub(keys[i+1].eye,keys[i].eye),forward=Math.abs(dot(de,F));
      if(forward>1e-5*Math.max(1,Math.hypot(...de)))return {ok:false,error:'Chunked Side Scroll only supports sideways/perpendicular camera movement.'};
    }

    const total=sub(keys[keys.length-1].eye,keys[0].eye),totalLen=Math.hypot(...total);
    let S=totalLen>1e-7?total.map(x=>x/totalLen):bases[0].R.slice();
    // Keep the chunk axis in the camera plane.
    const sf=dot(S,F);S=norm(S.map((x,i)=>x-F[i]*sf));
    if(Math.hypot(...S)<1e-7)S=bases[0].R.slice();

    // Reject strongly bent tracking paths. Small direction changes are fine,
    // but chunk culling assumes one dominant side-scroll axis.
    for(let i=0;i<keys.length-1;i++){
      const de=sub(keys[i+1].eye,keys[i].eye),L=Math.hypot(...de);
      if(L<1e-8)continue;
      const q=Math.abs(dot(de.map(x=>x/L),S));
      if(q<.985)return {ok:false,error:'Chunked Side Scroll requires a mostly straight tracking path. Use ordinary Fast/Exact for bent camera paths.'};
    }

    let src=geometryFaces(),faces=[];
    for(const f of src){
      let polys=[];
      if(f.v.length<=4)polys=[f.v];
      else for(let i=1;i<f.v.length-1;i++)polys.push([f.v[0],f.v[i],f.v[i+1]]);
      for(const vv of polys){
        if(vv.length<3)continue;
        const n=cross(sub(vv[1],vv[0]),sub(vv[2],vv[0]));
        if(Math.hypot(...n)<1e-10)continue;
        const d=dot(n,vv[0]);
        const vals=keys.map(k=>dot(n,k.eye)-d);
        if(vals.every(x=>x<=1e-9))continue;
        let dep=0,minSide=Infinity,maxSide=-Infinity;
        for(const p of vv){
          const z=projectWorld(p,keys[0],bases[0]).z;
          if(z<=.15)return {ok:false,error:'Some scene geometry crosses the near plane. Chunked Side Scroll refuses this case; use Exact/Close Camera.'};
          dep+=z;
          const s=sideCoord(p,S);minSide=Math.min(minSide,s);maxSide=Math.max(maxSide,s);
        }
        dep/=vv.length;
        faces.push({v:vv,color:hex6(f.color),n,d,vals,depth:dep,minSide,maxSide});
      }
    }
    if(!faces.length)return {ok:false,error:'No front-facing render faces for this side-scroll path.'};

    const C=cfg(),w=C.width,radius=C.radius;
    let minFace=Infinity,maxFace=-Infinity;
    for(const f of faces){minFace=Math.min(minFace,f.minSide);maxFace=Math.max(maxFace,f.maxSide)}
    const origin=Math.floor(minFace/w)*w;
    const chunkMap=new Map(),globalFaces=[];
    let maxChunkIndex=-Infinity,minChunkIndex=Infinity;
    for(let fi=0;fi<faces.length;fi++){
      const f=faces[fi],a=Math.floor((f.minSide-origin)/w),b=Math.floor((f.maxSide-origin)/w);
      minChunkIndex=Math.min(minChunkIndex,a);maxChunkIndex=Math.max(maxChunkIndex,b);
      if(b-a>12){globalFaces.push(fi);continue}
      for(let c=a;c<=b;c++)addChunk(chunkMap,c,fi);
    }

    // State boundaries = camera keys + chunk crossings + front/back crossings.
    const ev=new Set(keys.map(k=>qround(+k.t,9)));
    for(let seg=0;seg<keys.length-1;seg++){
      const a=keys[seg],b=keys[seg+1],ta=+a.t,tb=+b.t;
      const ca=sideCoord(a.eye,S),cb=sideCoord(b.eye,S),lo=Math.min(ca,cb),hi=Math.max(ca,cb);
      if(Math.abs(cb-ca)>1e-12){
        const k0=Math.floor((lo-origin)/w)-1,k1=Math.ceil((hi-origin)/w)+1;
        for(let k=k0;k<=k1;k++){
          const boundary=origin+k*w;
          if(boundary<=lo+1e-9||boundary>=hi-1e-9)continue;
          const q=(boundary-ca)/(cb-ca);
          if(q>0&&q<1)ev.add(qround(ta+(tb-ta)*q,9));
        }
      }
    }
    for(const f of faces){
      for(let seg=0;seg<keys.length-1;seg++){
        const a=f.vals[seg],b=f.vals[seg+1];
        if(a*b<0&&Math.abs(b-a)>1e-12){
          const q=-a/(b-a);
          ev.add(qround(keys[seg].t+(keys[seg+1].t-keys[seg].t)*q,9));
        }
      }
    }
    const events=[...ev].sort((a,b)=>a-b),states=[];
    let maxActive=0,totalStateDraws=0;
    for(let i=0;i<events.length-1;i++){
      const a=events[i],b=events[i+1];
      if(b-a<=1e-8)continue;
      const m=(a+b)/2,cam=sampleCamFromKeys(keys,m),cc=Math.floor((sideCoord(cam.eye,S)-origin)/w);
      const set=new Set(globalFaces);
      for(let c=cc-radius;c<=cc+radius;c++)for(const fi of chunkMap.get(c)||[])set.add(fi);
      const order=[...set].filter(fi=>dot(faces[fi].n,cam.eye)-faces[fi].d>1e-9);
      order.sort((x,y)=>faces[y].depth-faces[x].depth);
      const sig=order.join(','),prev=states[states.length-1];
      if(prev&&prev.sig===sig)prev.t1=b;
      else states.push({t0:a,t1:b,order,sig,centerChunk:cc});
    }
    if(!states.length||!states.some(s=>s.order.length))return {ok:false,error:'Chunk culling produced no visible faces.'};
    for(const st of states){maxActive=Math.max(maxActive,st.order.length);totalStateDraws+=st.order.length}
    if(maxActive>999)return {ok:false,error:'Chunked Side Scroll still needs '+maxActive+' simultaneous Gradients. Reduce Chunk Radius / Chunk Width or simplify the visible section.'};

    const verts=[],vmap=new Map(),faceIds=[];
    for(const f of faces){
      const row=[];
      for(const p of f.v){
        const k=key3(p);
        if(!vmap.has(k)){vmap.set(k,verts.length);verts.push(p)}
        row.push(vmap.get(k));
      }
      faceIds.push(row);
    }
    const positions=keys.map((k,i)=>verts.map(p=>projectWorld(p,k,bases[i]).xy));
    const colors=[...new Set(faces.map(f=>f.color))];
    if(colors.length>999)return {ok:false,error:'Too many unique colors for GD channels.'};
    const channels={};colors.forEach((c,i)=>channels[c]=i+1);

    let nextGroup=1;
    const take=()=>nextGroup++,vg=verts.map(take),start=take(),objects=[];
    for(let i=0;i<verts.length;i++){
      const xy=positions[0][i];
      objects.push({1:1,2:qround(xy[0]),3:qround(xy[1]),32:.001,21:1000,57:vg[i],96:1,121:1,135:1});
    }

    const stateGroups=states.map(take);
    let gradientDraws=0,disableAll=0,spawns=1,moves=0;
    for(let si=0;si<states.length;si++){
      const st=states[si],sg=stateGroups[si];
      objects.push({1:2903,2:30,3:280,508:1,57:sg,62:1,87:1,115:1});
      disableAll++;
      for(let rank=0;rank<st.order.length;rank++){
        const fi=st.order[rank],f=faces[fi],vs=faceIds[fi].map(i=>vg[i]);
        const corners=vs.length===3?[vs[0],vs[1],vs[2],vs[2]]:[vs[0],vs[1],vs[3],vs[2]];
        objects.push({
          1:2903,2:qround(100+rank*.05,6),3:280,
          21:channels[f.color],22:channels[f.color],24:7,25:rank,
          202:8,203:corners[0],204:corners[1],205:corners[2],206:corners[3],207:1,
          209:rank+1,57:sg,62:1,87:1,115:rank+2
        });
        gradientDraws++;
      }
    }

    // Root scheduler. Every chunk state starts from a clean Gradient stack.
    objects.push({1:1268,2:1,3:300,51:start,63:.02});
    const t0=keys[0].t;
    for(let si=0;si<states.length;si++){
      objects.push({1:1268,2:20+(si%700),3:300,51:stateGroups[si],63:qround(states[si].t0-t0,7),57:start,62:1,87:1});
      spawns++;
    }

    // Fixed-orientation perpendicular tracking makes projected motion linear
    // within each camera-key segment, so shared world vertices only need the
    // original camera keyframes.
    for(let seg=0;seg<keys.length-1;seg++){
      const a=keys[seg],b=keys[seg+1],dt=b.t-a.t;
      let group=start;
      if(seg>0){
        group=take();
        objects.push({1:1268,2:800+(seg%150),3:-2200,51:group,63:qround(a.t-t0,7),57:start,62:1,87:1});
        spawns++;
      }
      for(let i=0;i<verts.length;i++){
        const dx=positions[seg+1][i][0]-positions[seg][i][0],dy=positions[seg+1][i][1]-positions[seg][i][1];
        if(Math.abs(dx)+Math.abs(dy)<1e-10)continue;
        objects.push({1:901,2:900,3:-2300,10:qround(dt,7),28:qround(dx),29:qround(dy),51:vg[i],57:group,62:1,87:1});
        moves++;
      }
    }

    if(nextGroup>10000)return {ok:false,error:'GD group budget exceeded ('+(nextGroup-1)+'/9999). Increase chunk reuse or simplify the map.'};
    if(objects.length>90000)return {ok:false,error:'Chunked Side Scroll would create about '+objects.length.toLocaleString()+' objects; browser safety cap is 90,000.'};

    let parts=[];
    for(const c of colors){
      const ch=channels[c],rgb=[parseInt(c.slice(0,2),16),parseInt(c.slice(2,4),16),parseInt(c.slice(4,6),16)];
      parts.push('1_'+rgb[0]+'_2_'+rgb[1]+'_3_'+rgb[2]+'_4_-1_6_'+ch+'_7_1_15_1.0_18_0_8_1');
    }
    parts.push('1_0_2_0_3_0_4_-1_6_1000_7_0.0_15_0.0_18_0_8_1');
    const header='kS38,'+parts.join('|')+',kA13,0,kA6,1,kA16,1,kA15,1,k128,0,kA8,1,kA10,1,kA22,1';
    const level=header+';'+objects.map(objFields).join('');
    const desc='GD3D v0.82.0 Chunked Side Scroll; local chunk window + reusable Gradient IDs + deterministic far-to-near redraw.';
    const xml='<?xml version="1.0"?><plist version="1.0" gjver="2.0"><dict><k>kCEK</k><i>4</i><k>k2</k><s>'+xmlEsc(sc.name)+'</s><k>k4</k><s>'+xmlEsc(level)+'</s><k>k5</k><s>'+xmlEsc(desc)+'</s><k>k13</k><t/><k>k21</k><i>2</i><k>k16</k><i>1</i><k>k80</k><i>7</i><k>k50</k><i>45</i><k>k47</k><t/><k>k48</k><i>'+objects.length+'</i></dict></plist>';

    return {ok:true,text:xml,report:{
      mode:'side_scroll_chunked',renderer:'v0.82.0-chunked-side-scroll',
      source_faces:src.length,render_faces:faces.length,
      full_scene_gradients:faces.length,gradients:maxActive,gradient_ids:maxActive,
      gradient_trigger_objects:gradientDraws+disableAll,total_state_draws:totalStateDraws,
      chunks:Math.max(0,maxChunkIndex-minChunkIndex+1),chunk_width:w,chunk_radius:radius,
      global_faces:globalFaces.length,depth_states:states.length,
      anchors:verts.length,move_triggers:moves,alpha_switches:0,spawn_triggers:spawns,
      objects:objects.length,groups:nextGroup-1,camera_keys:keys.length
    }};
  }

  window.quickBuildGmd=function(skipUpdate=false){
    const requested=scene?.render?.mode||'auto';
    if(requested==='side_scroll_chunked')return chunkedSideScrollBuild(skipUpdate);
    const r=baseQuick(skipUpdate);
    // Auto only upgrades to chunking when ordinary side-scroll Quick Build is
    // otherwise valid but the full-map Gradient count is the blocker.
    if(requested==='auto'&&r&&!r.ok&&/Quick Build needs \d+ Gradients/.test(String(r.error||''))){
      const q=chunkedSideScrollBuild(true);
      if(q&&q.ok)return q;
    }
    return r;
  };
  window.gd3dChunkedSideScrollBuild=chunkedSideScrollBuild;

  function injectUI(){
    const rm=$('#renderMode');
    if(rm&&!rm.querySelector('option[value="side_scroll_chunked"]')){
      const o=document.createElement('option');o.value='side_scroll_chunked';o.textContent='side_scroll_chunked';rm.appendChild(o);
    }
    const r=scene.render||(scene.render={});
    if(!Number.isFinite(+r.side_scroll_chunk_width)||+r.side_scroll_chunk_width<4)r.side_scroll_chunk_width=18;
    if(!Number.isFinite(+r.side_scroll_chunk_radius)||+r.side_scroll_chunk_radius<0)r.side_scroll_chunk_radius=1;

    if(!$('#sideScrollChunkWidth')){
      const anchor=$('#centerLock')?.closest('.row')||$('#visibility')?.closest('.row');
      if(anchor){
        const row1=document.createElement('div');row1.className='row gd82ChunkRow';
        row1.innerHTML='<label>Chunk Width</label><input id="sideScrollChunkWidth" type="number" min="4" max="100" step="1" value="18">';
        const row2=document.createElement('div');row2.className='row gd82ChunkRow';
        row2.innerHTML='<label>Chunk Radius</label><select id="sideScrollChunkRadius"><option value="0">0 (1 chunk)</option><option value="1">1 (3 chunks)</option><option value="2">2 (5 chunks)</option><option value="3">3 (7 chunks)</option><option value="4">4 (9 chunks)</option></select>';
        anchor.after(row1,row2);
        $('#sideScrollChunkWidth').onchange=()=>{r.side_scroll_chunk_width=Math.max(4,+$('#sideScrollChunkWidth').value||18);try{updateJSON();scheduleBudget()}catch(e){}};
        $('#sideScrollChunkRadius').onchange=()=>{r.side_scroll_chunk_radius=clamp(Math.round(+$('#sideScrollChunkRadius').value||0),0,6);try{updateJSON();scheduleBudget()}catch(e){}};
      }
    }
    if($('#sideScrollChunkWidth'))$('#sideScrollChunkWidth').value=String(r.side_scroll_chunk_width);
    if($('#sideScrollChunkRadius'))$('#sideScrollChunkRadius').value=String(r.side_scroll_chunk_radius);
    if(rm&&r.mode==='side_scroll_chunked')rm.value='side_scroll_chunked';
    const show=(rm?.value==='side_scroll_chunked');
    $$('.gd82ChunkRow').forEach(x=>x.style.display=show?'flex':'none');
    if(rm&&!rm.dataset.gd82bound){
      rm.dataset.gd82bound='1';
      rm.addEventListener('change',()=>{$$('.gd82ChunkRow').forEach(x=>x.style.display=rm.value==='side_scroll_chunked'?'flex':'none')});
    }
  }

  window.updateJSON=function(){
    if($('#sideScrollChunkWidth'))scene.render.side_scroll_chunk_width=Math.max(4,+$('#sideScrollChunkWidth').value||18);
    if($('#sideScrollChunkRadius'))scene.render.side_scroll_chunk_radius=clamp(Math.round(+$('#sideScrollChunkRadius').value||0),0,6);
    return baseUpdateJSON.apply(this,arguments);
  };

  window.renderAll=function(){
    const r=baseRenderAll.apply(this,arguments);
    injectUI();
    return r;
  };

  injectUI();
  try{scheduleBudget()}catch(e){}
})();
