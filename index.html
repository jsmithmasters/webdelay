// Coach Replay App
// Focus: stability first. Replay last X seconds, optional pause of recorder during replay, save clip, slow-mo, keep-awake, zoom, reset.

const liveVideo = document.getElementById('liveVideo');
const replayVideo = document.getElementById('replayVideo');

const startBtn = document.getElementById('startBtn');
const replayBtn = document.getElementById('replayBtn');
const replayAgainBtn = document.getElementById('replayAgainBtn');
const saveClipBtn = document.getElementById('saveClipBtn');
const slowMoBtn = document.getElementById('slowMoBtn');
const loopBtn = document.getElementById('loopBtn');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const mirrorBtn = document.getElementById('mirrorBtn');
const keepAwakeBtn = document.getElementById('keepAwakeBtn');
const resetBtn = document.getElementById('resetBtn');

const bufferStatus = document.getElementById('bufferStatus');
const wakeStatus = document.getElementById('wakeStatus');
const zoomStatus = document.getElementById('zoomStatus');
const modePill = document.getElementById('modePill');

const pauseDuringReplay = document.getElementById('pauseDuringReplay');
const defaultSlowMo = document.getElementById('defaultSlowMo');

const chips = document.querySelectorAll('.chip[data-delay]');
const customDelayInput = document.getElementById('customDelay');
const downloadLink = document.getElementById('downloadLink');

// State
let stream = null;
let mediaRecorder = null;
let chunks = []; // {blob, timestamp}
let bufferSeconds = 120; // rolling buffer length
let isRecording = false;
let isReplaying = false;
let wakeLock = null;
let zoomLevel = 1.0;
let usePTZZoom = false;
let track = null;
let loopReplay = false;
let lastReplayMs = 15000;
let lastBlobURL = null;
let recorderMime = null;

// Persisted settings
function loadSettings(){
  try{
    const s = JSON.parse(localStorage.getItem('coachReplaySettings')||'{}');
    if(s.pauseDuringReplay) pauseDuringReplay.checked = true;
    if(s.defaultSlowMo) defaultSlowMo.checked = true;
    if(s.zoomLevel) zoomLevel = s.zoomLevel;
    if(s.lastReplayMs) lastReplayMs = s.lastReplayMs;
    if(s.delayChoice){
      chips.forEach(c => c.classList.toggle('active', c.dataset.delay == s.delayChoice));
      if(!['10','15','20','30'].includes(String(s.delayChoice))) {
        customDelayInput.value = Math.max(3, Math.min(120, Math.round(Number(s.delayChoice)||15)));
        document.querySelector('.chip.custom').classList.add('active');
      }
    }
  }catch(e){}
  applyZoom();
  updateUI();
}

function saveSettings(){
  const activeChip = [...chips].find(c => c.classList.contains('active'));
  const delayChoice = activeChip ? activeChip.dataset.delay : customDelayInput.value;
  const s = {
    pauseDuringReplay: pauseDuringReplay.checked,
    defaultSlowMo: defaultSlowMo.checked,
    zoomLevel,
    lastReplayMs,
    delayChoice
  };
  localStorage.setItem('coachReplaySettings', JSON.stringify(s));
}

function updateUI(){
  bufferStatus.innerHTML = `Buffering: <strong>${isRecording ? 'On' : 'Off'}</strong>`;
  zoomStatus.innerHTML = `Zoom: <strong>${zoomLevel.toFixed(1)}×${usePTZZoom?' (optical)':''}</strong>`;
  modePill.textContent = isReplaying ? 'REPLAY' : 'LIVE';
  modePill.classList.toggle('replay', isReplaying);
  modePill.classList.toggle('live', !isReplaying);

  const started = !!stream;
  replayBtn.disabled = !started;
  replayAgainBtn.disabled = !started;
  saveClipBtn.disabled = !started;
  slowMoBtn.disabled = !started;
  loopBtn.disabled = !started;
}

function setDelayFromChip(elem){
  chips.forEach(c=>c.classList.remove('active'));
  elem.classList.add('active');
  document.querySelector('.chip.custom').classList.remove('active');
  lastReplayMs = Number(elem.dataset.delay)*1000;
  saveSettings();
}

chips.forEach(chip => chip.addEventListener('click', ()=> setDelayFromChip(chip)));
customDelayInput.addEventListener('change', ()=>{
  chips.forEach(c=>c.classList.remove('active'));
  document.querySelector('.chip.custom').classList.add('active');
  const v = Math.max(3, Math.min(120, Math.round(Number(customDelayInput.value)||15)));
  customDelayInput.value = v;
  lastReplayMs = v*1000;
  saveSettings();
});

async function start(){
  startBtn.disabled = true;
  try{
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: false
    });
    liveVideo.srcObject = stream;
    track = stream.getVideoTracks()[0];
    try{
      const caps = track.getCapabilities?.();
      if(caps && 'zoom' in caps){
        usePTZZoom = true;
        // initialize to 1.0x relative scale (min may not be 1)
        const s = track.getSettings?.();
        if(s && s.zoom) zoomLevel = s.zoom;
      }
    }catch(e){}
    startRecording();
    enableKeepAwake();
  }catch(err){
    alert('Camera permission failed. Please allow camera access and reload.');
    console.error(err);
  }finally{
    startBtn.disabled = false;
  }
}

function startRecording(){
  if(!stream) return;
  // Prefer MP4/H264 on Safari/iOS, otherwise use webm
  const types = [
    'video/mp4;codecs="avc1.42E01E"', 
    'video/webm;codecs="vp9"',
    'video/webm;codecs="vp8"',
    'video/webm'
  ];
  let mimeType = "";
  for(const t of types){ if(MediaRecorder.isTypeSupported(t)){ mimeType = t; break; } }
  recorderMime = mimeType || undefined;
  mediaRecorder = new MediaRecorder(stream, mimeType?{mimeType}:{});

  mediaRecorder.ondataavailable = e => {
    if(e.data && e.data.size > 0){
      chunks.push({ blob: e.data, ts: Date.now() });
      pruneBuffer();
    }
  };
  mediaRecorder.onstop = ()=>{ isRecording = false; updateUI(); };
  mediaRecorder.start(1000); // gather data every second
  isRecording = true;
  updateUI();
}

function pruneBuffer(){
  const cutoff = Date.now() - bufferSeconds*1000;
  while(chunks.length && chunks[0].ts < cutoff){
    chunks.shift();
  }
}

function getLastWindowBlob(windowMs){
  pruneBuffer();
  if(!chunks.length) return null;
  const cutoff = Date.now() - windowMs;
  const selected = [];
  for(let i = chunks.length-1; i >= 0; i--){
    selected.push(chunks[i]);
    if(chunks[i].ts <= cutoff) break;
  }
  selected.reverse();
  const blobs = selected.map(c=>c.blob);
  if(!blobs.length) return null;
  return new Blob(blobs, { type: recorderMime || blobs[0].type || 'video/webm' });
}

async function playReplay(windowMs, again=false){
  if(!stream) return;
  const blob = getLastWindowBlob(windowMs);
  if(!blob){ alert('Not enough buffered video yet.'); return; }

  const pause = pauseDuringReplay.checked;
  if(pause && isRecording){
    try{ mediaRecorder.stop(); }catch(e){}
  }

  if(lastBlobURL) URL.revokeObjectURL(lastBlobURL);
  lastBlobURL = URL.createObjectURL(blob);

  replayVideo.srcObject = null;
  replayVideo.src = lastBlobURL;
  replayVideo.muted = true;
  replayVideo.playbackRate = defaultSlowMo.checked ? 0.5 : 1.0;
  replayVideo.loop = loopReplay;

  liveVideo.hidden = true;
  replayVideo.hidden = false;
  isReplaying = true;
  updateUI();

  try{
    await replayVideo.play();
  }catch(e){
    // Some browsers require user gesture; if fail, show controls and instruct tap
    replayVideo.controls = true;
  }

  replayVideo.onended = ()=>{
    if(!loopReplay){
      exitReplay();
      if(pause && !isRecording){
        // give recorder a moment to settle
        startRecording();
      }
    }
  };

  // For "Replay Again" button to know what length to use
  replayAgainBtn.textContent = `Replay Again (${Math.round(windowMs/1000)}s)`;
  replayAgainBtn.onclick = ()=> playReplay(windowMs, true);
}

function exitReplay(){
  replayVideo.pause();
  replayVideo.removeAttribute('src');
  replayVideo.load();
  replayVideo.hidden = true;
  liveVideo.hidden = false;
  isReplaying = false;
  updateUI();
}

function saveLast(windowMs){
  const blob = getLastWindowBlob(windowMs);
  if(!blob){ alert('Not enough buffered video yet.'); return; }
  const ext = (blob.type.includes('mp4') ? 'mp4' : 'webm');
  const name = `clip_last_${Math.round(windowMs/1000)}s_${new Date().toISOString().replace(/[:.]/g,'-')}.${ext}`;
  const url = URL.createObjectURL(blob);
  downloadLink.href = url;
  downloadLink.download = name;
  downloadLink.click();
  setTimeout(()=> URL.revokeObjectURL(url), 5000);
}

// Zoom
async function applyZoom(){
  if(usePTZZoom && track){
    try{
      const caps = track.getCapabilities();
      const s = track.getSettings();
      const min = caps.zoom?.min ?? 1, max = caps.zoom?.max ?? 3;
      const next = Math.min(max, Math.max(min, zoomLevel));
      await track.applyConstraints({ advanced: [{ zoom: next }] });
      zoomLevel = (track.getSettings().zoom ?? next);
    }catch(e){
      // fallback to CSS
      usePTZZoom = false;
      liveVideo.style.transform = `scale(${zoomLevel})`;
    }
  } else {
    liveVideo.style.transform = `scale(${zoomLevel})`;
  }
  zoomStatus.innerHTML = `Zoom: <strong>${zoomLevel.toFixed(1)}×${usePTZZoom?' (optical)':''}</strong>`;
  saveSettings();
}

function zoomIn(){ zoomLevel = Math.min(3.0, (zoomLevel + 0.1)); applyZoom(); }
function zoomOut(){ zoomLevel = Math.max(1.0, (zoomLevel - 0.1)); applyZoom(); }

// Mirror
function toggleMirror(){
  const mirrored = liveVideo.style.transform.includes('scaleX(-1)');
  if(mirrored){
    liveVideo.style.transform = liveVideo.style.transform.replace('scaleX(-1) ','').trim();
    mirrorBtn.textContent = 'Mirror Off';
  }else{
    liveVideo.style.transform = `scaleX(-1) ${liveVideo.style.transform}`.trim();
    mirrorBtn.textContent = 'Mirror On';
  }
}

// Loop + Slow‑mo
function toggleLoop(){
  loopReplay = !loopReplay;
  loopBtn.textContent = loopReplay ? 'Loop On' : 'Loop Off';
  replayVideo.loop = loopReplay;
}
function toggleSlowMo(){
  if(isReplaying){
    replayVideo.playbackRate = (replayVideo.playbackRate === 1 ? 0.5 : 1);
    slowMoBtn.textContent = replayVideo.playbackRate === 1 ? 'Slow‑mo (0.5×)' : 'Normal (1×)';
  } else {
    defaultSlowMo.checked = !defaultSlowMo.checked;
    saveSettings();
  }
}

// Keep Awake
async function enableKeepAwake(){
  try{
    wakeLock = await navigator.wakeLock.request('screen');
    wakeStatus.innerHTML = 'Keep Awake: <strong>On</strong>';
    keepAwakeBtn.textContent = 'Release Awake';
    wakeLock.addEventListener('release', ()=>{
      wakeStatus.innerHTML = 'Keep Awake: <strong>Off</strong>';
      keepAwakeBtn.textContent = 'Keep Awake';
    });
  }catch(e){
    alert('Wake Lock not supported; consider keeping the screen active manually.');
  }
}
async function toggleKeepAwake(){
  if(wakeLock){ await wakeLock.release(); wakeLock = null; }
  else { await enableKeepAwake(); }
}

// Reset
function resetDefaults(){
  // Stop replay if active
  if(isReplaying) exitReplay();
  // Stop recorder
  try{ mediaRecorder?.stop(); }catch(e){}
  isRecording = false;
  chunks = [];
  bufferSeconds = 120;
  zoomLevel = 1.0;
  usePTZZoom = false;

  // UI defaults
  chips.forEach(c=>c.classList.remove('active'));
  [...chips].find(c=>c.dataset.delay==='15')?.classList.add('active');
  customDelayInput.value = 15;
  pauseDuringReplay.checked = false;
  defaultSlowMo.checked = false;
  loopReplay = false;
  loopBtn.textContent = 'Loop Off';
  slowMoBtn.textContent = 'Slow‑mo (0.5×)';
  liveVideo.style.transform = 'scale(1)';
  mirrorBtn.textContent = 'Mirror Off';

  saveSettings();
  updateUI();
  if(stream){ startRecording(); }
}

// Wire up
startBtn.addEventListener('click', start);
replayBtn.addEventListener('click', ()=> playReplay(lastReplayMs));
replayAgainBtn.addEventListener('click', ()=> playReplay(lastReplayMs));
saveClipBtn.addEventListener('click', ()=> saveLast(Math.max(lastReplayMs, 20000))); // give them time per Jesse's note
slowMoBtn.addEventListener('click', toggleSlowMo);
loopBtn.addEventListener('click', toggleLoop);
zoomInBtn.addEventListener('click', zoomIn);
zoomOutBtn.addEventListener('click', zoomOut);
mirrorBtn.addEventListener('click', toggleMirror);
keepAwakeBtn.addEventListener('click', toggleKeepAwake);
resetBtn.addEventListener('click', resetDefaults);
pauseDuringReplay.addEventListener('change', saveSettings);
defaultSlowMo.addEventListener('change', saveSettings);

window.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'visible' && wakeLock){
    // Re-request on some platforms
    enableKeepAwake();
  }
});

loadSettings();
