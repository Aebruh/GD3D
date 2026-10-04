// GD3D v0.81.4 — BSP-synchronized projection motion
//
// v0.81.3 correctly scheduled exact BSP painter-state changes, but its screen-
// space vertex motion used an independent adaptive timeline. A BSP crossing
// could therefore occur partway through one GD Move-trigger segment, making the
// face-order swap look early/late even though the 3D crossing time was exact.
//
// v0.81.4 merges every BSP state boundary into the projection-motion knots.
// The projected geometry now reaches the exact crossing pose on the same frame
// that the Gradient state is redrawn.
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
    const adaptiveTimes=sched.times,sample=sched.sample;

    // Exact BSP painter states, far -> near.
    const rawStates=bspDepthStates(bsp,keys),states=[];
    for(const st of rawStates){
      const order=st.order.map(k=>faceIndex.get(k)).filter(i=>i!==undefined);
      const sig=order.join(','),prev=states[states.length-1];
      if(prev&&prev.sig===sig)prev.t1=st.t1;
      else states.push({t0:st.t0,t1:st.t1,order,sig});
    }
    if(!states.length||!states.some(s=>s.order.length))return {ok:false,error:'No front-facing BSP faces along this camera path.'};

    // Critical v0.81.4 fix: the GD vertices and BSP ordering must use one
    // synchronized timeline. Include both ends of every painter state so no
    // state change can happen in the middle of a Move-trigger interpolation.
    const firstT=adaptiveTimes[0],lastT=adaptiveTimes[adaptiveTimes.length-1],eps=1e-8;
    const motionTimes=[...new Set([
      ...adaptiveTimes,
      ...states.flatMap(s=>[s.t0,s.t1])
    ].map(t=>qround(+t,9)))]
      .filter(t=>t>=firstT-eps&&t<=lastT+eps)
      .sort((a,b)=>a-b);

    for(const t of motionTimes){
      const s=sample(t);
      if(s.minz<=.16)return generalBuildGmdClipped(true);
    }

    const maxVisible=Math.max(...states.map(s=>s.order.length),0);
    if(maxVisible>999)return {ok:false,error:`v0.81.4 needs ${maxVisible} simultaneous Gradient IDs; Geometry Dash limit is 999. Reduce visible BSP fragmentation.`};

    const usedFaces=[...new Set(states.flatMap(s=>s.order))];
    const positions=motionTimes.map(t=>sample(t).pos);
    const colors=[...new Set(usedFaces.map(fi=>faces[fi].color))];
    if(colors.length>999)return {ok:false,error:'Too many unique colors for GD channels.'};
    const channels={};colors.forEach((c,i)=>channels[c]=i+1);

    let nextGroup=1;
    const take=()=>nextGroup++;
    const vg=verts.map(take),start=take(),objects=[];
    const stateGroups=states.map(()=>take());

    // Projection anchors.
    for(let i=0;i<verts.length;i++){
      const xy=positions[0][i];
      objects.push({1:1,2:qround(xy[0]),3:qround(xy[1]),32:.001,21:1000,57:vg[i],96:1,121:1,135:1});
    }

    // Direct per-state Gradient redraw from v0.81.3 is retained unchanged.
    // Disable All executes first, then the state's Gradients far -> near.
    let gradientTriggerObjects=0,disableAllTriggers=0;
    for(let si=0;si<states.length;si++){
      const st=states[si],sg=stateGroups[si];
      objects.push({1:2903,2:30,3:280,508:1,57:sg,62:1,87:1});
      disableAllTriggers++;
      for(let rank=0;rank<st.order.length;rank++){
        const fi=st.order[rank],f=faces[fi],ids=faceIds[fi].map(i=>vg[i]);
        const corners=ids.length===3?[ids[0],ids[1],ids[2],ids[2]]:[ids[0],ids[1],ids[3],ids[2]];
        objects.push({
          1:2903,2:qround(100+rank*.05,6),3:280,
          21:channels[f.color],22:channels[f.color],24:7,25:rank,
          202:8,203:corners[0],204:corners[1],205:corners[2],206:corners[3],207:1,
          209:rank+1,57:sg,62:1,87:1
        });
        gradientTriggerObjects++;
      }
    }

    // Root scheduler. Depth-state changes now land on motionTimes by
    // construction, so the redraw and projected crossing pose are synchronized.
    objects.push({1:1268,2:1,3:300,51:start,63:.02});
    let schedulerSpawns=1,moves=0;
    const t0=motionTimes[0];
    for(let si=0;si<states.length;si++){
      objects.push({1:1268,2:20+si,3:300,51:stateGroups[si],63:qround(states[si].t0-t0,7),57:start,62:1,87:1});
      schedulerSpawns++;
    }

    // Projection movement uses the synchronized knot list.
    for(let seg=0;seg<motionTimes.length-1;seg++){
      const a=motionTimes[seg],b=motionTimes[seg+1],dt=b-a,stage=take();
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
    if(objects.length>90000)return {ok:false,error:`v0.81.4 build would create about ${objects.length.toLocaleString()} objects; browser safety cap is 90,000.`};

    let parts=[];
    for(const c of colors){
      const ch=channels[c],rgb=[parseInt(c.slice(0,2),16),parseInt(c.slice(2,4),16),parseInt(c.slice(4,6),16)];
      parts.push(`1_${rgb[0]}_2_${rgb[1]}_3_${rgb[2]}_4_-1_6_${ch}_7_1_15_1.0_18_0_8_1`);
    }
    parts.push('1_0_2_0_3_0_4_-1_6_1000_7_0.0_15_0.0_18_0_8_1');
    const header='kS38,'+parts.join('|')+',kA13,0,kA6,1,kA16,1,kA15,1,k128,0,kA8,1,kA10,1,kA22,1';
    const level=header+';'+objects.map(objFields).join('');
    const desc='GD3D v0.81.4 Exact BSP; BSP-synchronized projection knots + direct per-state Gradient redraw.';
    const xml='<?xml version="1.0"?><plist version="1.0" gjver="2.0"><dict><k>kCEK</k><i>4</i><k>k2</k><s>'+xmlEsc(sc.name)+'</s><k>k4</k><s>'+xmlEsc(level)+'</s><k>k5</k><s>'+xmlEsc(desc)+'</s><k>k13</k><t/><k>k21</k><i>2</i><k>k16</k><i>1</i><k>k80</k><i>7</i><k>k50</k><i>45</i><k>k47</k><t/><k>k48</k><i>'+objects.length+'</i></dict></plist>';

    return {ok:true,text:xml,report:{
      mode:'general_camera',renderer:'v0.81.4-bsp-synchronized-motion',
      source_faces:sourceFaces.length,bsp_fragments:bsp.stats.fragments,bsp_splits:bsp.stats.splits,render_pieces:faces.length,
      gradients:maxVisible,gradient_ids:maxVisible,gradient_trigger_objects:gradientTriggerObjects+disableAllTriggers,
      state_gradient_draws:gradientTriggerObjects,disable_all_refreshes:disableAllTriggers,
      anchors:verts.length,move_triggers:moves,alpha_switches:0,spawn_triggers:schedulerSpawns,
      objects:objects.length,groups:nextGroup-1,motion_knots:motionTimes.length,
      adaptive_motion_knots:adaptiveTimes.length,depth_sync_knots:motionTimes.length-adaptiveTimes.length,
      depth_states:states.length,tolerance:1.4
    }};
  };
  try{scheduleBudget()}catch(e){}
})();
