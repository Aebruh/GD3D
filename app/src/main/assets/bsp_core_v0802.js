// v0.78.2 exact BSP depth solver --------------------------------------------
// Ported from the validated GD3D generic fixed-Z/BSP backend. The BSP splits
// convex scene faces against each other's planes once, after which a simple
// far-to-near traversal is valid from any camera position.
const BSP_EPS=1e-7;
let previewBspCache={sig:null,sol:null,error:null};

function bspCleanLoop(v){
  let out=[];
  for(const p0 of v||[]){const p=p0.map(Number);if(!out.length||Math.hypot(...sub(p,out[out.length-1]))>BSP_EPS)out.push(p)}
  if(out.length>1&&Math.hypot(...sub(out[out.length-1],out[0]))<=BSP_EPS)out.pop();
  let changed=true,guard=0;
  while(changed&&out.length>=3&&guard++<8){
    changed=false;const next=[],n=out.length;
    for(let i=0;i<n;i++){
      const a=out[(i+n-1)%n],p=out[i],b=out[(i+1)%n],ab=sub(b,a),ab2=dot(ab,ab);
      if(ab2<=BSP_EPS*BSP_EPS){changed=true;continue}
      const cr=Math.hypot(...cross(sub(p,a),ab));
      if(cr<=BSP_EPS*Math.max(1,Math.sqrt(ab2))){
        const t=dot(sub(p,a),ab)/ab2;
        if(t>=-BSP_EPS&&t<=1+BSP_EPS){changed=true;continue}
      }
      next.push(p);
    }
    if(next.length<3)break;
    out=next;
  }
  return out;
}
function bspMakePoly(v,color,key){
  const vv=bspCleanLoop(v);if(vv.length<3)return null;
  let n=null;
  for(let i=1;i<vv.length-1;i++){const c=cross(sub(vv[i],vv[0]),sub(vv[i+1],vv[0]));if(Math.hypot(...c)>BSP_EPS){n=norm(c);break}}
  if(!n)return null;
  return {v:vv,color:hex6(color),key:String(key),n,d:dot(n,vv[0])};
}
function bspCanonicalPlane(p){
  let n=p.n.slice(),d=p.d;
  for(const x of n){if(Math.abs(x)>BSP_EPS){if(x<0){n=n.map(q=>-q);d=-d}break}}
  return [...n,d].map(x=>Math.round(x*1e8)/1e8).join('|');
}
function bspClassify(p,n,d){
  let pos=false,neg=false;
  for(const v of p.v){const q=dot(n,v)-d;if(q>BSP_EPS)pos=true;else if(q<-BSP_EPS)neg=true;if(pos&&neg)return 2}
  return pos?1:(neg?-1:0);
}
function bspClipHalf(v,n,d){
  if(!v.length)return [];
  const out=[];let A=v[v.length-1],da=dot(n,A)-d,ina=da>=-BSP_EPS;
  for(const B of v){
    const db=dot(n,B)-d,inb=db>=-BSP_EPS;
    if(ina!==inb){const den=da-db;if(Math.abs(den)>1e-12){const q=da/den;out.push([A[0]+(B[0]-A[0])*q,A[1]+(B[1]-A[1])*q,A[2]+(B[2]-A[2])*q])}}
    if(inb)out.push(B.slice());
    A=B;da=db;ina=inb;
  }
  return bspCleanLoop(out);
}
function bspScoreLess(a,b){for(let i=0;i<a.length;i++){if(a[i]<b[i])return true;if(a[i]>b[i])return false}return false}
function bspBuild(polys,stats={input:0,splits:0,maxDepth:0},depth=0){
  if(!polys.length)return null;
  stats.maxDepth=Math.max(stats.maxDepth,depth);
  if(depth>1600||stats.splits>1800)throw new Error('Exact BSP split budget exceeded. Reduce intersecting geometry.');
  const uniq=[],seen=new Set();
  for(const p of polys){const k=bspCanonicalPlane(p);if(!seen.has(k)){seen.add(k);uniq.push(p)}}
  let candidates=uniq;
  // Plane choice affects efficiency, not correctness. Limit expensive scoring
  // for large scenes while keeping a deterministic spread of candidates.
  if(candidates.length>48){const sampled=[];for(let i=0;i<48;i++)sampled.push(candidates[Math.floor(i*(candidates.length-1)/47)]);candidates=sampled}
  let best=null;
  for(const s of candidates){
    let front=0,back=0,split=0,cop=0;
    for(const q of polys){const k=bspClassify(q,s.n,s.d);if(k===2)split++;else if(k===1)front++;else if(k===-1)back++;else cop++}
    const score=[12*split+Math.abs(front-back),split,-cop];
    if(!best||bspScoreLess(score,best.score))best={s,score};
  }
  const splitter=best.s,front=[],back=[],coplanar=[];
  for(const q of polys){
    const k=bspClassify(q,splitter.n,splitter.d);
    if(k===0)coplanar.push(q);
    else if(k===1)front.push(q);
    else if(k===-1)back.push(q);
    else{
      const vf=bspClipHalf(q.v,splitter.n,splitter.d),nn=splitter.n.map(x=>-x),vb=bspClipHalf(q.v,nn,-splitter.d);
      const pf=vf.length>=3?bspMakePoly(vf,q.color,q.key+'F'):null,pb=vb.length>=3?bspMakePoly(vb,q.color,q.key+'B'):null;
      if(pf)front.push(pf);if(pb)back.push(pb);stats.splits++;
    }
  }
  const node={n:splitter.n.slice(),d:splitter.d,coplanar,front:null,back:null};
  node.front=bspBuild(front,stats,depth+1);node.back=bspBuild(back,stats,depth+1);return node;
}
function bspFlatten(node,out=[]){if(!node)return out;bspFlatten(node.front,out);out.push(...node.coplanar);bspFlatten(node.back,out);return out}
function bspPainter(node,eye,out=[]){
  if(!node)return out;
  if(dot(node.n,eye)>=node.d){bspPainter(node.back,eye,out);out.push(...node.coplanar);bspPainter(node.front,eye,out)}
  else{bspPainter(node.front,eye,out);out.push(...node.coplanar);bspPainter(node.back,eye,out)}
  return out;
}
function bspGdPieces(poly){
  const n=poly.v.length;if(n<=4)return [poly];
  const out=[];let i=1,chunk=0;
  while(i<n-1){
    const ids=[0];for(let j=i;j<Math.min(i+3,n);j++)ids.push(j);
    const p=bspMakePoly(ids.map(j=>poly.v[j]),poly.color,poly.key+'Q'+chunk++);if(p)out.push(p);i+=2;
  }
  return out;
}
function bspPrepareFaces(faces){
  const src=[];for(let i=0;i<faces.length;i++){const p=bspMakePoly(faces[i].v,faces[i].color,'f'+i);if(p)src.push(p)}
  if(!src.length)return null;
  const stats={input:src.length,splits:0,maxDepth:0},tree=bspBuild(src,stats,0),fragments=bspFlatten(tree,[]);
  const pieces=[],parentPieces=new Map(),pieceByKey=new Map();
  for(const p of fragments){const ps=bspGdPieces(p);parentPieces.set(p.key,ps);for(const q of ps){pieces.push(q);pieceByKey.set(q.key,q)}}
  stats.fragments=fragments.length;stats.pieces=pieces.length;
  return {tree,fragments,pieces,parentPieces,pieceByKey,stats};
}
function previewBspSolution(){
  const sig=JSON.stringify(scene.objects);
  if(previewBspCache.sig===sig)return previewBspCache.sol;
  try{const sol=bspPrepareFaces(generalFaces());previewBspCache={sig,sol,error:null};return sol}
  catch(e){previewBspCache={sig,sol:null,error:e?.message||String(e)};return null}
}
function bspCollectPlanes(node,out=[],seen=new Set()){
  if(!node)return out;const p={n:node.n,d:node.d},k=bspCanonicalPlane(p);
  if(!seen.has(k)){seen.add(k);out.push([node.n.slice(),node.d])}
  bspCollectPlanes(node.front,out,seen);bspCollectPlanes(node.back,out,seen);return out;
}
function bspEventTimes(sol,keys){
  const vals=new Set(keys.map(k=>qround(+k.t,9))),planes=bspCollectPlanes(sol.tree,[]);
  for(let i=0;i<keys.length-1;i++){
    const a=keys[i],b=keys[i+1],dt=b.t-a.t;
    for(const [n,d] of planes){
      const da=dot(a.eye,n)-d,db=dot(b.eye,n)-d;
      if(Math.abs(da)<=BSP_EPS)vals.add(qround(+a.t,9));
      if(Math.abs(db)<=BSP_EPS)vals.add(qround(+b.t,9));
      if(da*db<0&&Math.abs(db-da)>1e-12){const q=-da/(db-da);vals.add(qround(a.t+dt*q,9))}
    }
  }
  return [...vals].sort((a,b)=>a-b);
}
function bspVisiblePieceOrder(sol,eye){
  const out=[];
  for(const p of bspPainter(sol.tree,eye,[])){
    if(dot(p.n,eye)-p.d<=BSP_EPS)continue;
    const ps=sol.parentPieces.get(p.key)||[p];for(const q of ps)out.push(q.key);
  }
  return out;
}
function bspDepthStates(sol,keys){
  const events=bspEventTimes(sol,keys),states=[];
  for(let i=0;i<events.length-1;i++){
    const a=events[i],b=events[i+1];if(b-a<=1e-8)continue;
    const eye=sampleCamFromKeys(keys,(a+b)/2).eye,order=bspVisiblePieceOrder(sol,eye),sig=order.join(',');
    const prev=states[states.length-1];
    if(prev&&prev.sig===sig)prev.t1=b;
    else states.push({t0:a,t1:b,order,sig});
  }
  return states;
}
