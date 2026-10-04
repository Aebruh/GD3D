function setFileLink(kind,text,filename,mime){
  if(exportUrls[kind])URL.revokeObjectURL(exportUrls[kind]);
  const mt=mime||'application/octet-stream',url=URL.createObjectURL(new Blob([text],{type:mt}));exportUrls[kind]=url;
  const a=$('#'+kind+'Link');a.href=url;a.download=filename;a.dataset.filename=filename;a.dataset.mime=mt;a.style.display='inline-block';
  // In the Android APK, blob: download links do not reliably create a file.
  // Route the tap through the native Storage Access Framework bridge instead,
  // which opens Android's normal "Save to..." document picker.
  a.onclick=e=>{
    if(androidBridge()){
      e.preventDefault();
      if(nativeSaveText(filename,mt,text)){toast('Choose where to save '+filename);return false}
    }
    return true;
  };
  $('#saveLinks').style.display='block';return a;
}

// UI-only mobile patches load after the stock editor and native-save bridge.
(()=>{
  const s=document.createElement('script');s.src='ui_focus_v0804.js';
  s.onload=()=>{
    const t=document.createElement('script');t.src='mobile_tools_v0805.js';
    t.onload=()=>{
      const u=document.createElement('script');u.src='camera_tools_v0806.js';
      u.onload=()=>{const v=document.createElement('script');v.src='build_tools_v0807.js';document.head.appendChild(v)};
      document.head.appendChild(u);
    };
    document.head.appendChild(t);
  };
  document.head.appendChild(s);
})();
