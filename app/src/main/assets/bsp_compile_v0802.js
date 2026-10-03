function generalBuildGmd(skipUpdate=false){
  if(!skipUpdate)updateJSON();const sc=cleanScene(),keys=sc.camera.keys;if(!keys||keys.length<2)return {ok:false,error:'General Camera build needs at least two camera keyframes.'};
  for(let i=0;i<keys.length-1;i++)if(!(keys[i+1].t>keys[i].t))return {ok:false,error:'Camera keyframe times must strictly increase.'};

  const sourceFaces=generalFaces();if(!sourceFaces.length)return {ok:false,error:'No renderable faces in the scene.'};
  let bsp;
  try{bsp=bspPrepareFaces(sourceFaces)}catch(e){return {ok:false,error:'Exact BSP preprocessing failed: '+(e?.message||String(e))}}
  if(!bsp||!bsp.pieces.length)return {ok:false,error:'Exact BSP produced no renderable pieces.'};

  const faces=bsp.pieces.map(p=>({v:p.v,color:p.color,n:p.n,d:p.d,key:p.key})),faceIndex=new Map(faces.map((f,i)=>[f.key,i]));
  const verts=[],vmap=new Map(),faceIds=[];
  for(const f of faces){const row=[];for(const p of f.v){const k=key3(p);if(!vmap.has(k)){vmap.set(k,verts.length);verts.push(p)}row.push(vmap.get(k))}faceIds.push(row)}

  const sched=generalAdaptiveSchedule(keys,verts,1.4,256);if(!sched.ok){if(sched.nearPlane)return generalBuildGmdClipped(true);return sched;}
  const {times,sample}=sched;for(const t of times){const s=sample(t);if(s.minz<=.16)return generalBuildGmdClipped(true)}

  // BSP partition-plane crossings give the exact times at which painter order can change.
  const rawStates=bspDepthStates(bsp,keys),states=[];
  for(const st of rawStates){
    const order=st.order.map(k=>faceIndex.get(k)).filter(i=>i!==undefined),sig=order.join(',');
    const prev=states[states.length-1];
    if(prev&&prev.sig===sig)prev.t1=st.t1;
    else states.push({t0:st.t0,t1:st.t1,order,sig});
  }
  if(!states.length||!states.some(s=>s.order.length))return {ok:false,error:'No front-facing BSP faces along this camera path.'};

  // v0.80.3 temporal placement reuse:
  // A Gradient's Z-rank is static, so the minimum safe reusable unit is the
  // pair (face, rank). Reuse that same Gradient in every depth state where the
  // face needs that rank instead of cloning the whole state. This preserves
  // exact BSP painter order while avoiding stateCount * faceCount blow-up.
  const placementDefs=[],placementMap=new Map();
  let naivePlacementCount=0;
  for(let si=0;si<states.length;si++){
    const st=states[si],pg=[];naivePlacementCount+=st.order.length;
    for(let rank=0;rank<st.order.length;rank++){
      const fi=st.order[rank],pk=fi+'@'+rank;let slot=placementMap.get(pk);
      if(slot===undefined){slot=placementDefs.length;placementMap.set(pk,slot);placementDefs.push({face:fi,rank})}
      pg.push(slot);
    }
    st.placements=pg;
  }
  const placementCount=placementDefs.length;
  if(placementCount>999)return {ok:false,error:`Exact BSP needs ${placementCount} reusable Gradient placements (${naivePlacementCount} before reuse); Geometry Dash limit is 999. Reduce scene complexity or camera depth-order changes.`};

  const positions=times.map(t=>sample(t).pos),colors=[...new Set(faces.map(f=>f.color))];
  if(colors.length>999)return {ok:false,error:'Too many unique colors for GD channels.'};const channels={};colors.forEach((c,i)=>channels[c]=i+1);
  let nextGroup=1;const take=()=>nextGroup++,vg=verts.map(take),start=take(),placements=[],objects=[];
  for(let i=0;i<verts.length;i++){const xy=positions[0][i];objects.push({1:1,2:qround(xy[0]),3:qround(xy[1]),32:.001,21:1000,57:vg[i],96:1,121:1,135:1})}

  let gradId=1;
  for(let slot=0;slot<placementDefs.length;slot++){
    const def=placementDefs[slot],fi=def.face,rank=def.rank,f=faces[fi],ids=faceIds[fi].map(i=>vg[i]),corners=ids.length===3?[ids[0],ids[1],ids[2],ids[2]]:[ids[0],ids[1],ids[3],ids[2]],g=take();
    placements.push({group:g,face:fi,rank});
    objects.push({1:2903,2:1,3:qround(-1000-slot*.025,6),21:channels[f.color],22:channels[f.color],24:7,25:rank,202:8,203:corners[0],204:corners[1],205:corners[2],206:corners[3],207:1,209:gradId++,57:g});
  }

  const initially=new Set(states[0].placements);for(let i=0;i<placements.length;i++)objects.push({1:1007,2:0,3:320,10:0,35:initially.has(i)?1:0,51:placements[i].group});
  objects.push({1:1268,2:1,3:300,51:start,63:.02});let spawns=1,alphaSwitches=0,moves=0;
  const t0=times[0];

  // Exact depth-state swaps at BSP plane crossings. Only switch placements
  // whose active state actually changes; persistent face/rank pairs stay on.
  for(let si=1;si<states.length;si++){
    const prevSet=new Set(states[si-1].placements),nextSet=new Set(states[si].placements),off=[],on=[];
    for(const slot of prevSet)if(!nextSet.has(slot))off.push(slot);
    for(const slot of nextSet)if(!prevSet.has(slot))on.push(slot);
    if(!off.length&&!on.length)continue;
    const stage=take(),delay=qround(states[si].t0-t0,7);objects.push({1:1268,2:20+si,3:300,51:stage,63:delay,57:start,62:1,87:1});spawns++;
    for(const slot of off){objects.push({1:1007,2:40,3:320,10:0,35:0,51:placements[slot].group,57:stage,62:1,87:1});alphaSwitches++}
    for(const slot of on){objects.push({1:1007,2:41,3:320,10:0,35:1,51:placements[slot].group,57:stage,62:1,87:1});alphaSwitches++}
  }

  // Adaptive direct-anchor motion remains independent from depth-state timing.
  for(let seg=0;seg<times.length-1;seg++){
    const a=times[seg],b=times[seg+1],dt=b-a,stage=take();objects.push({1:1268,2:800+seg,3:-2200,51:stage,63:qround(a-t0,7),57:start,62:1,87:1});spawns++;
    for(let i=0;i<verts.length;i++){const dx=positions[seg+1][i][0]-positions[seg][i][0],dy=positions[seg+1][i][1]-positions[seg][i][1];if(Math.abs(dx)+Math.abs(dy)<1e-10)continue;objects.push({1:901,2:900,3:-2300,10:qround(dt,7),28:qround(dx),29:qround(dy),51:vg[i],57:stage,62:1,87:1});moves++}
  }

  if(nextGroup>10000)return {ok:false,error:`GD group budget exceeded (${nextGroup-1}/9999).`};
  if(objects.length>90000)return {ok:false,error:`Exact BSP build would create about ${objects.length.toLocaleString()} objects; browser safety cap is 90,000.`};
  let parts=[];for(const c of colors){const ch=channels[c],rgb=[parseInt(c.slice(0,2),16),parseInt(c.slice(2,4),16)];rgb.push(parseInt(c.slice(4,6),16));parts.push(`1_${rgb[0]}_2_${rgb[1]}_3_${rgb[2]}_4_-1_6_${ch}_7_1_15_1.0_18_0_8_1`)}parts.push('1_0_2_0_3_0_4_-1_6_1000_7_0.0_15_0.0_18_0_8_1');
  const header='kS38,'+parts.join('|')+',kA13,0,kA6,1,kA16,1,kA15,1,k128,0,kA8,1,kA10,1,kA22,1',level=header+';'+objects.map(objFields).join(''),desc='GD3D Visual Editor v0.78.3 Exact BSP; reusable face/rank placements + adaptive projection motion.';
  const xml='<?xml version="1.0"?><plist version="1.0" gjver="2.0"><dict><k>kCEK</k><i>4</i><k>k2</k><s>'+xmlEsc(sc.name)+'</s><k>k4</k><s>'+xmlEsc(level)+'</s><k>k5</k><s>'+xmlEsc(desc)+'</s><k>k13</k><t/><k>k21</k><i>2</i><k>k16</k><i>1</i><k>k80</k><i>7</i><k>k50</k><i>45</i><k>k47</k><t/><k>k48</k><i>'+objects.length+'</i></dict></plist>';
  return {ok:true,text:xml,report:{mode:'general_camera',source_faces:sourceFaces.length,bsp_fragments:bsp.stats.fragments,bsp_splits:bsp.stats.splits,render_pieces:faces.length,gradients:placementCount,naive_gradients:naivePlacementCount,gradient_reuse_saved:naivePlacementCount-placementCount,anchors:verts.length,move_triggers:moves,alpha_switches:alphaSwitches,spawn_triggers:spawns,objects:objects.length,groups:nextGroup-1,motion_knots:times.length,depth_states:states.length,tolerance:1.4}};
}
