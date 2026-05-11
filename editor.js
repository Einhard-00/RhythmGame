// ═══════════════════════════════════════════════════════
//  RHYTHMFLOW BEATMAP EDITOR
// ═══════════════════════════════════════════════════════

const audioEl  = document.getElementById('ed-audio-player');
const canvas   = document.getElementById('timeline-canvas');
const ctx      = canvas.getContext('2d');
const wrapper  = document.getElementById('timeline-wrapper');
const prevCv   = document.getElementById('preview-canvas');
const prevCtx  = prevCv.getContext('2d');

// ─── State ───
const es = {
  notes: [],
  bpm: 128,
  snap: 4,
  zoom: 120,
  playheadMs: 0,
  duration: 0,
  playing: false,
  selectedNote: null,
  selectedLane: 0,
  dragging: false,
  dragStartX: 0,
  scrollStart: 0,
  audioCtx: null,
  audioBuffer: null,
  audioSource: null,
  startAudioTime: 0,
  startPlayheadMs: 0,
  waveformData: null,
  history: [],
};

// ─── Layout constants (timeline) ───
const LANE_COLORS = ['#ff006e','#ffbe0b','#00f5ff','#06d6a0'];
const LANE_NAMES  = ['D','F','J','K'];
const LANE_HEIGHT = 24;
const HEADER_H    = 40;
const WAVEFORM_H  = 60;
const LANE_START  = HEADER_H + WAVEFORM_H;
const TOTAL_H     = LANE_START + LANE_HEIGHT * 4 + 20;
const LANE_Y      = [0,1,2,3].map(i => LANE_START + i * LANE_HEIGHT);

// ═══════════════════════════════════════════════════════
//  AUDIO LOADING
// ═══════════════════════════════════════════════════════

document.getElementById('ed-audio').addEventListener('change', async e => {
  const f = e.target.files[0]; if(!f) return;

  const badge = document.getElementById('audio-badge');
  badge.style.display = 'block';
  badge.textContent   = '🎵 ' + f.name;
  badge.title         = f.name;

  showToast('Memuat audio…');
  try {
    if(!es.audioCtx) es.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ab = await f.arrayBuffer();
    es.audioBuffer = await es.audioCtx.decodeAudioData(ab);
    es.duration    = es.audioBuffer.duration * 1000;
    document.getElementById('gen-end').value = Math.floor(es.duration);
    es.waveformData = getWaveformData(es.audioBuffer, 2000);
    redraw();
    drawPreview();
    showToast('Audio siap: ' + f.name);
  } catch(err) {
    showToast('Gagal memuat audio: ' + err.message);
  }
});

function getWaveformData(buffer, points) {
  const data = buffer.getChannelData(0);
  const step = Math.floor(data.length / points);
  const out  = new Float32Array(points);
  for(let i=0; i<points; i++) {
    let max = 0;
    for(let j=0; j<step; j++) max = Math.max(max, Math.abs(data[i*step+j]||0));
    out[i] = max;
  }
  return out;
}

// ═══════════════════════════════════════════════════════
//  TIMELINE CANVAS
// ═══════════════════════════════════════════════════════

function setupCanvas() {
  const totalMs = Math.max(es.duration||60000, 30000);
  const W = Math.ceil((totalMs/1000)*es.zoom) + 200;
  canvas.width  = W;
  canvas.height = TOTAL_H;
  canvas.style.height = TOTAL_H + 'px';
}

function redraw() {
  setupCanvas();
  const W = canvas.width;
  ctx.clearRect(0, 0, W, TOTAL_H);

  ctx.fillStyle = '#060614';
  ctx.fillRect(0, 0, W, TOTAL_H);

  drawGrid(W);
  drawWaveformOnCanvas(W);

  // Lane rows
  for(let i=0; i<4; i++) {
    const y = LANE_Y[i];
    ctx.fillStyle = i%2===0 ? 'rgba(255,255,255,0.01)' : 'rgba(0,0,0,0.1)';
    ctx.fillRect(0, y, W, LANE_HEIGHT);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
    ctx.fillStyle = LANE_COLORS[i];
    ctx.font = 'bold 10px Share Tech Mono';
    ctx.fillText(LANE_NAMES[i], 4, y+16);
  }

  // Bottom border
  const by = LANE_Y[3]+LANE_HEIGHT;
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.beginPath(); ctx.moveTo(0,by); ctx.lineTo(W,by); ctx.stroke();

  // Notes
  for(let i=0; i<es.notes.length; i++) {
    const n = es.notes[i];
    const x = msToX(n.time);
    const y = LANE_Y[n.lane];
    const sel = es.selectedNote === i;
    ctx.fillStyle   = LANE_COLORS[n.lane];
    ctx.shadowColor = LANE_COLORS[n.lane];
    ctx.shadowBlur  = sel ? 10 : 4;
    ctx.fillRect(x-8, y+3, 16, LANE_HEIGHT-6);
    ctx.shadowBlur  = 0;
    if(sel) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth   = 1.5;
      ctx.strokeRect(x-8, y+3, 16, LANE_HEIGHT-6);
    }
  }

  // Playhead
  const px = msToX(es.playheadMs);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
  ctx.shadowColor = '#fff'; ctx.shadowBlur = 6;
  ctx.beginPath(); ctx.moveTo(px,0); ctx.lineTo(px,TOTAL_H); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.moveTo(px-6,0); ctx.lineTo(px+6,0); ctx.lineTo(px,10); ctx.fill();

  updateStats();
  updateHeatmap();
  drawPreview();
}

function drawGrid(W) {
  const bpm    = es.bpm||128;
  const beatMs = 60000/bpm;
  const total  = (W/es.zoom)*1000;
  const sub    = Math.max(1, es.snap>1 ? es.snap : 4);

  for(let t=0; t<total; t+=beatMs/sub) {
    const x = msToX(t);
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(x,HEADER_H); ctx.lineTo(x,TOTAL_H); ctx.stroke();
  }
  let beat=0;
  for(let t=0; t<total; t+=beatMs, beat++) {
    const x  = msToX(t);
    const bm = beat%4===0;
    ctx.strokeStyle = bm ? 'rgba(0,245,255,0.25)' : 'rgba(255,255,255,0.1)';
    ctx.lineWidth   = bm ? 1.5 : 1;
    ctx.beginPath(); ctx.moveTo(x,HEADER_H); ctx.lineTo(x,TOTAL_H); ctx.stroke();
    if(bm) {
      const sec   = t/1000;
      const label = `${Math.floor(sec/60)}:${String(Math.floor(sec%60)).padStart(2,'0')}`;
      ctx.fillStyle = 'rgba(0,245,255,0.6)'; ctx.font='10px Share Tech Mono';
      ctx.fillText(label, x+3, 14);
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillText(`M${beat/4+1}`, x+3, 26);
    }
  }
}

function drawWaveformOnCanvas(W) {
  if(!es.waveformData) {
    ctx.fillStyle = 'rgba(0,245,255,0.05)';
    ctx.fillRect(0, HEADER_H, W, WAVEFORM_H);
    ctx.fillStyle = 'rgba(0,245,255,0.15)';
    ctx.font = '11px Share Tech Mono';
    ctx.fillText('[ Upload audio untuk melihat waveform ]', 20, HEADER_H+WAVEFORM_H/2+4);
    return;
  }
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(0, HEADER_H, W, WAVEFORM_H);
  const midY = HEADER_H + WAVEFORM_H/2;
  ctx.strokeStyle = 'rgba(0,245,255,0.5)'; ctx.lineWidth=1;
  ctx.beginPath();
  for(let px=0; px<W; px++) {
    const t   = xToMs(px);
    const idx = Math.floor((t/es.duration)*es.waveformData.length);
    const amp = (es.waveformData[idx]||0)*(WAVEFORM_H/2-4);
    px===0 ? ctx.moveTo(px,midY-amp) : ctx.lineTo(px,midY-amp);
  }
  ctx.stroke();
  ctx.beginPath();
  for(let px=0; px<W; px++) {
    const t   = xToMs(px);
    const idx = Math.floor((t/es.duration)*es.waveformData.length);
    const amp = (es.waveformData[idx]||0)*(WAVEFORM_H/2-4);
    px===0 ? ctx.moveTo(px,midY+amp) : ctx.lineTo(px,midY+amp);
  }
  ctx.stroke();
}

// ═══════════════════════════════════════════════════════
//  PREVIEW CANVAS  — tampilan mirip game (4 lane vertikal)
//  Window: playheadMs ± PREVIEW_WINDOW_MS
// ═══════════════════════════════════════════════════════

const PREVIEW_WINDOW_MS = 2000; // rentang waktu yang ditampilkan (ms)
const PREV_COLORS = ['#ff006e','#ffbe0b','#00f5ff','#06d6a0'];
const PREV_KEY_LABELS = ['D','F','J','K'];

function drawPreview() {
  // Resize canvas ke ukuran elemen
  const W = prevCv.clientWidth  || 220;
  const H = prevCv.clientHeight || 200;
  if(prevCv.width !== W || prevCv.height !== H) {
    prevCv.width  = W;
    prevCv.height = H;
  }

  prevCtx.clearRect(0, 0, W, H);

  // Background
  prevCtx.fillStyle = '#060614';
  prevCtx.fillRect(0, 0, W, H);

  const laneCount = 4;
  const laneW     = W / laneCount;
  const hitZoneY  = H - 36;  // garis hit zone
  const now        = es.playheadMs;

  // Lane backgrounds + dividers
  for(let i=0; i<laneCount; i++) {
    const x = i * laneW;
    prevCtx.fillStyle = i%2===0 ? 'rgba(255,255,255,0.015)' : 'rgba(0,0,0,0.15)';
    prevCtx.fillRect(x, 0, laneW, H);
    if(i>0) {
      prevCtx.strokeStyle = 'rgba(255,255,255,0.06)';
      prevCtx.lineWidth   = 1;
      prevCtx.beginPath(); prevCtx.moveTo(x,0); prevCtx.lineTo(x,H); prevCtx.stroke();
    }
  }

  // Notes — hanya yang dalam jendela waktu
  const windowStart = now - PREVIEW_WINDOW_MS * 0.3; // sedikit di bawah hit zone
  const windowEnd   = now + PREVIEW_WINDOW_MS;        // ke atas

  for(const n of es.notes) {
    if(n.time < windowStart || n.time > windowEnd) continue;

    const lane = n.lane;
    const cx   = lane * laneW + laneW/2;

    // Posisi Y: note di now → hitZoneY, note di windowEnd → atas (y=0)
    const frac = (windowEnd - n.time) / (windowEnd - windowStart);
    const y    = hitZoneY - (hitZoneY * (1 - frac));
    // lebih intuitif: note yang waktunya = now ada di hitZoneY
    const ratio = (n.time - now) / PREVIEW_WINDOW_MS; // -0.x sampai 1
    const noteY = hitZoneY - ratio * hitZoneY;

    if(noteY < -10 || noteY > H+10) continue;

    const isNear = Math.abs(n.time - now) < 80; // flash jika dekat playhead

    // Arrow shape (hexagonal mirip game)
    const aw = Math.min(laneW - 8, 36);
    const ah = 14;
    prevCtx.fillStyle   = PREV_COLORS[lane];
    prevCtx.shadowColor = PREV_COLORS[lane];
    prevCtx.shadowBlur  = isNear ? 14 : 6;

    prevCtx.beginPath();
    prevCtx.moveTo(cx - aw*0.4, noteY - ah/2);
    prevCtx.lineTo(cx + aw*0.4, noteY - ah/2);
    prevCtx.lineTo(cx + aw/2,   noteY);
    prevCtx.lineTo(cx + aw*0.4, noteY + ah/2);
    prevCtx.lineTo(cx - aw*0.4, noteY + ah/2);
    prevCtx.lineTo(cx - aw/2,   noteY);
    prevCtx.closePath();
    prevCtx.fill();
    prevCtx.shadowBlur = 0;
  }

  // Hit zone line
  prevCtx.strokeStyle = 'rgba(255,255,255,0.25)';
  prevCtx.lineWidth   = 1.5;
  prevCtx.beginPath(); prevCtx.moveTo(0, hitZoneY); prevCtx.lineTo(W, hitZoneY); prevCtx.stroke();

  // Hit zone boxes per lane
  for(let i=0; i<laneCount; i++) {
    const x  = i * laneW;
    const cx = x + laneW/2;
    const bw = Math.min(laneW-8, 38);
    prevCtx.strokeStyle = PREV_COLORS[i];
    prevCtx.lineWidth   = 1.5;
    prevCtx.shadowColor = PREV_COLORS[i];
    prevCtx.shadowBlur  = 4;
    prevCtx.strokeRect(cx - bw/2, hitZoneY - 7, bw, 14);
    prevCtx.shadowBlur  = 0;

    // Key label
    prevCtx.fillStyle = PREV_COLORS[i];
    prevCtx.font      = 'bold 11px Share Tech Mono';
    prevCtx.textAlign = 'center';
    prevCtx.fillText(PREV_KEY_LABELS[i], cx, H - 8);
  }

  // Playhead time overlay (pojok kiri atas)
  const ms  = es.playheadMs;
  const sec = ms/1000;
  const tLabel = `${Math.floor(sec/60)}:${String(Math.floor(sec%60)).padStart(2,'0')}.${String(Math.floor(ms%1000)).padStart(3,'0')}`;
  prevCtx.fillStyle = 'rgba(0,245,255,0.4)';
  prevCtx.font      = '9px Share Tech Mono';
  prevCtx.textAlign = 'left';
  prevCtx.fillText(tLabel, 4, 12);

  // Jumlah note di jendela ini
  const inWindow = es.notes.filter(n => n.time >= windowStart && n.time <= windowEnd).length;
  if(inWindow > 0) {
    prevCtx.fillStyle = 'rgba(255,255,255,0.2)';
    prevCtx.textAlign = 'right';
    prevCtx.fillText(inWindow + ' notes', W-4, 12);
  }
}

// ═══════════════════════════════════════════════════════
//  COORDINATE HELPERS
// ═══════════════════════════════════════════════════════

function msToX(ms) { return (ms/1000)*es.zoom; }
function xToMs(x)  { return (x/es.zoom)*1000; }

function snapMs(ms) {
  if(!es.snap) return ms;
  const unit = (60000/es.bpm)/es.snap;
  return Math.round(ms/unit)*unit;
}

function getLaneFromY(y) {
  for(let i=0; i<4; i++) {
    if(y >= LANE_Y[i] && y < LANE_Y[i]+LANE_HEIGHT) return i;
  }
  return -1;
}

// ═══════════════════════════════════════════════════════
//  CANVAS MOUSE
// ═══════════════════════════════════════════════════════

let isRightClick = false;

canvas.addEventListener('mousedown', e => {
  const rect = canvas.getBoundingClientRect();
  const x    = e.clientX - rect.left + wrapper.scrollLeft;
  const y    = e.clientY - rect.top;

  if(e.button === 1 || e.button === 2) {
    isRightClick    = true;
    es.dragging     = true;
    es.dragStartX   = e.clientX;
    es.scrollStart  = wrapper.scrollLeft;
    return;
  }
  isRightClick = false;

  const ms   = xToMs(x);
  const lane = getLaneFromY(y);

  if(lane >= 0) {
    // Cari note yang diklik
    let found = -1;
    for(let i=0; i<es.notes.length; i++) {
      if(es.notes[i].lane===lane && Math.abs(msToX(es.notes[i].time)-x)<10) { found=i; break; }
    }
    if(found >= 0) {
      es.selectedNote = found;
      updateSelectionInfo();
    } else {
      saveHistory();
      es.notes.push({ time: snapMs(ms), lane });
      es.notes.sort((a,b)=>a.time-b.time);
      es.selectedNote = null;
    }
    es.playheadMs = snapMs(ms);
    redraw();
  } else if(y < HEADER_H) {
    es.playheadMs = snapMs(ms);
    seekAudio(es.playheadMs);
    redraw();
  }
});

canvas.addEventListener('mousemove', e => {
  if(es.dragging && isRightClick)
    wrapper.scrollLeft = es.scrollStart - (e.clientX - es.dragStartX);
});
canvas.addEventListener('mouseup', () => { es.dragging = false; });

canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const x    = e.clientX - rect.left + wrapper.scrollLeft;
  const y    = e.clientY - rect.top;
  const lane = getLaneFromY(y);
  if(lane < 0) return;
  const idx = es.notes.findIndex(n => n.lane===lane && Math.abs(msToX(n.time)-x)<12);
  if(idx >= 0) {
    saveHistory();
    es.notes.splice(idx, 1);
    redraw();
    showToast('Note dihapus');
  }
});

// ═══════════════════════════════════════════════════════
//  KEYBOARD
// ═══════════════════════════════════════════════════════

document.addEventListener('keydown', e => {
  const tag = e.target.tagName.toLowerCase();
  if(tag==='input'||tag==='textarea') return;

  if(e.code==='Space')        { e.preventDefault(); togglePlay(); return; }
  if(e.key==='s'||e.key==='S') { stopAudio(); return; }
  if(e.ctrlKey && e.key==='s') { e.preventDefault(); exportJSON(); return; }
  if(e.ctrlKey && e.key==='z') { e.preventDefault(); undo(); return; }
  if(e.ctrlKey && e.key==='m') {
    e.preventDefault();
    saveHistory();
    es.notes = es.notes.map(n=>({...n, lane:3-n.lane}));
    redraw(); showToast('Beatmap di-mirror!'); return;
  }
  if((e.key==='Delete'||e.key==='Backspace') && es.selectedNote!==null) {
    es.notes.splice(es.selectedNote,1);
    es.selectedNote=null;
    updateSelectionInfo(); redraw(); return;
  }
  if(e.key==='ArrowLeft')  { es.playheadMs=Math.max(0,es.playheadMs-100); seekAudio(es.playheadMs); redraw(); return; }
  if(e.key==='ArrowRight') { es.playheadMs=Math.min(es.duration,es.playheadMs+100); seekAudio(es.playheadMs); redraw(); return; }

  // Place note saat playing
  if(es.playing) {
    const laneMap = {d:0,f:1,j:2,k:3};
    const k = e.key.toLowerCase();
    if(k in laneMap) {
      saveHistory();
      es.notes.push({ time: snapMs(es.playheadMs), lane: laneMap[k] });
      es.notes.sort((a,b)=>a.time-b.time);
      showToast(`+ ${k.toUpperCase()} @ ${Math.round(es.playheadMs)}ms`);
    }
  }
});

// ═══════════════════════════════════════════════════════
//  PLAYBACK
// ═══════════════════════════════════════════════════════

let rafId = null;

function togglePlay() { es.playing ? pauseAudio() : playAudio(); }

function playAudio() {
  if(!es.audioCtx) es.audioCtx = new (window.AudioContext||window.webkitAudioContext)();
  if(es.audioBuffer) {
    if(es.audioSource) { try{es.audioSource.stop();}catch(_){} }
    es.audioSource = es.audioCtx.createBufferSource();
    es.audioSource.buffer = es.audioBuffer;
    es.audioSource.connect(es.audioCtx.destination);
    es.audioSource.start(0, es.playheadMs/1000);
    es.startAudioTime  = es.audioCtx.currentTime;
    es.startPlayheadMs = es.playheadMs;
    es.audioSource.onended = () => { if(es.playing) stopAudio(); };
  }
  es.playing = true;
  document.getElementById('tp-play').textContent = '⏸';
  document.getElementById('tp-play').classList.add('playing');
  loop();
}

function pauseAudio() {
  if(es.audioSource) { try{es.audioSource.stop();}catch(_){} }
  es.playing = false;
  document.getElementById('tp-play').textContent = '▶';
  document.getElementById('tp-play').classList.remove('playing');
  if(rafId) cancelAnimationFrame(rafId);
  redraw();
}

function stopAudio() { pauseAudio(); es.playheadMs=0; seekAudio(0); redraw(); }

function seekAudio(ms) {
  if(es.playing) { pauseAudio(); es.playheadMs=ms; playAudio(); }
  else            { es.playheadMs=ms; }
}

function loop() {
  if(!es.playing) return;
  if(es.audioCtx)
    es.playheadMs = es.startPlayheadMs + (es.audioCtx.currentTime - es.startAudioTime)*1000;
  updatePlayheadDisplay();
  redraw(); // redraw calls drawPreview internally
  const px = msToX(es.playheadMs);
  const vw = wrapper.clientWidth;
  if(px > wrapper.scrollLeft + vw - 100) wrapper.scrollLeft = px - 100;
  rafId = requestAnimationFrame(loop);
}

function updatePlayheadDisplay() {
  const ms  = es.playheadMs;
  const s   = ms/1000;
  document.getElementById('playhead-time').textContent =
    `${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}.${String(Math.floor(ms%1000)).padStart(3,'0')}`;
}

// ═══════════════════════════════════════════════════════
//  CONTROLS
// ═══════════════════════════════════════════════════════

document.getElementById('tp-play').addEventListener('click', togglePlay);
document.getElementById('tb-play').addEventListener('click', playAudio);
document.getElementById('tp-stop').addEventListener('click', stopAudio);
document.getElementById('tb-stop').addEventListener('click', stopAudio);
document.getElementById('tp-rewind').addEventListener('click', stopAudio);

document.getElementById('zoom-range').addEventListener('input', e => { es.zoom=+e.target.value; redraw(); });
document.getElementById('bpm-input').addEventListener('change', e => { es.bpm=+e.target.value||128; redraw(); });
document.getElementById('snap-select').addEventListener('change', e => { es.snap=+e.target.value; });

document.querySelectorAll('.lane-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.lane-btn').forEach(b=>b.classList.remove('sel'));
    btn.classList.add('sel');
    es.selectedLane = +btn.dataset.l;
  });
});

document.getElementById('add-note-btn').addEventListener('click', () => {
  const t = +document.getElementById('note-time').value || 0;
  saveHistory();
  es.notes.push({ time: snapMs(t), lane: es.selectedLane });
  es.notes.sort((a,b)=>a.time-b.time);
  redraw();
});

document.getElementById('note-at-play-btn').addEventListener('click', () => {
  saveHistory();
  es.notes.push({ time: snapMs(es.playheadMs), lane: es.selectedLane });
  es.notes.sort((a,b)=>a.time-b.time);
  redraw();
});

document.getElementById('gen-btn').addEventListener('click', () => {
  const start   = +document.getElementById('gen-start').value || 0;
  const end     = +document.getElementById('gen-end').value   || 10000;
  const beatMs  = 60000/es.bpm;
  const pattern = document.getElementById('gen-pattern').value;
  const div     = pattern==='8th' ? 2 : 1;
  saveHistory();
  let idx=0;
  for(let t=start; t<end; t+=beatMs/div) {
    let lane;
    if(pattern==='rand') lane=Math.floor(Math.random()*4);
    else if(pattern==='alt') lane=idx%2===0?0:2;
    else lane=[0,1,2,3][idx%4];
    es.notes.push({ time: Math.round(t), lane });
    idx++;
  }
  es.notes.sort((a,b)=>a.time-b.time);
  redraw();
  showToast(`Generated ${idx} notes`);
});

function updateSelectionInfo() {
  const info = document.getElementById('selection-info');
  if(es.selectedNote===null) { info.textContent='Klik note di timeline untuk select'; return; }
  const n = es.notes[es.selectedNote];
  info.textContent = `Lane: ${LANE_NAMES[n.lane]} | Time: ${n.time}ms`;
}

document.getElementById('del-selected-btn').addEventListener('click', () => {
  if(es.selectedNote!==null) {
    saveHistory();
    es.notes.splice(es.selectedNote,1);
    es.selectedNote=null;
    updateSelectionInfo(); redraw();
  }
});

document.getElementById('clear-all-btn').addEventListener('click', () => {
  if(confirm('Hapus semua note?')) { saveHistory(); es.notes=[]; es.selectedNote=null; redraw(); }
});

// ═══════════════════════════════════════════════════════
//  STATS
// ═══════════════════════════════════════════════════════

function updateStats() {
  const c=[0,0,0,0];
  es.notes.forEach(n=>c[n.lane]++);
  document.getElementById('stat-total').textContent=es.notes.length;
  document.getElementById('stat-d').textContent=c[0];
  document.getElementById('stat-f').textContent=c[1];
  document.getElementById('stat-j').textContent=c[2];
  document.getElementById('stat-k').textContent=c[3];
  const last=es.notes[es.notes.length-1]?.time||0;
  const s=last/1000;
  document.getElementById('stat-dur').textContent=`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
}

function updateHeatmap() {
  const cols=['#ff006e','#ffbe0b','#00f5ff','#06d6a0'];
  ['stat-d','stat-f','stat-j','stat-k'].forEach((id,i)=>{
    const el=document.getElementById(id);
    if(el) el.style.color=cols[i];
  });
}

// ═══════════════════════════════════════════════════════
//  EXPORT / IMPORT
// ═══════════════════════════════════════════════════════

document.getElementById('tb-export').addEventListener('click', exportJSON);

function exportJSON() {
  const meta = {
    title:  document.getElementById('meta-title').value  || 'Untitled',
    artist: document.getElementById('meta-artist').value || '',
    bpm:    es.bpm,
    offset: +document.getElementById('meta-offset').value || 0,
  };
  const blob = new Blob([JSON.stringify({meta, notes:es.notes}, null, 2)], {type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url; a.download = (meta.title.replace(/\s+/g,'_')||'beatmap')+'.json';
  a.click(); URL.revokeObjectURL(url);
  showToast('Diekspor: ' + a.download);
}

document.getElementById('tb-import').addEventListener('click', () => document.getElementById('tb-import-file').click());

document.getElementById('tb-import-file').addEventListener('change', e => {
  const f = e.target.files[0]; if(!f) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const d = JSON.parse(ev.target.result);
      es.notes = d.notes || [];
      if(d.meta) {
        document.getElementById('meta-title').value  = d.meta.title  || '';
        document.getElementById('meta-artist').value = d.meta.artist || '';
        document.getElementById('bpm-input').value   = d.meta.bpm    || 128;
        es.bpm = d.meta.bpm || 128;
      }
      redraw();
      showToast(`Imported: ${es.notes.length} notes`);
    } catch { showToast('File tidak valid!'); }
  };
  reader.readAsText(f);
});

// ═══════════════════════════════════════════════════════
//  UNDO
// ═══════════════════════════════════════════════════════

function saveHistory() {
  es.history.push(JSON.stringify(es.notes));
  if(es.history.length>50) es.history.shift();
}

function undo() {
  if(!es.history.length) return;
  es.notes = JSON.parse(es.history.pop());
  redraw(); showToast('Undo!');
}

// ═══════════════════════════════════════════════════════
//  HELP
// ═══════════════════════════════════════════════════════

document.getElementById('tb-help').addEventListener('click', () => {
  document.getElementById('help-panel').style.display='flex';
});
document.getElementById('close-help').addEventListener('click', () => {
  document.getElementById('help-panel').style.display='none';
});
document.getElementById('tb-help').addEventListener('dblclick', () => {
  if(!es.notes.length) return;
  const w={};
  es.notes.forEach(n=>{ const b=Math.floor(n.time/1000); w[b]=(w[b]||0)+1; });
  const max=Math.max(...Object.values(w));
  const peak=Object.entries(w).sort((a,b)=>b[1]-a[1])[0][0];
  showToast(`Peak density: ${max} notes/sec @ ${peak}s`);
});

// ═══════════════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════════════

function showToast(msg) {
  const t=document.createElement('div');
  t.style.cssText=`position:fixed;bottom:40px;left:50%;transform:translateX(-50%);
    background:rgba(0,245,255,0.15);border:1px solid rgba(0,245,255,0.4);
    color:#fff;padding:8px 20px;font-family:Share Tech Mono,monospace;font-size:12px;
    z-index:999;pointer-events:none;animation:fadeToast 2.5s ease forwards;
    letter-spacing:1px;white-space:nowrap;`;
  t.textContent=msg;
  const s=document.createElement('style');
  s.textContent='@keyframes fadeToast{0%{opacity:0}10%{opacity:1}80%{opacity:1}100%{opacity:0}}';
  document.head.appendChild(s);
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),2600);
}

// ═══════════════════════════════════════════════════════
//  RESIZE & INIT
// ═══════════════════════════════════════════════════════

window.addEventListener('resize', () => { redraw(); drawPreview(); });
setupCanvas();
redraw();
showToast('Editor siap — Upload audio untuk mulai');