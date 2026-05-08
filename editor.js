// ═══════════════════════════════════════════════════════
//  RHYTHMFLOW BEATMAP EDITOR
// ═══════════════════════════════════════════════════════

const audioEl = document.getElementById('ed-audio-player');
const canvas = document.getElementById('timeline-canvas');
const ctx = canvas.getContext('2d');
const wrapper = document.getElementById('timeline-wrapper');

// Editor state
const es = {
  notes: [],       // {time, lane}
  subtitles: [],   // {time, duration, text}
  bpm: 128,
  snap: 4,         // beats per snap (0 = free)
  zoom: 120,       // px per second
  playheadMs: 0,
  duration: 0,     // audio duration ms
  playing: false,
  audioOffset: 0,
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
};

// Colors
const LANE_COLORS = ['#ff006e','#ffbe0b','#00f5ff','#06d6a0'];
const LANE_NAMES = ['D','F','J','K'];
const LANE_HEIGHT = 24;
const HEADER_H = 40;
const WAVEFORM_H = 60;
const LANE_START = HEADER_H + WAVEFORM_H;
const TOTAL_H = LANE_START + LANE_HEIGHT * 4 + 20;
const LANE_Y = [0,1,2,3].map(i => LANE_START + i * LANE_HEIGHT);

// ─── Audio Loading ───
document.getElementById('ed-audio').addEventListener('change', async e => {
  const f = e.target.files[0]; if(!f) return;
  const url = URL.createObjectURL(f);
  audioEl.src = url;
  await audioEl.load();

  // Decode for waveform
  const ab = await f.arrayBuffer();
  if(!es.audioCtx) es.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  es.audioBuffer = await es.audioCtx.decodeAudioData(ab);
  es.duration = es.audioBuffer.duration * 1000;
  document.getElementById('gen-end').value = Math.floor(es.duration);

  drawWaveform();
  redraw();
  showToast('Audio dimuat: ' + f.name);
});

// Waveform drawing
function drawWaveform() {
  if(!es.audioBuffer) return;
  // Stored as data, drawn in redraw
  es.waveformData = getWaveformData(es.audioBuffer, 2000);
}

function getWaveformData(buffer, points) {
  const data = buffer.getChannelData(0);
  const step = Math.floor(data.length / points);
  const result = new Float32Array(points);
  for(let i=0; i<points; i++) {
    let max = 0;
    for(let j=0; j<step; j++) {
      max = Math.max(max, Math.abs(data[i*step+j] || 0));
    }
    result[i] = max;
  }
  return result;
}

// ─── Canvas Setup ───
function setupCanvas() {
  const totalMs = Math.max(es.duration || 60000, 30000);
  const W = Math.ceil((totalMs / 1000) * es.zoom) + 200;
  canvas.width = W;
  canvas.height = TOTAL_H;
  canvas.style.height = TOTAL_H + 'px';
}

// ─── Redraw ───
function redraw() {
  setupCanvas();
  const W = canvas.width;
  ctx.clearRect(0, 0, W, TOTAL_H);

  // Background
  ctx.fillStyle = '#060614';
  ctx.fillRect(0, 0, W, TOTAL_H);

  // Grid lines (beats)
  drawGrid(W);

  // Waveform
  drawWaveformOnCanvas(W);

  // Lane backgrounds
  for(let i=0; i<4; i++) {
    const y = LANE_Y[i];
    ctx.fillStyle = i%2===0 ? 'rgba(255,255,255,0.01)' : 'rgba(0,0,0,0.1)';
    ctx.fillRect(0, y, W, LANE_HEIGHT);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();

    // Lane label
    ctx.fillStyle = LANE_COLORS[i];
    ctx.font = 'bold 10px Share Tech Mono';
    ctx.fillText(LANE_NAMES[i], 4, y + 16);
  }

  // Bottom border
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.beginPath();
  ctx.moveTo(0, LANE_Y[3]+LANE_HEIGHT);
  ctx.lineTo(W, LANE_Y[3]+LANE_HEIGHT);
  ctx.stroke();

  // Subtitle markers
  for(const sub of es.subtitles) {
    const x = msToX(sub.time);
    const x2 = msToX(sub.time + (sub.duration || 3000));
    ctx.fillStyle = 'rgba(6,214,160,0.12)';
    ctx.fillRect(x, HEADER_H, x2-x, WAVEFORM_H);
    ctx.strokeStyle = '#06d6a0';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, HEADER_H); ctx.lineTo(x, HEADER_H+WAVEFORM_H); ctx.stroke();
    ctx.fillStyle = '#06d6a0';
    ctx.font = '9px Share Tech Mono';
    ctx.fillText('◆', x+2, HEADER_H+10);
  }

  // Notes
  for(let i=0; i<es.notes.length; i++) {
    const n = es.notes[i];
    const x = msToX(n.time);
    const y = LANE_Y[n.lane];
    const isSelected = es.selectedNote === i;

    ctx.fillStyle = LANE_COLORS[n.lane];
    ctx.shadowColor = LANE_COLORS[n.lane];
    ctx.shadowBlur = isSelected ? 10 : 4;
    ctx.fillRect(x-8, y+3, 16, LANE_HEIGHT-6);
    ctx.shadowBlur = 0;

    if(isSelected) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x-8, y+3, 16, LANE_HEIGHT-6);
    }
  }

  // Playhead
  const px = msToX(es.playheadMs);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.shadowColor = '#fff';
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.moveTo(px, 0);
  ctx.lineTo(px, TOTAL_H);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Playhead triangle
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(px-6, 0);
  ctx.lineTo(px+6, 0);
  ctx.lineTo(px, 10);
  ctx.fill();

  updateStats();
}

function drawGrid(W) {
  const bpm = es.bpm || 128;
  const beatMs = 60000 / bpm;
  const totalMs = (W / es.zoom) * 1000;

  // Sub-beat lines
  const subDiv = Math.max(1, es.snap > 1 ? es.snap : 4);
  for(let t=0; t<totalMs; t+=beatMs/subDiv) {
    const x = msToX(t);
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x,HEADER_H); ctx.lineTo(x,TOTAL_H); ctx.stroke();
  }

  // Beat lines
  let beat = 0;
  for(let t=0; t<totalMs; t+=beatMs, beat++) {
    const x = msToX(t);
    const isMeasure = beat % 4 === 0;
    ctx.strokeStyle = isMeasure ? 'rgba(0,245,255,0.25)' : 'rgba(255,255,255,0.1)';
    ctx.lineWidth = isMeasure ? 1.5 : 1;
    ctx.beginPath(); ctx.moveTo(x,HEADER_H); ctx.lineTo(x,TOTAL_H); ctx.stroke();

    // Time label
    if(isMeasure) {
      const sec = t / 1000;
      const label = `${Math.floor(sec/60)}:${String(Math.floor(sec%60)).padStart(2,'0')}`;
      ctx.fillStyle = 'rgba(0,245,255,0.6)';
      ctx.font = '10px Share Tech Mono';
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
    ctx.fillText('[ Upload audio untuk melihat waveform ]', 20, HEADER_H + WAVEFORM_H/2 + 4);
    return;
  }
  const data = es.waveformData;
  const totalMs = (W / es.zoom) * 1000;
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(0, HEADER_H, W, WAVEFORM_H);

  const midY = HEADER_H + WAVEFORM_H/2;
  ctx.strokeStyle = 'rgba(0,245,255,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for(let px=0; px<W; px++) {
    const t = xToMs(px);
    const idx = Math.floor((t / es.duration) * data.length);
    const amp = (data[idx] || 0) * (WAVEFORM_H/2 - 4);
    if(px===0) ctx.moveTo(px, midY - amp);
    else ctx.lineTo(px, midY - amp);
  }
  ctx.stroke();
  ctx.beginPath();
  for(let px=0; px<W; px++) {
    const t = xToMs(px);
    const idx = Math.floor((t / es.duration) * data.length);
    const amp = (data[idx] || 0) * (WAVEFORM_H/2 - 4);
    if(px===0) ctx.moveTo(px, midY + amp);
    else ctx.lineTo(px, midY + amp);
  }
  ctx.stroke();
}

// ─── Coordinate helpers ───
function msToX(ms) { return (ms / 1000) * es.zoom; }
function xToMs(x) { return (x / es.zoom) * 1000; }

function snapMs(ms) {
  if(!es.snap || es.snap === 0) return ms;
  const beatMs = 60000 / es.bpm;
  const snapUnit = beatMs / es.snap;
  return Math.round(ms / snapUnit) * snapUnit;
}

function getLaneFromY(y) {
  for(let i=0; i<4; i++) {
    if(y >= LANE_Y[i] && y < LANE_Y[i]+LANE_HEIGHT) return i;
  }
  return -1;
}

// ─── Canvas Mouse Events ───
let isRightClick = false;

canvas.addEventListener('mousedown', e => {
  const rect = canvas.getBoundingClientRect();
  const scrollX = wrapper.scrollLeft;
  const x = e.clientX - rect.left + scrollX;
  const y = e.clientY - rect.top;

  if(e.button === 1 || e.button === 2) {
    // Middle/right = drag scroll
    isRightClick = true;
    es.dragging = true;
    es.dragStartX = e.clientX;
    es.scrollStart = wrapper.scrollLeft;
    return;
  }

  isRightClick = false;
  const ms = xToMs(x);
  const lane = getLaneFromY(y);

  if(lane >= 0) {
    // Check if clicking existing note
    let found = -1;
    for(let i=0; i<es.notes.length; i++) {
      const n = es.notes[i];
      if(n.lane === lane && Math.abs(msToX(n.time) - x) < 10) {
        found = i; break;
      }
    }
    if(found >= 0) {
      es.selectedNote = found;
      updateSelectionInfo();
    } else {
      // Place note
      const snapped = snapMs(ms);
      es.notes.push({ time: snapped, lane });
      es.notes.sort((a,b) => a.time - b.time);
      es.selectedNote = null;
    }
    es.playheadMs = snapMs(ms);
    redraw();
  } else if(y < HEADER_H) {
    // Click header = set playhead
    es.playheadMs = snapMs(ms);
    seekAudio(es.playheadMs);
    redraw();
  }
});

canvas.addEventListener('mousemove', e => {
  if(es.dragging && isRightClick) {
    const dx = e.clientX - es.dragStartX;
    wrapper.scrollLeft = es.scrollStart - dx;
  }
});

canvas.addEventListener('mouseup', () => { es.dragging = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());

// ─── Keyboard Shortcuts ───
document.addEventListener('keydown', e => {
  const tag = e.target.tagName.toLowerCase();
  if(tag === 'input' || tag === 'textarea') return;

  if(e.code === 'Space') { e.preventDefault(); togglePlay(); return; }
  if(e.key === 's' || e.key === 'S') { stopAudio(); return; }
  if((e.key === 'Delete' || e.key === 'Backspace') && es.selectedNote !== null) {
    es.notes.splice(es.selectedNote, 1);
    es.selectedNote = null;
    updateSelectionInfo(); redraw(); return;
  }
  if(e.key === 'ArrowLeft') { es.playheadMs = Math.max(0, es.playheadMs - 100); seekAudio(es.playheadMs); redraw(); return; }
  if(e.key === 'ArrowRight') { es.playheadMs = Math.min(es.duration, es.playheadMs + 100); seekAudio(es.playheadMs); redraw(); return; }

  // Place note while playing
  if(es.playing) {
    const laneMap = { d:0, f:1, j:2, k:3 };
    const k = e.key.toLowerCase();
    if(k in laneMap) {
      const ms = snapMs(es.playheadMs);
      es.notes.push({ time: ms, lane: laneMap[k] });
      es.notes.sort((a,b) => a.time - b.time);
      return;
    }
  }

  if(e.ctrlKey && e.key === 's') { e.preventDefault(); exportJSON(); }
});

// ─── Playback ───
let rafId = null;

function togglePlay() {
  if(es.playing) pauseAudio();
  else playAudio();
}

function playAudio() {
  if(!es.audioCtx) es.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if(es.audioBuffer) {
    if(es.audioSource) { try { es.audioSource.stop(); } catch(e){} }
    es.audioSource = es.audioCtx.createBufferSource();
    es.audioSource.buffer = es.audioBuffer;
    es.audioSource.connect(es.audioCtx.destination);
    es.audioSource.start(0, es.playheadMs/1000);
    es.startAudioTime = es.audioCtx.currentTime;
    es.startPlayheadMs = es.playheadMs;
    es.audioSource.onended = () => { if(es.playing) stopAudio(); };
  }
  es.playing = true;
  document.getElementById('tp-play').textContent = '⏸';
  document.getElementById('tp-play').classList.add('playing');
  loop();
}

function pauseAudio() {
  if(es.audioSource) { try { es.audioSource.stop(); } catch(e){} }
  es.playing = false;
  document.getElementById('tp-play').textContent = '▶';
  document.getElementById('tp-play').classList.remove('playing');
  if(rafId) cancelAnimationFrame(rafId);
  redraw();
}

function stopAudio() {
  pauseAudio();
  es.playheadMs = 0;
  seekAudio(0);
  redraw();
}

function seekAudio(ms) {
  if(es.playing) {
    pauseAudio();
    es.playheadMs = ms;
    playAudio();
  } else {
    es.playheadMs = ms;
  }
}

function loop() {
  if(!es.playing) return;
  if(es.audioCtx) {
    es.playheadMs = es.startPlayheadMs + (es.audioCtx.currentTime - es.startAudioTime)*1000;
  }
  updatePlayheadDisplay();
  redraw();
  // Auto-scroll
  const px = msToX(es.playheadMs);
  const vw = wrapper.clientWidth;
  if(px > wrapper.scrollLeft + vw - 100) wrapper.scrollLeft = px - 100;
  rafId = requestAnimationFrame(loop);
}

function updatePlayheadDisplay() {
  const ms = es.playheadMs;
  const s = ms / 1000;
  const min = Math.floor(s/60);
  const sec = Math.floor(s%60);
  const ms2 = Math.floor(ms%1000);
  document.getElementById('playhead-time').textContent =
    `${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}.${String(ms2).padStart(3,'0')}`;
}

// ─── Controls ───
document.getElementById('tp-play').addEventListener('click', togglePlay);
document.getElementById('tb-play').addEventListener('click', playAudio);
document.getElementById('tp-stop').addEventListener('click', stopAudio);
document.getElementById('tb-stop').addEventListener('click', stopAudio);
document.getElementById('tp-rewind').addEventListener('click', () => { stopAudio(); });

document.getElementById('zoom-range').addEventListener('input', e => {
  es.zoom = +e.target.value;
  redraw();
});

document.getElementById('bpm-input').addEventListener('change', e => {
  es.bpm = +e.target.value || 128;
  redraw();
});

document.getElementById('snap-select').addEventListener('change', e => {
  es.snap = +e.target.value;
});

// ─── Note Controls ───
document.querySelectorAll('.lane-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.lane-btn').forEach(b => b.classList.remove('sel'));
    btn.classList.add('sel');
    es.selectedLane = +btn.dataset.l;
  });
});

document.getElementById('add-note-btn').addEventListener('click', () => {
  const t = +document.getElementById('note-time').value || 0;
  const snapped = snapMs(t);
  es.notes.push({ time: snapped, lane: es.selectedLane });
  es.notes.sort((a,b) => a.time-b.time);
  redraw();
});

document.getElementById('note-at-play-btn').addEventListener('click', () => {
  const snapped = snapMs(es.playheadMs);
  es.notes.push({ time: snapped, lane: es.selectedLane });
  es.notes.sort((a,b) => a.time-b.time);
  redraw();
});

// ─── Auto Generate ───
document.getElementById('gen-btn').addEventListener('click', () => {
  const start = +document.getElementById('gen-start').value || 0;
  const end = +document.getElementById('gen-end').value || 10000;
  const bpm = es.bpm;
  const beatMs = 60000 / bpm;
  const pattern = document.getElementById('gen-pattern').value;

  let div = 1;
  if(pattern === '4th') div = 1;
  if(pattern === '8th') div = 2;

  const lanes = [0,1,2,3];
  let idx = 0;
  for(let t=start; t<end; t+=beatMs/div) {
    let lane;
    if(pattern === 'rand') lane = Math.floor(Math.random()*4);
    else if(pattern === 'alt') lane = idx%2===0 ? 0 : 2;
    else { lane = lanes[idx%4]; }
    es.notes.push({ time: Math.round(t), lane });
    idx++;
  }
  es.notes.sort((a,b) => a.time-b.time);
  redraw();
  showToast(`Generated ${idx} notes`);
});

// ─── Subtitle Controls ───
document.getElementById('add-sub-btn').addEventListener('click', addSubtitle);
document.getElementById('sub-at-play-btn').addEventListener('click', () => {
  document.getElementById('sub-time-inp').value = Math.round(es.playheadMs);
  addSubtitle();
});

function addSubtitle() {
  const t = +document.getElementById('sub-time-inp').value || Math.round(es.playheadMs);
  const dur = +document.getElementById('sub-dur-inp').value || 3000;
  const text = document.getElementById('sub-text-inp').value.trim();
  if(!text) { showToast('Isi teks subtitle!'); return; }
  es.subtitles.push({ time: t, duration: dur, text });
  es.subtitles.sort((a,b) => a.time-b.time);
  document.getElementById('sub-text-inp').value = '';
  renderSubList();
  redraw();
}

function renderSubList() {
  const list = document.getElementById('sub-list');
  list.innerHTML = '';
  document.getElementById('sub-count').textContent = es.subtitles.length;
  es.subtitles.forEach((sub, i) => {
    const row = document.createElement('div');
    row.className = 'sub-item';
    const t = sub.time/1000;
    const min = Math.floor(t/60);
    const sec = (t%60).toFixed(2).padStart(5,'0');
    row.innerHTML = `
      <span class="sub-time-tag">${min}:${sec}</span>
      <span class="sub-text-preview">${sub.text}</span>
      <span class="sub-dur-tag">${(sub.duration/1000).toFixed(1)}s</span>
      <span class="sub-del" data-i="${i}">✖</span>
    `;
    row.addEventListener('click', e => {
      if(e.target.classList.contains('sub-del')) {
        es.subtitles.splice(+e.target.dataset.i, 1);
        renderSubList(); redraw();
      } else {
        es.playheadMs = sub.time;
        seekAudio(sub.time);
        redraw();
        // Populate form for editing
        document.getElementById('sub-time-inp').value = sub.time;
        document.getElementById('sub-dur-inp').value = sub.duration;
        document.getElementById('sub-text-inp').value = sub.text;
      }
    });
    list.appendChild(row);
  });
}

// ─── Selection ───
function updateSelectionInfo() {
  const info = document.getElementById('selection-info');
  if(es.selectedNote === null) {
    info.textContent = 'Klik note di timeline untuk select';
  } else {
    const n = es.notes[es.selectedNote];
    info.textContent = `Lane: ${LANE_NAMES[n.lane]} | Time: ${n.time}ms`;
  }
}

document.getElementById('del-selected-btn').addEventListener('click', () => {
  if(es.selectedNote !== null) {
    es.notes.splice(es.selectedNote, 1);
    es.selectedNote = null;
    updateSelectionInfo(); redraw();
  }
});

document.getElementById('clear-all-btn').addEventListener('click', () => {
  if(confirm('Hapus semua note?')) { es.notes = []; es.selectedNote = null; redraw(); }
});

// ─── Stats ───
function updateStats() {
  const counts = [0,0,0,0];
  es.notes.forEach(n => counts[n.lane]++);
  document.getElementById('stat-total').textContent = es.notes.length;
  document.getElementById('stat-d').textContent = counts[0];
  document.getElementById('stat-f').textContent = counts[1];
  document.getElementById('stat-j').textContent = counts[2];
  document.getElementById('stat-k').textContent = counts[3];
  const last = es.notes[es.notes.length-1]?.time || 0;
  const s = last/1000;
  document.getElementById('stat-dur').textContent = `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
}

// ─── Export / Import ───
document.getElementById('tb-export').addEventListener('click', exportJSON);

function exportJSON() {
  const meta = {
    title: document.getElementById('meta-title').value || 'Untitled',
    artist: document.getElementById('meta-artist').value || '',
    bpm: es.bpm,
    offset: +document.getElementById('meta-offset').value || 0,
  };
  const data = { meta, notes: es.notes, subtitles: es.subtitles };
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (meta.title.replace(/\s+/g,'_') || 'beatmap') + '.json';
  a.click();
  showToast('Beatmap diekspor: ' + a.download);
}

document.getElementById('tb-import').addEventListener('click', () => {
  document.getElementById('tb-import-file').click();
});

document.getElementById('tb-import-file').addEventListener('change', e => {
  const f = e.target.files[0]; if(!f) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const d = JSON.parse(ev.target.result);
      es.notes = d.notes || [];
      es.subtitles = d.subtitles || [];
      if(d.meta) {
        document.getElementById('meta-title').value = d.meta.title || '';
        document.getElementById('meta-artist').value = d.meta.artist || '';
        document.getElementById('bpm-input').value = d.meta.bpm || 128;
        es.bpm = d.meta.bpm || 128;
      }
      renderSubList();
      redraw();
      showToast(`Imported: ${es.notes.length} notes, ${es.subtitles.length} subtitles`);
    } catch { showToast('File tidak valid!'); }
  };
  reader.readAsText(f);
});

// ─── Help ───
document.getElementById('tb-help').addEventListener('click', () => {
  document.getElementById('help-panel').style.display = 'flex';
});
document.getElementById('close-help').addEventListener('click', () => {
  document.getElementById('help-panel').style.display = 'none';
});

// ─── Toast ───
function showToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:40px;left:50%;transform:translateX(-50%);
    background:rgba(0,245,255,0.15);border:1px solid rgba(0,245,255,0.4);
    color:#fff;padding:8px 20px;font-family:Share Tech Mono;font-size:12px;
    z-index:999;pointer-events:none;animation:fadeToast 2.5s ease forwards;
    letter-spacing:1px;`;
  t.textContent = msg;
  const style = document.createElement('style');
  style.textContent = '@keyframes fadeToast{0%{opacity:0}10%{opacity:1}80%{opacity:1}100%{opacity:0}}';
  document.head.appendChild(style);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}


// ─── UNDO ───
es.history = [];
function saveHistory() {
  es.history.push({ notes: JSON.stringify(es.notes), subtitles: JSON.stringify(es.subtitles) });
  if(es.history.length > 50) es.history.shift();
}
function undo() {
  if(!es.history.length) return;
  const prev = es.history.pop();
  es.notes = JSON.parse(prev.notes);
  es.subtitles = JSON.parse(prev.subtitles);
  renderSubList(); redraw(); showToast('Undo!');
}
document.addEventListener('keydown', e => {
  if(e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
});

// Wrap note-adding to save history
const _origSpawn = spawnArrow ? null : null;
const origAddNote = document.getElementById('add-note-btn').onclick;

// Intercept note pushes via canvas click — wrap redraw
const _origRedraw = redraw;

// ─── RIGHT-CLICK DELETE on canvas ───
canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left + wrapper.scrollLeft;
  const y = e.clientY - rect.top;
  const ms = xToMs(x);
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

// ─── RECORD MODE: tap D/F/J/K while playing to place notes ───
es.recording = false;

// Override keyboard to capture note placements while playing
const _origKeydown = document.onkeydown;
document.addEventListener('keydown', e => {
  if(!es.playing) return;
  const laneMap = { d:0, f:1, j:2, k:3 };
  const k = e.key.toLowerCase();
  const tag = e.target.tagName.toLowerCase();
  if(tag==='input'||tag==='textarea') return;
  if(k in laneMap && es.playing) {
    saveHistory();
    const snapped = snapMs(es.playheadMs);
    es.notes.push({ time: snapped, lane: laneMap[k] });
    es.notes.sort((a,b)=>a.time-b.time);
    // Flash lane indicator
    showToast(`+ Note ${k.toUpperCase()} @ ${Math.round(es.playheadMs)}ms`);
  }
});

// ─── SUBTITLE PREVIEW PANEL ───
const previewEl = document.createElement('div');
previewEl.id = 'sub-preview';
previewEl.style.cssText = `
  position:fixed;bottom:0;left:0;right:0;
  height:36px;background:rgba(5,5,20,0.95);
  border-top:1px solid rgba(6,214,160,0.3);
  display:flex;align-items:center;justify-content:center;
  font-family:Share Tech Mono,monospace;font-size:13px;
  color:#fff;z-index:80;letter-spacing:1px;
  text-shadow:0 0 10px rgba(0,245,255,0.4);
  pointer-events:none;
`;
document.body.appendChild(previewEl);

// Update preview during playback
const _rafLoop = loop;
function loop() {
  _rafLoop && _rafLoop();
  // Update subtitle preview
  const elapsed = es.playheadMs;
  let found = null;
  for(const sub of es.subtitles){
    if(elapsed >= sub.time && elapsed < sub.time+(sub.duration||3000)){ found=sub; break; }
  }
  previewEl.textContent = found ? '♪ ' + found.text + ' ♪' : '';
}

// ─── NOTE COUNT HEATMAP on stats bar ───
function updateHeatmap() {
  if(!es.notes.length) return;
  const counts = [0,0,0,0];
  es.notes.forEach(n => counts[n.lane]++);
  const max = Math.max(...counts,1);
  const bars = ['stat-d','stat-f','stat-j','stat-k'];
  const cols = ['#ff006e','#ffbe0b','#00f5ff','#06d6a0'];
  bars.forEach((id,i) => {
    const el = document.getElementById(id);
    if(el) el.style.color = cols[i];
  });
}
// Call after redraw
const __origRedraw = redraw;
function redraw() { __origRedraw(); updateHeatmap(); }

// ─── MIRROR / FLIP TOOL ───
document.addEventListener('keydown', e => {
  if(e.ctrlKey && e.key==='m') {
    e.preventDefault();
    saveHistory();
    es.notes = es.notes.map(n => ({ ...n, lane: 3-n.lane }));
    redraw(); showToast('Beatmap di-mirror!');
  }
});

// ─── DENSITY ANALYSIS ───
function getDensity() {
  if(!es.notes.length) return;
  const windows = {};
  es.notes.forEach(n => {
    const bucket = Math.floor(n.time/1000);
    windows[bucket] = (windows[bucket]||0)+1;
  });
  const max = Math.max(...Object.values(windows));
  showToast(`Max density: ${max} notes/sec at ${Object.entries(windows).sort((a,b)=>b[1]-a[1])[0][0]}s`);
}
document.getElementById('tb-help').addEventListener('dblclick', getDensity);

// ─── Resize ───
window.addEventListener('resize', redraw);

// ─── Init ───
setupCanvas();
redraw();
renderSubList();
showToast('Beatmap Editor siap — Upload audio untuk mulai');
