// GD3D v0.81.2 — clean Gradient-state rebuild
//
// v0.81.1 incorrectly tried to hide already-active Gradient effects by changing
// alpha on the Gradient trigger objects. Gradient effects are persistent runtime
// state, so hiding the trigger does not remove the effect. v0.81.2 uses the
// Gradient trigger's real Disable All command (property 508) before rebuilding
// each exact BSP painter state.
//
// Runtime sequence at every depth-state boundary:
//   1. Disable All active gradients.
//   2. Re-activate ONLY the currently visible BSP pieces, far -> near.
// This leaves no stale rear/back-face gradients alive and makes the most recently
// activated (nearest) visible gradient sit at the front of GD's Gradient stack.
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

    const faces=bsp.pieces.map(p=>({v:p.v,color:p.color,n:p.n,d:p.d,key:p.key}));
    const faceIndex=new Map(faces.map((f,i)=>[f.key,i]));
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

    const sched=generalAdaptiveSchedule(keys,verts,1.4,256);
    if(!sched.ok){if(sched.nearPlane)return generalBuildGmdClipped(true);return sched}
    const {times,sample}=sched;
    for(const t of times){const s=sample(t);if(s.minz<=.16)return generalBuildGmdClipped(true)}

    // Exact BSP painter states; order is far -> near.
    const rawStates=bspDepthStates(bsp,keys),states=[];
    for(const st of rawStates){
      const order=st.order.map(k=>faceIndex.get(k)).filter(i=>i!==undefined);
      const sig=order.join(','),prev=states[states.length-1];
      if(prev&&prev.sig===sig)prev.t1=st.t1;
      else states.push({t0:st.t0,t1:st.t1,order,sig});
    }
    if(!states.length||!states.some(s=>s.order.length))return {ok:false,error:'No front-facing BSP faces along this camera path.'};

    // One Gradient ID / draw trigger per BSP piece that is ever visible.
    const usedFaces=[...new Set(states.flatMap(s=>s.order))];
    const slotOfFace=new Map(usedFaces.map((fi,i)=>[fi,i]));
    const gradientIds=usedFaces.length;
    if(gradientIds>999)return {ok:false,error:`v0.81.2 needs ${gradientIds} unique BSP Gradient IDs; Geometry Dash limit is 999. Reduce actual BSP fragmentation/intersections.`};
    for(const st of states)st.placements=st.order.map(fi=>slotOfFace.get(fi));

    const positions=times.map(t=>sample(t).pos);
    const colors=[...new Set(usedFaces.map(fi=>faces[fi].color))];
    if(colors.length>999)return {ok:false,error:'Too many unique colors for GD channels.'};
    const channels={};colors.forEach((c,i)=>channels[c]=i+1);

    let nextGroup=1;
    const take=()=>nextGroup++;
    const vg=verts.map(take),start=take(),objects=[];
    const drawGroups=usedFaces.map(()=>take());
    const disableAllGroup=take();

    // Projection anchors.
    for(let i=0;i<verts.length;i++){
      const xy=positions[0][i];
      objects.push({1:1,2:qround(xy[0]),3:qround(xy[1]),32:.001,21:1000,57:vg[i],96:1,121:1,135:1});
    }

    // Reusable DRAW Gradient triggers. All share the same GD Z order on purpose;
    // runtime far->near activation order defines their stack priority.
    for(let slot=0;slot<usedFaces.length;slot++){
      const fi=usedFaces[slot],f=faces[fi],ids=faceIds[fi].map(i=>vg[i]);
      const corners=ids.length===3?[ids[0],ids[1],ids[2],ids[2]]:[ids[0],ids[1],ids[3],ids[2]];
      objects.push({
        1:2903,2:qround(-3200-slot*.01,6),3:-3000,
        21:channels[f.color],22:channels[f.color],24:7,25:0,
        202:8,203:corners[0],204:corners[1],205:corners[2],206:corners[3],207:1,
        209:slot+1,57:drawGroups[slot],62:1,87:1
      });
    }

    // One reusable real Gradient "Disable All" trigger. Property 508 is the
    // native Gradient Disable All flag; unlike Alpha/Toggle, this clears active
    // Gradient effects themselves.
    objects.push({1:2903,2:-3400,3:-3000,508:1,57:disableAllGroup,62:1,87:1});

    // Root scheduler.
    objects.push({1:1268,2:1,3:300,51:start,63:.02});
    let schedulerSpawns=1,moves=0,orderProxies=0,disableProxies=0,stackRefreshes=0;
    const t0=times[0];

    function addStackRefresh(state,stageGroup,baseX=100){
      // Disable first. Spawn processing is left -> right, so x=30 executes
      // before all draw proxies at x>=baseX.
      objects.push({1:1268,2:30,3:280,51:disableAllGroup,63:0,57:stageGroup,62:1,87:1});
      disableProxies++;stackRefreshes++;
      for(let rank=0;rank<state.placements.length;rank++){
        const slot=state.placements[rank];
        objects.push({1:1268,2:qround(baseX+rank*.05,6),3:280,51:drawGroups[slot],63:0,57:stageGroup,62:1,87:1});
        orderProxies++;
      }
    }

    // Initial clean stack after startup.
    addStackRefresh(states[0],start,100);

    // Schedule every exact BSP depth-state rebuild.
    for(let si=1;si<states.length;si++){
      const stage=take(),delay=qround(states[si].t0-t0,7);
      objects.push({1:1268,2:20+si,3:300,51:stage,63:delay,57:start,62:1,87:1});
      schedulerSpawns++;
      addStackRefresh(states[si],stage,100);
    }

    // Adaptive direct-anchor projection motion is unchanged from v0.81.
    for(let seg=0;seg<times.length-1;seg++){
      const a=times[seg],b=times[seg+1],dt=b-a,stage=take();
      objects.push({1:1268,2:800+seg,3:-2200,51:stage,63:qround(a-t0,7),57:start,62:1,87:1});
      schedulerSpawns++;
      for(let i=0;i<verts.length;i++){
        const dx=positions[seg+1][i][0]-positions[seg][i][0];
        const dy=positions[seg+1][i][1]-positions[seg][i][1];
        if(Math.abs(dx)+Math.abs(dy)<1e-10)continue;
        objects.push({1:901,2:900,3:-2300,10:qround(dt,7),28:qround(dx),29:qround(dy),51:vg[i],57:stage,62:1,87:1});
        moves++;
      }
    }

    if(nextGroup>10000)return {ok:false,error:`GD group budget exceeded (${nextGroup-1}/9999).`};
    if(objects.length>90000)return {ok:false,error:`v0.81.2 build would create about ${objects.length.toLocaleString()} objects; browser safety cap is 90,000.`};

    let parts=[];
    for(const c of colors){
      const ch=channels[c],rgb=[parseInt(c.slice(0,2),16),parseInt(c.slice(2,4),16),parseInt(c.slice(4,6),16)];
      parts.push(`1_${rgb[0]}_2_${rgb[1]}_3_${rgb[2]}_4_-1_6_${ch}_7_1_15_1.0_18_0_8_1`);
    }
    parts.push('1_0_2_0_3_0_4_-1_6_1000_7_0.0_15_0.0_18_0_8_1');
    const header='kS38,'+parts.join('|')+',kA13,0,kA6,1,kA16,1,kA15,1,k128,0,kA8,1,kA10,1,kA22,1';
    const level=header+';'+objects.map(objFields).join('');
    const desc='GD3D v0.81.2 Exact BSP; native Gradient Disable-All + clean far-to-near stack rebuild + adaptive projection motion.';
    const xml='<?xml version="1.0"?><plist version="1.0" gjver="2.0"><dict><k>kCEK</k><i>4</i><k>k2</k><s>'+xmlEsc(sc.name)+'</s><k>k4</k><s>'+xmlEsc(level)+'</s><k>k5</k><s>'+xmlEsc(desc)+'</s><k>k13</k><t/><k>k21</k><i>2</i><k>k16</k><i>1</i><k>k80</k><i>7</i><k>k50</k><i>45</i><k>k47</k><t/><k>k48</k><i>'+objects.length+'</i></dict></plist>';

    return {ok:true,text:xml,report:{
      mode:'general_camera',renderer:'v0.81.2-gradient-disable-all',
      source_faces:sourceFaces.length,bsp_fragments:bsp.stats.fragments,bsp_splits:bsp.stats.splits,render_pieces:faces.length,
      gradients:gradientIds,gradient_trigger_objects:gradientIds+1,unique_visible_pieces:gradientIds,
      anchors:verts.length,move_triggers:moves,alpha_switches:0,
      spawn_triggers:schedulerSpawns+orderProxies+disableProxies,order_proxy_triggers:orderProxies,
      disable_all_refreshes:stackRefreshes,objects:objects.length,groups:nextGroup-1,
      motion_knots:times.length,depth_states:states.length,tolerance:1.4
    }};
  };
  try{scheduleBudget()}catch(e){}
})();
