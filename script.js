// Minimal Safari-safe video delay using a canvas ring buffer.
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

  const bufSec = document.getElementById('bufSec');
  const lagSec = document.getElementById('lagSec');
  const drawFps = document.getElementById('drawFps');
  const statusEl = document.getElementById('status');

  let stream = null;
  let running = false;
  let playing = true;

  let frames = [];
  let targetDelayMs = 12000;
  let targetFps = 30;
  let captureRAF = null;
  let drawRAF = null;

  const secure = (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  const canBitmap = ('createImageBitmap' in window);
  const hasRVFC = ('requestVideoFrameCallback' in HTMLVideoElement.prototype);

  function setStatus(msg){ statusEl.textContent = msg; }
  function setUI(state){
    btnStart.disabled = (state !== 'idle');
    btnStop.disabled = (state === 'idle');
    btnPlayPause.disabled = (state === 'idle');
    btnPlayPause.textContent = playing ? 'Pause' : 'Play';
    delayLabel.textContent = (targetDelayMs/1000).toFixed(1) + 's';
    fpsLabel.textContent = String(targetFps);
  }

  function resizeCanvas(){
    const w = live.videoWidth || screen.clientWidth || 1280;
    const h = live.videoHeight || screen.clientHeight || 720;
    if (screen.width !== w || screen.height !== h) { screen.width = w; screen.height = h; }
  }

  async function start(){
    if (running) return;
    if (!secure){
      setStatus('Needs HTTPS for camera'); alert('Camera requires HTTPS on iOS (GitHub Pages recommended).');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 60 } },
        audio: false
      });
    } catch (e) {
      setStatus('camera blocked');
      alert('Cannot access camera. On iPad/iPhone: Settings > Safari > Camera > Allow.\\n\\n' + e.message);
      return;
    }

    live.srcObject = stream;
    live.setAttribute('playsinline','true');
    try { await live.play(); } catch {}

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    running = true;
    playing = true;
    frames = [];
    startCapture();
    startDraw();
    setUI('run');
    setStatus(`running  mode=${canBitmap?'bitmap':'canvas'} rvfc=${hasRVFC?'yes':'no'}`);
  }

  function stop(){
    running = false;
    playing = false;
    if (captureRAF) cancelAnimationFrame(captureRAF);
    if (drawRAF) cancelAnimationFrame(drawRAF);
    captureRAF = drawRAF = null;
    if (stream) { stream.getTracks().forEach(t=>t.stop()); stream = null; }
    frames = [];
    ctx.clearRect(0,0,screen.width,screen.height);
    setUI('idle');
    setStatus('idle');
  }

  function startCapture(){
    const capInterval = 1000 / targetFps;
    let last = performance.now();

    const capture = async (now) => {
      if (!running) return;

      if (now - last >= capInterval - 2){
        last = now;
        try {
          if (canBitmap){
            const bmp = await createImageBitmap(live);
            frames.push({ t: now, b: bmp });
          } else {
            const c = document.createElement('canvas');
            const w = live.videoWidth || 1280, h = live.videoHeight || 720;
            c.width = w; c.height = h;
            c.getContext('2d').drawImage(live, 0, 0, w, h);
            frames.push({ t: now, c });
          }
          const maxMs = targetDelayMs + 2000;
          while (frames.length > 2 && now - frames[0].t > maxMs){
            const f = frames.shift(); if (f.b && f.b.close) f.b.close();
          }
        } catch {}
      }

      bufSec.textContent = frames.length < 2 ? '0.0' : ((frames[frames.length-1].t - frames[0].t)/1000).toFixed(1);

      if (hasRVFC) live.requestVideoFrameCallback(capture);
      else captureRAF = requestAnimationFrame(capture);
    };

    if (hasRVFC) live.requestVideoFrameCallback(capture);
    else captureRAF = requestAnimationFrame(capture);
  }

  function findIndexForTs(ts){
    let lo=0, hi=frames.length-1, ans=-1;
    while (lo<=hi){
      const mid=(lo+hi)>>1;
      if (frames[mid].t >= ts){ ans = mid; hi = mid - 1; }
      else lo = mid + 1;
    }
    return ans === -1 ? frames.length - 1 : ans;
  }

  function startDraw(){
    let lastDraw = performance.now();
    let count = 0, tick = performance.now();

    const draw = (now) => {
      if (!running) return;
      drawRAF = requestAnimationFrame(draw);

      if (now - lastDraw < 1000/60 - 2) return;
      lastDraw = now;

      if (!playing || frames.length < 2) return;
      const wantTs = now - targetDelayMs;
      const idx = findIndexForTs(wantTs);
      const f = frames[idx];
      if (!f) return;

      if (screen.width !== live.videoWidth || screen.height !== live.videoHeight){
        if (live.videoWidth && live.videoHeight){
          screen.width = live.videoWidth; screen.height = live.videoHeight;
        }
      }
      if (f.b) ctx.drawImage(f.b, 0, 0, screen.width, screen.height);
      else if (f.c) ctx.drawImage(f.c, 0, 0, screen.width, screen.height);

      lagSec.textContent = ((frames[frames.length-1].t - wantTs)/1000).toFixed(1);

      count++;
      const dt = now - tick;
      if (dt >= 1000){ drawFps.textContent = String(count); count = 0; tick = now; }
    };

    drawRAF = requestAnimationFrame(draw);
  }

  // UI
  btnStart.addEventListener('click', start, { passive: true });
  btnStop.addEventListener('click', stop, { passive: true });
  btnPlayPause.addEventListener('click', () => {
    if (!running) return;
    playing = !playing;
    btnPlayPause.textContent = playing ? 'Pause' : 'Play';
  });

  delayRange.addEventListener('input', (e) => {
    const v = Number(e.target.value) || 12;
    targetDelayMs = Math.max(1000, Math.min(30000, Math.round(v*1000)));
    delayLabel.textContent = v.toFixed(1) + 's';
  });

  fpsRange.addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10) || 30;
    targetFps = Math.max(5, Math.min(60, v));
    fpsLabel.textContent = String(targetFps);
  });

  // Init
  setUI('idle');
  if (!secure) setStatus('Needs HTTPS for camera');
})();