(() => {
  const els = {
    stage: document.getElementById('stage'),
    preview: document.getElementById('preview'),
    start: document.getElementById('startBtn'),
    stop: document.getElementById('stopBtn'),
    viewer: document.getElementById('viewerBtn'),
    delay: document.getElementById('delaySec'),
    delayOut: document.getElementById('delayOut'),
    quality: document.getElementById('quality'),
    replay: document.getElementById('replayBtn'),
    save: document.getElementById('saveBtn'),
    status: document.getElementById('status'),
    overlay: document.getElementById('viewerOverlay'),
    closeViewer: document.getElementById('closeViewer'),
    viewerImg: document.getElementById('viewerImg'),
    viewerStats: document.getElementById('viewerStats'),
    viewerBuffer: document.getElementById('viewerBuffer'),
  };

  // Force overlay hidden on script load as well
  if (els.overlay) { els.overlay.classList.remove('open'); els.overlay.setAttribute('hidden',''); els.overlay.setAttribute('aria-hidden','true'); }

  let mediaStream = null;
  let wakeLock = null;
  const frames = [];
  let running = false;
  let desiredDelayMs = 12000;
  let maxBufferMs = 13200;
  let videoWidth = 1280, videoHeight = 720;
  let targetFps = 24, jpgQuality = 0.82;
  let viewerTimer = null;

  function setStatus(msg){ if (els.status) els.status.textContent = msg || ''; }

  function updateDesiredDelay(){
    desiredDelayMs = Math.max(2000, parseInt(els.delay.value||'12',10) * 1000);
    maxBufferMs = desiredDelayMs + 1200;
    els.delayOut.textContent = Math.round(desiredDelayMs/1000);
  }
  if (els.delay) { els.delay.addEventListener('input', updateDesiredDelay); updateDesiredDelay(); }

  function applyQuality(){
    const mode = els.quality ? els.quality.value : 'balanced';
    if (mode==='high'){ targetFps=30; jpgQuality=0.90; }
    else if (mode==='battery'){ targetFps=20; jpgQuality=0.75; }
    else { targetFps=24; jpgQuality=0.82; }
  }
  if (els.quality) { els.quality.addEventListener('change', applyQuality); applyQuality(); }

  function fitStageToViewport(w,h){
    const wrap = document.querySelector('.video-wrap') || document.body;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio||1));
    const vw = Math.max(1, Math.floor(wrap.clientWidth * dpr));
    const vh = Math.max(1, Math.floor(wrap.clientHeight * dpr));
    const ar = w/h;
    let cw = vw, ch = Math.floor(vw/ar);
    if (ch>vh){ ch=vh; cw=Math.floor(vh*ar); }
    if (els.stage.width!==cw || els.stage.height!==ch){
      els.stage.width=cw; els.stage.height=ch;
      els.stage.style.width = Math.floor(cw/dpr)+'px';
      els.stage.style.height= Math.floor(ch/dpr)+'px';
    }
  }

  function pickFrame(targetTs){
    let lo=0, hi=frames.length-1, idx=-1;
    while(lo<=hi){
      const mid=(lo+hi)>>1;
      if(frames[mid].ts<=targetTs){ idx=mid; lo=mid+1; } else hi=mid-1;
    }
    return idx;
  }
  function trim(nowTs){ const minTs = nowTs - maxBufferMs; while(frames.length && frames[0].ts < minTs) frames.shift(); }

  async function acquireWakeLock(){ try{ if('wakeLock' in navigator){ wakeLock = await navigator.wakeLock.request('screen'); } }catch{} }
  async function releaseWakeLock(){ try{ await wakeLock?.release(); }catch{} wakeLock=null; }

  async function start(){
    if(!isSecureContext || !navigator.mediaDevices){ setStatus('Use HTTPS + modern browser'); return; }
    try{
      setStatus('Starting…');
      let constraints = { audio:false, video:{ facingMode:{ exact:'environment' }, width:{ideal:1920}, height:{ideal:1080}, frameRate:{ideal:30} } };
      try{ mediaStream = await navigator.mediaDevices.getUserMedia(constraints); }
      catch{ mediaStream = await navigator.mediaDevices.getUserMedia({ audio:false, video:{ facingMode:{ ideal:'environment' }, width:{ideal:1920}, height:{ideal:1080}, frameRate:{ideal:30} } }); }
      els.preview.srcObject = mediaStream;
      await els.preview.play();
      await new Promise(res => { if (els.preview.videoWidth) return res(); els.preview.onloadedmetadata = () => res(); });
      videoWidth = els.preview.videoWidth || 1280;
      videoHeight = els.preview.videoHeight || 720;
      fitStageToViewport(videoWidth, videoHeight);
      running = true;
      await acquireWakeLock();
      els.start.disabled = true; els.stop.disabled = false; els.viewer.disabled = false; els.replay.disabled = false; els.save.disabled = false;
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
    if (viewerTimer) { clearInterval(viewerTimer); viewerTimer = null; }
    await releaseWakeLock();
    try{ els.preview.pause(); }catch{}
    try{ mediaStream?.getTracks().forEach(t=>t.stop()); }catch{}
    mediaStream=null;
    els.start.disabled=false; els.stop.disabled=true; els.viewer.disabled=true; els.replay.disabled=true; els.save.disabled=true;
    setStatus('Stopped');
    forceCloseOverlay();
  }

  function captureLoop(){
    const v = els.preview;
    const useRVFC = !!v.requestVideoFrameCallback;
    const push = () => {
      if(!running) return;
      fitStageToViewport(videoWidth, videoHeight);
      try{ els.stage.getContext('2d', {alpha:false, desynchronized:true}).drawImage(v, 0, 0, els.stage.width, els.stage.height); }catch{ return; }
      const ts = performance.now();
      const entry = { ts, w: els.stage.width, h: els.stage.height };
      const store = () => {
        if('createImageBitmap' in window){
          createImageBitmap(els.stage).then(bmp => { entry.bitmap=bmp; frames.push(entry); trim(ts); }).catch(()=>{});
        } else {
          const c=document.createElement('canvas'); c.width=els.stage.width; c.height=els.stage.height;
          c.getContext('2d').drawImage(els.stage,0,0); entry.canvas=c; frames.push(entry); trim(ts);
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
    let last=0;
    const loop = ()=>{
      if(!running) return;
      const now=performance.now(); const interval = 1000/targetFps;
      if(now-last < interval){ return requestAnimationFrame(loop); }
      last=now;
      const idx = pickFrame(now - desiredDelayMs);
      if(idx>=0){
        const f = frames[idx]; const src = f.bitmap || f.canvas;
        if(src){ els.stage.getContext('2d').drawImage(src,0,0,els.stage.width,els.stage.height); }
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // Overlay control
  function forceCloseOverlay(){
    els.overlay.classList.remove('open');
    els.overlay.setAttribute('hidden','');
    els.overlay.setAttribute('aria-hidden','true');
    const old = els.viewerImg.src; if(old) URL.revokeObjectURL(old);
    els.viewerImg.removeAttribute('src');
    if (viewerTimer) { clearInterval(viewerTimer); viewerTimer = null; }
  }
  function openOverlay(){
    // Only open if we have at least one frame
    const idx = pickFrame(performance.now() - desiredDelayMs);
    if (idx < 0) { if(els.viewerBuffer) els.viewerBuffer.textContent = 'Buffering…'; }
    els.overlay.classList.add('open');
    els.overlay.removeAttribute('hidden');
    els.overlay.setAttribute('aria-hidden','false');
    if (viewerTimer) clearInterval(viewerTimer);
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
      const src = f.bitmap || f.canvas; if(!src) return;
      tctx.drawImage(src,0,0,tw,th);
      const blob = await new Promise(r=>tmp.toBlob(r,'image/jpeg', jpgQuality));
      if(!blob) return;
      const url = URL.createObjectURL(blob);
      const old = els.viewerImg.src;
      els.viewerImg.src = url;
      if(old) URL.revokeObjectURL(old);
    }, Math.round(1000 / Math.min(targetFps, 24)));
  }

  // Close handlers
  function onOverlayClick(e){
    // Click on background or image closes; clicks on .viewer-bar do not
    if (e.target === els.overlay || e.target === els.viewerImg) { forceCloseOverlay(); }
  }
  function onKey(e){
    if (e.key === 'Escape' || e.key.toLowerCase() === 'x') forceCloseOverlay();
  }
  // Triple-tap anywhere as a failsafe close
  let tapTimes = [];
  function onTapClose(){
    const now = performance.now();
    tapTimes = tapTimes.filter(t => now - t < 700);
    tapTimes.push(now);
    if (tapTimes.length >= 3) forceCloseOverlay();
  }

  // Wire buttons
  els.start.addEventListener('click', start);
  els.stop.addEventListener('click', stop);
  els.viewer.addEventListener('click', openOverlay);
  els.closeViewer.addEventListener('click', forceCloseOverlay);
  els.overlay.addEventListener('click', onOverlayClick);
  document.addEventListener('keydown', onKey);
  document.addEventListener('click', onTapClose);
})();