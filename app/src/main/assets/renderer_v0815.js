// GD3D v0.81.5 — explicit trigger execution order for Gradient state redraws
//
// v0.81.4 writes each BSP state's Gradient triggers in far->near order, but
// Geometry Dash does not guarantee that simultaneously spawned triggers execute
// in file/array order. Gradient stacking depends on activation order, so the
// exported level must explicitly assign ORD values.
//
// This patch wraps v0.81.4 and adds monotonically increasing Edit Group Order
// (save key 115) to every Gradient trigger in the exact sequence already emitted:
//   Disable All first, then farthest face ... nearest face, state by state.
(function(){
  const prev=window.generalBuildGmd;
  if(typeof prev!=='function')return;

  function addOrderToGradientObjects(xml){
    const open='<k>k4</k><s>', close='</s>';
    const p0=xml.indexOf(open);
    if(p0<0)return {xml,count:0};
    const start=p0+open.length, end=xml.indexOf(close,start);
    if(end<0)return {xml,count:0};

    const level=xml.slice(start,end), chunks=level.split(';');
    if(chunks.length<2)return {xml,count:0};

    let ord=1,count=0;
    for(let i=1;i<chunks.length;i++){
      const s=chunks[i];
      if(!s)continue;
      const a=s.split(',');
      let isGradient=false,hasOrder=false;
      for(let j=0;j+1<a.length;j+=2){
        if(a[j]==='1'&&a[j+1]==='2903')isGradient=true;
        if(a[j]==='115')hasOrder=true;
      }
      if(!isGradient)continue;
      if(!hasOrder){a.push('115',String(ord));chunks[i]=a.join(',')}
      ord++;count++;
    }
    const patched=chunks.join(';');
    return {xml:xml.slice(0,start)+patched+xml.slice(end),count};
  }

  window.generalBuildGmd=function(skipUpdate=false){
    const r=prev(skipUpdate);
    if(!r||!r.ok||typeof r.text!=='string')return r;
    const patched=addOrderToGradientObjects(r.text);
    r.text=patched.xml;
    if(r.report){
      r.report.renderer='v0.81.5-ordered-gradient-execution';
      r.report.gradient_ordered_triggers=patched.count;
    }
    return r;
  };
  try{scheduleBudget()}catch(e){}
})();
