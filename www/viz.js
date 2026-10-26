'use strict';
/* Soundz visualizer: the strip above the grid + its editor sheet.
   Uses ctx / master / analyser / audioCtx / playSound / sounds / editMode / prefs / toast from app.js. */
(() => {
const $ = id => document.getElementById(id);
function audio() { return audioCtx(); }
let tileColor = '#ffffff';
window.onSoundPlayed = s => { if (s && s.color) tileColor = s.color; };

/* ---------------- Settings model ---------------- */
const DEFAULT = {"style":"wave","align":"bottom","bars":74,"gap":2,"height":50,"round":0.8,"lineWidth":3.5,"segments":16,"colorMode":"gradient","color1":"#ffffff","color2":"#ffffff","glow":24,"opacity":1,"sensitivity":0.7,"smoothing":0.62,"peaks":true,"peakFall":0.9,"idle":0,"lowHz":20,"highHz":20000,"logScale":true,"waveWindow":61,"waveCalm":0.65,"waveLock":false,"lineFill":"fade","fillStrength":0.35};

const W2 = { colorMode: 'gradient', color1: '#ffffff', color2: '#ffffff' };
const PRESETS = [
  ['Default', null],
  ['Classic bars', { ...DEFAULT, ...W2, style: 'bars', bars: 48, gap: 3, height: 70, round: 0.6, glow: 10, sensitivity: 1.4, smoothing: 0.75, idle: 2, lowHz: 40, highHz: 14000 }],
  ['Mirror', { ...DEFAULT, ...W2, style: 'bars', align: 'center', bars: 64, gap: 2, height: 70, round: 1, glow: 18, sensitivity: 1.6, smoothing: 0.75, idle: 2, lowHz: 40, highHz: 14000 }],
  ['LED meter', { ...DEFAULT, ...W2, style: 'blocks', bars: 24, gap: 4, height: 70, segments: 10, glow: 6, peaks: false, round: 0.2, sensitivity: 1.4, smoothing: 0.75, lowHz: 40, highHz: 14000 }],
  ['Soft line', { ...DEFAULT, ...W2, style: 'line', bars: 96, height: 60, lineWidth: 3, glow: 16, sensitivity: 1.4, smoothing: 0.82, idle: 2, lowHz: 40, highHz: 14000 }],
  ['Ring', { ...DEFAULT, ...W2, style: 'circle', bars: 64, gap: 2, height: 120, round: 1, glow: 14, sensitivity: 1.4, smoothing: 0.75, idle: 2, lowHz: 40, highHz: 14000 }],
  ['Dots', { ...DEFAULT, ...W2, style: 'dots', bars: 40, gap: 4, height: 60, glow: 12, sensitivity: 1.4, smoothing: 0.75, idle: 2, lowHz: 40, highHz: 14000 }],
];

function loadSaved() {
  try { const v = localStorage.getItem('soundz-viz'); if (v) return { ...DEFAULT, ...JSON.parse(v) }; } catch (_) {}
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

let freq = new Uint8Array(2048), wave = new Uint8Array(4096);
let vals = [], peaks = [], lastT = performance.now();

function bandEdges(n) {
  const sr = ctx ? ctx.sampleRate : 48000;
  const binHz = sr / 4096, maxBin = 2047;
  const edges = [];
  for (let i = 0; i <= n; i++) {
    const f = S.logScale
      ? S.lowHz * Math.pow(S.highHz / S.lowHz, i / n)
      : S.lowHz + (S.highHz - S.lowHz) * i / n;
    edges.push(Math.min(maxBin, Math.max(1, Math.round(f / binHz))));
  }
  return edges;
}

function readBars(n) {
  const out = new Array(n).fill(0);
  if (!ctx) return out;
  analyser.getByteFrequencyData(freq);
  const e = bandEdges(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    const a = e[i], b = Math.max(e[i + 1], a + 1);
    for (let j = a; j < b; j++) if (freq[j] > m) m = freq[j];
    // gentle tilt so highs aren't always tiny
    const tilt = 1 + 0.6 * (i / n);
    out[i] = Math.min(1, Math.pow(m / 255, 1.6) * S.sensitivity * tilt);
  }
  return out;
}

function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function mix(a, b, t) { const A = hexRgb(a), B = hexRgb(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`; }

function fillFor(i, n, v) {
  switch (S.colorMode) {
    case 'solid': return S.color1;
    case 'rainbow': return `hsl(${Math.round(360 * i / n)}, 90%, 60%)`;
    case 'tile': return tileColor;
    default: return null; // gradient handled by a canvas gradient
  }
}
function vertGradient() {
  const gr = S.align === 'top' ? g.createLinearGradient(0, 0, 0, H)
           : S.align === 'center' ? null
           : g.createLinearGradient(0, H, 0, 0);
  if (S.align === 'center') {
    const c = g.createLinearGradient(0, 0, 0, H);
    c.addColorStop(0, S.color2); c.addColorStop(0.5, S.color1); c.addColorStop(1, S.color2);
    return c;
  }
  gr.addColorStop(0, S.color1); gr.addColorStop(1, S.color2);
  return gr;
}

function rr(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// y position and height for a bar of value h (pixels), given alignment
function place(h) {
  if (S.align === 'top') return [0, h];
  if (S.align === 'center') return [(H - h) / 2, h];
  return [H - h, h];
}

function frame(now) {
  if (analyser) analyser.smoothingTimeConstant = S.smoothing;
  const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  g.clearRect(0, 0, W, H);
  g.globalAlpha = S.opacity;
  const n = S.bars | 0;
  const raw = readBars(n);
  if (vals.length !== n) { vals = raw.slice(); peaks = raw.slice(); }
  for (let i = 0; i < n; i++) {
    vals[i] = raw[i];
    peaks[i] = Math.max(raw[i], peaks[i] - S.peakFall * dt);
  }
  const idle = S.idle * DPR;
  const grad = S.colorMode === 'gradient' ? vertGradient() : null;
  g.shadowBlur = S.glow * DPR;

  if (S.style === 'wave') drawWave(grad);
  else if (S.style === 'circle') drawCircle(n, grad, idle);
  else if (S.style === 'line') drawLine(n, grad, idle);
  else drawBars(n, grad, idle);

  g.shadowBlur = 0; g.globalAlpha = 1;
  requestAnimationFrame(frame);
}

function drawBars(n, grad, idle) {
  const gap = S.gap * DPR;
  const bw = Math.max(1, (W - gap * (n - 1)) / n);
  for (let i = 0; i < n; i++) {
    const x = i * (bw + gap);
    const col = fillFor(i, n, vals[i]);
    g.fillStyle = col || grad; g.shadowColor = col || S.color1;
    const h = Math.max(idle, vals[i] * H);
    if (S.style === 'blocks') {
      const segs = S.segments | 0, sg = Math.max(1, gap * 0.6);
      const sh = (H - sg * (segs - 1)) / segs;
      const lit = Math.round(vals[i] * segs);
      for (let s = 0; s < Math.max(lit, idle > 0 ? 1 : 0); s++) {
        const y = S.align === 'top' ? s * (sh + sg)
                : S.align === 'center' ? null
                : H - (s + 1) * sh - s * sg;
        if (y === null) {
          // center: grow outward symmetrically
          const half = Math.floor(segs / 2);
          if (s >= half) break;
          const off = s * (sh + sg);
          rr(x, H / 2 + off, bw, sh, S.round * bw / 2); g.fill();
          rr(x, H / 2 - off - sh, bw, sh, S.round * bw / 2); g.fill();
        } else { rr(x, y, bw, sh, S.round * bw / 2); g.fill(); }
      }
    } else if (S.style === 'dots') {
      const d = Math.min(bw, 8 * DPR);
      const [y, hh] = place(h);
      const cy = S.align === 'top' ? y + hh : S.align === 'center' ? null : y;
      if (cy === null) { dot(x + bw / 2, H / 2 - hh / 2, d); dot(x + bw / 2, H / 2 + hh / 2, d); }
      else dot(x + bw / 2, Math.min(H - d / 2, Math.max(d / 2, cy)), d);
    } else {
      const [y, hh] = place(h);
      rr(x, y, bw, hh, S.round * bw / 2); g.fill();
    }
    if (S.peaks && S.style !== 'blocks') {
      const ph = Math.max(idle, peaks[i] * H), cap = Math.max(2, 3 * DPR);
      g.shadowBlur = 0; g.fillStyle = col || S.color2;
      if (S.align === 'top') g.fillRect(x, ph + 2 * DPR, bw, cap);
      else if (S.align === 'center') { g.fillRect(x, (H - ph) / 2 - cap - 2 * DPR, bw, cap); g.fillRect(x, (H + ph) / 2 + 2 * DPR, bw, cap); }
      else g.fillRect(x, H - ph - cap - 2 * DPR, bw, cap);
      g.shadowBlur = S.glow * DPR;
    }
  }
}
function dot(x, y, d) { g.beginPath(); g.arc(x, y, d / 2, 0, Math.PI * 2); g.fill(); }

function drawLine(n, grad, idle) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? W / 2 : i * W / (n - 1);
    const h = Math.max(idle, vals[i] * H);
    const y = S.align === 'top' ? h : S.align === 'center' ? H / 2 - h / 2 : H - h;
    pts.push([x, y]);
  }
  const strokeCol = S.colorMode === 'rainbow' ? (() => { const l = g.createLinearGradient(0, 0, W, 0); for (let k = 0; k <= 6; k++) l.addColorStop(k / 6, `hsl(${k * 60},90%,60%)`); return l; })()
                  : (fillFor(0, n, 0) || grad);
  const curve = () => {
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      g.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    }
    g.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  };
  // soft fill under the line
  g.beginPath(); curve();
  const base = S.align === 'top' ? 0 : S.align === 'center' ? H / 2 : H;
  g.lineTo(W, base); g.lineTo(0, base); g.closePath();
  if (S.lineFill !== 'none') {
    let fillStyle = strokeCol;
    if (S.lineFill === 'fade') {
      // strongest right under the line, fading to nothing at the edge
      const base0 = S.align === 'top' ? 0 : S.align === 'center' ? H / 2 : H;
      const far = S.align === 'top' ? H : 0;
      const fc = S.colorMode === 'tile' ? tileColor : S.color1;
      const [r, gg, bb] = hexRgb(fc.startsWith('#') ? fc : '#ffffff');
      const lg = g.createLinearGradient(0, far, 0, base0);
      lg.addColorStop(0, `rgba(${r},${gg},${bb},1)`);
      lg.addColorStop(1, `rgba(${r},${gg},${bb},0)`);
      fillStyle = lg;
    }
    g.globalAlpha = S.opacity * S.fillStrength; g.fillStyle = fillStyle; g.shadowBlur = 0; g.fill();
  }
  g.globalAlpha = S.opacity; g.shadowBlur = S.glow * DPR; g.shadowColor = S.colorMode === 'tile' ? tileColor : S.color1;
  g.beginPath(); curve();
  g.lineWidth = S.lineWidth * DPR; g.lineJoin = 'round'; g.lineCap = 'round';
  g.strokeStyle = strokeCol; g.stroke();
  if (S.align === 'center') {
    // mirror below the middle
    g.save(); g.translate(0, H); g.scale(1, -1);
    g.beginPath(); curve(); g.stroke(); g.restore();
  }
}

let wavePts = null;
function drawWave(grad) {
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

function drawCircle(n, grad, idle) {
  const cx = W / 2, cy = H / 2;
  const R = Math.min(W, H) * 0.24;
  const maxLen = Math.min(W, H) / 2 - R - 4 * DPR;
  const gapA = (S.gap / 14) * (Math.PI * 2 / n) * 0.8;
  const slice = Math.PI * 2 / n;
  const bw = Math.max(1 * DPR, R * (slice - gapA));
  for (let i = 0; i < n; i++) {
    const a = i * slice - Math.PI / 2;
    const len = Math.max(idle, vals[i] * maxLen);
    let col = fillFor(i, n, vals[i]);
    if (!col) col = mix(S.color1, S.color2, vals[i]);
    g.fillStyle = col; g.shadowColor = col;
    g.save(); g.translate(cx, cy); g.rotate(a);
    const inward = S.align === 'center' ? len / 2 : S.align === 'top' ? len : 0;
    rr(R - inward, -bw / 2, len, bw, S.round * bw / 2); g.fill();
    g.restore();
  }
  g.shadowBlur = 0;
  g.beginPath(); g.arc(cx, cy, R - 6 * DPR - (S.align === 'top' ? maxLen * 0.5 : 0), 0, Math.PI * 2);
  g.globalAlpha = 0.12; g.fillStyle = S.colorMode === 'tile' ? tileColor : S.color1; g.fill(); g.globalAlpha = S.opacity;
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

/* Presets */
const presetsEl = $('vPresets');
const presetBtns = [];
for (const [name, p] of PRESETS) {
  const b = document.createElement('button');
  b.className = 'chip'; b.type = 'button'; b.textContent = name;
  b.addEventListener('click', () => { S = p ? { ...p } : { ...DEFAULT, style: S.style }; changed(); refresh(); });
  presetsEl.appendChild(b); presetBtns.push([b, p]);
}

/* ---------------- Controls ---------------- */
const STYLES = [['wave','Wave'],['bars','Bars'],['blocks','Blocks'],['line','Line'],['circle','Circle'],['dots','Dots']];
const SPECTRUM = ['bars','blocks','line','circle','dots'];
const pct = v => Math.round(v * 100) + '%';
const CONTROLS = {
  'vg-style': [
    { k: 'align', label: 'Grow from', type: 'seg', only: SPECTRUM, options: [['bottom','Bottom'],['center','Center'],['top','Top']] },
    { k: 'bars', label: 'Number of bars', type: 'range', only: SPECTRUM, min: 8, max: 160, step: 1 },
    { k: 'gap', label: 'Gap between bars', type: 'range', only: ['bars','blocks','circle','dots'], min: 0, max: 14, step: 1, fmt: v => v + 'px' },
    { k: 'round', label: 'Roundness', type: 'range', only: ['bars','blocks','circle'], min: 0, max: 1, step: 0.05, fmt: pct },
    { k: 'segments', label: 'Blocks per bar', type: 'range', only: ['blocks'], min: 4, max: 30, step: 1 },
    { k: 'lineWidth', label: 'Line width', type: 'range', only: ['line','wave'], min: 1, max: 10, step: 0.5, fmt: v => v + 'px' },
    { k: 'lineFill', label: 'Fill under line', type: 'seg', only: ['line'], options: [['none','None'],['fade','Fade'],['solid','Solid']] },
    { k: 'fillStrength', label: 'Fill strength', type: 'range', only: ['line'], min: 0.05, max: 1, step: 0.05, fmt: pct },
    { k: 'waveWindow', label: 'Zoom', hint: 'How much of the sound fits across', type: 'range', only: ['wave'], min: 3, max: 80, step: 1, fmt: v => v + ' ms' },
    { k: 'waveCalm', label: 'Calm', hint: 'Higher is slower and smoother', type: 'range', only: ['wave'], min: 0, max: 0.97, step: 0.01, fmt: pct },
    { k: 'waveLock', label: 'Hold steady', type: 'switch', only: ['wave'] },
    { k: 'peaks', label: 'Peak caps', type: 'switch', only: ['bars','dots'] },
    { k: 'peakFall', label: 'Peak fall speed', type: 'range', only: ['bars','dots'], min: 0.1, max: 2, step: 0.05, fmt: v => v.toFixed(2) },
    { k: 'idle', label: 'Resting height', type: 'range', only: SPECTRUM, min: 0, max: 12, step: 1, fmt: v => v + 'px' },
  ],
  'vg-look': [
    { k: 'height', label: 'Height', type: 'range', min: 30, max: 200, step: 5, fmt: v => v + 'px' },
    { k: 'colorMode', label: 'Color', type: 'seg', options: [['solid','Solid'],['gradient','Gradient'],['rainbow','Rainbow'],['tile','Pad']] },
    { k: 'colors', label: 'Colors', type: 'colors' },
    { k: 'glow', label: 'Glow', type: 'range', min: 0, max: 30, step: 1 },
    { k: 'opacity', label: 'Opacity', type: 'range', min: 0.2, max: 1, step: 0.05, fmt: pct },
    { k: 'sensitivity', label: 'Sensitivity', type: 'range', min: 0.3, max: 3, step: 0.05, fmt: v => v.toFixed(2) + '×' },
  ],
  'vg-adv': [
    { k: 'smoothing', label: 'Smoothing', type: 'range', only: SPECTRUM, min: 0, max: 0.95, step: 0.01, fmt: pct },
    { k: 'lowHz', label: 'Lowest frequency', type: 'range', only: SPECTRUM, min: 20, max: 500, step: 5, fmt: v => v + ' Hz' },
    { k: 'highHz', label: 'Highest frequency', type: 'range', only: SPECTRUM, min: 2000, max: 20000, step: 250, fmt: v => (v / 1000).toFixed(1) + ' kHz' },
    { k: 'logScale', label: 'Musical spacing', type: 'switch', only: SPECTRUM },
  ],
};

const ICONS = {
  wave: '<path d="M2 12c1.5-5 3.5-5 5 0s3.5 5 5 0 3.5-5 5 0 3.5 5 5 0"/>',
  bars: '<path stroke-width="2.6" d="M4 20v-6M8 20V8M12 20v-9M16 20V5M20 20v-7"/>',
  blocks: '<rect x="3" y="15" width="4" height="4" rx="1"/><rect x="3" y="9" width="4" height="4" rx="1"/><rect x="10" y="15" width="4" height="4" rx="1"/><rect x="10" y="9" width="4" height="4" rx="1"/><rect x="10" y="3" width="4" height="4" rx="1"/><rect x="17" y="15" width="4" height="4" rx="1"/>',
  line: '<path d="M2 18l4-6 4 3 4-8 4 3 4-5"/>',
  circle: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  dots: '<g fill="currentColor" stroke="none"><circle cx="4" cy="15" r="1.9"/><circle cx="8" cy="9" r="1.9"/><circle cx="12" cy="13" r="1.9"/><circle cx="16" cy="6" r="1.9"/><circle cx="20" cy="11" r="1.9"/></g>',
};
const tabsEl = $('vTabs');
for (const [val, text] of STYLES) {
  const t = document.createElement('button');
  t.type = 'button'; t.className = 'tab'; t.id = 'tab-' + val; t.setAttribute('role', 'tab');
  t.setAttribute('aria-label', text); t.title = text;
  t.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[val]}</svg>`;
  t.addEventListener('click', () => { S.style = val; changed(); refresh(); });
  tabsEl.appendChild(t);
}

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
    if (c.only) refreshers.push(() => { row.hidden = !c.only.includes(S.style); });
    grp.appendChild(row);
  }
}
refreshers.push(() => {
  for (const t of tabsEl.children) {
    const on = t.id === 'tab-' + S.style;
    t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
  }
  $('vStyleName').textContent = (STYLES.find(x => x[0] === S.style) || ['', ''])[1];
  // Advanced has nothing for the wave style
  $('vAdv').hidden = S.style === 'wave';
  const cur = JSON.stringify(S);
  for (const [b, p] of presetBtns) b.setAttribute('aria-pressed', String(JSON.stringify(p ? { ...DEFAULT, ...p } : { ...DEFAULT, style: S.style }) === cur));
  $('vSave').classList.toggle('dirty', sheetOpen && isDirty());
});

function refresh() { for (const f of refreshers) f(); sizeCanvas(); }
function changed() {
  if (analyser) analyser.smoothingTimeConstant = S.smoothing;
  if (S.highHz <= S.lowHz + 200) S.highHz = S.lowHz + 200;
  sizeCanvas();
  for (const [b, p] of presetBtns) b.setAttribute('aria-pressed', String(JSON.stringify(p ? { ...DEFAULT, ...p } : { ...DEFAULT, style: S.style }) === JSON.stringify(S)));
  $('vSave').classList.toggle('dirty', isDirty());
}

$('vReset').addEventListener('click', () => { S = { ...DEFAULT, style: S.style }; changed(); refresh(); toast('Back to default (white)'); });

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
