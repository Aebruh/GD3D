// GD3D v0.81 — exact BSP Z-band packing + shared visibility groups
//
// Keeps the validated BSP face splitting / painter traversal from v0.80.x, but
// stops treating a face's absolute rank in the whole visible scene as its Z ID.
// Instead, build the union ordering graph across all exact BSP depth states,
// collapse true order-reversal cycles with SCCs, and give each SCC a stable Z
// band. Faces outside reversal cycles therefore stay at one Z placement even if
// unrelated faces appear/disappear elsewhere in the scene.
(function(){
  function gd3dLegacyPlacementPlan(states){
    const defs=[],map=new Map();let naive=0;
    for(const st of states){const pg=[];naive+=st.order.length;for(let rank=0;rank<st.order.length;rank++){
      const fi=st.order[rank],k=fi+'@'+rank;let slot=map.get(k);
      if(slot===undefined){slot=defs.length;map.set(k,slot);defs.push({face:fi,layer:rank})}
      pg.push(slot);
    }st.placements=pg}
    return {defs,placementCount:defs.length,legacyCount:defs.length,naiveCount:naive,components:0,cyclicComponents:0,largestComponent:1,mode:'legacy-rank'};
  }

  function gd3dPackedPlacementPlan(states,faceCount){
    const adj=Array.from({length:faceCount},()=>new Set()),legacy=new Set();let naive=0;
    for(const st of states){
      naive+=st.order.length;
      for(let r=0;r<st.order.length;r++)legacy.add(st.order[r]+'@'+r);
      for(let i=0;i+1<st.order.length;i++){const a=st.order[i],b=st.order[i+1];if(a!==b)adj[a].add(b)}
    }
    const legacyCount=legacy.size;

    // Tarjan SCC: only faces that genuinely reverse ordering (directly or via
    // a cycle of constraints) must share a dynamic local Z band.
    const index=new Array(faceCount).fill(-1),low=new Array(faceCount).fill(0),on=new Array(faceCount).fill(false),stack=[],compOf=new Array(faceCount).fill(-1),comps=[];let tick=0;
    function visit(v){
      index[v]=low[v]=tick++;stack.push(v);on[v]=true;
      for(const w of adj[v]){if(index[w]<0){visit(w);low[v]=Math.min(low[v],low[w])}else if(on[w])low[v]=Math.min(low[v],index[w])}
      if(low[v]===index[v]){const c=[];while(stack.length){const w=stack.pop();on[w]=false;compOf[w]=comps.length;c.push(w);if(w===v)break}comps.push(c)}
    }
    for(let v=0;v<faceCount;v++)if(index[v]<0)visit(v);

    const nC=comps.length,cadj=Array.from({length:nC},()=>new Set()),indeg=new Array(nC).fill(0),first=new Array(nC).fill(Infinity);
    let seenOrd=0;for(const st of states)for(const f of st.order){const c=compOf[f];first[c]=Math.min(first[c],seenOrd++)}
    for(let u=0;u<faceCount;u++)for(const v of adj[u]){const a=compOf[u],b=compOf[v];if(a!==b&&!cadj[a].has(b)){cadj[a].add(b);indeg[b]++}}

    const ready=[];for(let c=0;c<nC;c++)if(indeg[c]===0)ready.push(c);
    const sortReady=()=>ready.sort((a,b)=>(first[a]-first[b])||a-b),topo=[];sortReady();
    while(ready.length){const c=ready.shift();topo.push(c);for(const d of cadj[c]){if(--indeg[d]===0){ready.push(d);sortReady()}}}
    if(topo.length!==nC)return gd3dLegacyPlacementPlan(states);
    const topoPos=new Array(nC);topo.forEach((c,i)=>topoPos[c]=i);

    // Validate that every exact painter state can be expressed as contiguous SCC
    // bands in this topological order. This should always hold; fallback keeps the
    // old exact method available if malformed/pathological input violates it.
    const width=new Array(nC).fill(0);
    for(const st of states){
      const cnt=new Map();let last=-1;
      for(const f of st.order){const c=compOf[f],p=topoPos[c];if(p<last)return gd3dLegacyPlacementPlan(states);last=p;cnt.set(c,(cnt.get(c)||0)+1)}
      for(const [c,n] of cnt)width[c]=Math.max(width[c],n);
    }
    const base=new Array(nC).fill(0);let cursor=0;for(const c of topo){base[c]=cursor;cursor+=width[c]}

    const defs=[],map=new Map();
    for(const st of states){
      const local=new Map(),pg=[];let lastLayer=-1;
      for(const fi of st.order){
        const c=compOf[fi],lr=local.get(c)||0;local.set(c,lr+1);const layer=base[c]+lr;
        if(layer<=lastLayer)return gd3dLegacyPlacementPlan(states);lastLayer=layer;
        const k=fi+'@'+layer;let slot=map.get(k);
        if(slot===undefined){slot=defs.length;map.set(k,slot);defs.push({face:fi,layer,component:c,localRank:lr})}
        pg.push(slot);
      }
      st.placements=pg;
    }
    if(defs.length>legacyCount)return gd3dLegacyPlacementPlan(states);

    let cyclic=0,largest=1;
    for(let c=0;c<nC;c++){let cyc=comps[c].length>1;if(!cyc&&adj[comps[c][0]]?.has(comps[c][0]))cyc=true;if(cyc)cyclic++;largest=Math.max(largest,comps[c].length)}
    return {defs,placementCount:defs.length,legacyCount,naiveCount:naive,components:nC,cyclicComponents:cyclic,largestComponent:largest,zBandWidth:cursor,mode:'scc-z-band'};
  }

  function gd3dVisibilityGroups(states,placementCount){
    const activeStates=Array.from({length:placementCount},()=>[]);
    states.forEach((st,si)=>st.placements.forEach(slot=>activeStates[slot].push(si)));
    const sigMap=new Map(),groups=[],slotGroup=new Array(placementCount).fill(-1),staticSlots=[];
    for(let slot=0;slot<placementCount;slot++){
      const a=activeStates[slot];
      if(a.length===states.length){staticSlots.push(slot);continue}
      const sig=a.join(',');let gi=sigMap.get(sig);
      if(gi===undefined){gi=groups.length;sigMap.set(sig,gi);groups.push({states:a.slice(),stateSet:new Set(a),slots:[]})}
      groups[gi].slots.push(slot);slotGroup[slot]=gi;
    }
    const stateGroups=states.map((st,si)=>{const s=new Set();for(const slot of st.placements){const g=slotGroup[slot];if(g>=0)s.add(g)}return s});
    return {groups,slotGroup,stateGroups,staticSlots};
  }

  // Override v0.80.x exact compiler while preserving the same public contract.
  window.generalBuildGmd=function(skipUpdate=false){
    if(!skipUpdate)updateJSON();const sc=cleanScene(),keys=sc.camera.keys;if(!keys||keys.length<2)return {ok:false,error:'General Camera build needs at least two camera keyframes.'};
    for(let i=0;i<keys.length-1;i++)if(!(keys[i+1].t>keys[i].t))return {ok:false,error:'Camera keyframe times must strictly increase.'};

    const sourceFaces=generalFaces();if(!sourceFaces.length)return {ok:false,error:'No renderable faces in the scene.'};
    let bsp;try{bsp=bspPrepareFaces(sourceFaces)}catch(e){return {ok:false,error:'Exact BSP preprocessing failed: '+(e?.message||String(e))}}
    if(!bsp||!bsp.pieces.length)return {ok:false,error:'Exact BSP produced no renderable pieces.'};

    const faces=bsp.pieces.map(p=>({v:p.v,color:p.color,n:p.n,d:p.d,key:p.key})),faceIndex=new Map(faces.map((f,i)=>[f.key,i]));
    const verts=[],vmap=new Map(),faceIds=[];
    for(const f of faces){const row=[];for(const p of f.v){const k=key3(p);if(!vmap.has(k)){vmap.set(k,verts.length);verts.push(p)}row.push(vmap.get(k))}faceIds.push(row)}

    const sched=generalAdaptiveSchedule(keys,verts,1.4,256);if(!sched.ok){if(sched.nearPlane)return generalBuildGmdClipped(true);return sched}
    const {times,sample}=sched;for(const t of times){const s=sample(t);if(s.minz<=.16)return generalBuildGmdClipped(true)}

    const rawStates=bspDepthStates(bsp,keys),states=[];
    for(const st of rawStates){
      const order=st.order.map(k=>faceIndex.get(k)).filter(i=>i!==undefined),sig=order.join(','),prev=states[states.length-1];
      if(prev&&prev.sig===sig)prev.t1=st.t1;else states.push({t0:st.t0,t1:st.t1,order,sig});
    }
    if(!states.length||!states.some(s=>s.order.length))return {ok:false,error:'No front-facing BSP faces along this camera path.'};

    const zplan=gd3dPackedPlacementPlan(states,faces.length),placementDefs=zplan.defs,placementCount=zplan.placementCount;
    if(placementCount>999)return {ok:false,error:`v0.81 exact Z packing still needs ${placementCount} Gradients (v0.80 rank reuse: ${zplan.legacyCount}; naive states: ${zplan.naiveCount}). Geometry Dash limit is 999. Reduce true camera order reversals or scene intersection complexity.`};

    const visibility=gd3dVisibilityGroups(states,placementCount),positions=times.map(t=>sample(t).pos),colors=[...new Set(faces.map(f=>f.color))];
    if(colors.length>999)return {ok:false,error:'Too many unique colors for GD channels.'};const channels={};colors.forEach((c,i)=>channels[c]=i+1);

    let nextGroup=1;const take=()=>nextGroup++,vg=verts.map(take),start=take(),objects=[];
    const visGroupIds=visibility.groups.map(()=>take());
    for(let i=0;i<verts.length;i++){const xy=positions[0][i];objects.push({1:1,2:qround(xy[0]),3:qround(xy[1]),32:.001,21:1000,57:vg[i],96:1,121:1,135:1})}

    let gradId=1;
    for(let slot=0;slot<placementDefs.length;slot++){
      const def=placementDefs[slot],fi=def.face,f=faces[fi],ids=faceIds[fi].map(i=>vg[i]),corners=ids.length===3?[ids[0],ids[1],ids[2],ids[2]]:[ids[0],ids[1],ids[3],ids[2]];
      const obj={1:2903,2:1,3:qround(-1000-slot*.025,6),21:channels[f.color],22:channels[f.color],24:7,25:def.layer,202:8,203:corners[0],204:corners[1],205:corners[2],206:corners[3],207:1,209:gradId++};
      const gi=visibility.slotGroup[slot];if(gi>=0)obj[57]=visGroupIds[gi];objects.push(obj);
    }

    // Dynamic placements that share the exact same on/off schedule share one GD
    // group. Placements active in every state are left ungrouped and need no
    // Alpha triggers at all.
    for(let gi=0;gi<visibility.groups.length;gi++)objects.push({1:1007,2:0,3:320,10:0,35:visibility.groups[gi].stateSet.has(0)?1:0,51:visGroupIds[gi]});
    objects.push({1:1268,2:1,3:300,51:start,63:.02});let spawns=1,alphaSwitches=visibility.groups.length,moves=0;
    const t0=times[0];

    for(let si=1;si<states.length;si++){
      const prev=visibility.stateGroups[si-1],next=visibility.stateGroups[si],off=[],on=[];
      for(const g of prev)if(!next.has(g))off.push(g);for(const g of next)if(!prev.has(g))on.push(g);
      if(!off.length&&!on.length)continue;
      const stage=take(),delay=qround(states[si].t0-t0,7);objects.push({1:1268,2:20+si,3:300,51:stage,63:delay,57:start,62:1,87:1});spawns++;
      for(const gi of off){objects.push({1:1007,2:40,3:320,10:0,35:0,51:visGroupIds[gi],57:stage,62:1,87:1});alphaSwitches++}
      for(const gi of on){objects.push({1:1007,2:41,3:320,10:0,35:1,51:visGroupIds[gi],57:stage,62:1,87:1});alphaSwitches++}
    }

    for(let seg=0;seg<times.length-1;seg++){
      const a=times[seg],b=times[seg+1],dt=b-a,stage=take();objects.push({1:1268,2:800+seg,3:-2200,51:stage,63:qround(a-t0,7),57:start,62:1,87:1});spawns++;
      for(let i=0;i<verts.length;i++){const dx=positions[seg+1][i][0]-positions[seg][i][0],dy=positions[seg+1][i][1]-positions[seg][i][1];if(Math.abs(dx)+Math.abs(dy)<1e-10)continue;objects.push({1:901,2:900,3:-2300,10:qround(dt,7),28:qround(dx),29:qround(dy),51:vg[i],57:stage,62:1,87:1});moves++}
    }

    if(nextGroup>10000)return {ok:false,error:`GD group budget exceeded (${nextGroup-1}/9999).`};
    if(objects.length>90000)return {ok:false,error:`v0.81 Exact BSP build would create about ${objects.length.toLocaleString()} objects; browser safety cap is 90,000.`};
    let parts=[];for(const c of colors){const ch=channels[c],rgb=[parseInt(c.slice(0,2),16),parseInt(c.slice(2,4),16),parseInt(c.slice(4,6),16)];parts.push(`1_${rgb[0]}_2_${rgb[1]}_3_${rgb[2]}_4_-1_6_${ch}_7_1_15_1.0_18_0_8_1`)}parts.push('1_0_2_0_3_0_4_-1_6_1000_7_0.0_15_0.0_18_0_8_1');
    const header='kS38,'+parts.join('|')+',kA13,0,kA6,1,kA16,1,kA15,1,k128,0,kA8,1,kA10,1,kA22,1',level=header+';'+objects.map(objFields).join(''),desc='GD3D v0.81 Exact BSP; SCC Z-band packing + shared visibility groups + adaptive projection motion.';
    const xml='<?xml version="1.0"?><plist version="1.0" gjver="2.0"><dict><k>kCEK</k><i>4</i><k>k2</k><s>'+xmlEsc(sc.name)+'</s><k>k4</k><s>'+xmlEsc(level)+'</s><k>k5</k><s>'+xmlEsc(desc)+'</s><k>k13</k><t/><k>k21</k><i>2</i><k>k16</k><i>1</i><k>k80</k><i>7</i><k>k50</k><i>45</i><k>k47</k><t/><k>k48</k><i>'+objects.length+'</i></dict></plist>';
    return {ok:true,text:xml,report:{mode:'general_camera',renderer:'v0.81-scc-zpack',source_faces:sourceFaces.length,bsp_fragments:bsp.stats.fragments,bsp_splits:bsp.stats.splits,render_pieces:faces.length,gradients:placementCount,legacy_gradients:zplan.legacyCount,naive_gradients:zplan.naiveCount,gradient_reuse_saved:zplan.naiveCount-placementCount,gradient_vs_v080_saved:zplan.legacyCount-placementCount,z_components:zplan.components,cyclic_z_components:zplan.cyclicComponents,largest_z_component:zplan.largestComponent,z_band_width:zplan.zBandWidth||0,static_gradients:visibility.staticSlots.length,visibility_groups:visibility.groups.length,anchors:verts.length,move_triggers:moves,alpha_switches:alphaSwitches,spawn_triggers:spawns,objects:objects.length,groups:nextGroup-1,motion_knots:times.length,depth_states:states.length,tolerance:1.4}};
  };

  // Recompute live budget after the override lands.
  try{scheduleBudget()}catch(e){}
})();
