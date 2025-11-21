(() => {
  const q = id => document.getElementById(id);
  const els = {
    stage: q('stage'),
    preview: q('preview'),
    start: q('startBtn'),
    stop: q('stopBtn'),
    viewer: q('viewerBtn'),
    delay: q('delaySec'),
    delayOut: q('delayOut'),
    quality: q('quality'),
    replay: q('replayBtn'),
    save: q('saveBtn'),
    status: q('status'),
    overlay: q('viewerOverlay'),
    closeViewer: q('closeViewer'),
    viewerImg: q('viewerImg'),
    viewerStats: q('viewerStats'),
    viewerBuffer: q('viewerBuffer')
  };

  let mediaStream = null, wakeLock = null;
  const stage = els.stage || document.createElement('canvas');
  const ctx = stage.getContext('2d', { alpha:false });
  const frames = [];
  let running = false;
  let desiredDelayMs = 12000;
  let maxBufferMs = 13200;
  let videoWidth = 1280, videoHeight = 720;
  let targetFps = 24, jpgQuality = 0.82;
  let viewerTimer = null;

  function setStatus(s){ if(els.status) els.status.textContent = s || ''; }

  function updateDelay(){
    if(!els.delay) return;
    desiredDelayMs = Math.max(2000, parseInt(els.delay.value||'12',10)*1000);
    maxBufferMs = desiredDelayMs + 1200;
    if(els.delayOut) els.delayOut.textContent = Math.round(desiredDelayMs/1000);
  }
  if(els.delay){
    els.delay.addEventListener('input', updateDelay);
    updateDelay();
  }

  function applyQuality(){
    const v = els.quality ? els.quality.value : 'balanced';
    if (v==='high'){ targetFps=30; jpgQuality=0.9; }
    else if (v==='battery'){ targetFps=20; jpgQuality=0.75; }
    else { targetFps=24; jpgQuality=0.82; }
  }
  if(els.quality){
    els.quality.addEventListener('change', applyQuality);
    applyQuality();
  }

  function fitStageToViewport(w,h){
    const wrap = document.querySelector('.video-wrap') || document.body;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio||1));
    const vw = Math.max(1, Math.floor(wrap.clientWidth * dpr));
    const vh = Math.max(1, Math.floor(wrap.clientHeight * dpr));
    const ar = w/h;
    let cw = vw, ch = Math.floor(vw/ar);
    if (ch>vh){ ch=vh; cw=Math.floor(vh*ar); }
    if (stage.width!==cw || stage.height!==ch){
      stage.width=cw; stage.height=ch;
      stage.style.width = Math.floor(cw/dpr)+'px';
      stage.style.height= Math.floor(ch/dpr)+'px';
    }
  }

  function pickFrame(ts){
    let lo=0, hi=frames.length-1, idx=-1;
    while(lo<=hi){
      const mid=(lo+hi)>>1;
      if(frames[mid].ts<=ts){ idx=mid; lo=mid+1; } else hi=mid-1;
    }
    return idx;
  }
  function trim(now){ const min = now - maxBufferMs; while(frames.length && frames[0].ts<min) frames.shift(); }

  async function acquireWake(){ try{ if('wakeLock' in navigator){ wakeLock=await navigator.wakeLock.request('screen'); } }catch{} }
  async function releaseWake(){ try{ await wakeLock?.release(); }catch{} wakeLock=null; }

  async function start(){
    if(!isSecureContext || !navigator.mediaDevices){ setStatus('Use HTTPS + modern browser'); return; }
    try{
      setStatus('Starting…');
      let constraints = {audio:false, video:{ facingMode:{ exact:'environment' }, width:{ideal:1920}, height:{ideal:1080}, frameRate:{ideal:30}}};
      try{ mediaStream = await navigator.mediaDevices.getUserMedia(constraints); }
      catch{ mediaStream = await navigator.mediaDevices.getUserMedia({audio:false, video:{ facingMode:{ ideal:'environment' }, width:{ideal:1920}, height:{ideal:1080}, frameRate:{ideal:30}}}); }

      if(els.preview){ els.preview.srcObject = mediaStream; await els.preview.play(); }
      await new Promise(res => {
        const v = els.preview;
        if (!v || v.videoWidth) return res();
        v.onloadedmetadata = () => res();
      });
      videoWidth = els.preview?.videoWidth || 1280;
      videoHeight = els.preview?.videoHeight || 720;
      fitStageToViewport(videoWidth, videoHeight);

      running = true;
      await acquireWake();
      if(els.start) els.start.disabled = true;
      if(els.stop) els.stop.disabled = false;
      if(els.viewer) els.viewer.disabled = false;
      if(els.replay) els.replay.disabled = false;
      if(els.save) els.save.disabled = false;

      captureLoop();
      delayedDrawLoop();
      setStatus('Live with delay');
    }catch(e){
      console.error(e);
      setStatus('Failed to start camera');
      await stop();
    }
  }

  async function stop(){
    running = false;
    if(viewerTimer){ clearInterval(viewerTimer); viewerTimer=null; }
    await releaseWake();
    try{ els.preview?.pause(); }catch{}
    try{ mediaStream?.getTracks().forEach(t=>t.stop()); }catch{}
    mediaStream=null;
    if(els.start) els.start.disabled=false;
    if(els.stop) els.stop.disabled=true;
    if(els.viewer) els.viewer.disabled=true;
    if(els.replay) els.replay.disabled=true;
    if(els.save) els.save.disabled=true;
    setStatus('Stopped');
    closeViewer();
  }

  function captureLoop(){
    const v = els.preview;
    const useRVFC = !!v?.requestVideoFrameCallback;
    const push = () => {
      if(!running) return;
      fitStageToViewport(videoWidth, videoHeight);
      try{ ctx.drawImage(v, 0, 0, stage.width, stage.height); }catch{ return; }
      const ts = performance.now();
      const entry = { ts, w: stage.width, h: stage.height };
      const store = () => {
        if('createImageBitmap' in window){
          createImageBitmap(stage).then(bmp => {
            entry.bitmap = bmp; frames.push(entry); trim(ts);
          }).catch(()=>{});
        }else{
          const c = document.createElement('canvas'); c.width=stage.width; c.height=stage.height;
          c.getContext('2d').drawImage(stage,0,0); entry.canvas=c; frames.push(entry); trim(ts);
        }
      };
      store();
    };
    if(useRVFC){
      const cb = ()=>{ push(); v.requestVideoFrameCallback(cb); };
      v.requestVideoFrameCallback(cb);
    }else{
      const loop = ()=>{ if(!running) return; push(); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    }
  }

  function delayedDrawLoop(){
    let last = 0;
    const loop = ()=>{
      if(!running) return;
      const now = performance.now();
      const interval = 1000 / targetFps;
      if(now-last < interval){ return requestAnimationFrame(loop); }
      last = now;
      const idx = pickFrame(now - desiredDelayMs);
      if(idx>=0){
        const f = frames[idx];
        const src = f.bitmap || f.canvas;
        if(src) ctx.drawImage(src, 0, 0, stage.width, stage.height);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // Viewer overlay (robust open/close & buffering gate)
  function openViewer(){
    // Gate until we have at least one valid frame
    const now = performance.now();
    const idx = pickFrame(now - desiredDelayMs);
    if(idx<0){ 
      if(els.viewerBuffer) els.viewerBuffer.textContent = 'Buffering…';
    }
    els.overlay.hidden = false;
    // Close by clicking outside bar or with ESC
    els.overlay.addEventListener('click', overlayCloseHandler);
    document.addEventListener('keydown', escCloseHandler);

    if(viewerTimer) clearInterval(viewerTimer);
    viewerTimer = setInterval(async () => {
      if(!running) return;
      const i = pickFrame(performance.now() - desiredDelayMs);
      if(i<0){ if(els.viewerBuffer) els.viewerBuffer.textContent='Buffering…'; return; }
      if(els.viewerBuffer) els.viewerBuffer.textContent='';

      const f = frames[i];
      const tmp = document.createElement('canvas');
      const maxW=1280, maxH=720;
      const tw = Math.min(f.w, maxW);
      const th = Math.min(f.h, Math.round(tw * (f.h / f.w)));
      tmp.width = tw || 1; tmp.height = th || 1;
      const tctx = tmp.getContext('2d', {alpha:false});
      const src = f.bitmap || f.canvas;
      if(!src) return;
      tctx.drawImage(src, 0, 0, tw, th);
      // Guard toBlob nulls
      const blob = await new Promise(res => tmp.toBlob(b => res(b), 'image/jpeg', jpgQuality));
      if(!blob) return;
      const url = URL.createObjectURL(blob);
      const old = els.viewerImg.src;
      els.viewerImg.src = url;
      if(old) URL.revokeObjectURL(old);
    }, Math.round(1000 / Math.min(targetFps, 24)));
  }
  function overlayCloseHandler(e){
    // If click is on the background grid (not on controls or image), close
    if(e.target === els.overlay || e.target === els.viewerImg){ closeViewer(); }
  }
  function escCloseHandler(e){
    if(e.key === 'Escape'){ closeViewer(); }
  }
  function closeViewer(){
    if (els.overlay.hidden) return;
    els.overlay.hidden = true;
    els.overlay.removeEventListener('click', overlayCloseHandler);
    document.removeEventListener('keydown', escCloseHandler);
    if(viewerTimer){ clearInterval(viewerTimer); viewerTimer=null; }
    const old = els.viewerImg.src; if(old) URL.revokeObjectURL(old);
    els.viewerImg.removeAttribute('src');
  }

  function replay15(){
    desiredDelayMs = Math.min(desiredDelayMs + 15000, 60000);
    if(els.delay){ els.delay.value = Math.round(desiredDelayMs/1000); updateDelay(); }
  }

  async function saveLast15(){
    try{
      const startTs = performance.now() - desiredDelayMs - 15000;
      const endTs = performance.now() - desiredDelayMs;
      const picks = [];
      for(let t=startTs;t<=endTs;t+=1000){
        const idx = pickFrame(t);
        if(idx<0) continue;
        picks.push(frames[idx]);
      }
      if(!picks.length){ alert('Nothing to save yet.'); return; }
      const parts = ['<html><meta charset="utf-8"><body style="background:#000;color:#fff;font-family:sans-serif"><h2>WebDelay – Last 15s</h2>'];
      for(const f of picks){
        const c = document.createElement('canvas'); c.width=f.w; c.height=f.h;
        const cctx = c.getContext('2d', {alpha:false});
        const src = f.bitmap || f.canvas;
        cctx.drawImage(src,0,0);
        const b = await new Promise(r=>c.toBlob(r,'image/jpeg',0.9));
        const url = URL.createObjectURL(b);
        parts.push(`<div><img src="${url}" style="max-width:100%"></div>`);
      }
      parts.push('</body></html>');
      const blob = new Blob(parts.map(p=>new Blob([p])), {type:'text/html'});
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download='webdelay-clip.html'; a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href), 1500);
    }catch(e){ console.error(e); alert('Save failed'); }
  }

  window.addEventListener('resize', () => fitStageToViewport(videoWidth, videoHeight));
  window.addEventListener('orientationchange', () => fitStageToViewport(videoWidth, videoHeight));
  document.addEventListener('visibilitychange', () => { if(document.visibilityState==='visible' && running){ acquireWake(); } });

  if(els.start) els.start.addEventListener('click', start);
  if(els.stop) els.stop.addEventListener('click', stop);
  if(els.viewer) els.viewer.addEventListener('click', openViewer);
  if(els.closeViewer) els.closeViewer.addEventListener('click', closeViewer);
  if(els.replay) els.replay.addEventListener('click', replay15);
  if(els.save) els.save.addEventListener('click', saveLast15);
})();