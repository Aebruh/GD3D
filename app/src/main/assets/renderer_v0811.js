// GD3D v0.81.1 — runtime Gradient stack refresh
//
// Geometry Dash Gradient triggers can resolve same-layer draw priority from
// trigger activation/processing order. The browser preview has no such runtime
// quirk, so v0.81 could look correct in the viewport but keep an older, farther
// gradient visually above a nearer face in GD after a depth-state change.
//
// This compiler keeps the exact BSP states, uses ONE Gradient per BSP piece,
// and re-activates all visible gradients far -> near whenever the BSP state
// changes. Spawn proxies are laid out left -> right in that same order, which
// gives deterministic GD trigger processing without spending extra Gradients.
(function(){
  window.generalBuildGmd=function(skipUpdate=false){
    if(!skipUpdate)updateJSON();
    const sc=cleanScene(),keys=sc.camera.keys;
    if(!keys||keys.length<2)return {ok:false,error:'General Camera build needs at least two camera keyframes.'};
    for(let i=0;i<keys.length-1;i++)if(!(keys[i+1].t>keys[i].t))return {ok:false,error:'Camera keyframe times must strictly increase.'};

    const sourceFaces=generalFaces();
    if(!sourceFaces.length)return {ok:false,error:'No renderable faces in the scene.'};
    let bsp;
    try{bsp=bspPrepareFaces(sourceFaces)}catch(e){return {ok:false,error:'Exact BSP preprocessing failed: '+(e?.message||String(e))}}
    if(!bsp||!bsp.pieces.length)return {ok:false,error:'Exact BSP produced no renderable pieces.'};

    const faces=bsp.pieces.map(p=>({v:p.v,color:p.color,n:p.n,d:p.d,key:p.key})),faceIndex=new Map(faces.map((f,i)=>[f.key,i]));
    const verts=[],vmap=new Map(),faceIds=[];
    for(const f of faces){
      const row=[];
      for(const p of f.v){const k=key3(p);if(!vmap.has(k)){vmap.set(k,verts.length);verts.push(p)}row.push(vmap.get(k))}
      faceIds.push(row);
    }

    const sched=generalAdaptiveSchedule(keys,verts,1.4,256);
    if(!sched.ok){if(sched.nearPlane)return generalBuildGmdClipped(true);return sched}
    const {times,sample}=sched;
    for(const t of times){const s=sample(t);if(s.minz<=.16)return generalBuildGmdClipped(true)}

    // Exact BSP painter states. bspPainter order is far -> near.
    const rawStates=bspDepthStates(bsp,keys),states=[];
    for(const st of rawStates){
      const order=st.order.map(k=>faceIndex.get(k)).filter(i=>i!==undefined),sig=order.join(','),prev=states[states.length-1];
      if(prev&&prev.sig===sig)prev.t1=st.t1;
      else states.push({t0:st.t0,t1:st.t1,order,sig});
    }
    if(!states.length||!states.some(s=>s.order.length))return {ok:false,error:'No front-facing BSP faces along this camera path.'};

    // One runtime Gradient per BSP piece that is visible at least once.
    const usedFaces=[...new Set(states.flatMap(s=>s.order))];
    const slotOfFace=new Map(usedFaces.map((fi,i)=>[fi,i]));
    const placementCount=usedFaces.length;
    if(placementCount>999)return {ok:false,error:`v0.81.1 needs ${placementCount} unique BSP Gradient pieces; Geometry Dash limit is 999. Reduce actual BSP fragmentation/intersections.`};
    for(const st of states)st.placements=st.order.map(fi=>slotOfFace.get(fi));

    const positions=times.map(t=>sample(t).pos),colors=[...new Set(usedFaces.map(fi=>faces[fi].color))];
    if(colors.length>999)return {ok:false,error:'Too many unique colors for GD channels.'};
    const channels={};colors.forEach((c,i)=>channels[c]=i+1);

    let nextGroup=1;const take=()=>nextGroup++,vg=verts.map(take),start=take(),objects=[];
    // Each Gradient gets its own group so it can be alpha-hidden AND spawned
    // repeatedly. The Gradient trigger itself is spawn-triggered + multi-trigger.
    const gradGroups=usedFaces.map(()=>take());

    for(let i=0;i<verts.length;i++){
      const xy=positions[0][i];
      objects.push({1:1,2:qround(xy[0]),3:qround(xy[1]),32:.001,21:1000,57:vg[i],96:1,121:1,135:1});
    }

    let gradId=1;
    for(let slot=0;slot<usedFaces.length;slot++){
      const fi=usedFaces[slot],f=faces[fi],ids=faceIds[fi].map(i=>vg[i]),corners=ids.length===3?[ids[0],ids[1],ids[2],ids[2]]:[ids[0],ids[1],ids[3],ids[2]];
      // Same Z layer + same Z order intentionally. Runtime activation order is
      // refreshed far -> near at every depth state, so newest/nearer gradients
      // become the front of GD's internal Gradient stack.
      objects.push({1:2903,2:qround(-3000-slot*.01,6),3:-3000,21:channels[f.color],22:channels[f.color],24:7,25:0,202:8,203:corners[0],204:corners[1],205:corners[2],206:corners[3],207:1,209:gradId++,57:gradGroups[slot],62:1,87:1});
    }

    const initial=new Set(states[0].placements);
    // Only groups not initially visible need to start at alpha 0. Visible groups
    // are still at their default alpha 1 before their first runtime activation.
    for(let slot=0;slot<placementCount;slot++)if(!initial.has(slot))objects.push({1:1007,2:0,3:320,10:0,35:0,51:gradGroups[slot]});

    // Root scheduler. It spawns all time-based scheduling triggers plus the
    // initial far->near Gradient activation proxies after startup settles.
    objects.push({1:1268,2:1,3:300,51:start,63:.02});
    let spawns=1,alphaSwitches=placementCount-initial.size,moves=0,orderProxies=0,stackRefreshes=1;
    const t0=times[0];

    function addOrderProxies(state,stageGroup,baseX=100){
      for(let rank=0;rank<state.placements.length;rank++){
        const slot=state.placements[rank];
        // Spawn ordering is left -> right, so increasing X fires far -> near.
        objects.push({1:1268,2:qround(baseX+rank*.05,6),3:280,51:gradGroups[slot],63:0,57:stageGroup,62:1,87:1});
        orderProxies++;
      }
    }
    addOrderProxies(states[0],start,100);

    // At every exact BSP state crossing:
    //   1) update visibility with Alpha triggers
    //   2) re-fire every visible Gradient far -> near
    // The proxy X positions guarantee alpha changes happen first (40/41), then
    // Gradient stack refreshes at X >= 100.
    for(let si=1;si<states.length;si++){
      const prevSet=new Set(states[si-1].placements),nextSet=new Set(states[si].placements),off=[],on=[];
      for(const slot of prevSet)if(!nextSet.has(slot))off.push(slot);
      for(const slot of nextSet)if(!prevSet.has(slot))on.push(slot);
      const stage=take(),delay=qround(states[si].t0-t0,7);
      objects.push({1:1268,2:20+si,3:300,51:stage,63:delay,57:start,62:1,87:1});spawns++;
      for(const slot of off){objects.push({1:1007,2:40,3:320,10:0,35:0,51:gradGroups[slot],57:stage,62:1,87:1});alphaSwitches++}
      for(const slot of on){objects.push({1:1007,2:41,3:320,10:0,35:1,51:gradGroups[slot],57:stage,62:1,87:1});alphaSwitches++}
      addOrderProxies(states[si],stage,100);stackRefreshes++;
    }

    // Adaptive direct-anchor motion remains identical to v0.81.
    for(let seg=0;seg<times.length-1;seg++){
      const a=times[seg],b=times[seg+1],dt=b-a,stage=take();
      objects.push({1:1268,2:800+seg,3:-2200,51:stage,63:qround(a-t0,7),57:start,62:1,87:1});spawns++;
      for(let i=0;i<verts.length;i++){
        const dx=positions[seg+1][i][0]-positions[seg][i][0],dy=positions[seg+1][i][1]-positions[seg][i][1];
        if(Math.abs(dx)+Math.abs(dy)<1e-10)continue;
        objects.push({1:901,2:900,3:-2300,10:qround(dt,7),28:qround(dx),29:qround(dy),51:vg[i],57:stage,62:1,87:1});moves++;
      }
    }

    if(nextGroup>10000)return {ok:false,error:`GD group budget exceeded (${nextGroup-1}/9999).`};
    if(objects.length>90000)return {ok:false,error:`v0.81.1 build would create about ${objects.length.toLocaleString()} objects; browser safety cap is 90,000.`};

    let parts=[];
    for(const c of colors){const ch=channels[c],rgb=[parseInt(c.slice(0,2),16),parseInt(c.slice(2,4),16),parseInt(c.slice(4,6),16)];parts.push(`1_${rgb[0]}_2_${rgb[1]}_3_${rgb[2]}_4_-1_6_${ch}_7_1_15_1.0_18_0_8_1`)}
    parts.push('1_0_2_0_3_0_4_-1_6_1000_7_0.0_15_0.0_18_0_8_1');
    const header='kS38,'+parts.join('|')+',kA13,0,kA6,1,kA16,1,kA15,1,k128,0,kA8,1,kA10,1,kA22,1',level=header+';'+objects.map(objFields).join(''),desc='GD3D v0.81.1 Exact BSP; runtime far-to-near Gradient stack refresh + adaptive projection motion.';
    const xml='<?xml version="1.0"?><plist version="1.0" gjver="2.0"><dict><k>kCEK</k><i>4</i><k>k2</k><s>'+xmlEsc(sc.name)+'</s><k>k4</k><s>'+xmlEsc(level)+'</s><k>k5</k><s>'+xmlEsc(desc)+'</s><k>k13</k><t/><k>k21</k><i>2</i><k>k16</k><i>1</i><k>k80</k><i>7</i><k>k50</k><i>45</i><k>k47</k><t/><k>k48</k><i>'+objects.length+'</i></dict></plist>';
    return {ok:true,text:xml,report:{mode:'general_camera',renderer:'v0.81.1-runtime-gradient-stack',source_faces:sourceFaces.length,bsp_fragments:bsp.stats.fragments,bsp_splits:bsp.stats.splits,render_pieces:faces.length,gradients:placementCount,unique_visible_pieces:placementCount,anchors:verts.length,move_triggers:moves,alpha_switches:alphaSwitches,spawn_triggers:spawns+orderProxies,order_proxy_triggers:orderProxies,stack_refreshes:stackRefreshes,objects:objects.length,groups:nextGroup-1,motion_knots:times.length,depth_states:states.length,tolerance:1.4}};
  };
  try{scheduleBudget()}catch(e){}
})();
