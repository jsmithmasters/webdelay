const liveVideo = document.getElementById('liveVideo');
const delayVideo = document.getElementById('delayVideo');
const replayVideo = document.getElementById('replayVideo');

const startBtn = document.getElementById('startBtn');
const delayModeBtn = document.getElementById('delayModeBtn');
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
const delayStatus = document.getElementById('delayStatus');
const zoomStatus = document.getElementById('zoomStatus');
const modePill = document.getElementById('modePill');

const pauseDuringReplay = document.getElementById('pauseDuringReplay');
const defaultSlowMo = document.getElementById('defaultSlowMo');
const crossfadeDelay = document.getElementById('crossfadeDelay');

const chips = document.querySelectorAll('.chip[data-delay]');
const customDelayInput = document.getElementById('customDelay');
const downloadLink = document.getElementById('downloadLink');

let stream=null, track=null;
let mediaRecorder=null, recorderMime=null;
let isRecording=false, isReplaying=false, loopReplay=false;
let chunks=[]; // {blob, ts}
let bufferSeconds=180;
let lastReplayMs=15000;
let updatingDelay=false;
let delayTimer=null;
let lastReplayBlobURL=null;
let zoomLevel=1.0, usePTZZoom=false;
let wakeLock=null;

function isiOS(){ return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream; }

function updateUI(){
  bufferStatus.innerHTML = `Buffer: <strong>${isRecording?'On':'Off'}</strong>`;
  delayStatus.innerHTML = `Delay: <strong>${Math.round(lastReplayMs/1000)}s</strong>`;
  modePill.textContent = isReplaying ? 'REPLAY' : 'LIVE';
  modePill.classList.toggle('replay', isReplaying);
  modePill.classList.toggle('live', !isReplaying);
  const started = !!stream;
  [delayModeBtn,replayBtn,replayAgainBtn,saveClipBtn,slowMoBtn,loopBtn].forEach(b=> b.disabled = !started);
  zoomStatus.innerHTML = `Zoom: <strong>${zoomLevel.toFixed(1)}×${usePTZZoom?' (optical)':''}</strong>`;
}

function setDelayFromChip(elem){
  chips.forEach(c=>c.classList.remove('active'));
  elem.classList.add('active');
  document.querySelector('.chip.custom').classList.remove('active');
  lastReplayMs = Number(elem.dataset.delay)*1000;
  updateUI();
}

chips.forEach(chip => chip.addEventListener('click', ()=> setDelayFromChip(chip)));
customDelayInput.addEventListener('change', ()=>{
  chips.forEach(c=>c.classList.remove('active'));
  document.querySelector('.chip.custom').classList.add('active');
  const v = Math.max(3, Math.min(120, Math.round(Number(customDelayInput.value)||15)));
  customDelayInput.value = v;
  lastReplayMs = v*1000;
  updateUI();
});

async function start(){
  startBtn.disabled = true;
  try{
    try{
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: 'environment' }, width:{ideal:1280}, height:{ideal:720}, frameRate:{ideal:30} },
        audio: false
      });
    }catch(e){
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width:{ideal:1280}, height:{ideal:720}, frameRate:{ideal:30} },
        audio: false
      });
    }
    liveVideo.srcObject = stream;
    track = stream.getVideoTracks()[0];
    try{ const caps = track.getCapabilities?.(); if(caps && 'zoom' in caps){ usePTZZoom = true; } }catch(e){}
    startRecording();
    await startDelayView();
    await enableKeepAwake();
  }catch(err){
    alert('Could not start camera. Please allow camera access.');
    console.error(err);
  }finally{ startBtn.disabled=false; updateUI(); }
}

function pickMime(){
  const types = ['video/mp4;codecs="avc1.42E01E"','video/webm;codecs="vp9"','video/webm;codecs="vp8"','video/webm'];
  for(const t of types){ if(MediaRecorder.isTypeSupported?.(t)) return t; }
  return '';
}

function startRecording(){
  if(!stream) return;
  const mime=pickMime();
  recorderMime = mime || undefined;
  mediaRecorder = new MediaRecorder(stream, mime?{mimeType:mime}:{ });
  mediaRecorder.ondataavailable = e=>{
    if(e.data && e.data.size>0){
      chunks.push({blob:e.data, ts: Date.now()});
      pruneBuffer();
    }
  };
  mediaRecorder.onstop = ()=>{ isRecording=false; updateUI(); }
  mediaRecorder.start(500);
  isRecording=true; updateUI();
}

function pruneBuffer(){
  const cutoff = Date.now() - bufferSeconds*1000;
  while(chunks.length && chunks[0].ts < cutoff){ chunks.shift(); }
}

function getLastWindowBlob(windowMs){
  pruneBuffer();
  if(!chunks.length) return null;
  const cutoff = Date.now()-windowMs;
  const selected=[];
  for(let i=chunks.length-1;i>=0;i--){
    selected.push(chunks[i]);
    if(chunks[i].ts <= cutoff) break;
  }
  selected.reverse();
  const blobs = selected.map(c=>c.blob);
  if(!blobs.length) return null;
  return new Blob(blobs, { type: recorderMime || blobs[0].type || 'video/webm' });
}

async function startDelayView(){
  delayModeBtn.disabled=false;
  if(delayTimer) clearInterval(delayTimer);
  await refreshDelayOnce(true);
  delayTimer = setInterval(()=> refreshDelayOnce(false), 800);
}

async function refreshDelayOnce(initial){
  if(!isRecording) return;
  if(updatingDelay) return;
  updatingDelay=true;
  try{
    const blob = getLastWindowBlob(lastReplayMs);
    if(!blob){ updatingDelay=false; return; }
    const url = URL.createObjectURL(blob);
    delayVideo.srcObject=null;
    delayVideo.src = url;
    delayVideo.muted=true;
    await delayVideo.play().catch(()=>{});
  }finally{ updatingDelay=false; }
}

let replayLock=false;
async function playReplay(windowMs){
  if(replayLock) return;
  replayLock=true; replayBtn.disabled=true; replayAgainBtn.disabled=true;
  try{
    const blob = getLastWindowBlob(windowMs);
    if(!blob){ alert('Need a bit more buffer before replay.'); return; }
    const pause = pauseDuringReplay.checked;
    if(pause && isRecording){ try{ mediaRecorder.stop(); }catch(e){} }
    if(lastReplayBlobURL) URL.revokeObjectURL(lastReplayBlobURL);
    lastReplayBlobURL = URL.createObjectURL(blob);
    replayVideo.srcObject=null; replayVideo.src=lastReplayBlobURL;
    replayVideo.loop = loopReplay; replayVideo.muted=true;
    replayVideo.playbackRate = defaultSlowMo.checked ? 0.5 : 1.0;
    isReplaying=true; modePill.textContent='REPLAY'; modePill.classList.add('replay');
    replayVideo.hidden=false;
    await replayVideo.play().catch(()=>{ replayVideo.controls=true; });
    replayVideo.onended = async ()=>{
      if(!loopReplay){
        isReplaying=false; modePill.textContent='LIVE'; modePill.classList.remove('replay');
        replayVideo.hidden=true; replayVideo.removeAttribute('src'); replayVideo.load();
        if(pause && !isRecording){ startRecording(); }
      }
    };
    replayAgainBtn.textContent = `Replay Again (${Math.round(windowMs/1000)}s)`;
    replayAgainBtn.onclick = ()=> playReplay(windowMs);
  }finally{
    setTimeout(()=>{ replayLock=false; replayBtn.disabled=false; replayAgainBtn.disabled=false; }, 600);
    updateUI();
  }
}

function saveLast(windowMs){
  const blob = getLastWindowBlob(windowMs);
  if(!blob){ alert('Need more buffer before saving.'); return; }
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  const name = `clip_${Math.round(windowMs/1000)}s_${new Date().toISOString().replace(/[:.]/g,'-')}.${ext}`;
  const url = URL.createObjectURL(blob);
  if(isiOS()){
    const w = window.open(url, '_blank');
    if(!w){ alert('Popup blocked. Allow popups to save the clip.'); }
  } else {
    downloadLink.href = url; downloadLink.download = name; downloadLink.click();
    setTimeout(()=> URL.revokeObjectURL(url), 5000);
  }
}

async function applyZoom(){
  if(track && usePTZZoom){
    try{
      const caps = track.getCapabilities();
      const min = caps.zoom?.min ?? 1, max = caps.zoom?.max ?? 3;
      const target = Math.min(max, Math.max(min, zoomLevel));
      await track.applyConstraints({ advanced: [{ zoom: target }] });
      zoomLevel = (track.getSettings().zoom ?? target);
    }catch(e){
      usePTZZoom=false;
      delayVideo.style.transform = `scale(${zoomLevel})`;
    }
  } else {
    delayVideo.style.transform = `scale(${zoomLevel})`;
  }
  zoomStatus.innerHTML = `Zoom: <strong>${zoomLevel.toFixed(1)}×${usePTZZoom?' (optical)':''}</strong>`;
}
function zoomIn(){ zoomLevel = Math.min(3.0, zoomLevel+0.1); applyZoom(); }
function zoomOut(){ zoomLevel = Math.max(1.0, zoomLevel-0.1); applyZoom(); }
function toggleMirror(){
  const mirrored = delayVideo.style.transform.includes('scaleX(-1)');
  if(mirrored){
    delayVideo.style.transform = delayVideo.style.transform.replace('scaleX(-1) ','').trim();
    mirrorBtn.textContent='Mirror Off';
  }else{
    delayVideo.style.transform = `scaleX(-1) ${delayVideo.style.transform}`.trim();
    mirrorBtn.textContent='Mirror On';
  }
}
function toggleLoop(){ loopReplay=!loopReplay; loopBtn.textContent = loopReplay?'Loop On':'Loop Off'; }
function toggleSlowMo(){
  if(isReplaying){
    replayVideo.playbackRate = (replayVideo.playbackRate===1?0.5:1);
    slowMoBtn.textContent = replayVideo.playbackRate===1 ? 'Slow-mo (0.5×)' : 'Normal (1×)';
  } else {
    defaultSlowMo.checked = !defaultSlowMo.checked;
  }
}
async function enableKeepAwake(){
  try{ wakeLock = await navigator.wakeLock.request('screen'); keepAwakeBtn.textContent='Release Awake'; }
  catch(e){ console.warn('WakeLock not available', e); }
}
async function toggleKeepAwake(){
  if(wakeLock){ await wakeLock.release(); wakeLock=null; keepAwakeBtn.textContent='Keep Awake'; }
  else { await enableKeepAwake(); }
}
function resetAll(){
  try{ mediaRecorder?.stop(); }catch(e){}
  isRecording=false; chunks=[]; lastReplayMs=15000; bufferSeconds=180;
  zoomLevel=1.0; usePTZZoom=false;
  chips.forEach(c=>c.classList.remove('active')); [...chips].find(c=>c.dataset.delay==='15')?.classList.add('active');
  customDelayInput.value=15; pauseDuringReplay.checked=false; defaultSlowMo.checked=false; loopReplay=false;
  loopBtn.textContent='Loop Off'; slowMoBtn.textContent='Slow-mo (0.5×)';
  delayVideo.style.transform='scale(1)'; mirrorBtn.textContent='Mirror Off';
  if(delayTimer) clearInterval(delayTimer);
  if(stream){ startRecording(); startDelayView(); }
  updateUI();
}

startBtn.addEventListener('click', start);
delayModeBtn.addEventListener('click', ()=>{});
replayBtn.addEventListener('click', ()=> playReplay(lastReplayMs));
replayAgainBtn.addEventListener('click', ()=> playReplay(lastReplayMs));
saveClipBtn.addEventListener('click', ()=> saveLast(Math.max(lastReplayMs,20000)));
slowMoBtn.addEventListener('click', toggleSlowMo);
loopBtn.addEventListener('click', toggleLoop);
zoomInBtn.addEventListener('click', zoomIn);
zoomOutBtn.addEventListener('click', zoomOut);
mirrorBtn.addEventListener('click', toggleMirror);
keepAwakeBtn.addEventListener('click', toggleKeepAwake);
resetBtn.addEventListener('click', resetAll);

updateUI();
