// GD3D v0.81.6 — exact BSP ordering for close-camera / near-plane scenes
//
// The legacy close-camera path clipped triangles correctly, but ordered the
// resulting screen-space pieces by average depth at each motion interval. That
// approximation can disagree with the exact painter order when geometry
// overlaps or intersects. v0.81.6 keeps the clipping subsystem, but performs it
// on the exact BSP fragments and expands each BSP far->near traversal into the
// currently visible clipped triangle pieces.
//
// Each close-camera depth state is rebuilt exactly like the validated v0.81.5
// normal path: Disable All first, then visible Gradient triggers far -> near,
// with explicit ORD values so Geometry Dash executes simultaneous triggers in
// the intended order.
(function(){
  function clippedBspTriangles(sol){
    const tris=[],byParent=new Map();
    const add=(p,v,local)=>{
      const n=cross(sub(v[1],v[0]),sub(v[2],v[0]));
      if(Math.hypot(...n)<1e-10)return;
      const idx=tris.length;
      tris.push({v,color:p.color,n,d:dot(n,v[0]),parentKey:p.key,local});
      if(!byParent.has(p.key))byParent.set(p.key,[]);
      byParent.get(p.key).push(idx);
    };
    for(const p of sol.pieces){
      if(!p.v||p.v.length<3)continue;
      if(p.v.length===3)add(p,[p.v[0],p.v[1],p.v[2]],0);
      else if(p.v.length===4){
        add(p,[p.v[0],p.v[1],p.v[2]],0);
        add(p,[p.v[0],p.v[2],p.v[3]],1);
      }else{
        for(let i=1;i<p.v.length-1;i++)add(p,[p.v[0],p.v[i],p.v[i+1]],i-1);
      }
    }
    return {tris,byParent};
  }

  function orderedVisibleClipKeys(sol,triInfo,S){
    const perTri=new Map();
    for(const [key] of S.pieces){
      const c=key.indexOf(':');
      const ti=+(c<0?key:key.slice(0,c));
      if(!perTri.has(ti))perTri.set(ti,[]);
      perTri.get(ti).push(key);
    }
    for(const a of perTri.values())a.sort((x,y)=>{
      const ax=+(x.slice(x.indexOf(':')+1)||0),ay=+(y.slice(y.indexOf(':')+1)||0);
      return ax-ay;
    });

    const out=[],used=new Set(),parentOrder=bspVisiblePieceOrder(sol,S.cam.eye);
    for(const parentKey of parentOrder){
      for(const ti of triInfo.byParent.get(parentKey)||[]){
        for(const key of perTri.get(ti)||[]){out.push(key);used.add(key)}
      }
    }

    // Numerical safety only. Normally every clipped front-facing triangle is
    // represented by the BSP traversal above. If an edge-case survives clipping
    // but misses the traversal because of epsilon disagreement, retain it using
    // its camera-space depth instead of silently dropping geometry.
    const leftovers=[];
    for(const [key,p] of S.pieces)if(!used.has(key))leftovers.push([key,p.depth]);
    leftovers.sort((a,b)=>b[1]-a[1]);
    for(const [key] of leftovers)out.push(key);
    return {order:out,leftovers:leftovers.length};
  }

  window.generalBuildGmdClipped=function(skipUpdate=false){
    if(!skipUpdate)updateJSON();
    const sc=cleanScene(),keys=sc.camera.keys;
    if(!keys||keys.length<2)return {ok:false,error:'Close-camera build needs at least two camera keyframes.'};
    for(let i=0;i<keys.length-1;i++)if(!(keys[i+1].t>keys[i].t))return {ok:false,error:'Camera keyframe times must strictly increase.'};

    const sourceFaces=generalFaces();
    if(!sourceFaces.length)return {ok:false,error:'No renderable faces in the scene.'};
    let bsp;
    try{bsp=bspPrepareFaces(sourceFaces)}catch(e){return {ok:false,error:'Close-camera exact BSP preprocessing failed: '+(e?.message||String(e))}}
    if(!bsp||!bsp.pieces.length)return {ok:false,error:'Close-camera exact BSP produced no renderable pieces.'};

    const triInfo=clippedBspTriangles(bsp),tris=triInfo.tris;
    if(!tris.length)return {ok:false,error:'No renderable BSP triangles for close-camera clipping.'};

    const sched=nearClipAdaptiveSchedule(keys,tris,1.35,260);
    if(!sched.ok)return sched;

    // Synchronize clipping/topology knots with every exact BSP plane crossing.
    const bspStates=bspDepthStates(bsp,keys);
    const firstT=sched.times[0],lastT=sched.times[sched.times.length-1],eps=1e-8;
    const times=[...new Set([
      ...sched.times,
      ...bspStates.flatMap(s=>[s.t0,s.t1])
    ].map(t=>qround(+t,9)))]
      .filter(t=>t>=firstT-eps&&t<=lastT+eps)
      .sort((a,b)=>a-b);

    const states=[];
    let numericalFallbackPieces=0;
    for(let i=0;i<times.length-1;i++){
      const a=times[i],b=times[i+1];
      if(b-a<=1e-8)continue;
      const m=(a+b)/2,S=sched.sample(m),ord=orderedVisibleClipKeys(bsp,triInfo,S);
      numericalFallbackPieces+=ord.leftovers;
      const order=ord.order,sig=order.join(',');
      const prev=states[states.length-1];
      if(prev&&prev.sig===sig){prev.t1=b;prev.endIndex=i+1}
      else states.push({t0:a,t1:b,startIndex:i,endIndex:i+1,order,sig});
    }
    if(!states.length||!states.some(s=>s.order.length))return {ok:false,error:'No visible clipped BSP faces along this camera path.'};

    const maxVisible=Math.max(...states.map(s=>s.order.length),0);
    if(maxVisible>999)return {ok:false,error:`Close-camera exact BSP needs ${maxVisible} simultaneous Gradient IDs; Geometry Dash limit is 999. Reduce close visible fragmentation.`};

    const colors=[...new Set(tris.map(f=>f.color))];
    if(colors.length>999)return {ok:false,error:'Too many unique colors for GD channels.'};
    const channels={};colors.forEach((c,i)=>channels[c]=i+1);

    let nextGroup=1;
    const take=()=>nextGroup++;
    const start=take(),objects=[],placements=[];
    const stateGroups=states.map(()=>take());
    let gradientTriggerObjects=0,disableAllTriggers=0,moves=0,spawns=1;

    // Each state owns private clipped anchors. Their initial coordinates are the
    // exact pose at that state's entry, so inactive future states require no
    // pre-positioning movement.
    for(let si=0;si<states.length;si++){
      const st=states[si],sg=stateGroups[si],pg=[];
      const S0=stateEdgeSample(sched,st,st.t0,1);

      objects.push({1:2903,2:30,3:280,508:1,57:sg,62:1,87:1,115:1});
      disableAllTriggers++;

      for(let rank=0;rank<st.order.length;rank++){
        const key=st.order[rank];
        const piece=statePieceAt(S0,key)||statePieceAt(sched.sample((st.t0+st.t1)/2),key);
        if(!piece)continue;
        const ti=+key.slice(0,key.indexOf(':'));
        const tri=tris[ti];
        if(!tri)continue;
        const ag=[take(),take(),take()];
        for(let j=0;j<3;j++)objects.push({1:1,2:qround(piece.xy[j][0]),3:qround(piece.xy[j][1]),32:.001,21:1000,57:ag[j],96:1,121:1,135:1});
        placements.push({state:si,key,anchors:ag});
        pg.push(placements.length-1);
        objects.push({
          1:2903,2:qround(100+rank*.05,6),3:280,
          21:channels[tri.color],22:channels[tri.color],24:7,25:rank,
          202:8,203:ag[0],204:ag[1],205:ag[2],206:ag[2],207:1,
          209:rank+1,57:sg,62:1,87:1,115:rank+2
        });
        gradientTriggerObjects++;
      }
      st.placements=pg;
    }

    // Root scheduler: every state performs a clean Disable All + exact redraw.
    objects.push({1:1268,2:1,3:300,51:start,63:.02});
    const t0=times[0];
    for(let si=0;si<states.length;si++){
      objects.push({1:1268,2:20+si,3:300,51:stateGroups[si],63:qround(states[si].t0-t0,7),57:start,62:1,87:1});
      spawns++;
    }

    // Move only the private clipped anchors belonging to the active state.
    const stageBySeg=new Map();
    const getStage=seg=>{
      if(stageBySeg.has(seg))return stageBySeg.get(seg);
      const g=take(),a=times[seg];
      objects.push({1:1268,2:900+seg,3:-2200,51:g,63:qround(a-t0,7),57:start,62:1,87:1});
      spawns++;stageBySeg.set(seg,g);return g;
    };
    for(const st of states){
      for(const slot of st.placements){
        const pl=placements[slot];
        for(let seg=st.startIndex;seg<st.endIndex;seg++){
          const a=times[seg],b=times[seg+1],A=stateEdgeSample(sched,st,a,1),B=stateEdgeSample(sched,st,b,-1);
          const pa=statePieceAt(A,pl.key),pb=statePieceAt(B,pl.key);
          if(!pa||!pb)continue;
          const stage=getStage(seg),dt=b-a;
          for(let j=0;j<3;j++){
            const dx=pb.xy[j][0]-pa.xy[j][0],dy=pb.xy[j][1]-pa.xy[j][1];
            if(Math.abs(dx)+Math.abs(dy)<1e-10)continue;
            objects.push({1:901,2:900+j,3:-2300,10:qround(dt,7),28:qround(dx),29:qround(dy),51:pl.anchors[j],57:stage,62:1,87:1});
            moves++;
          }
        }
      }
    }

    if(nextGroup>10000)return {ok:false,error:`GD group budget exceeded (${nextGroup-1}/9999).`};
    if(objects.length>90000)return {ok:false,error:`Close-camera exact BSP build would create about ${objects.length.toLocaleString()} objects; browser safety cap is 90,000.`};

    let parts=[];
    for(const c of colors){
      const ch=channels[c],rgb=[parseInt(c.slice(0,2),16),parseInt(c.slice(2,4),16),parseInt(c.slice(4,6),16)];
      parts.push(`1_${rgb[0]}_2_${rgb[1]}_3_${rgb[2]}_4_-1_6_${ch}_7_1_15_1.0_18_0_8_1`);
    }
    parts.push('1_0_2_0_3_0_4_-1_6_1000_7_0.0_15_0.0_18_0_8_1');
    const header='kS38,'+parts.join('|')+',kA13,0,kA6,1,kA16,1,kA15,1,k128,0,kA8,1,kA10,1,kA22,1';
    const level=header+';'+objects.map(objFields).join('');
    const desc='GD3D v0.81.6 Close Camera; exact BSP ordering + near-plane clipping + explicit Gradient order.';
    const xml='<?xml version="1.0"?><plist version="1.0" gjver="2.0"><dict><k>kCEK</k><i>4</i><k>k2</k><s>'+xmlEsc(sc.name)+'</s><k>k4</k><s>'+xmlEsc(level)+'</s><k>k5</k><s>'+xmlEsc(desc)+'</s><k>k13</k><t/><k>k21</k><i>2</i><k>k16</k><i>1</i><k>k80</k><i>7</i><k>k50</k><i>45</i><k>k47</k><t/><k>k48</k><i>'+objects.length+'</i></dict></plist>';

    return {ok:true,text:xml,report:{
      mode:'close_camera',renderer:'v0.81.6-bsp-clipped-ordered',
      source_faces:sourceFaces.length,bsp_fragments:bsp.stats.fragments,bsp_splits:bsp.stats.splits,
      bsp_pieces:bsp.pieces.length,clip_triangles:tris.length,
      gradients:maxVisible,gradient_ids:maxVisible,gradient_trigger_objects:gradientTriggerObjects+disableAllTriggers,
      state_gradient_draws:gradientTriggerObjects,disable_all_refreshes:disableAllTriggers,
      anchors:placements.length*3,move_triggers:moves,alpha_switches:0,spawn_triggers:spawns,
      objects:objects.length,groups:nextGroup-1,motion_knots:times.length,depth_states:states.length,
      numerical_order_fallbacks:numericalFallbackPieces,tolerance:1.35
    }};
  };
})();
