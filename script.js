// Safari-stable video delay with a fixed-size ring buffer and canvas reuse.
// Simple build: rear camera only, performance-first defaults.
(() => {
  const live = document.getElementById('live');
  const screen = document.getElementById('screen');
  const ctx = screen.getContext('2d', { alpha: false });

  const btnStart = document.getElementById('btnStart');

  // === Rolling 15s recorder for Replay/Save (non-invasive) ===
  let __mr = null;
  let __mrChunks = []; // {blob, t}
  const __MR_TIMESLICE = 1000;
  const __CLIP_MS = 15000;

  function __startRecorder(stream) {
    try {
      __stopRecorder();
      __mr = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
      __mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          __mrChunks.push({ blob: e.data, t: performance.now() });
          const cutoff = performance.now() - __CLIP_MS - 1000;
          while (__mrChunks.length && __mrChunks[0].t < cutoff) __mrChunks.shift();
        }
      };
      __mr.start(__MR_TIMESLICE);
    } catch (err) {
      console.warn('MediaRecorder not available for replay/save:', err);
      __mr = null;
    }
  }
  function __stopRecorder() {
    if (__mr) {
      try { __mr.stop(); } catch {}
      __mr = null;
    }
    __mrChunks = [];
  }
  function __buildLastClipBlob() {
    if (!__mrChunks.length) return null;
    const cutoff = performance.now() - __CLIP_MS;
    const parts = [];
    for (let i = __mrChunks.length - 1; i >= 0; i--) {
      if (__mrChunks[i].t >= cutoff) parts.unshift(__mrChunks[i].blob);
      else break;
    }
    if (!parts.length) return null;
    return new Blob(parts, { type: 'video/webm' });
  }

  const __replayOverlay = document.getElementById('replayOverlay');
  const __replayVideo = document.getElementById('replayVideo');
  let __replayURL = null;
  function __hideReplay() {
    if (__replayVideo) { __replayVideo.pause(); __replayVideo.removeAttribute('src'); __replayVideo.load(); }
    if (__replayURL) { URL.revokeObjectURL(__replayURL); __replayURL = null; }
    if (__replayOverlay) __replayOverlay.style.display = 'none';
  }
  function __replay15s() {
    const blob = __buildLastClipBlob();
    if (!blob) { try{ setStatus && setStatus('No clip yet'); }catch{} return; }
    __hideReplay();
    __replayURL = URL.createObjectURL(blob);
    __replayVideo.src = __replayURL;
    __replayOverlay.style.display = 'flex';
    __replayVideo.currentTime = 0;
    __replayVideo.play().catch(()=>{});
  }
  function __save15s() {
    const blob = __buildLastClipBlob();
    if (!blob) { try{ setStatus && setStatus('No clip to save'); }catch{} return; }
    const a = document.createElement('a');
    a.download = 'delay-clip-' + new Date().toISOString().replace(/[:.]/g,'-') + '.webm';
    a.href = URL.createObjectURL(blob);
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
  if (__replayOverlay) __replayOverlay.addEventListener('click', (e)=>{ if (e.target === __replayOverlay) __hideReplay(); });

  // Wire buttons
  const __btnReplay = document.getElementById('btnReplay');
  const __btnSave = document.getElementById('btnSaveClip');
  if (__btnReplay) __btnReplay.addEventListener('click', __replay15s);
  if (__btnSave) __btnSave.addEventListener('click', __save15s);

  const btnStop = document.getElementById('btnStop');
  const btnPlayPause = document.getElementById('btnPlayPause');

  const delayRange = document.getElementById('delayRange');
  const delayLabel = document.getElementById('delayLabel');
  const fpsRange = document.getElementById('fpsRange');
  const fpsLabel = document.getElementById('fpsLabel');
  const perfMode = document.getElementById('perfMode');

  const bufSec = document.getElementById('bufSec');
  const lagSec = document.getElementById('lagSec');
  const drawFps = document.getElementById('drawFps');
  const statusEl = document.getElementById('status');

  let stream = null;
  let running = false;
  let playing = true;

  let targetDelayMs = 12000; // default 12s
  let targetFps = 20;        // default 20 FPS for iOS stability
  let captureRAF = null;
  let drawRAF = null;

  // ---- Rolling clip buffer using MediaRecorder on the live stream ----
  let mr = null;
  let mrChunks = []; // {blob, t} with capture time (ms)
  const MR_TIMESLICE = 1000; // 1s chunks for fine trimming
  const CLIP_WINDOW_MS = 15000;

  function startRecorder(stream) {
    try {
      stopRecorder();
      mr = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          mrChunks.push({ blob: e.data, t: performance.now() });
          // trim to last 15s
          const cutoff = performance.now() - CLIP_WINDOW_MS - 1000;
          while (mrChunks.length && mrChunks[0].t < cutoff) mrChunks.shift();
        }
      };
      mr.start(MR_TIMESLICE);
    } catch (err) {
      console.warn('MediaRecorder unavailable; replay/save disabled', err);
      mr = null;
    }
  }
  function stopRecorder() {
    if (mr) {
      try { mr.stop(); } catch {}
      mr = null;
    }
    mrChunks = [];
  }

  function buildLastClipBlob() {
    if (!mrChunks.length) return null;
    const now = performance.now();
    const cutoff = now - CLIP_WINDOW_MS;
    const parts = [];
    for (let i = mrChunks.length - 1; i >= 0; i--) {
      if (mrChunks[i].t >= cutoff) parts.unshift(mrChunks[i].blob);
      else break;
    }
    if (!parts.length) return null;
    return new Blob(parts, { type: 'video/webm' });
  }

  // Replay handling
  const replayOverlay = document.getElementById('replayOverlay');
  const replayVideo = document.getElementById('replayVideo');
  let replayURL = null;

  function hideReplay() {
    if (replayVideo) {
      replayVideo.pause();
      replayVideo.removeAttribute('src');
      replayVideo.load();
    }
    if (replayURL) {
      URL.revokeObjectURL(replayURL);
      replayURL = null;
    }
    if (replayOverlay) replayOverlay.style.display = 'none';
  }

  function replayLast15s() {
    const blob = buildLastClipBlob();
    if (!blob) {
      setStatus('No clip yet');
      return;
    }
    hideReplay();
    replayURL = URL.createObjectURL(blob);
    replayVideo.src = replayURL;
    replayOverlay.style.display = 'flex';
    replayVideo.currentTime = 0;
    replayVideo.play().catch(()=>{});
    replayVideo.onended = () => {
      // keep overlay open; user can close by tapping background
    };
  }

  if (replayOverlay) {
    replayOverlay.addEventListener('click', (e) => {
      if (e.target === replayOverlay) hideReplay();
    });
  }

  // Save handling
  function saveLast15s() {
    const blob = buildLastClipBlob();
    if (!blob) {
      setStatus('No clip to save');
      return;
    }
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const fname = `delay-clip-${ts}.webm`;
    a.download = fname;
    a.href = URL.createObjectURL(blob);
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
  }

  const btnReplay = document.getElementById('btnReplay');
  const btnSaveClip = document.getElementById('btnSaveClip');
  if (btnReplay) btnReplay.addEventListener('click', replayLast15s);
  if (btnSaveClip) btnSaveClip.addEventListener('click', saveLast15s);


  // Ring buffer state
  let rb = null; // { canvases: [], times: Float64Array, size, head, w, h }
  const HEADROOM_MS = 2000;

  const secure = (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');

  function setStatus(msg){ if (statusEl) statusEl.textContent = msg; }
  function setUI(state){
    if (btnStart) btnStart.disabled = (state !== 'idle');
    if (btnStop) btnStop.disabled = (state === 'idle');
    if (btnPlayPause) {
      btnPlayPause.disabled = (state === 'idle');
      btnPlayPause.textContent = playing ? 'Pause' : 'Play';
    }
    if (delayLabel) delayLabel.textContent = (targetDelayMs/1000).toFixed(1) + 's';
    if (fpsLabel) fpsLabel.textContent = String(targetFps);
  }

  function pickDims() {
    // 480p for stability by default; uncheck perfMode to try 720p
    if (perfMode && perfMode.checked) return { w: 854, h: 480 };
    return { w: 1280, h: 720 };
  }

  function resizeCanvasTo(d){ screen.width = d.w; screen.height = d.h; }

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

  function rbPush(ts){
    const c = rb.canvases[rb.head];
    const cctx = c.getContext('2d');
    cctx.drawImage(live, 0, 0, rb.w, rb.h);
    rb.times[rb.head] = ts;
    rb.head = (rb.head + 1) % rb.size;
  }

  function rbDuration(){
    const newest = (rb.head - 1 + rb.size) % rb.size;
    const oldest = rb.head;
    const tNew = rb.times[newest];
    const tOld = rb.times[oldest];
    if (!tNew || !tOld || tNew <= 0 || tOld <= 0) return 0;
    const d = tNew - tOld;
    return d > 0 ? d/1000 : 0;
  }

  function rbFind(ts){
    // linearize circular buffer to oldest..newest, then binary search by timestamp
    const order = [];
    for (let i=0;i<rb.size;i++){ order.push((rb.head + i) % rb.size); }
    const filled = order.filter(idx => rb.times[idx] > 0);
    if (filled.length === 0) return null;

    let lo = 0, hi = filled.length - 1, ans = filled[filled.length - 1];
    while (lo <= hi){
      const mid = (lo + hi) >> 1;
      const idx = filled[mid];
      if (rb.times[idx] >= ts){ ans = idx; hi = mid - 1; }
      else lo = mid + 1;
    }
    return ans;
  }

  async function start(){
    if (running) return;
    if (!secure){ setStatus('Needs HTTPS for camera'); alert('Use HTTPS (GitHub Pages) for camera on iOS.'); return; }

    const dims = pickDims();
    const constraints = {
      video: { facingMode: 'environment', width: { ideal: dims.w }, height: { ideal: dims.h }, frameRate: { ideal: 30, max: 60 } },
      audio: false
    };

    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      setStatus('camera blocked');
      alert('Allow camera in iOS Settings > Safari > Camera.\n\n' + e.message);
      return;
    }

    live.srcObject = stream;
    try{ __startRecorder(stream); }catch(e){}
    try{ if (!__mr && screen && screen.captureStream) { __startRecorder(screen.captureStream(targetFps||20)); } }catch(e){}
    live.setAttribute('playsinline','true');
    try { await live.play(); } catch {}

    resizeCanvasTo(dims);
    window.addEventListener('resize', () => resizeCanvasTo(dims));

    rb = makeRingBuffer(targetDelayMs/1000 + HEADROOM_MS/1000, targetFps, dims);
    for (let i=0;i<rb.size;i++){ rb.times[i] = 0; }

    running = true;
    playing = true;
    startCapture();
    startDraw();
    setUI('run');
    setStatus(`running ${dims.w}x${dims.h} rb=${rb.size} perf=${perfMode && perfMode.checked?'on':'off'}`);
  }

  function stop(){
    running = false;
    playing = false;
    if (captureRAF) cancelAnimationFrame(captureRAF);
    if (drawRAF) cancelAnimationFrame(drawRAF);
    captureRAF = drawRAF = null;
    if (stream) { stream.getTracks().forEach(t=>t.stop()); stream = null; }
    rb = null;
    // force a clear without resizing CSS box
    const w = screen.width, h = screen.height;
    screen.width = w; screen.height = h;
    setUI('idle');
    setStatus('idle');
  }

  function startCapture(){
    const capInterval = 1000 / targetFps;
    let last = performance.now();

    const loop = (now) => {
      if (!running) return;
      captureRAF = requestAnimationFrame(loop);

      if (now - last >= capInterval - 2){
        last = now;
        try { rbPush(now); } catch {}
      }
      if (bufSec) bufSec.textContent = rb ? rbDuration().toFixed(1) : '0.0';
    };

    captureRAF = requestAnimationFrame(loop);
  }

  function startDraw(){
    let lastDraw = performance.now();
    let framesDrawn = 0, tick = performance.now();

    const loop = (now) => {
      if (!running) return;
      drawRAF = requestAnimationFrame(loop);

      if (now - lastDraw < 1000/60 - 2) return; // cap ~60Hz draw
      lastDraw = now;

      if (!playing || !rb) return;

      const wantTs = now - targetDelayMs;
      const idx = rbFind(wantTs);
      if (idx == null) return;

      try { ctx.drawImage(rb.canvases[idx], 0, 0, screen.width, screen.height); } catch {}

      const newest = (rb.head - 1 + rb.size) % rb.size;
      const latestTs = rb.times[newest] || now;
      if (lagSec) lagSec.textContent = ((latestTs - wantTs)/1000).toFixed(1);

      framesDrawn++;
      const dt = now - tick;
      if (dt >= 1000){ if (drawFps) drawFps.textContent = String(framesDrawn); framesDrawn = 0; tick = now; }
    };

    drawRAF = requestAnimationFrame(loop);
  }

  // Controls
  if (btnStart) btnStart.addEventListener('click', start, { passive: true });
  if (btnStop) btnStop.addEventListener('click', stop, { passive: true });
  if (btnPlayPause) btnPlayPause.addEventListener('click', () => {
    if (!running) return;
    playing = !playing;
    btnPlayPause.textContent = playing ? 'Pause' : 'Play';
  });

  if (delayRange) delayRange.addEventListener('input', e => {
    const v = Number(e.target.value) || 12;
    targetDelayMs = Math.max(1000, Math.min(30000, Math.round(v*1000)));
    if (delayLabel) delayLabel.textContent = v.toFixed(1) + 's';
  });

  if (fpsRange) fpsRange.addEventListener('input', e => {
    const v = parseInt(e.target.value, 10) || 20;
    targetFps = Math.max(5, Math.min(60, v));
    if (fpsLabel) fpsLabel.textContent = String(targetFps);
  });

  // Init
  setUI('idle');
  if (!secure) setStatus('Needs HTTPS for camera');
})();
