'use strict';
/* Soundz visualizer: the strip above the grid + its editor sheet.
   Uses ctx / master / analyser / audioCtx / playSound / sounds / editMode / prefs / toast from app.js. */
(() => {
const $ = id => document.getElementById(id);
function audio() { return audioCtx(); }
let tileColor = '#ffffff';
window.onSoundPlayed = s => { if (s && s.color) tileColor = s.color; };

/* ---------------- Settings model ---------------- */
// Only the Wave style is left; old saved settings from other styles are ignored
const DEFAULT = {"style":"wave","height":50,"lineWidth":3.5,"colorMode":"gradient","color1":"#ffffff","color2":"#ffffff","glow":24,"opacity":1,"sensitivity":0.7,"waveWindow":61,"waveCalm":0.65,"waveLock":false};

function loadSaved() {
  try {
    const v = localStorage.getItem('soundz-viz');
    if (v) {
      const o = JSON.parse(v), out = { ...DEFAULT };
      for (const k of Object.keys(DEFAULT)) if (k in o) out[k] = o[k];
      out.style = 'wave';
      return out;
    }
  } catch (_) {}
  return { ...DEFAULT };
}
let saved = loadSaved();   // what the app is using
let S = { ...saved };      // what the editor is showing right now

function noiseBuf(c) {
  if (noiseBuf.b) return noiseBuf.b;
  const b = c.createBuffer(1, c.sampleRate, c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return (noiseBuf.b = b);
}
function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

const SYNTHS = {
  kick(c, t) {
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    env(g, t, 0.003, 1, 0.35); o.connect(g).connect(master); o.start(t); o.stop(t + 0.4);
  },
  snare(c, t) {
    const n = c.createBufferSource(); n.buffer = noiseBuf(c);
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1200;
    const g = c.createGain(); env(g, t, 0.002, 0.6, 0.18);
    n.connect(f).connect(g).connect(master); n.start(t); n.stop(t + 0.25);
    const o = c.createOscillator(), og = c.createGain(); o.frequency.value = 190;
    env(og, t, 0.002, 0.4, 0.08); o.connect(og).connect(master); o.start(t); o.stop(t + 0.12);
  },
  hat(c, t) {
    const n = c.createBufferSource(); n.buffer = noiseBuf(c);
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
    const g = c.createGain(); env(g, t, 0.001, 0.3, 0.05);
    n.connect(f).connect(g).connect(master); n.start(t); n.stop(t + 0.08);
  },
  bass(c, t, note = 41.2) {
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = note;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(140, t + 0.3);
    const g = c.createGain(); env(g, t, 0.005, 0.45, 0.32);
    o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + 0.4);
  },
  horn(c, t) {
    for (const fr of [440, 554, 659]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr;
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.03);
      g.gain.setValueAtTime(0.16, t + 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(g).connect(master); o.start(t); o.stop(t + 0.95);
    }
  },
  laser(c, t) {
    const o = c.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(2400, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.35);
    const g = c.createGain(); env(g, t, 0.002, 0.25, 0.35);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.4);
  },
};

const BPM = 112, STEP = 60 / BPM / 4;
const PATTERN = {
  kick:  'x...x...x...x..x',
  snare: '....x.......x...',
  hat:   'x.x.x.x.x.x.x.xx',
  bass:  'x..x..x...x..x..',
};
const BASSLINE = [41.2, 41.2, 49, 55, 41.2, 36.7];
function scheduler() {
  const c = ctx;
  while (nextT < c.currentTime + 0.12) {
    for (const [k, p] of Object.entries(PATTERN)) {
      if (p[step] === 'x') {
        if (k === 'bass') SYNTHS.bass(c, nextT, BASSLINE[(step >> 2) % BASSLINE.length]);
        else SYNTHS[k](c, nextT);
      }
    }
    if (step === 0 && Math.random() < 0.25) SYNTHS.laser(c, nextT + STEP * 8);
    step = (step + 1) % 16; nextT += STEP;
  }
}

let beatOn = false, nextT = 0, step = 0, sched;

/* ---------------- Drawing ---------------- */
const cv = document.getElementById('viz');
const g = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
function sizeCanvas() {
  cv.style.height = S.height + 'px';
  DPR = window.devicePixelRatio || 1;
  const r = cv.getBoundingClientRect();
  W = cv.width = Math.round(r.width * DPR);
  H = cv.height = Math.round(S.height * DPR);
}
window.addEventListener('resize', sizeCanvas);

let wave = new Uint8Array(4096);

function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function forTheme(c) {
  if (document.documentElement.dataset.theme !== 'light' || !c || c[0] !== '#') return c;
  const [r, gg, b] = hexRgb(c);
  return (0.299 * r + 0.587 * gg + 0.114 * b) > 215 ? '#2b2b33' : c;
}
function frame(now) {
  const real = S;
  S = { ...S, color1: forTheme(S.color1), color2: forTheme(S.color2) };
  try { frameInner(now); } finally { S = real; }
}
function frameInner() {
  g.clearRect(0, 0, W, H);
  g.globalAlpha = S.opacity;
  g.shadowBlur = S.glow * DPR;
  drawWave();
  g.shadowBlur = 0; g.globalAlpha = 1;
  requestAnimationFrame(frame);
}

let wavePts = null;
function drawWave() {
  const pts = Math.max(64, Math.round(W / DPR));
  if (!wavePts || wavePts.length !== pts) wavePts = new Float32Array(pts);
  if (ctx) {
    analyser.getByteTimeDomainData(wave);
    const sr = ctx.sampleRate;
    const span = Math.min(wave.length / 2, Math.max(32, Math.round(S.waveWindow / 1000 * sr)));
    // "Hold steady": start each frame at a rising zero crossing so the shape doesn't jitter
    let start = 0;
    if (S.waveLock) {
      for (let i = 1; i < wave.length - span; i++) {
        if (wave[i - 1] < 128 && wave[i] >= 128) { start = i; break; }
      }
    }
    const k = S.waveCalm;
    for (let i = 0; i < pts; i++) {
      const v = (wave[start + Math.floor(i * span / pts)] - 128) / 128;
      wavePts[i] = wavePts[i] * k + v * (1 - k);
    }
  } else {
    wavePts.fill(0);
  }
  g.beginPath();
  for (let i = 0; i < pts; i++) {
    const v = wavePts[i] * S.sensitivity;
    const x = i * W / (pts - 1);
    const y = H / 2 - Math.max(-1, Math.min(1, v)) * (H / 2 - S.lineWidth * DPR);
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.lineWidth = S.lineWidth * DPR; g.lineJoin = 'round';
  const col = S.colorMode === 'rainbow'
    ? (() => { const l = g.createLinearGradient(0, 0, W, 0); for (let k = 0; k <= 6; k++) l.addColorStop(k / 6, `hsl(${k * 60},90%,60%)`); return l; })()
    : S.colorMode === 'gradient' ? (() => { const l = g.createLinearGradient(0, 0, W, 0); l.addColorStop(0, S.color1); l.addColorStop(1, S.color2); return l; })()
    : (S.colorMode === 'tile' ? tileColor : S.color1);
  g.strokeStyle = col; g.shadowColor = S.colorMode === 'tile' ? tileColor : S.color1;
  g.stroke();
}

/* ---------------- Editor sheet ---------------- */
let sheetOpen = false, snapshot = null;
const sheet = $('vSheet');

function openSheet() {
  snapshot = JSON.stringify(saved);
  S = { ...saved };
  sheetOpen = true;
  sheet.hidden = false; sheet.classList.remove('tall');
  document.body.classList.add('viz-open');
  rebuildTestRow();
  refresh();
}
function closeSheet() {
  sheetOpen = false;
  sheet.hidden = true;
  document.body.classList.remove('viz-open');
  stopBeat();
}
const isDirty = () => JSON.stringify(S) !== snapshot;

$('vSave').addEventListener('click', () => {
  saved = { ...S };
  try { localStorage.setItem('soundz-viz', JSON.stringify(saved)); } catch (_) {}
  closeSheet(); toast('Visualizer saved');
});
$('vCancel').addEventListener('click', tryCancel);
function tryCancel() {
  if (isDirty()) { $('vConfirm').hidden = false; return; }
  S = { ...saved }; closeSheet(); sizeCanvas();
}
$('vKeep').addEventListener('click', () => { $('vConfirm').hidden = true; });
$('vDiscard').addEventListener('click', () => {
  $('vConfirm').hidden = true; S = { ...saved }; closeSheet(); sizeCanvas();
});

/* Grabber: tap to make the sheet taller/shorter, swipe down to close */
(() => {
  const grab = $('vGrab'); let y0 = null, moved = 0;
  grab.addEventListener('pointerdown', e => { y0 = e.clientY; moved = 0; grab.setPointerCapture(e.pointerId); });
  grab.addEventListener('pointermove', e => { if (y0 != null) moved = e.clientY - y0; });
  grab.addEventListener('pointerup', () => {
    if (y0 == null) return;
    if (moved > 70) { sheet.classList.contains('tall') ? sheet.classList.remove('tall') : tryCancel(); }
    else if (moved < -40) sheet.classList.add('tall');
    else if (Math.abs(moved) < 6) sheet.classList.toggle('tall');
    y0 = null;
  });
})();

/* Try it row: demo beat + your sounds */
const testRow = $('vTest');
const beatChip = document.createElement('button');
beatChip.className = 'chip test'; beatChip.type = 'button';
beatChip.innerHTML = '<span class="live"></span><span class="t">Play beat</span>';
beatChip.addEventListener('click', () => beatOn ? stopBeat() : startBeat());
// (demo beat removed: you test with your own sounds)
function rebuildTestRow() {
  testRow.replaceChildren();
  for (const s of sounds) {
    const ch = document.createElement('button');
    ch.className = 'chip'; ch.type = 'button'; ch.style.setProperty('--c', s.color);
    const sw = document.createElement('span'); sw.className = 'sw';
    ch.append(sw, document.createTextNode(s.name));
    ch.addEventListener('pointerdown', () => playSound(s));
    testRow.appendChild(ch);
  }
}
function startBeat() {
  const c = audio(); beatOn = true; nextT = c.currentTime + 0.05; step = 0;
  sched = setInterval(scheduler, 25);
  beatChip.classList.add('on'); beatChip.querySelector('.t').textContent = 'Stop beat';
}
function stopBeat() {
  beatOn = false; clearInterval(sched);
  beatChip.classList.remove('on'); beatChip.querySelector('.t').textContent = 'Play beat';
}

/* ---------------- Controls ---------------- */
const pct = v => Math.round(v * 100) + '%';
const CONTROLS = {
  'vg-style': [
    { k: 'lineWidth', label: 'Line width', type: 'range', min: 1, max: 10, step: 0.5, fmt: v => v + 'px' },
    { k: 'waveWindow', label: 'Zoom', hint: 'How much of the sound fits across', type: 'range', min: 3, max: 80, step: 1, fmt: v => v + ' ms' },
    { k: 'waveCalm', label: 'Calm', hint: 'Higher is slower and smoother', type: 'range', min: 0, max: 0.97, step: 0.01, fmt: pct },
    { k: 'waveLock', label: 'Hold steady', type: 'switch' },
  ],
  'vg-look': [
    { k: 'height', label: 'Height', type: 'range', min: 30, max: 200, step: 5, fmt: v => v + 'px' },
    { k: 'colorMode', label: 'Color', type: 'seg', options: [['solid','Solid'],['gradient','Gradient'],['rainbow','Rainbow'],['tile','Pad']] },
    { k: 'colors', label: 'Colors', type: 'colors' },
    { k: 'glow', label: 'Glow', type: 'range', min: 0, max: 30, step: 1 },
    { k: 'opacity', label: 'Opacity', type: 'range', min: 0.2, max: 1, step: 0.05, fmt: pct },
    { k: 'sensitivity', label: 'Sensitivity', type: 'range', min: 0.3, max: 3, step: 0.05, fmt: v => v.toFixed(2) + '×' },
  ],
};

const refreshers = [];
for (const [gid, list] of Object.entries(CONTROLS)) {
  const grp = $(gid);
  for (const c of list) {
    const row = document.createElement('div');
    row.className = 'ctl';
    const id = 'c-' + c.k;
    const title = c.hint ? `${c.label}<span style="display:block;font-weight:500;font-size:12.5px;color:var(--muted)">${c.hint}</span>` : c.label;
    if (c.type === 'range') {
      row.innerHTML = `<label for="${id}">${title}</label><output></output><input id="${id}" type="range" min="${c.min}" max="${c.max}" step="${c.step}">`;
      const inp = row.querySelector('input'), out = row.querySelector('output');
      const show = () => { out.textContent = c.fmt ? c.fmt(+inp.value) : inp.value; };
      inp.addEventListener('input', () => { S[c.k] = +inp.value; show(); changed(); });
      refreshers.push(() => { inp.value = S[c.k]; show(); });
    } else if (c.type === 'seg') {
      row.innerHTML = `<span class="lbl">${title}</span><span></span><div class="seg" role="group" aria-label="${c.label}"></div>`;
      const seg = row.querySelector('.seg');
      for (const [val, text] of c.options) {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = text; b.id = id + '-' + val;
        b.addEventListener('click', () => { S[c.k] = val; changed(); refresh(); });
        seg.appendChild(b);
        refreshers.push(() => b.setAttribute('aria-pressed', String(S[c.k] === val)));
      }
    } else if (c.type === 'switch') {
      row.innerHTML = `<label for="${id}">${title}</label><input id="${id}" type="checkbox" class="switch">`;
      const inp = row.querySelector('input');
      inp.addEventListener('change', () => { S[c.k] = inp.checked; changed(); });
      refreshers.push(() => { inp.checked = !!S[c.k]; });
    } else if (c.type === 'colors') {
      row.innerHTML = `<span class="lbl">${title}</span><span class="colors"><input id="c-color1" type="color" aria-label="First color"><input id="c-color2" type="color" aria-label="Second color"></span>`;
      const [a, b] = row.querySelectorAll('input');
      a.addEventListener('input', () => { S.color1 = a.value; changed(); });
      b.addEventListener('input', () => { S.color2 = b.value; changed(); });
      refreshers.push(() => {
        a.value = S.color1; b.value = S.color2;
        row.hidden = !(S.colorMode === 'solid' || S.colorMode === 'gradient');
        b.hidden = S.colorMode !== 'gradient';
      });
    }
    grp.appendChild(row);
  }
}
refreshers.push(() => {
  $('vSave').classList.toggle('dirty', sheetOpen && isDirty());
});

function refresh() { for (const f of refreshers) f(); sizeCanvas(); }
function changed() {
  sizeCanvas();
  $('vSave').classList.toggle('dirty', isDirty());
}

$('vReset').addEventListener('click', () => { S = { ...DEFAULT }; changed(); refresh(); toast('Back to default'); });

/* ---------------- Hook into the app ---------------- */
const vizWrap = $('vizWrap');
vizWrap.addEventListener('click', () => { if (editMode && !sheetOpen) openSheet(); });

function applyVisibility() {
  vizWrap.hidden = !prefs.get('showViz', true);
  sizeCanvas();
}
const optViz = $('optViz');
optViz.checked = prefs.get('showViz', true);
optViz.addEventListener('change', () => { prefs.set('showViz', optViz.checked); applyVisibility(); });

S = { ...saved };
applyVisibility();
refresh();
requestAnimationFrame(frame);
})();
