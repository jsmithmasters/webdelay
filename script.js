/* Video Delay using a canvas ring buffer (works on iPad Safari). */
(() => {
  const live = document.getElementById('live');
  const screen = document.getElementById('screen');
  const ctx = screen.getContext('2d', { alpha: false });

  const btnStart = document.getElementById('btnStart');
  const btnStop = document.getElementById('btnStop');
  const btnPlayPause = document.getElementById('btnPlayPause');
  const btnRew5 = document.getElementById('btnRew5');
  const btnRew10 = document.getElementById('btnRew10');

  const delayRange = document.getElementById('delayRange');
  const delayLabel = document.getElementById('delayLabel');
  const fpsRange = document.getElementById('fpsRange');
  const fpsLabel = document.getElementById('fpsLabel');

  const bufSec = document.getElementById('bufSec');
  const lagSec = document.getElementById('lagSec');
  const drawFps = document.getElementById('drawFps');

  let stream = null;
  let running = false;
  let playing = true;

  // frame store: array of {t: timestampMs, bitmap: ImageBitmap}
  let frames = [];
  let readIndex = 0; // index into frames for display
  let targetDelayMs = 12000;
  let targetFps = 30;
  let captureTimer = null;
  let drawTimer = null;

  function qs(el) { return document.querySelector(el); }
  function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

  function setUI(state) {
    if (state === 'idle') {
      btnStart.disabled = false;
      btnStop.disabled = true;
      btnPlayPause.disabled = true;
      btnRew5.disabled = true;
      btnRew10.disabled = true;
    } else {
      btnStart.disabled = true;
      btnStop.disabled = false;
      btnPlayPause.disabled = false;
      btnRew5.disabled = false;
      btnRew10.disabled = false;
    }
    btnPlayPause.textContent = playing ? 'Pause' : 'Play';
    delayLabel.textContent = (targetDelayMs/1000).toFixed(1) + 's';
    fpsLabel.textContent = String(targetFps);
  }

  // Resize canvas to the live video's intrinsic size (or window if unknown).
  function resizeCanvas() {
    const w = live.videoWidth || screen.clientWidth || 1280;
    const h = live.videoHeight || screen.clientHeight || 720;
    if (screen.width !== w || screen.height !== h) {
      screen.width = w;
      screen.height = h;
    }
  }

  async function start() {
    if (running) return;
    try {
      // iOS requires this be triggered by a user gesture (click).
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment', // rear camera by default for sports
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 60 }
        },
        audio: false
      });

      live.srcObject = stream;
      // important for iOS to render
      live.setAttribute('playsinline', 'true');
      await live.play().catch(()=>{});

      resizeCanvas();
      window.addEventListener('resize', resizeCanvas);

      running = true;
      playing = true;
      frames = [];
      readIndex = 0;

      // capture loop using requestVideoFrameCallback if available for better pacing
      startCaptureLoop();
      startDrawLoop();
      setUI('run');
    } catch (err) {
      alert('Camera error: ' + err.message);
      console.error(err);
      stop();
    }
  }

  function stop() {
    running = false;
    playing = false;
    if (captureTimer) cancelAnimationFrame(captureTimer);
    captureTimer = null;
    if (drawTimer) cancelAnimationFrame(drawTimer);
    drawTimer = null;

    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    frames.forEach(f => f.bitmap.close && f.bitmap.close());
    frames = [];
    readIndex = 0;
    ctx.clearRect(0,0,screen.width, screen.height);
    setUI('idle');
  }

  // Capture frames into ring buffer. We limit stored seconds to delay+2s headroom.
  function startCaptureLoop() {
    const useRVFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
    let lastCapture = performance.now();
    const captureInterval = 1000/targetFps;

    const capture = async (now) => {
      if (!running) return;

      if (useRVFC) {
        // Only capture at target fps
        if (now - lastCapture >= captureInterval - 2) {
          lastCapture = now;
          try {
            // create an ImageBitmap fast; this avoids layout reads
            const bmp = await createImageBitmap(live);
            frames.push({ t: now, bitmap: bmp });
            // trim extra beyond desired buffer
            trimBuffer(now);
          } catch (e) {
            // swallow intermittent frame errors
          }
        }
        live.requestVideoFrameCallback(capture);
      } else {
        // fallback with rAF
        if (now - lastCapture >= captureInterval - 2) {
          lastCapture = now;
          createImageBitmap(live).then(bmp => {
            frames.push({ t: now, bitmap: bmp });
            trimBuffer(now);
          }).catch(()=>{});
        }
        captureTimer = requestAnimationFrame(capture);
      }
      bufSec.textContent = bufferSeconds().toFixed(1);
    };

    if (useRVFC) live.requestVideoFrameCallback(capture);
    else captureTimer = requestAnimationFrame(capture);
  }

  function trimBuffer(nowTs) {
    // keep at most targetDelayMs + 2000ms
    const maxKeepMs = targetDelayMs + 2000;
    // drop old frames while total age exceeds maxKeepMs
    while (frames.length > 2) {
      const age = nowTs - frames[0].t;
      if (age > maxKeepMs) {
        const f = frames.shift();
        f.bitmap.close && f.bitmap.close();
        if (readIndex > 0) readIndex--;
      } else break;
    }
  }

  function bufferSeconds() {
    if (frames.length < 2) return 0;
    const dur = frames[frames.length-1].t - frames[0].t;
    return dur/1000;
  }

  function findFrameForTime(targetTs) {
    // binary search nearest frame with t >= targetTs
    let lo = 0, hi = frames.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (frames[mid].t >= targetTs) {
        ans = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    return ans === -1 ? frames.length - 1 : ans;
  }

  function startDrawLoop() {
    let lastDraw = performance.now();
    let frameCounter = 0;
    let fpsStamp = performance.now();

    const draw = (now) => {
      if (!running) return;
      drawTimer = requestAnimationFrame(draw);

      // aim to draw ~60fps regardless of capture rate (canvas is cheap)
      if (now - lastDraw < 1000/60 - 2) return;
      lastDraw = now;

      if (!playing || frames.length < 2) return;

      // desired timeline is current time minus delay
      const wantTs = now - targetDelayMs;
      const idx = findFrameForTime(wantTs);
      // guard the index and keep a bit behind end
      readIndex = clamp(idx, 0, frames.length-1);

      const f = frames[readIndex];
      if (f) {
        // Ensure canvas size matches source; avoids blurry scaling on iPad rotation
        if (screen.width !== live.videoWidth || screen.height !== live.videoHeight) {
          if (live.videoWidth > 0 && live.videoHeight > 0) {
            screen.width = live.videoWidth;
            screen.height = live.videoHeight;
          }
        }
        ctx.drawImage(f.bitmap, 0, 0, screen.width, screen.height);
      }

      lagSec.textContent = ((frames.length ? (frames[frames.length-1].t - wantTs) : 0)/1000).toFixed(1);

      // fps meter
      frameCounter++;
      const dt = now - fpsStamp;
      if (dt >= 1000) {
        drawFps.textContent = String(frameCounter);
        frameCounter = 0;
        fpsStamp = now;
      }
    };
    drawTimer = requestAnimationFrame(draw);
  }

  // Rewind simply increases delay for a moment while buffer is available.
  function rewindSeconds(sec) {
    targetDelayMs = clamp(targetDelayMs + sec*1000, 1000, 30000);
    delayRange.value = (targetDelayMs/1000).toFixed(1);
    delayLabel.textContent = (targetDelayMs/1000).toFixed(1) + 's';
  }

  // UI handlers
  btnStart.addEventListener('click', start, { passive: true });
  btnStop.addEventListener('click', stop, { passive: true });
  btnPlayPause.addEventListener('click', () => {
    if (!running) return;
    playing = !playing;
    btnPlayPause.textContent = playing ? 'Pause' : 'Play';
  });

  btnRew5.addEventListener('click', () => rewindSeconds( -5 ));
  btnRew10.addEventListener('click', () => rewindSeconds( -10 ));

  delayRange.addEventListener('input', (e) => {
    const v = Number(e.target.value);
    targetDelayMs = clamp(Math.round(v*1000), 1000, 30000);
    delayLabel.textContent = v.toFixed(1) + 's';
  });

  fpsRange.addEventListener('input', (e) => {
    targetFps = clamp(parseInt(e.target.value,10)||30, 5, 60);
    fpsLabel.textContent = String(targetFps);
  });

  // Start in idle
  setUI('idle');
})();