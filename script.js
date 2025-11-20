// iOS Clean + Pop-out viewer (dataURL streaming); aspect-ratio fix to avoid distortion
(() => {
  const $ = id => document.getElementById(id);
  const screen = $('screen');
  const live = $('live');

  const btnStart = $('btnStart');
  const btnStop = $('btnStop');
  const btnPlayPause = $('btnPlayPause');
  const btnPopout = $('btnPopout');

  const delayRange = $('delayRange');
  const delayLabel = $('delayLabel');
  const fpsRange = $('fpsRange');
  const fpsLabel = $('fpsLabel');

  const bufSec = $('bufSec');
  const lagSec = $('lagSec');
  const drawFps = $('drawFps');
  const status = $('status');

  const HEADROOM_MS = 1200;
  let targetDelayMs = Number(delayRange.value) * 1000;
  let targetFps = Number(fpsRange.value);

  // 100vh fix
  function setVh() {
    const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    document.documentElement.style.setProperty('--vh', (h*0.01) + 'px');
  }
  setVh();
  window.addEventListener('resize', setVh, { passive:true });
  window.addEventListener('orientationchange', () => { setVh(); setTimeout(setVh, 350); }, { passive:true });

  // Compute canvas pixel size to fit 16:9 in the visible area without distortion
  function pickDims(){
    const wrap = document.querySelector('.canvas-wrap').getBoundingClientRect();
    let w = Math.max(1, wrap.width|0);
    let h = Math.max(1, wrap.height|0);
    // Fit 16:9
    let tw = w, th = Math.floor(w * 9/16);
    if (th > h) { th = h; tw = Math.floor(h * 16/9); }
    return { w: tw|0, h: th|0 };
  }

  function resizeCanvas(){
    const d = pickDims();
    if (screen.width !== d.w || screen.height !== d.h){
      screen.width = d.w; screen.height = d.h;
    }
  }
  const ro = new ResizeObserver(resizeCanvas);
  ro.observe(document.querySelector('.canvas-wrap'));
  resizeCanvas();

  // Ring buffer
  function makeRingBuffer(seconds, fps, dims){
    const frames = Math.max(2, Math.ceil((seconds + HEADROOM_MS/1000) * fps));
    const canvases = new Array(frames);
    for (let i=0;i<frames;i++){
      const c = document.createElement('canvas');
      c.width = dims.w; c.height = dims.h;
      canvases[i] = c;
    }
    return { canvases, times: new Float64Array(frames), size: frames, head: 0, w: dims.w, h: dims.h };
  }

  let rb = makeRingBuffer(targetDelayMs/1000 + 1.2, targetFps, pickDims());

  function rbPush(ts){
    const c = rb.canvases[rb.head];
    const cctx = c.getContext('2d');
    cctx.drawImage(live, 0, 0, rb.w, rb.h);
    rb.times[rb.head] = ts;
    rb.head = (rb.head + 1) % rb.size;
  }

  function rbFind(ts){
    const order = [];
    for (let i=0;i<rb.size;i++) order.push((rb.head + i) % rb.size);
    const filled = order.filter(idx => rb.times[idx] > 0);
    if (!filled.length) return null;
    let lo=0, hi=filled.length-1, ans=filled[filled.length-1];
    while (lo<=hi){
      const mid=(lo+hi)>>1, idx=filled[mid];
      if (rb.times[idx] >= ts){ ans=idx; hi=mid-1; } else lo=mid+1;
    }
    return ans;
  }

  function rbDurationSec(){
    const newest = (rb.head - 1 + rb.size) % rb.size;
    const oldest = rb.head;
    const tNew = rb.times[newest], tOld = rb.times[oldest];
    if (!tNew || !tOld) return 0;
    const d = tNew - tOld;
    return d>0 ? d/1000 : 0;
  }

  // Capture & draw loops
  let stream = null, capturing=false, captureRAF=null, lastCap=0;
  let drawing=false, drawRAF=null, framesDrawn=0, lastTick=0;

  function captureLoop(now){
    captureRAF = requestAnimationFrame(captureLoop);
    if (!capturing) return;
    if (!lastCap) lastCap = now;
    const step = 1000/targetFps;
    if (now - lastCap >= step){
      lastCap = now;
      rbPush(performance.now());
    }
  }

  function drawLoop(now){
    drawRAF = requestAnimationFrame(drawLoop);
    if (!drawing) return;
    const targetTs = performance.now() - targetDelayMs;
    const idx = rbFind(targetTs);
    if (idx != null){
      const c = rb.canvases[idx];
      const ctx = screen.getContext('2d', { alpha:false });
      ctx.drawImage(c, 0, 0, screen.width, screen.height);
      framesDrawn++;
      sendToPopout(); // stream frame if pop-out is open
    }
    if (!lastTick) lastTick = now;
    if (now - lastTick >= 1000){
      if (drawFps) drawFps.textContent = String(framesDrawn);
      framesDrawn = 0; lastTick = now;
      if (bufSec) bufSec.textContent = rbDurationSec().toFixed(1) + 's';
      if (lagSec) lagSec.textContent = (targetDelayMs/1000).toFixed(1) + 's';
    }
  }

  // Start/Stop
  async function start(){
    if (stream) return;
    resizeCanvas();
    const dims = { w: screen.width, h: screen.height };
    rb = makeRingBuffer(targetDelayMs/1000 + 1.2, targetFps, dims);
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: dims.w }, height: { ideal: dims.h }, frameRate: { ideal: 30, max: 60 } },
        audio: false
      });
    } catch (e){
      alert('Camera access failed. Check Safari > Settings > Camera.\n\n' + (e && e.message || e));
      return;
    }
    live.srcObject = stream;
    live.setAttribute('playsinline','true');
    try { await live.play(); } catch {}

    capturing = true; drawing = true;
    captureLoop(0); drawLoop(0);
    btnStart.disabled = true; btnStop.disabled = false; btnPlayPause.disabled = false;
    setStatus('running');
  }

  function stop(){
    capturing = false; drawing = false;
    if (captureRAF) cancelAnimationFrame(captureRAF);
    if (drawRAF) cancelAnimationFrame(drawRAF);
    captureRAF = drawRAF = null;
    if (stream){ try{ stream.getTracks().forEach(t=>t.stop()); }catch{}; stream=null; }
    const ctx = screen.getContext('2d',{alpha:false});
    ctx.clearRect(0,0,screen.width,screen.height);
    rb.times.fill(0);
    btnStart.disabled = false; btnStop.disabled = true; btnPlayPause.disabled = true; btnPlayPause.textContent = 'Pause';
    setStatus('idle');
  }

  function setStatus(s){ if (status) status.textContent = s; }

  function togglePlayPause(){
    if (!drawing && !capturing) return;
    if (btnPlayPause.textContent === 'Pause'){
      capturing = false; drawing = false; btnPlayPause.textContent = 'Resume'; setStatus('paused');
    } else {
      capturing = true; drawing = true; btnPlayPause.textContent = 'Pause'; setStatus('running');
    }
  }

  delayRange.addEventListener('input', () => {
    targetDelayMs = Number(delayRange.value)*1000;
    delayLabel.textContent = 'Delay: ' + delayRange.value + 's';
  });
  fpsRange.addEventListener('input', () => {
    targetFps = Number(fpsRange.value);
    fpsLabel.textContent = 'FPS: ' + targetFps;
  });
  btnStart.addEventListener('click', start);
  btnStop.addEventListener('click', stop);
  btnPlayPause.addEventListener('click', togglePlayPause);

  // --- Pop-out window streaming (dataURL) ---
  let pop = null;
  let lastSend = 0;
  let sendEveryMs = 66; // ~15 fps
  function openPopout(){
    if (pop && !pop.closed) { try { pop.focus(); } catch {} ; return; }
    pop = window.open('viewer.html', '_blank', 'noopener,noreferrer');
  }
  function sendToPopout(){
    if (!pop || pop.closed) return;
    const now = performance.now();
    if (now - lastSend < sendEveryMs) return;
    lastSend = now;
    try {
      const url = screen.toDataURL('image/jpeg', 0.7);
      pop.postMessage({ type:'frame', url, w: screen.width, h: screen.height }, '*');
    } catch {}
  }
  window.addEventListener('message', (e)=>{
    if (e.data && e.data.type === 'viewer-ready'){
      // viewer connected; send one immediately
      lastSend = 0;
    }
  });
  btnPopout.addEventListener('click', openPopout);

  window.addEventListener('beforeunload', stop);
})();