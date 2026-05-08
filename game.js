// ═══════════════════════════════════════════════════════
//  RHYTHMFLOW ENGINE v2 — Full Featured, Low-spec
// ═══════════════════════════════════════════════════════

const KEYS = { d:0, f:1, j:2, k:3 };
const COLORS = ['lane-d','lane-f','lane-j','lane-k'];
const COLOR_HEX = ['#ff006e','#ffbe0b','#00f5ff','#06d6a0'];
const HIT_WINDOW = { perfect:55, good:100, miss:130 };
let ARROW_SPEED = 280;
let AUDIO_OFFSET = 0;

let state = {
  running:false, paused:false,
  score:0, combo:0, maxCombo:0,
  perfect:0, good:0, miss:0, health:100,
  arrows:[], beatmap:[], beatmapIdx:0,
  // subtitles:[], startTime:0,
  laneHeight:0, hitY:0,
  audioLoaded:false, videoLoaded:false, beatmapLoaded:false,
  isDemo:false, totalNotes:0, noMiss:true,
};

// DOM refs
const audioEl    = document.getElementById('audio-player');
const bgVideo    = document.getElementById('bg-video');
const bgImage    = document.getElementById('bg-image');
const subtitleEl = document.getElementById('subtitle-text');
const timingEl   = document.getElementById('timing-indicator');
const scoreEl    = document.getElementById('score-display');
const comboEl    = document.getElementById('combo-num');
const progressEl = document.getElementById('progress-bar');
const menuScreen    = document.getElementById('menu-screen');
const pauseScreen   = document.getElementById('pause-screen');
const resultScreen  = document.getElementById('result-screen');
const startBtn      = document.getElementById('start-btn');
const loadStatus    = document.getElementById('load-status');
const healthBar     = document.getElementById('health-bar');
const fcNotice      = document.getElementById('fc-notice');
const countdownEl   = document.getElementById('countdown');

// Sliders
document.getElementById('speed-slider').addEventListener('input', e => {
  ARROW_SPEED = +e.target.value;
  document.getElementById('speed-val').textContent = e.target.value;
});
document.getElementById('offset-slider').addEventListener('input', e => {
  AUDIO_OFFSET = +e.target.value;
  document.getElementById('offset-val').textContent = e.target.value;
});

// File loaders
document.getElementById('audio-upload').addEventListener('change', e => {
  const f = e.target.files[0]; if(!f) return;
  audioEl.src = URL.createObjectURL(f);
  audioEl.load();
  state.audioLoaded = true;
  updateLoadStatus();
});

document.getElementById('video-upload').addEventListener('change', e => {
  const f = e.target.files[0]; if(!f) return;
  const url = URL.createObjectURL(f);
  if(f.type.startsWith('video/')) {
    bgVideo.src=url; bgVideo.style.display='block'; bgImage.style.display='none';
  } else {
    bgImage.src=url; bgImage.style.display='block'; bgVideo.style.display='none';
  }
  state.videoLoaded = true;
  updateLoadStatus();
});

document.getElementById('beatmap-upload').addEventListener('change', e => {
  const f = e.target.files[0]; if(!f) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      state.beatmap   = (data.notes || data).sort((a,b)=>a.time-b.time);
      // state.subtitles = data.subtitles || [];
      state.beatmapLoaded = true;
      loadStatus.textContent = `Beatmap: ${state.beatmap.length} notes`;
      updateLoadStatus();
    } catch(err) { alert('Beatmap tidak valid! '+err); }
  };
  reader.readAsText(f);
});

function updateLoadStatus() {
  const p = [];
  if(state.audioLoaded) p.push('Audio OK');
  if(state.videoLoaded) p.push('Video OK');
  if(state.beatmapLoaded) p.push('Beatmap OK');
  loadStatus.textContent = p.join(' | ') || 'Belum ada file';
  startBtn.disabled = !(state.audioLoaded && state.beatmapLoaded);
}

// Demo generator
function generateDemo() {
  const bpm=128, beat=60000/bpm;
  const pat=[0,2,1,3,0,1,2,3,1,0,3,2,0,3,1,2];
  const notes=[];
  for(let i=0;i<96;i++) notes.push({time:1000+i*(beat/2), lane:pat[i%pat.length]});
  state.beatmap   = notes;
  state.subtitles = [
    {time:0,    duration:2500, text:'RHYTHMFLOW DEMO'},
    {time:2500, duration:2000, text:'Tekan  D  F  J  K'},
    {time:4500, duration:2000, text:'Saat panah menyentuh zona hit!'},
    {time:6500, duration:99999,text:'Keep the rhythm going!'},
  ];
  state.beatmapLoaded=true; state.isDemo=true;
}

// Start game
document.getElementById('start-demo-btn').addEventListener('click', ()=>{
  generateDemo();
  bgVideo.style.display='none'; bgImage.style.display='none';
  document.getElementById('video-zone').style.background='linear-gradient(135deg,#0a0a2e,#1a0533,#050510)';
  startGame(true);
});
startBtn.addEventListener('click', ()=>startGame(false));
document.getElementById('resume-btn').addEventListener('click', resumeGame);
document.getElementById('quit-btn').addEventListener('click', goMenu);
document.getElementById('retry-btn').addEventListener('click', goMenu);
document.getElementById('menu-btn').addEventListener('click', goMenu);

function startGame(demo) {
  menuScreen.style.display='none';
  resultScreen.style.display='none';
  pauseScreen.style.display='none';
  Object.assign(state,{
    running:false,paused:false,score:0,combo:0,maxCombo:0,
    perfect:0,good:0,miss:0,health:100,
    arrows:[],beatmapIdx:0,totalNotes:state.beatmap.length,
    noMiss:true,isDemo:demo,
  });
  fcNotice.style.display='none';
  document.querySelectorAll('.arrow').forEach(a=>a.remove());
  computeHitY();

  // Countdown
  let cd=3;
  function tick(){
    countdownEl.textContent = cd>0 ? cd : 'GO!';
    countdownEl.className='show';
    setTimeout(()=>{ countdownEl.className=''; },600);
    if(cd-->0){ setTimeout(tick,1000); }
    else {
      setTimeout(()=>{
        state.running=true;
        if(!demo){
          audioEl.currentTime = Math.max(0,-AUDIO_OFFSET/1000);
          audioEl.play();
          if(bgVideo.src) bgVideo.play();
        }
        state.startTime = performance.now() + Math.max(0, AUDIO_OFFSET);
        // subtitleEl.textContent='';
        requestAnimationFrame(loop);
      },400);
    }
  }
  tick();
}

function computeHitY(){
  const el=document.getElementById('lane-d');
  if(!el) return;
  const r=el.getBoundingClientRect();
  state.laneHeight=r.height;
  state.hitY=state.laneHeight-58;
}

function goMenu(){
  state.running=false;
  audioEl.pause(); audioEl.currentTime=0;
  if(bgVideo.src) bgVideo.pause();
  document.querySelectorAll('.arrow').forEach(a=>a.remove());
  state.arrows=[];
  fcNotice.style.display='none';
  menuScreen.style.display='';
  pauseScreen.style.display='none';
  resultScreen.style.display='none';
}

function pauseGame(){
  if(!state.running||state.paused) return;
  state.paused=true;
  audioEl.pause();
  if(bgVideo.src) bgVideo.pause();
  pauseScreen.style.display='';
}

function resumeGame(){
  if(!state.paused) return;
  state.paused=false;
  pauseScreen.style.display='none';
  if(!state.isDemo){ audioEl.play(); if(bgVideo.src) bgVideo.play(); }
  requestAnimationFrame(loop);
}

// Main loop
function loop(now){
  if(!state.running||state.paused) return;

  // Time sync: use audio.currentTime when available for accuracy
  let elapsed;
  if(!state.isDemo && audioEl.src && !audioEl.paused && audioEl.currentTime>0){
    elapsed = audioEl.currentTime*1000 + AUDIO_OFFSET;
  } else {
    elapsed = now - state.startTime;
  }

  // Spawn
  while(state.beatmapIdx < state.beatmap.length){
    const note = state.beatmap[state.beatmapIdx];
    const travelMs = (state.hitY/ARROW_SPEED)*1000;
    if(elapsed >= note.time - travelMs){ spawnArrow(note.lane, note.time); state.beatmapIdx++; }
    else break;
  }

  updateSubtitle(elapsed);
  updateArrows(elapsed);
  checkMisses(elapsed);
  updateHUD(elapsed);

  const lastT = state.beatmap[state.beatmap.length-1]?.time||0;
  if(elapsed > lastT+2500 && state.arrows.length===0 && state.beatmapIdx>=state.beatmap.length){
    endGame(); return;
  }

  requestAnimationFrame(loop);
}

function spawnArrow(laneIdx, hitTime){
  const key=Object.keys(KEYS)[laneIdx];
  const laneEl=document.getElementById('lane-'+key);
  const el=document.createElement('div');
  el.className=`arrow ${COLORS[laneIdx]}`;
  el.textContent='>';
  el.style.top='-32px';
  laneEl.appendChild(el);
  state.arrows.push({el,lane:laneIdx,hitTime,hit:false,missed:false});
}

function updateArrows(elapsed){
  for(const a of state.arrows){
    if(a.hit||a.missed) continue;
    const travelMs=(state.hitY/ARROW_SPEED)*1000;
    const frac=1-(a.hitTime-elapsed)/travelMs;
    const y=Math.min(frac*state.hitY, state.laneHeight);
    a.el.style.top=y+'px';
  }
  state.arrows=state.arrows.filter(a=>{
    if((a.hit||a.missed)&&a.el.parentNode){a.el.remove();return false;}
    return true;
  });
}

function checkMisses(elapsed){
  for(const a of state.arrows){
    if(a.hit||a.missed) continue;
    if(elapsed-a.hitTime > HIT_WINDOW.miss){
      a.missed=true;
      a.el.style.opacity='0.1';
      registerMiss(a.lane);
    }
  }
}

// Input
document.addEventListener('keydown', e=>{
  if(e.key==='Escape'){ if(state.running&&!state.paused) pauseGame(); else if(state.paused) resumeGame(); return; }
  if(e.key==='p'||e.key==='P'){ if(state.running&&!state.paused) pauseGame(); else if(state.paused) resumeGame(); return; }
  if(e.repeat) return;
  const key=e.key.toLowerCase();
  if(!(key in KEYS)) return;
  if(!state.running||state.paused) return;
  document.getElementById('lane-'+key)?.classList.add('active');
  hitLane(KEYS[key], key);
});
document.addEventListener('keyup', e=>{
  const key=e.key.toLowerCase();
  document.getElementById('lane-'+key)?.classList.remove('active');
});

function hitLane(laneIdx){
  let elapsed;
  if(!state.isDemo && audioEl.src && !audioEl.paused && audioEl.currentTime>0){
    elapsed=audioEl.currentTime*1000+AUDIO_OFFSET;
  } else {
    elapsed=performance.now()-state.startTime;
  }
  let best=null,bestDiff=Infinity;
  for(const a of state.arrows){
    if(a.lane!==laneIdx||a.hit||a.missed) continue;
    const diff=Math.abs(elapsed-a.hitTime);
    if(diff<bestDiff){bestDiff=diff;best=a;}
  }
  if(!best||bestDiff>HIT_WINDOW.miss) return;
  best.hit=true; best.el.style.opacity='0';
  if(bestDiff<=HIT_WINDOW.perfect){ state.perfect++; registerHit('PERFECT',laneIdx,300); }
  else { state.good++; registerHit('GOOD',laneIdx,100); }
}

function registerHit(type,laneIdx,pts){
  state.combo++;
  state.maxCombo=Math.max(state.maxCombo,state.combo);
  state.score+=pts*Math.min(state.combo,10);
  state.health=Math.min(100,state.health+2);
  const color=type==='PERFECT'?COLOR_HEX[laneIdx]:'#ffbe0b';
  showHitFx(laneIdx,type,color);
  spawnParticles(laneIdx,color);
  flashSubtitle();
  updateHealth();
  if(state.noMiss&&state.combo>=10) fcNotice.style.display='block';
}

function registerMiss(laneIdx){
  state.miss++;state.combo=0;state.noMiss=false;
  state.health=Math.max(0,state.health-10);
  fcNotice.style.display='none';
  showHitFx(laneIdx,'MISS','#ff006e');
  updateHealth();
}

function spawnParticles(laneIdx,color){
  const key=Object.keys(KEYS)[laneIdx];
  const laneEl=document.getElementById('lane-'+key);
  const hz=laneEl.querySelector('.hit-zone');
  const lr=laneEl.getBoundingClientRect();
  const hr=hz.getBoundingClientRect();
  const cx=hr.left-lr.left+hr.width/2;
  const cy=hr.top-lr.top+hr.height/2;
  for(let i=0;i<7;i++){
    const p=document.createElement('div');
    p.className='particle';
    const angle=(i/7)*Math.PI*2;
    const dist=18+Math.random()*18;
    p.style.cssText=`left:${cx}px;top:${cy}px;background:${color};--dx:${Math.cos(angle)*dist}px;--dy:${Math.sin(angle)*dist}px;`;
    laneEl.appendChild(p);
    setTimeout(()=>p.remove(),520);
  }
}

function showHitFx(laneIdx,text,color){
  const key=Object.keys(KEYS)[laneIdx];
  const laneEl=document.getElementById('lane-'+key);
  const eff=document.createElement('div');
  eff.className='hit-effect'; eff.textContent=text; eff.style.color=color;
  laneEl.appendChild(eff);
  setTimeout(()=>eff.remove(),500);
}

function flashSubtitle(){
  if(!subtitleEl) return;
  subtitleEl.classList.remove('flash');
  void subtitleEl.offsetWidth;
  subtitleEl.classList.add('flash');
}

function updateSubtitle(elapsed){
  if(!subtitleEl || !state.subtitles || !state.subtitles.length) return;
  for(const sub of state.subtitles){
    if(elapsed>=sub.time && elapsed<sub.time+(sub.duration||3000)){
      if(subtitleEl.dataset.subTime!==String(sub.time)){
        subtitleEl.textContent=sub.text;
        subtitleEl.dataset.subTime=sub.time;
      }
      return;
    }
  }
}

function updateHealth(){
  healthBar.style.height=state.health+'%';
  healthBar.style.background = state.health>60
    ? 'linear-gradient(to top,#06d6a0,#00f5ff)'
    : state.health>30
    ? 'linear-gradient(to top,#ffbe0b,#00f5ff)'
    : 'linear-gradient(to top,#ff006e,#ff4444)';
}

function updateHUD(elapsed){
  scoreEl.textContent=String(state.score).padStart(6,'0');
  comboEl.textContent=state.combo;
  const hit=state.perfect+state.good+state.miss;
  const acc=hit===0?100:Math.round(((state.perfect+state.good*0.5)/hit)*100);
  document.getElementById('acc-num').textContent=acc+'%';
  const lastT=state.beatmap[state.beatmap.length-1]?.time||1;
  progressEl.style.width=Math.min(100,(elapsed/lastT)*100)+'%';
  if(timingEl) {
    const s=Math.floor(elapsed/1000);
    timingEl.textContent=`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  }
}

function endGame(){
  state.running=false;
  audioEl.pause();
  if(bgVideo.src) bgVideo.pause();
  fcNotice.style.display='none';

  const hit=state.perfect+state.good+state.miss;
  const acc=hit===0?100:Math.round(((state.perfect+state.good*0.5)/hit)*100);
  let grade='D';
  if(acc>=95)grade='S'; else if(acc>=90)grade='A'; else if(acc>=80)grade='B'; else if(acc>=70)grade='C';
  if(state.noMiss&&state.miss===0&&acc>=95) grade='SS';

  const gradeEl=document.getElementById('result-grade');
  gradeEl.textContent=grade;
  gradeEl.style.color=grade.startsWith('S')?'#ffbe0b':grade==='A'?'#00f5ff':grade==='B'?'#06d6a0':'#ff006e';
  document.getElementById('res-score').textContent=state.score.toLocaleString();
  document.getElementById('res-combo').textContent=state.maxCombo;
  document.getElementById('res-acc').textContent=acc+'%';
  document.getElementById('res-perfect').textContent=state.perfect;
  document.getElementById('res-good').textContent=state.good;
  document.getElementById('res-miss').textContent=state.miss;
  resultScreen.style.display='';
}

window.addEventListener('resize', computeHitY);
computeHitY();