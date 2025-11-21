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
  };

  // State
  let mediaStream = null;
  let wakeLock = null;

  // Ring buffer of frames: {bitmap|image, ts, w, h}
  const frames = [];
  let maxBufferMs = 0;
  let desiredDelayMs = 12000;
  let running = false;

  // Drawing
  const stage = els.stage;
  const ctx = stage.getContext('2d', { alpha: false, desynchronized: true });

  // Timing / adaptive
  let targetFps = 30;
  let jpgQuality = 0.85;
  let viewerTimer = null;
  let drawLoopStop = null;
  let lastStats = { pushes:0, drops:0, start:0 };

  function setStatus(msg) {
    els.status.textContent = msg || '';
  }

  function isSecureOK() {
    if (!isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setStatus('Secure context or camera API missing. Use HTTPS and Safari/Chrome.');
      return false;
    }
    return true;
  }

  function updateDesiredDelay() {
    desiredDelayMs = Math.max(2000, parseInt(els.delay.value, 10) * 1000);
    els.delayOut.textContent = Math.round(desiredDelayMs / 1000);
    // Keep buffer small: delay + ~1.2s headroom
    maxBufferMs = desiredDelayMs + 1200;
  }
  updateDesiredDelay();
  els.delay.addEventListener('input', updateDesiredDelay);

  function applyQualityMode() {
    const mode = els.quality.value;
    if (mode === 'high') {
      targetFps = 30; jpgQuality = 0.9;
    } else if (mode === 'battery') {
      targetFps = 20; jpgQuality = 0.75;
    } else {
      targetFps = 24; jpgQuality = 0.82;
    }
  }
  applyQualityMode();
  els.quality.addEventListener('change', applyQualityMode);

  function fitStageToViewport(videoWidth, videoHeight) {
    // Hard ceiling for iOS stability in viewer path; stage can be device-fit
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const vw = Math.floor(document.querySelector('.video-wrap').clientWidth * dpr);
    const vh = Math.floor(document.querySelector('.video-wrap').clientHeight * dpr);

    // 16:9 letterbox within available area based on camera aspect
    const srcAR = videoWidth / videoHeight;
    let w = vw, h = Math.floor(vw / srcAR);
    if (h > vh) { h = vh; w = Math.floor(vh * srcAR); }

    if (stage.width !== w || stage.height !== h) {
      stage.width = w; stage.height = h;
      stage.style.width = Math.floor(w / dpr) + 'px';
      stage.style.height = Math.floor(h / dpr) + 'px';
    }
  }

  function debounce(fn, ms=100) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(()=>fn(...a), ms); };
  }

  async function acquireWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => {});
      }
    } catch {}
  }

  async function releaseWakeLock() {
    try { await wakeLock?.release(); } catch {}
    wakeLock = null;
  }

  function pickFrameByTimestamp(targetTs) {
    // binary search to find frame with ts closest to targetTs but not newer
    let lo = 0, hi = frames.length - 1, idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (frames[mid].ts <= targetTs) { idx = mid; lo = mid + 1; }
      else { hi = mid - 1; }
    }
    return idx;
  }

  function trimOldFrames(nowTs) {
    const minTs = nowTs - maxBufferMs;
    // drop frames older than minTs
    while (frames.length && frames[0].ts < minTs) frames.shift();
  }

  function startStats() {
    lastStats = { pushes:0, drops:0, start:performance.now() };
  }

  function tickStats(push) {
    if (push) lastStats.pushes++; else lastStats.drops++;
    const dt = performance.now() - lastStats.start;
    if (dt > 3000) {
      // Adaptive: if too many drops, step down; if good headroom, step up a notch
      const dropRate = lastStats.drops / Math.max(1, (lastStats.pushes + lastStats.drops));
      if (dropRate > 0.25) {
        targetFps = Math.max(15, targetFps - 3);
        jpgQuality = Math.max(0.7, jpgQuality - 0.03);
      } else if (dropRate < 0.05 && targetFps < 30) {
        targetFps = Math.min(30, targetFps + 2);
        jpgQuality = Math.min(0.92, jpgQuality + 0.02);
      }
      els.viewerStats.textContent = `FPS~${targetFps} q=${jpgQuality.toFixed(2)} drops:${Math.round(dropRate*100)}%`;
      startStats();
    }
  }

  let videoWidth = 1280, videoHeight = 720;
  async function start() {
    if (!isSecureOK()) return;
    setStatus('Starting…');
    try {
      // Try exact rear camera first
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { exact: 'environment' },
            width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 }
          }
        });
      } catch {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 }
          }
        });
      }

      els.preview.srcObject = mediaStream;
      const v = els.preview;
      await v.play();

      await acquireWakeLock();
      running = true;
      els.start.disabled = true;
      els.stop.disabled = false;
      els.viewer.disabled = false;
      els.replay.disabled = false;
      els.save.disabled = false;

      // Wait for video dimensions
      await new Promise(res => {
        if (v.videoWidth) return res();
        v.onloadedmetadata = () => res();
      });
      videoWidth = v.videoWidth || 1280;
      videoHeight = v.videoHeight || 720;
      fitStageToViewport(videoWidth, videoHeight);

      // Start capture loop
      startCaptureLoop(v);
      setStatus('Live with delay');
    } catch (e) {
      console.error(e);
      setStatus('Failed to start camera. Check permissions and HTTPS.');
      await stop();
    }
  }

  async function stop() {
    running = false;
    clearInterval(viewerTimer); viewerTimer = null;
    drawLoopStop?.(); drawLoopStop = null;
    await releaseWakeLock();
    els.start.disabled = false;
    els.stop.disabled = true;
    els.viewer.disabled = true;
    els.replay.disabled = true;
    els.save.disabled = true;

    try { els.preview.pause(); } catch {}
    try {
      mediaStream?.getTracks().forEach(t => t.stop());
    } catch {}
    mediaStream = null;
    setStatus('Stopped');
  }

  function startCaptureLoop(videoEl) {
    frames.length = 0;
    startStats();
    const useRVFC = !!videoEl.requestVideoFrameCallback;
    let rafId = 0;
    let lastPushTs = 0;
    const pushInterval = 1000 / 30; // capture from camera at ~30fps

    const pushFrame = () => {
      if (!running) return;
      const now = performance.now();
      if (now - lastPushTs < pushInterval) { return; }

      fitStageToViewport(videoWidth, videoHeight); // keep size fresh pre-draw
      // Draw current camera to stage temporarily (reused canvas)
      ctx.drawImage(videoEl, 0, 0, stage.width, stage.height);
      const ts = now;

      // Store frame as ImageBitmap for efficiency if supported
      const store = () => {
        if (!running) return;
        const entry = { ts, w: stage.width, h: stage.height };
        // Prefer ImageBitmap
        if ('createImageBitmap' in window) {
          createImageBitmap(stage).then(bmp => {
            entry.bitmap = bmp;
            frames.push(entry);
            trimOldFrames(ts);
            lastPushTs = now;
            tickStats(true);
          }).catch(()=> tickStats(false));
        } else {
          // fallback: store a canvas snapshot
          const clone = document.createElement('canvas');
          clone.width = stage.width; clone.height = stage.height;
          clone.getContext('2d').drawImage(stage, 0, 0);
          entry.canvas = clone;
          frames.push(entry);
          trimOldFrames(ts);
          lastPushTs = now;
          tickStats(true);
        }
      };
      store();
    };

    const usingRVFC = useRVFC ? 'rvfc' : 'raf';
    if (useRVFC) {
      const cb = (now, meta) => {
        if (!running) return;
        pushFrame();
        videoEl.requestVideoFrameCallback(cb);
      };
      videoEl.requestVideoFrameCallback(cb);
      drawLoopStop = () => {}; // nothing to cancel per se
    } else {
      const loop = () => {
        if (!running) return;
        pushFrame();
        rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);
      drawLoopStop = () => cancelAnimationFrame(rafId);
    }

    // Start delayed render loop to stage
    startDelayedRenderLoop();
  }

  function startDelayedRenderLoop() {
    let lastDraw = 0;
    const drawInterval = () => 1000 / targetFps;

    const loop = () => {
      if (!running) return;
      const now = performance.now();
      if (now - lastDraw < drawInterval()) {
        requestAnimationFrame(loop);
        return;
      }
      lastDraw = now;

      const targetTs = now - desiredDelayMs;
      const idx = pickFrameByTimestamp(targetTs);
      if (idx >= 0) {
        const f = frames[idx];
        // Draw selected frame to stage
        if (f.bitmap) ctx.drawImage(f.bitmap, 0, 0, stage.width, stage.height);
        else if (f.canvas) ctx.drawImage(f.canvas, 0, 0, stage.width, stage.height);
        tickStats(true);
      } else {
        tickStats(false);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // Viewer overlay using blob URLs (revoke immediately after swap)
  function openViewer() {
    els.overlay.hidden = false;
    if (viewerTimer) clearInterval(viewerTimer);

    // Cap viewer size for iOS stability
    const maxW = 1280, maxH = 720;
    viewerTimer = setInterval(() => {
      if (!running) return;
      const now = performance.now();
      const targetTs = now - desiredDelayMs;
      const idx = pickFrameByTimestamp(targetTs);
      if (idx < 0) return;
      const f = frames[idx];

      // Draw to a temp canvas respecting cap
      const tw = Math.min(f.w, maxW);
      const th = Math.min(f.h, Math.round(tw * (f.h / f.w)));
      const tmp = document.createElement('canvas');
      tmp.width = tw; tmp.height = th;
      const tctx = tmp.getContext('2d', { alpha:false });
      if (f.bitmap) tctx.drawImage(f.bitmap, 0, 0, tw, th);
      else if (f.canvas) tctx.drawImage(f.canvas, 0, 0, tw, th);

      // toBlob is more memory-friendly than toDataURL
      tmp.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const img = els.viewerImg;
        const old = img.src;
        img.src = url;
        if (old) URL.revokeObjectURL(old);
      }, 'image/jpeg', jpgQuality);
    }, Math.round(1000 / Math.min(targetFps, 24))); // viewer runs up to 24fps
  }

  function closeViewer() {
    els.overlay.hidden = true;
    if (viewerTimer) { clearInterval(viewerTimer); viewerTimer = null; }
    // Revoke current image URL
    const old = els.viewerImg.src;
    if (old) URL.revokeObjectURL(old);
    els.viewerImg.removeAttribute('src');
  }

  // Replay: jump the delay by extra 15s once (and let buffer catch up)
  function replay15() {
    desiredDelayMs = Math.min(desiredDelayMs + 15000, 60000);
    els.delay.value = Math.round(desiredDelayMs / 1000);
    updateDesiredDelay();
    setStatus('Replaying last 15s…');
    setTimeout(()=> setStatus(''), 1200);
  }

  // Save last 15s: capture a still sequence (~1 fps) to local downloads as a zip of JPEGs
  async function saveLast15() {
    try {
      const startTs = performance.now() - desiredDelayMs - 15000;
      const endTs = performance.now() - desiredDelayMs;
      const shots = [];
      for (let t = startTs; t <= endTs; t += 1000) {
        const idx = pickFrameByTimestamp(t);
        if (idx < 0) continue;
        const f = frames[idx];
        const tmp = document.createElement('canvas');
        tmp.width = f.w; tmp.height = f.h;
        const tctx = tmp.getContext('2d', { alpha:false });
        if (f.bitmap) tctx.drawImage(f.bitmap, 0, 0);
        else if (f.canvas) tctx.drawImage(f.canvas, 0, 0);
        const blob = await new Promise(res => tmp.toBlob(res, 'image/jpeg', 0.9));
        shots.push({ ts: f.ts, blob });
      }
      if (!shots.length) { alert('Nothing to save yet.'); return; }

      // Build a client-side zip in-memory
      // To avoid heavy JS zip impl here, we stream a single HTML file with embedded images (works offline).
      const htmlParts = ['<html><head><meta charset="utf-8"><title>WebDelay clip</title></head><body style="background:#000;color:#fff;font-family:sans-serif">'];
      htmlParts.push('<h2>WebDelay – Last 15s (stills)</h2>');
      for (const s of shots) {
        const url = URL.createObjectURL(s.blob);
        htmlParts.push(`<div><img src="${url}" style="max-width:100%"/></div>`);
      }
      htmlParts.push('</body></html>');
      const file = new Blob(htmlParts.map(p=>new Blob([p])), { type: 'text/html' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = 'webdelay-clip.html';
      a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
    } catch (e) {
      console.error(e);
      alert('Save failed.');
    }
  }

  // Visibility: re-acquire wake lock if needed
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && running) acquireWakeLock();
  });

  // Resize/orientation hardening
  const onResize = debounce(() => {
    if (!running) return;
    fitStageToViewport(videoWidth, videoHeight);
  }, 120);
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  // Buttons
  els.start.addEventListener('click', start);
  els.stop.addEventListener('click', stop);
  els.viewer.addEventListener('click', openViewer);
  els.closeViewer.addEventListener('click', closeViewer);
  els.replay.addEventListener('click', replay15);
  els.save.addEventListener('click', saveLast15);
})();
