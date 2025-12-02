// Single-page Video Delay with landscape-friendly UI and hidden controls in landscape.
// Keeps simple 15s replay/save buffer. Defaults to rear camera. No separate window.
(() => {
  const delayedVideo = document.getElementById('delayedVideo');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const replayBtn = document.getElementById('replayBtn');
  const saveBtn = document.getElementById('saveBtn');
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const toastEl = document.getElementById('toast');

  // --- Config ---
  const REPLAY_SECONDS = 15;
  const BUFFER_SECONDS = 40;
  const TIMESLICE_MS = 1000;

  // --- State ---
  let mediaStream = null;
  let mediaRecorder = null;
  let chunkQueue = [];
  let delayedTimer = null;
  let currentDelayUrl = null;

  // --- Helpers ---
  const showToast = (msg, ms=1200) => {
    toastEl.textContent = msg;
    toastEl.style.opacity = '1';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { toastEl.style.opacity = '0'; }, ms);
  };

  const chooseMimeType = () => {
    if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')) return 'video/webm;codecs=vp9,opus';
    if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')) return 'video/webm;codecs=vp8,opus';
    if (MediaRecorder.isTypeSupported('video/webm')) return 'video/webm';
    return ''; // let browser pick
  };

  const totalBuffered = () => chunkQueue.reduce((s, c) => s + (c.duration || 0), 0);
  const pruneBuffer = () => {
    let total = totalBuffered();
    while (total > BUFFER_SECONDS && chunkQueue.length) {
      const removed = chunkQueue.shift();
      total -= (removed.duration || 0);
    }
  };

  const blobFromTail = (seconds) => {
    const parts = [];
    let dur = 0;
    for (let i = chunkQueue.length - 1; i >= 0 && dur < seconds; i--) {
      const ch = chunkQueue[i];
      parts.push(ch.blob);
      dur += (ch.duration || 0);
    }
    parts.reverse();
    return new Blob(parts, { type: chooseMimeType() || 'video/webm' });
  };

  // --- Delayed playback loop ---
  const startDelayedLoop = () => {
    stopDelayedLoop();
    delayedTimer = setInterval(() => {
      if (!chunkQueue.length) return;
      const snippet = blobFromTail(REPLAY_SECONDS + 2); // short advancing window ~15s behind
      const url = URL.createObjectURL(snippet);
      if (currentDelayUrl) URL.revokeObjectURL(currentDelayUrl);
      currentDelayUrl = url;
      delayedVideo.src = url;
      delayedVideo.muted = true;
      delayedVideo.play().catch(()=>{});
    }, 1000);
  };
  const stopDelayedLoop = () => {
    if (delayedTimer) clearInterval(delayedTimer);
    delayedTimer = null;
    if (currentDelayUrl) {
      URL.revokeObjectURL(currentDelayUrl);
      currentDelayUrl = null;
    }
  };

  // --- Save & Replay ---
  const saveLast15 = () => {
    const blob = blobFromTail(REPLAY_SECONDS);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `clip-${new Date().toISOString().replace(/[:.]/g,'-')}.webm`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    showToast('Saved last 15s');
  };

  const playReplay = () => {
    // Pause advancing loop and play a fixed 15s blob; clicking again restarts the 15s
    stopDelayedLoop();
    const blob = blobFromTail(REPLAY_SECONDS);
    const url = URL.createObjectURL(blob);
    const cleanup = () => URL.revokeObjectURL(url);

    const resume = () => {
      cleanup();
      startDelayedLoop();
    };

    delayedVideo.onended = () => {
      delayedVideo.onended = null;
      resume();
    };
    delayedVideo.src = url;
    delayedVideo.currentTime = 0;
    delayedVideo.play().catch(()=>{});
  };

  // --- Recorder ---
  const startRecorder = (stream) => {
    const options = {};
    const mime = chooseMimeType();
    if (mime) options.mimeType = mime;
    mediaRecorder = new MediaRecorder(stream, options);
    let last = performance.now();
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size) {
        const now = performance.now();
        const duration = (now - last) / 1000;
        last = now;
        chunkQueue.push({ blob: e.data, duration });
        pruneBuffer();
      }
    };
    mediaRecorder.start(TIMESLICE_MS);
  };

  // --- Controls ---
  startBtn.onclick = async () => {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
      startRecorder(mediaStream);
      startDelayedLoop();
      startBtn.disabled = true;
      stopBtn.disabled = false;
      replayBtn.disabled = false;
      saveBtn.disabled = false;
      showToast('Started');
    } catch (e) {
      console.error(e);
      alert('Could not start camera (permissions or device issue).');
    }
  };

  stopBtn.onclick = () => {
    stopDelayedLoop();
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try { mediaRecorder.stop(); } catch {}
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop());
      mediaStream = null;
    }
    startBtn.disabled = false;
    stopBtn.disabled = true;
    replayBtn.disabled = true;
    saveBtn.disabled = true;
    showToast('Stopped');
  };

  replayBtn.onclick = () => {
    playReplay();
    showToast('Replaying last 15s');
  };

  saveBtn.onclick = () => {
    saveLast15();
  };

  // Fullscreen + try to lock orientation landscape when supported (mostly Android/desktop)
  fullscreenBtn.onclick = async () => {
    const el = document.documentElement;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
        showToast('Fullscreen');
      } else {
        await document.exitFullscreen();
        showToast('Exited fullscreen');
      }
    } catch {}
    const so = screen.orientation;
    if (document.fullscreenElement && so && so.lock) {
      try { await so.lock('landscape'); } catch {}
    }
  };

  // Cleanup
  window.addEventListener('beforeunload', () => {
    stopDelayedLoop();
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try { mediaRecorder.stop(); } catch {}
    }
    if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
  });
})();
