// Safari-stable video delay with a fixed-size ring buffer and canvas reuse.
// Simple build: rear camera only, performance-first defaults.
(() => {
  const live = document.getElementById('live');
  const screen = document.getElementById('screen');
  const ctx = screen.getContext('2d', { alpha: false });

  const btnStart = document.getElementById('btnStart');
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
