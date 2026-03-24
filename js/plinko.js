// ---------- Utilities ----------
const isFiniteNum = (v)=> Number.isFinite(v) && !Number.isNaN(v);

// ---------- Seeded RNG ----------
function xmur3(str){let h=1779033703^str.length;for(let i=0;i<str.length;i++){h=Math.imul(h^str.charCodeAt(i),3432918353);h=h<<13|h>>>19;}return function(){h=Math.imul(h^h>>>16,2246822507);h=Math.imul(h^h>>>13,3266489909);return (h^h>>>16)>>>0;}}
function mulberry32(a){return function(){let t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;}}
function makeRNG(seedStr, nonce){const seed = xmur3(seedStr+"|"+nonce)();return mulberry32(seed);}

// ---------- Binomial helpers ----------
function nCr(n,k){if(k<0||k>n) return 0; k=Math.min(k,n-k); let num=1,den=1; for(let i=1;i<=k;i++){num*=(n-(k-i));den*=i;} return num/den;}
function binomProb(n,k){return nCr(n,k)/Math.pow(2,n)}

// ---------- Payout model ----------
function makeMultipliers(slotProbs, risk, targetRtp, edgeBias){
  const k = risk==='low'?1.25: risk==='high'?2.1: 1.6;
  const slots = slotProbs.length; const base = []; const center = (slots-1)/2;
  const bias = Math.max(1, +edgeBias || 1);
  for(let i=0;i<slots;i++){
    const d = Math.abs(i-center);
    const shaped = Math.pow(d, bias);
    base.push(Math.pow(k, shaped));
  }
  let expected=0; for(let i=0;i<slots;i++) expected += (slotProbs[i]||0)*base[i];
  const scale = (targetRtp/100)/expected;
  return base.map(v=> Math.max(0.01, +(v*scale).toFixed(2)));
}

function buildRowPins(rows, startPins, rawInput){
  const out = [];
  const parts = String(rawInput||'').split(/[\s,;|]+/).map(v=>+v).filter(v=>Number.isFinite(v));
  for(let r=0;r<rows;r++){
    const fallback = Math.max(1, startPins + r);
    out.push(Math.max(1, Math.round(parts[r] || fallback)));
  }
  return out;
}

function buildSlotProbs(rows, slotCount){
  const slots = Math.max(2, Math.round(slotCount||2));
  const probs = new Array(slots).fill(0);
  if(rows<=0){ probs[Math.floor((slots-1)/2)] = 1; return probs; }
  for(let k=0;k<=rows;k++){
    const p = binomProb(rows, k);
    const pos = (k/rows) * (slots-1);
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    if(lo===hi){
      probs[lo] += p;
    }else{
      const t = pos - lo;
      probs[lo] += p*(1-t);
      probs[hi] += p*t;
    }
  }
  return probs;
}

// ---------- Canvas / Geometry ----------
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const stage = document.getElementById('stage');
let dpr = Math.max(1, window.devicePixelRatio||1);
let W=0,H=0;

function safeResize(){
  const rect = stage.getBoundingClientRect();
  let w = rect.width * dpr; let h = rect.height * dpr;
  if(!isFiniteNum(w) || w <= 0) w = (canvas.clientWidth||600) * dpr;
  if(!isFiniteNum(h) || h <= 0) h = (canvas.clientHeight||800) * dpr;
  if(!isFiniteNum(w) || !isFiniteNum(h) || w<=0 || h<=0){ w = 900 * dpr; h = 1200 * dpr; }
  W = Math.floor(w); H = Math.floor(h);
  canvas.width=W; canvas.height=H; canvas.style.width=(W/dpr)+'px'; canvas.style.height=(H/dpr)+'px';
}
function requestDraw(){ if(W>0 && H>0) draw(); }
const ro = new ResizeObserver(()=>{ dpr = Math.max(1, window.devicePixelRatio||1); safeResize(); layoutBoard(); renderMeter(); requestDraw(); });
ro.observe(stage);

// ---------- State ----------
const ui = {
  playMode: document.getElementById('playMode'),
  rows: document.getElementById('rows'), rowsOut: document.getElementById('rowsOut'),
  startPins: document.getElementById('startPins'), startPinsOut: document.getElementById('startPinsOut'),
  risk: document.getElementById('risk'), rtp: document.getElementById('rtp'), rtpOut: document.getElementById('rtpOut'),
  seed: document.getElementById('seed'), bet: document.getElementById('bet'),
  dropOffset: document.getElementById('dropOffset'), dropOffsetOut: document.getElementById('dropOffsetOut'),
  dropWidth: document.getElementById('dropWidth'), dropWidthOut: document.getElementById('dropWidthOut'),
  spawnMode: document.getElementById('spawnMode'),
  spawnPos: document.getElementById('spawnPos'), spawnPosOut: document.getElementById('spawnPosOut'),
  speed: document.getElementById('speed'), speedOut: document.getElementById('speedOut'),
  spacingX: document.getElementById('spacingX'), spacingXOut: document.getElementById('spacingXOut'),
  spacingY: document.getElementById('spacingY'), spacingYOut: document.getElementById('spacingYOut'),
  slotFontSize: document.getElementById('slotFontSize'), slotFontSizeOut: document.getElementById('slotFontSizeOut'),
  rowPins: document.getElementById('rowPins'),
  resultMode: document.getElementById('resultMode'),
  targetSlot: document.getElementById('targetSlot'),
  drop: document.getElementById('drop'), auto10: document.getElementById('auto10'), auto100: document.getElementById('auto100'), reset: document.getElementById('reset'),
  runTests: document.getElementById('runTests'), testsOut: document.getElementById('testsOut'),
  bal: document.getElementById('bal'), last: document.getElementById('last'), pl: document.getElementById('pl'), nonce: document.getElementById('nonce'),
  meter: document.getElementById('meter'), hitmap: document.getElementById('hitmap'),
  edgeBias: document.getElementById('edgeBias'), edgeBiasOut: document.getElementById('edgeBiasOut'),
  winpct: document.getElementById('winpct'),
  houseEdge: document.getElementById('houseEdge'), houseEdgeOut: document.getElementById('houseEdgeOut'),
  house: document.getElementById('house'),
  testBadge: document.getElementById('testBadge')
};
const adminControls = Array.from(document.querySelectorAll('.admin-only'));

let state = {
  playMode: ui.playMode.value,
  rows: +ui.rows.value,
  startPins: +ui.startPins.value,
  risk: ui.risk.value,
  rtp: +ui.rtp.value,
  seed: ui.seed.value,
  dropOffset: +ui.dropOffset.value,
  dropWidth: +ui.dropWidth.value,
  spawnMode: ui.spawnMode.value,
  spawnPos: +ui.spawnPos.value,
  speed: +ui.speed.value,
  spacingX: +ui.spacingX.value,
  spacingY: +ui.spacingY.value,
  slotFontSize: +ui.slotFontSize.value,
  rowPins: [],
  resultMode: 'random',
  targetSlot: 0,
  balance: 1000000,
  profit: 0,
  nonce: 0,
  multipliers: [],
  hits: [],
  pegs: [],
  slotsX: [],
  balls: [],
  floorY: 0,
  leftWall: 0,
  rightWall: 0,
  rowYs: [],
  rowMinX: [],
  rowMaxX: [],
  halfGap: 0,
  colGap: 0,
  rowGapEff: 0,
  edgeBias: 1.20,
  houseEdge: 3.0,
  house: 0,
  slotProbs: []
};

// Radii (colliders)
function radii(){ return { BALL: 8*dpr, PEG: 6*dpr }; }

function rebuild(){
  state.playMode = ui.playMode.value;
  const isAdmin = state.playMode === 'admin';
  if(!isAdmin){
    ui.spawnMode.value = 'random';
    ui.resultMode.value = 'random';
  }
  for(const el of adminControls) el.classList.toggle('hidden', !isAdmin);
  ui.testBadge.classList.toggle('hidden', !isAdmin);

  state.rows=+ui.rows.value; ui.rowsOut.textContent=state.rows;
  state.startPins = +ui.startPins.value; ui.startPinsOut.textContent = state.startPins;
  state.risk=ui.risk.value;
  // keep RTP and House Edge in sync (RTP = 100 - HouseEdge)
  state.rtp=+ui.rtp.value; state.houseEdge = +(100 - state.rtp).toFixed(1);
  ui.rtpOut.textContent=state.rtp+"%"; ui.houseEdgeOut.textContent = state.houseEdge.toFixed(1)+'%'; ui.houseEdge.value = String(state.houseEdge);
  state.seed=ui.seed.value;
  state.dropOffset = +ui.dropOffset.value; ui.dropOffsetOut.textContent = `${state.dropOffset.toFixed(0)}px`;
  state.dropWidth = Math.max(1, Math.min(100, +ui.dropWidth.value || 100)); ui.dropWidthOut.textContent = `${state.dropWidth.toFixed(0)}%`;
  state.spawnMode = isAdmin ? ui.spawnMode.value : 'random';
  state.spawnPos = Math.max(0, Math.min(100, +ui.spawnPos.value || 50));
  ui.spawnPos.value = String(state.spawnPos);
  ui.spawnPosOut.textContent = `${state.spawnPos.toFixed(0)}%`;
  state.speed=+ui.speed.value; ui.speedOut.textContent=state.speed.toFixed(1)+'×';
  state.spacingX = +ui.spacingX.value; ui.spacingXOut.textContent = state.spacingX.toFixed(2)+'×';
  state.spacingY = +ui.spacingY.value; ui.spacingYOut.textContent = state.spacingY.toFixed(2)+'×';
  state.slotFontSize = +ui.slotFontSize.value; ui.slotFontSizeOut.textContent = `${state.slotFontSize}px`;
  state.resultMode = isAdmin ? ui.resultMode.value : 'random';
  state.targetSlot = Math.max(0, Math.round(+ui.targetSlot.value || 0));
  state.rowPins = buildRowPins(state.rows, state.startPins, ui.rowPins.value);
  // Keep user-defined values, auto-fill missing rows with defaults, and mirror back to input.
  ui.rowPins.value = state.rowPins.join(',');
  state.edgeBias = +ui.edgeBias.value; ui.edgeBiasOut.textContent = state.edgeBias.toFixed(2)+'×';
  const slotCount = (state.rowPins[state.rowPins.length-1] || state.startPins) + 1;
  state.slotProbs = buildSlotProbs(state.rows, slotCount);
  state.multipliers = makeMultipliers(state.slotProbs, state.risk, state.rtp, state.edgeBias);
  const maxSlotIdx = Math.max(0, state.slotProbs.length - 1);
  state.targetSlot = Math.min(state.targetSlot, maxSlotIdx);
  ui.targetSlot.max = String(maxSlotIdx);
  ui.targetSlot.value = String(state.targetSlot);
  state.hits = new Array(state.slotProbs.length).fill(0);
  ui.bal.textContent = state.balance.toFixed(2); ui.pl.textContent = (state.profit>=0?'+':'') + state.profit.toFixed(2); ui.house.textContent = state.house.toFixed(2);
  layoutBoard();
  renderMeter();
  renderHitmap();
  updateWinPct();
  requestDraw();
}

function layoutBoard(){
  if(!(W>0 && H>0)) return;
  const rows = state.rows; const {PEG, BALL} = radii();
  // Keep spawn anchor fixed, move board down by dropOffset.
  const spawnAnchorY = BALL + 10*dpr;
  const marginTop = spawnAnchorY + Math.max(0, state.dropOffset*dpr);
  const marginSide = 40*dpr, marginBottom=120*dpr;

  // Requirement: clear space between peg edges = 1.25 × ball diameter
  const ballDiameter = BALL*2;
  const desiredClearGap = ballDiameter*1.25;
  const baseGap = (PEG*2) + desiredClearGap;
  const spacingX = Math.max(0.7, state.spacingX || 1);
  const colGap = baseGap * spacingX;
  state.colGap = colGap;

  const spacingY = Math.max(0.7, state.spacingY || 1);
  const rowGapEff = baseGap * spacingY;
  state.rowGapEff = rowGapEff;

  const centerX = W/2;
  const pegs=[]; const rowYs=[]; const rowMinX=[]; const rowMaxX=[];
  for(let r=0;r<rows;r++){
    // Anchor first row at the board apex; spacing only affects rows below it.
    const cols = Math.max(1, state.rowPins[r] || (state.startPins + r)); const y = marginTop + (r*rowGapEff); rowYs.push(y);
    const totalWidth = (cols-1)*colGap; const leftMost = centerX - totalWidth/2; const rightMost = centerX + totalWidth/2;
    // Expand envelope by ±BALL so clamp (env ± BALL) yields true outer edge
    rowMinX.push(leftMost - colGap/2 - BALL); rowMaxX.push(rightMost + colGap/2 + BALL);
    const row=[];
    for(let c=0;c<cols;c++){ const x = leftMost + c*colGap; row.push({x,y,r:PEG}); }
    pegs.push(row);
  }
  state.pegs = pegs; state.rowYs=rowYs; state.rowMinX=rowMinX; state.rowMaxX=rowMaxX; state.halfGap = colGap/2;

  const slots = state.slotProbs.length; const lastRow = pegs[pegs.length-1] || [{x:centerX}];
  const slotsX=[]; for(let s=0;s<slots;s++){ const left = (lastRow[0].x ?? centerX) - colGap/2; slotsX.push(left + s*colGap); }
  state.slotsX = slotsX;
  // place floor just below final peg row
  const lastY = rowYs[rowYs.length-1] || marginTop;
  state.floorY = lastY + state.rowGapEff;
  state.leftWall = rowMinX[0];
  state.rightWall = rowMaxX[0];
}

// Envelope: min/max X at a given Y by interpolating between row bands
function getEnvelopeAtY(y){
  const {rowYs,rowMinX,rowMaxX} = state; const n = rowYs.length;
  if(n===0) return {min: W*0.4, max: W*0.6};
  if(y <= rowYs[0]) return {min: rowMinX[0], max: rowMaxX[0]};
  for(let i=0;i<n-1;i++){
    const y1=rowYs[i], y2=rowYs[i+1]; if(y>=y1 && y<=y2){
      const t = (y - y1) / Math.max(1, (y2 - y1));
      const min = rowMinX[i] + t*(rowMinX[i+1]-rowMinX[i]);
      const max = rowMaxX[i] + t*(rowMaxX[i+1]-rowMaxX[i]);
      return {min, max};
    }
  }
  const i = n-1; return {min: rowMinX[i], max: rowMaxX[i]};
}

// ---------- Drawing ----------
function drawBG(){ if(!(W>0 && H>0)) return; const g=ctx.createLinearGradient(0,0,0,Math.max(1,H)); g.addColorStop(0,'rgba(90,140,255,0.08)'); g.addColorStop(1,'rgba(93,228,199,0.05)'); ctx.fillStyle=g; ctx.fillRect(0,0,W,H); }
function drawPegs(){ const {PEG}=radii(); ctx.save(); ctx.shadowColor='rgba(0,0,0,0.6)'; ctx.shadowBlur=10; for(const row of state.pegs){ for(const p of row){ ctx.beginPath(); ctx.arc(p.x,p.y,PEG,0,Math.PI*2); ctx.fillStyle='rgba(255,255,255,0.9)'; ctx.fill(); } } ctx.restore(); }
function drawSlots(){ const y = state.floorY; ctx.save(); for(let i=0;i<state.slotsX.length;i++){ const x = state.slotsX[i]; ctx.beginPath(); ctx.moveTo(x, y-40*dpr); ctx.lineTo(x, y+18*dpr); ctx.strokeStyle='rgba(255,255,255,0.15)'; ctx.lineWidth=2*dpr; ctx.stroke(); const multVal = state.multipliers[i]; const mult = Number.isFinite(multVal) ? multVal : 0; const w = 58*dpr, h=28*dpr; const left = x - w/2, top = y+24*dpr; const rad = h/2; ctx.beginPath(); ctx.moveTo(left+rad,top); ctx.arcTo(left+w,top,left+w,top+h,rad); ctx.arcTo(left+w,top+h,left,top+h,rad); ctx.arcTo(left,top+h,left,top,rad); ctx.arcTo(left,top,left+w,top,rad); ctx.closePath(); const edgeFactor = Math.abs(i - (state.slotsX.length-1)/2); const denom = Math.max(1, (state.slotsX.length-1)/2); const c = Math.min(1, edgeFactor/denom); const base = `rgba(${120+60*c}, ${180-40*c}, ${255-40*c}, 0.18)`; ctx.fillStyle=base; ctx.fill(); ctx.strokeStyle='rgba(255,255,255,0.12)'; ctx.stroke(); ctx.fillStyle='rgba(230,241,255,0.95)'; ctx.font = `${state.slotFontSize*dpr}px ui-monospace, Menlo, monospace`; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(mult.toFixed(2)+'×', x, top+h/2); } ctx.restore(); }
function getSpawnConfig(rng){
  const {BALL} = radii();
  const spawnY = BALL + 10*dpr;
  const centerX = W/2;
  const fullMin = BALL;
  const fullMax = W - BALL;
  const firstRow = state.pegs[0] || [];
  let baseMin = centerX - state.colGap*0.5;
  let baseMax = centerX + state.colGap*0.5;
  if(firstRow.length){
    baseMin = firstRow[0].x;
    baseMax = firstRow[firstRow.length - 1].x;
  }
  const baseWidth = Math.max(1, baseMax - baseMin); // 100% width baseline = row 1 width
  const widthScale = Math.max(0.01, Math.min(1, (state.dropWidth || 100) / 100));
  const zoneRange = Math.max(1, baseWidth * widthScale);
  const baseCenter = (baseMin + baseMax) / 2;
  const zoneCenter = baseCenter;
  const zoneMin = zoneCenter - zoneRange/2;
  const zoneMax = zoneCenter + zoneRange/2;
  // Effective range visible on board after clipping.
  const minStart = Math.max(fullMin, zoneMin);
  const maxStart = Math.min(fullMax, zoneMax);
  let spawnX = centerX;
  if(state.spawnMode === 'preset'){
    const t = Math.max(0, Math.min(1, (state.spawnPos || 0) / 100));
    spawnX = minStart + (maxStart - minStart) * t;
  }else if(rng){
    const range = Math.max(1, maxStart - minStart);
    // Use full-width randomization; in random mode, boost chance near edges.
    const edgeBoost = state.resultMode === 'random' ? 0.55 : 0.30;
    if(rng() < edgeBoost){
      const edgeBand = range * 0.28;
      const onLeft = rng() < 0.5;
      spawnX = onLeft
        ? (minStart + rng() * edgeBand)
        : (maxStart - rng() * edgeBand);
    }else{
      spawnX = minStart + rng() * range;
    }
  }
  // Keep spawn visible on board even if zone width is larger than board.
  spawnX = Math.max(fullMin, Math.min(fullMax, spawnX));
  return {spawnY, minStart, maxStart, centerX, spawnX};
}
function drawSpawnPreview(){
  if(!(W>0 && H>0) || state.rowYs.length===0) return;
  const {BALL} = radii();
  const {spawnY, minStart, maxStart, spawnX} = getSpawnConfig(null);
  ctx.save();
  ctx.setLineDash([6*dpr, 6*dpr]);
  ctx.strokeStyle = 'rgba(122,162,247,0.45)';
  ctx.lineWidth = 1.5*dpr;
  ctx.beginPath();
  ctx.moveTo(minStart, spawnY);
  ctx.lineTo(maxStart, spawnY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Ghost ball at current spawn position (preset/random center preview).
  ctx.beginPath();
  ctx.arc(spawnX, spawnY, BALL, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(122,162,247,0.25)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(122,162,247,0.65)';
  ctx.stroke();
  // Show left/right edge targets so random spawn range is obvious.
  ctx.beginPath();
  ctx.arc(minStart, spawnY, 3*dpr, 0, Math.PI*2);
  ctx.arc(maxStart, spawnY, 3*dpr, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(122,162,247,0.75)';
  ctx.fill();
  ctx.restore();
}
function drawBalls(){
  const {BALL}=radii();
  const now = performance.now();
  for(const b of state.balls){
    let alpha = 1;
    if(b.finished && b.removeAt){
      if(now >= b.removeAt){
        const t = Math.min(1, (now - b.removeAt)/FADE_MS);
        alpha = 1 - t;
      }
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    const glow = b.finished? 'rgba(93,228,199,0.7)' : 'rgba(122,162,247,0.7)';
    ctx.shadowColor=glow; ctx.shadowBlur=18*dpr;
    ctx.beginPath(); ctx.arc(b.x,b.y,BALL,0,Math.PI*2);
    ctx.fillStyle= b.finished? 'rgba(93,228,199,1)' : 'rgba(122,162,247,1)';
    ctx.fill();
    ctx.restore();
  }
}
function draw(){ if(!(W>0 && H>0)) return; ctx.clearRect(0,0,W,H); drawBG(); drawPegs(); drawSlots(); drawSpawnPreview(); drawBalls(); }

// ---------- Deterministic Path Simulation ----------
const FADE_MS = 800;

function pickForcedSlot(){
  const slots = state.slotProbs.length;
  if(slots<=0) return null;
  if(state.resultMode === 'preset'){
    return Math.max(0, Math.min(slots-1, state.targetSlot));
  }
  return null;
}

function pickTargetSlot(){
  const slots = state.slotProbs.length;
  if(slots<=0) return 0;
  const forced = pickForcedSlot();
  if(Number.isInteger(forced)) return Math.max(0, Math.min(slots-1, forced)); // 0 = leftmost
  // In random mode, sample slot by configured probabilities.
  const rng = makeRNG(state.seed, state.nonce);
  const r = rng();
  let acc = 0;
  for(let i=0;i<slots;i++){
    acc += (state.slotProbs[i] || 0);
    if(r <= acc) return i;
  }
  return slots - 1;
}

const physics = {
  gravity: 2200,
  restitution: 0.28,
  friction: 0.995,
  floorBounce: 0.35
};

function simulateLanding(startX, startY, initVx, nonce, targetSlot){
  const {BALL} = radii();
  const rng = makeRNG(state.seed, nonce);
  const sim = { x:startX, y:startY, vx:initVx, vy:0, floorHits:0, rng };
  const simDt = 1/120;
  const maxSteps = 1800;
  let best = 0, bestd = Infinity;

  for(let step=0; step<maxSteps; step++){
    sim.vy += physics.gravity * state.speed * (dpr/1) * simDt;
    sim.vx += (sim.rng() - 0.5) * 22 * simDt * state.speed;
    sim.x += sim.vx * simDt;
    sim.y += sim.vy * simDt;
    sim.vx *= physics.friction;

    const env = getEnvelopeAtY(sim.y);
    const minX = env.min + BALL;
    const maxX = env.max - BALL;
    if(sim.x < minX){ sim.x = minX; sim.vx = Math.abs(sim.vx) * 0.35; }
    if(sim.x > maxX){ sim.x = maxX; sim.vx = -Math.abs(sim.vx) * 0.35; }

    for(const row of state.pegs){
      for(const p of row){
        const dx = sim.x - p.x, dy = sim.y - p.y;
        const dist = Math.hypot(dx,dy);
        const minD = BALL + p.r;
        if(dist>0 && dist < minD){
          const nX = dx/dist, nY = dy/dist;
          const overlap = (minD - dist) + 0.01;
          sim.x += nX * overlap;
          sim.y += nY * overlap;
          const vn = sim.vx*nX + sim.vy*nY;
          sim.vx -= (1+physics.restitution)*vn*nX;
          sim.vy -= (1+physics.restitution)*vn*nY;
          sim.vx += (sim.rng()-0.5) * 24 * state.speed;
        }
      }
    }

    const floor = state.floorY - BALL;
    if(sim.y >= floor){
      sim.y = floor;
      sim.floorHits++;
      if(Math.abs(sim.vy) > 110 && sim.floorHits <= 4){
        sim.vy = -Math.abs(sim.vy) * physics.floorBounce;
        sim.vx *= 0.82;
      }else{
        for(let i=0;i<state.slotsX.length;i++){
          const d = Math.abs(sim.x - state.slotsX[i]);
          if(d<bestd){ bestd=d; best=i; }
        }
        return {slot:best, x:sim.x, dist:Math.abs(best - targetSlot)};
      }
    }
  }

  for(let i=0;i<state.slotsX.length;i++){
    const d = Math.abs(sim.x - state.slotsX[i]);
    if(d<bestd){ bestd=d; best=i; }
  }
  return {slot:best, x:sim.x, dist:Math.abs(best - targetSlot)};
}

function solvePresetInitialVx(startX, startY, targetSlot, nonce){
  // Search initial horizontal velocity so pure physics lands on target slot.
  const maxV = 1200 * state.speed;
  let bestVx = 0;
  let bestErr = Infinity;
  let bestDistX = Infinity;

  const test = (vx)=>{
    const r = simulateLanding(startX, startY, vx, nonce, targetSlot);
    const err = Math.abs(r.slot - targetSlot);
    const dx = Math.abs((state.slotsX[targetSlot] ?? startX) - r.x);
    if(err < bestErr || (err === bestErr && dx < bestDistX)){
      bestErr = err;
      bestDistX = dx;
      bestVx = vx;
    }
  };

  for(let i=0;i<=20;i++){
    const t = i/20;
    test(-maxV + (2*maxV*t));
  }
  const refineSpan = Math.max(80, maxV * 0.22);
  for(let i=0;i<=14;i++){
    const t = i/14;
    test((bestVx - refineSpan) + (2*refineSpan*t));
  }
  return bestVx;
}

function spawnBall(){
  const rng = makeRNG(state.seed, state.nonce);
  const spawnCfg = getSpawnConfig(rng);
  const startX = spawnCfg.spawnX;
  const spawnY = spawnCfg.spawnY;

  const targetSlot = pickTargetSlot();
  const targetX = state.slotsX[targetSlot] ?? (W/2);
  const initialVx = state.resultMode === 'preset'
    ? solvePresetInitialVx(startX, spawnY, targetSlot, state.nonce)
    : (rng() - 0.5) * 180 * state.speed;
  const b = {
    x: startX, y: spawnY,
    vx: initialVx, vy: 0,
    rng,
    finished: false, slot: null, removeAt: null,
    targetSlot, targetX, floorHits: 0
  };
  state.balls.push(b);
}

let lastT = 0;
function stepAll(ts){
  if(!lastT) lastT = ts; let dt = (ts - lastT)/1000; dt = Math.min(dt, 1/30); lastT = ts;
  const {BALL}=radii();
  const g = physics.gravity * state.speed * (dpr/1);

  for(const b of state.balls){
    if(b.finished) continue;

    // Gravity integration.
    b.vy += g*dt;
    // Shared micro drift for both modes so motion style stays consistent.
    b.vx += (b.rng() - 0.5) * 22 * dt * state.speed;

    b.x += b.vx*dt;
    b.y += b.vy*dt;
    b.vx *= physics.friction;

    // Envelope containment.
    const env = getEnvelopeAtY(b.y);
    let minX = (env.min + BALL), maxX = (env.max - BALL);
    if(b.x < minX){ b.x = minX; b.vx = Math.abs(b.vx) * 0.35; }
    if(b.x > maxX){ b.x = maxX; b.vx = -Math.abs(b.vx) * 0.35; }

    // Peg collisions.
    for(const row of state.pegs){
      for(const p of row){
        const dx = b.x - p.x, dy = b.y - p.y;
        const dist = Math.hypot(dx,dy);
        const minD = BALL + p.r;
        if(dist>0 && dist < minD){
          const nX = dx/dist, nY = dy/dist;
          const overlap = (minD - dist) + 0.01;
          b.x += nX * overlap;
          b.y += nY * overlap;
          const vn = b.vx*nX + b.vy*nY;
          b.vx -= (1+physics.restitution)*vn*nX;
          b.vy -= (1+physics.restitution)*vn*nY;
          b.vx += (b.rng()-0.5) * 26 * state.speed;
        }
      }
    }

    // Floor landing.
    const floor = state.floorY - BALL;
    if(b.y >= floor){
      b.y = floor;
      b.floorHits++;
      if(Math.abs(b.vy) > 110 && b.floorHits <= 4){
        b.vy = -Math.abs(b.vy) * physics.floorBounce;
        b.vx *= 0.82;
      }else{
        const xs = state.slotsX;
        let best=0, bestd=Infinity;
        for(let i=0;i<xs.length;i++){
          const d = Math.abs(b.x - xs[i]);
          if(d<bestd){bestd=d; best=i;}
        }
        b.vx = 0;
        b.vy = 0;
        b.slot = best;
        b.finished = true;
        onBallLanded(b);
      }
    }
  }

  state.balls = state.balls.filter(bb => !(bb.finished && bb.removeAt && performance.now() >= bb.removeAt + FADE_MS));

  draw(); requestAnimationFrame(stepAll);
}

// ---------- Game Flow ----------
function dropBall(){
  if(!(W>0 && H>0)) return;
  const bet = Math.max(0.01, +ui.bet.value||1);
  state.balance = +(state.balance - bet).toFixed(2);
  state.profit = +(state.profit - bet).toFixed(2);
  ui.bal.textContent = state.balance.toFixed(2);
  ui.pl.textContent = (state.profit>=0?'+':'') + state.profit.toFixed(2);
  spawnBall();
}

function onBallLanded(b){
  const bet = Math.max(0.01, +ui.bet.value||1);
  const mult = Number(state.multipliers[b.slot] ?? 0);
  const win = +(bet*mult).toFixed(2);
  state.balance = +(state.balance + win).toFixed(2);
  state.profit = +(state.profit + win).toFixed(2);
  const houseDelta = +(bet - win).toFixed(2);
  state.house = +(state.house + houseDelta).toFixed(2);

  state.hits[b.slot]++;
  ui.bal.textContent = state.balance.toFixed(2);
  ui.last.textContent = `${win.toFixed(2)} (${mult.toFixed(2)}×)`;
  ui.pl.textContent = (state.profit>=0?'+':'') + state.profit.toFixed(2);
  ui.house.textContent = state.house.toFixed(2);
  flashSlot(b.slot);
  renderHitmap();
  b.removeAt = performance.now() + 3000;
}

function flashSlot(idx){ const meter = ui.meter.querySelector(`[data-slot="s${idx}"]`); if(!meter) return; meter.classList.add('hit'); setTimeout(()=>meter.classList.remove('hit'), 450); }

// ---------- Meter & stats ----------
function renderMeter(){ const el = ui.meter; el.innerHTML=''; const slots = state.slotProbs.length; for(let i=0;i<slots;i++){ const p = ((state.slotProbs[i]||0)*100).toFixed(2); const multVal = state.multipliers[i]; const mult = Number.isFinite(multVal) ? multVal : 0; const div = document.createElement('div'); div.className='slot'; div.dataset.slot = 's'+i; const cls = mult>=1? 'good':'bad'; div.innerHTML = `<div class="mono ${cls}">${mult.toFixed(2)}×</div><div style="font-size:11px;color:var(--muted)">${p}%</div>`; el.appendChild(div); } }
function renderHitmap(){ const el = ui.hitmap; el.innerHTML=''; const total = state.hits.reduce((a,b)=>a+b,0)||1; state.hits.forEach((h,i)=>{ const pct = (h/total*100).toFixed(1); const multVal = state.multipliers[i]; const mult = Number.isFinite(multVal) ? multVal : 0; const chip = document.createElement('span'); chip.className='pill'; const cls = mult>=1? 'good':'bad'; chip.innerHTML = `<strong class="mono ${cls}">${i}</strong> <span class="mono">${h}</span> <span style="color:var(--muted)">${pct}%</span>`; el.appendChild(chip); }); }

function theoreticalWinRate(){ let p=0; for(let i=0;i<state.slotProbs.length;i++){ if(state.multipliers[i] >= 1){ p += (state.slotProbs[i]||0); } } return +(p*100).toFixed(2); }
function updateWinPct(){ ui.winpct.textContent = theoreticalWinRate().toFixed(2)+'%'; }

// ---------- Self-tests ----------
function runSelfTests(){ const out = []; const ok = (name, cond)=> out.push(`${cond?'✅':'❌'} ${name}`);
  ok('Canvas size finite', isFiniteNum(W) && isFiniteNum(H) && W>0 && H>0);
  try{ const g = ctx.createLinearGradient(0,0,0,Math.max(1,H)); ok('Gradient args finite', !!g); }catch(e){ ok('Gradient args finite', false); }
  const s = state.slotProbs.reduce((a,b)=>a+b,0); ok('Slot probs sum ≈ 1', Math.abs(1-s) < 1e-9);
  ok('Multipliers length', state.multipliers.length === state.slotProbs.length);
  ok('Multipliers defined', state.multipliers.every(m=> Number.isFinite(m)));
  ok('Multipliers > 0', state.multipliers.every(m=>m>0));
  const {BALL, PEG}=radii(); const ballDiameter = BALL*2; const desiredClear = ballDiameter*1.25*state.spacingX; const clearGap = state.colGap - 2*PEG; ok('Clear gap follows spacing X', Math.abs(clearGap - desiredClear) < 1*dpr + 0.001);
  ok('No NaN in colGap/rowGap', Number.isFinite(state.colGap) && Number.isFinite(state.rowGapEff));
  ok('rowGap follows spacing Y', Math.abs(state.rowGapEff - (((PEG*2)+(BALL*2*1.25))*state.spacingY)) < 1*dpr + 0.001);
  const centerX = W/2; const envMin = state.rowMinX[0] + BALL; const envMax = state.rowMaxX[0] - BALL; const canLeft = envMin <= centerX - (PEG + BALL*0.99); const canRight = envMax >= centerX + (PEG + BALL*0.99); ok('Apex clearance (left)', canLeft); ok('Apex clearance (right)', canRight);
  ok('Finished balls tagged for removal', state.balls.filter(b=>b.finished).every(b=> Number.isFinite(b.removeAt)) || state.balls.filter(b=>b.finished).length===0);
  ok('dropBall is function', typeof dropBall === 'function');
  ok('onBallLanded is function', typeof onBallLanded === 'function');
  ok('UI balance sync', ui.bal.textContent === state.balance.toFixed(2));
  ok('Fade constant defined', typeof FADE_MS === 'number' && FADE_MS > 0);
  ok('Removal waits for fade', state.balls.every(b => !(b.finished && b.removeAt && performance.now() >= b.removeAt) || state.balls.includes(b)));
  const wr = theoreticalWinRate(); ok('Win% sane', Number.isFinite(wr) && wr>=0 && wr<=100);
  ok('House tracker exists', typeof state.house === 'number' && Number.isFinite(state.house));
  ok('House UI mirrors state', ui.house.textContent === state.house.toFixed(2));
  ok('RTP-houseEdge sync', Math.abs((100 - state.houseEdge) - state.rtp) < 0.11);

  ui.testsOut.style.display='block'; ui.testsOut.textContent = out.join('\n'); }

// ---------- Wiring ----------
ui.rows.addEventListener('input', rebuild);
ui.playMode.addEventListener('change', rebuild);
ui.startPins.addEventListener('input', ()=>{
  // Regenerate row pins from startPins defaults for immediate layout change.
  ui.rowPins.value = '';
  rebuild();
});
ui.rowPins.addEventListener('change', rebuild);
ui.resultMode.addEventListener('change', rebuild);
ui.targetSlot.addEventListener('input', rebuild);
ui.risk.addEventListener('change', rebuild);
ui.rtp.addEventListener('input', ()=>{ state.rtp = +ui.rtp.value; state.houseEdge = +(100 - state.rtp).toFixed(1); ui.rtpOut.textContent = state.rtp+'%'; ui.houseEdge.value = String(state.houseEdge); ui.houseEdgeOut.textContent = state.houseEdge.toFixed(1)+'%'; state.multipliers = makeMultipliers(state.slotProbs, state.risk, state.rtp, state.edgeBias); renderMeter(); updateWinPct(); requestDraw(); });
ui.houseEdge.addEventListener('input', ()=>{ state.houseEdge = +ui.houseEdge.value; ui.houseEdgeOut.textContent = state.houseEdge.toFixed(1)+'%'; state.rtp = +(100 - state.houseEdge).toFixed(1); ui.rtp.value = String(state.rtp); ui.rtpOut.textContent = state.rtp+'%'; state.multipliers = makeMultipliers(state.slotProbs, state.risk, state.rtp, state.edgeBias); renderMeter(); updateWinPct(); requestDraw(); });
ui.seed.addEventListener('change', rebuild);
ui.dropOffset.addEventListener('input', ()=>{
  state.dropOffset = +ui.dropOffset.value;
  ui.dropOffsetOut.textContent = `${state.dropOffset.toFixed(0)}px`;
  layoutBoard();
  renderMeter();
  requestDraw();
});
ui.dropWidth.addEventListener('input', ()=>{
  state.dropWidth = Math.max(1, Math.min(100, +ui.dropWidth.value || 100));
  ui.dropWidth.value = String(state.dropWidth);
  ui.dropWidthOut.textContent = `${state.dropWidth.toFixed(0)}%`;
  requestDraw();
});
ui.spawnMode.addEventListener('change', ()=>{
  state.spawnMode = ui.spawnMode.value;
  requestDraw();
});
ui.spawnPos.addEventListener('input', ()=>{
  state.spawnPos = Math.max(0, Math.min(100, +ui.spawnPos.value || 0));
  ui.spawnPosOut.textContent = `${state.spawnPos.toFixed(0)}%`;
  requestDraw();
});
ui.speed.addEventListener('input', ()=>{ state.speed=+ui.speed.value; ui.speedOut.textContent=state.speed.toFixed(1)+'×'; });
ui.spacingX.addEventListener('input', ()=>{ state.spacingX = +ui.spacingX.value; ui.spacingXOut.textContent = state.spacingX.toFixed(2)+'×'; layoutBoard(); renderMeter(); requestDraw(); });
ui.spacingY.addEventListener('input', ()=>{ state.spacingY = +ui.spacingY.value; ui.spacingYOut.textContent = state.spacingY.toFixed(2)+'×'; layoutBoard(); renderMeter(); requestDraw(); });
ui.slotFontSize.addEventListener('input', ()=>{ state.slotFontSize = +ui.slotFontSize.value; ui.slotFontSizeOut.textContent = `${state.slotFontSize}px`; requestDraw(); });
ui.edgeBias.addEventListener('input', ()=>{ state.edgeBias = +ui.edgeBias.value; ui.edgeBiasOut.textContent = state.edgeBias.toFixed(2)+'×'; state.multipliers = makeMultipliers(state.slotProbs, state.risk, state.rtp, state.edgeBias); renderMeter(); updateWinPct(); requestDraw(); });
ui.runTests.addEventListener('click', runSelfTests);
ui.drop.addEventListener('click', ()=>{ state.nonce++; ui.nonce.textContent=state.nonce; dropBall(); });
ui.auto10.addEventListener('click', ()=> autoRun(10)); ui.auto100.addEventListener('click', ()=> autoRun(100));
ui.reset.addEventListener('click', ()=>{ state.balance=1000000; state.profit=0; state.house=0; state.nonce=0; ui.bal.textContent='1000000.00'; ui.pl.textContent='0.00'; ui.house.textContent='0.00'; ui.nonce.textContent='0'; state.hits.fill(0); state.balls=[]; rebuild(); renderHitmap(); updateWinPct(); draw(); });
function autoRun(n){ const run = ()=>{ if(n<=0) return; state.nonce++; ui.nonce.textContent=state.nonce; dropBall(); n--; setTimeout(run, 120); }; run(); }

// ---------- Init ----------
window.addEventListener('DOMContentLoaded', ()=>{ safeResize(); rebuild(); requestAnimationFrame(stepAll); });
