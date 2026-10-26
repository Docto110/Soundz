'use strict';

/* ---------- Settings ---------- */
const MAX_SOUND_S = 10;     // longest a sound on the board can be
const TAP_MAX_MS = 500;     // released before this = play
const DELETE_MS = 5000;     // hold this long = delete
const MOVE_CANCEL_PX = 12;  // finger moved this far = it's a scroll, cancel
const COLORS = [
  '#e8485c', '#f27a35', '#e9b52c', '#3fb86b', '#22a9a0',
  '#3a8ee6', '#6a5ce6', '#b04fd6', '#e0558f', '#7d8a99'
];

/* ---------- Storage (IndexedDB) ---------- */
const db = (() => {
  let conn;
  function open() {
    if (conn) return conn;
    conn = new Promise((resolve, reject) => {
      const req = indexedDB.open('soundz', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('sounds', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return conn;
  }
  async function tx(mode, fn) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const t = d.transaction('sounds', mode);
      const result = fn(t.objectStore('sounds'));
      t.oncomplete = () => resolve(result && result.result !== undefined ? result.result : undefined);
      t.onerror = () => reject(t.error);
    });
  }
  return {
    all: () => tx('readonly', s => s.getAll()),
    put: item => tx('readwrite', s => s.put(item)),
    del: id => tx('readwrite', s => s.delete(id)),
  };
})();

/* ---------- Audio ---------- */
let ctx, master, analyser;  // everything plays through master -> analyser (for the visualizer)
const buffers = new Map();   // id -> AudioBuffer
const playing = new Map();   // id -> Set of AudioBufferSourceNodes

/* App settings (saved on the phone) */
const prefs = (() => {
  let p = {};
  try { p = JSON.parse(localStorage.getItem('soundz-prefs') || '{}'); } catch (_) {}
  return {
    get: (k, d) => (k in p ? p[k] : d),
    set: (k, v) => { p[k] = v; try { localStorage.setItem('soundz-prefs', JSON.stringify(p)); } catch (_) {} },
  };
})();

/* Trim + fade settings for a sound, always valid for its buffer */
function regionOf(sound, buf) {
  const dur = buf.duration;
  let start = Math.max(0, Math.min(sound.start || 0, dur));
  let end = sound.end == null ? dur : Math.max(start, Math.min(sound.end, dur));
  if (end - start < 0.01) { start = 0; end = dur; }
  end = Math.min(end, start + MAX_SOUND_S);
  const len = end - start;
  let fadeIn = Math.max(0, Math.min(sound.fadeIn || 0, len));
  let fadeOut = Math.max(0, Math.min(sound.fadeOut || 0, len - fadeIn));
  return { start, end, len, fadeIn, fadeOut };
}

function audioCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    master.connect(analyser);
    analyser.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

async function getBuffer(sound) {
  if (buffers.has(sound.id)) return buffers.get(sound.id);
  const data = await sound.blob.arrayBuffer();
  const buf = await audioCtx().decodeAudioData(data);
  buffers.set(sound.id, buf);
  return buf;
}

function setPlayingClass(id) {
  const el = tileEl(id);
  if (el) el.classList.toggle('playing', !!(playing.get(id) && playing.get(id).size));
}

function stopSound(id) {
  const set = playing.get(id);
  if (set) for (const src of set) { try { src.stop(); } catch (_) {} }
  playing.delete(id);
  setPlayingClass(id);
}

// Plays a sound with its trim + fades. `opts.overlap` decides whether
// a new play layers on top or restarts it. Returns { startedAt, region }.
async function playSound(sound, opts = {}) {
  const overlap = opts.overlap != null ? opts.overlap : prefs.get('overlap', false);
  // Overlap off: whatever is playing gets cut off by the new sound
  if (!overlap) for (const id of [...playing.keys()]) stopSound(id);
  try {
    const c = audioCtx();
    const buf = opts.buffer || await getBuffer(sound);
    const r = regionOf(sound, buf);
    const src = c.createBufferSource();
    src.buffer = buf;
    const gain = c.createGain();
    src.connect(gain).connect(master);

    const t0 = c.currentTime + 0.005;
    const g = gain.gain;
    g.setValueAtTime(r.fadeIn > 0 ? 0 : 1, t0);
    if (r.fadeIn > 0) g.linearRampToValueAtTime(1, t0 + r.fadeIn);
    if (r.fadeOut > 0) {
      g.setValueAtTime(1, t0 + r.len - r.fadeOut);
      g.linearRampToValueAtTime(0, t0 + r.len);
    }

    if (!playing.has(sound.id)) playing.set(sound.id, new Set());
    playing.get(sound.id).add(src);
    src.onended = () => {
      const set = playing.get(sound.id);
      if (set) { set.delete(src); if (!set.size) playing.delete(sound.id); }
      setPlayingClass(sound.id);
      if (opts.onEnd) opts.onEnd();
    };
    src.start(t0, r.start, r.len);
    if (window.onSoundPlayed) window.onSoundPlayed(sound);
    setPlayingClass(sound.id);
    return { startedAt: t0, region: r };
  } catch (e) {
    console.error(e);
    toast("Couldn't play that sound");
    return null;
  }
}

/* ---------- Haptics ---------- */
function buzz(ms = 40) {
  const H = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics;
  if (H) {
    H.vibrate({ duration: ms }).catch(() => {});
  } else if (navigator.vibrate) {
    navigator.vibrate(ms);
  }
}

/* ---------- UI ---------- */
const grid = document.getElementById('grid');
const sheet = document.getElementById('sheet');
const rec = document.getElementById('rec');
const recTime = document.getElementById('recTime');
const fileInput = document.getElementById('fileInput');
const toastEl = document.getElementById('toast');

let sounds = [];

function tileEl(id) {
  return grid.querySelector(`[data-id="${id}"]`);
}

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2200);
}

function render() {
  grid.innerHTML = '';
  for (const s of sounds) grid.appendChild(makeTile(s));
  const add = document.createElement('button');
  add.className = 'tile add';
  add.setAttribute('aria-label', 'Add sound');
  add.addEventListener('click', () => { sheet.hidden = false; });
  grid.appendChild(add);
}

/* Pictures: one object URL per sound, reused across renders */
const imageUrls = new Map();   // id -> { blob, url }
function imageUrl(sound) {
  if (!sound.image) return null;
  const c = imageUrls.get(sound.id);
  if (c && c.blob === sound.image) return c.url;
  if (c) URL.revokeObjectURL(c.url);
  const url = URL.createObjectURL(sound.image);
  imageUrls.set(sound.id, { blob: sound.image, url });
  return url;
}

// Square, center-cropped JPEG from anything drawable (image bitmap or video frame)
function squareJpeg(src, w, h, size = 480) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const s = Math.min(w, h);
  cv.getContext('2d').drawImage(src, (w - s) / 2, (h - s) / 2, s, s, 0, 0, size, size);
  return new Promise(res => cv.toBlob(b => res(b), 'image/jpeg', 0.85));
}

async function imageFileToJpeg(file) {
  const bmp = await createImageBitmap(file);
  const out = await squareJpeg(bmp, bmp.width, bmp.height);
  if (bmp.close) bmp.close();
  return out;
}

function makeTile(sound) {
  const el = document.createElement('button');
  el.className = 'tile';
  el.dataset.id = sound.id;
  el.style.setProperty('--c', sound.color);
  el.style.setProperty('--hold', (DELETE_MS - TAP_MAX_MS) + 'ms');
  el.innerHTML = '<span class="fill"></span><span class="trash"></span><span class="name"></span>';
  el.querySelector('.name').textContent = sound.name;
  const img = imageUrl(sound);
  if (img) {
    el.classList.add('has-img');
    el.style.backgroundImage = `linear-gradient(rgba(0,0,0,0) 40%, rgba(0,0,0,.6)), url("${img}")`;
  }

  let downAt = 0, startX = 0, startY = 0, holdTimer = null, deleteTimer = null, active = false;

  function reset() {
    clearTimeout(holdTimer);
    clearTimeout(deleteTimer);
    holdTimer = deleteTimer = null;
    active = false;
    el.classList.remove('pressed', 'holding');
  }

  el.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button !== 0) return;
    active = true;
    downAt = Date.now();
    startX = e.clientX; startY = e.clientY;
    el.classList.add('pressed');
    audioCtx(); // warm up audio on first touch
    if (editMode) return; // in edit mode a tap just opens the sampler
    holdTimer = setTimeout(() => {
      el.classList.remove('pressed');
      el.classList.add('holding');
      buzz(15);
    }, TAP_MAX_MS);
    deleteTimer = setTimeout(() => {
      reset();
      removeSound(sound);
    }, DELETE_MS);
  });

  function insideTile(x, y) {
    const r = el.getBoundingClientRect();
    const pad = 6; // a little forgiveness at the edges
    return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
  }

  el.addEventListener('pointermove', e => {
    if (!active) return;
    if (el.classList.contains('holding')) {
      // Already holding to delete: only cancel if the finger leaves the square
      if (!insideTile(e.clientX, e.clientY)) reset();
    } else if (Math.abs(e.clientX - startX) > MOVE_CANCEL_PX || Math.abs(e.clientY - startY) > MOVE_CANCEL_PX) {
      // Early on, a real swipe means the user is scrolling
      reset();
    }
  });

  // While holding to delete, stop the page from scrolling (which would cancel the hold)
  el.addEventListener('touchmove', e => {
    if (active && el.classList.contains('holding') && e.cancelable) e.preventDefault();
  }, { passive: false });

  el.addEventListener('pointerup', () => {
    if (!active) return;
    const held = Date.now() - downAt;
    reset();
    if (editMode) openEditor(sound);
    else if (held < TAP_MAX_MS) playSound(sound);
  });

  el.addEventListener('pointercancel', reset);
  el.addEventListener('contextmenu', e => e.preventDefault());

  return el;
}

async function removeSound(sound) {
  buzz(80);
  stopSound(sound.id);
  const el = tileEl(sound.id);
  if (el) el.classList.add('gone');
  await db.del(sound.id);
  buffers.delete(sound.id);
  sounds = sounds.filter(s => s.id !== sound.id);
  setTimeout(render, 250);
}

async function addSound(blob, name, extra = {}) {
  const used = new Set(sounds.map(s => s.color));
  const free = COLORS.filter(c => !used.has(c));
  const pool = free.length ? free : COLORS;
  const sound = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    name,
    blob,
    color: pool[Math.floor(Math.random() * pool.length)],
    created: Date.now(),
    ...extra,
  };
  // Make sure it actually decodes before saving it
  try {
    await getBuffer(sound);
  } catch (e) {
    toast("That file isn't a playable sound");
    return;
  }
  await db.put(sound);
  sounds.push(sound);
  render();
  buzz(25);
  return sound;
}

/* ---------- Importing (audio files and videos), max 10 seconds ---------- */
const MAX_IMPORT_BYTES = 300 * 1024 * 1024;

function cropBuffer(b, t0, t1) {
  const sr = b.sampleRate;
  const i0 = Math.max(0, Math.floor(t0 * sr)), i1 = Math.min(b.length, Math.ceil(t1 * sr));
  const out = audioCtx().createBuffer(b.numberOfChannels, Math.max(1, i1 - i0), sr);
  for (let c = 0; c < b.numberOfChannels; c++) out.copyToChannel(b.getChannelData(c).subarray(i0, i1), c);
  return out;
}

async function importFile(f, isVideo) {
  if (f.size > MAX_IMPORT_BYTES) { toast('That file is too big, try a shorter one'); return; }
  toast(isVideo ? 'Grabbing the sound…' : 'Loading…');
  let buf;
  try {
    buf = await audioCtx().decodeAudioData(await f.arrayBuffer());
  } catch (e) {
    console.error(e);
    toast(isVideo ? "Couldn't find any sound in that video" : "That file isn't a playable sound");
    return;
  }
  const name = (f.name || '').replace(/\.[^.]+$/, '').slice(0, 40) || nextRecName();
  const long = buf.duration > MAX_SOUND_S + 0.05;
  if (!long && !isVideo) {
    await addSound(f, name);
    return;
  }
  // Videos (any length) and long audio open the sampler:
  // pick up to 10 seconds, and for videos a frame for the picture.
  const temp = { id: '__import', name, color: '#c8c8d0', start: 0, end: Math.min(buf.duration, MAX_SOUND_S) };
  await openEditor(temp, {
    buffer: buf,
    video: isVideo ? f : null,
    onSave: async (region, nm, b, image) => {
      const piece = cropBuffer(b, region.start, region.end);
      const extra = { fadeIn: region.fadeIn, fadeOut: region.fadeOut };
      if (image) extra.image = image;
      await addSound(toWav(piece), nm || name, extra);
      toast('Added');
    },
  });
  if (long) toast(`It's ${Math.round(buf.duration)}s long. Pick up to ${MAX_SOUND_S} seconds.`);
  else toast('Pick a frame for the picture, then tap Add');
}

function nextRecName() {
  let n = 1;
  const names = new Set(sounds.map(s => s.name));
  while (names.has('Sound ' + n)) n++;
  return 'Sound ' + n;
}

/* ---------- Add sheet ---------- */
sheet.addEventListener('click', e => { if (e.target === sheet) sheet.hidden = true; });
document.getElementById('btnCancel').addEventListener('click', () => { sheet.hidden = true; });

document.getElementById('btnPick').addEventListener('click', () => {
  sheet.hidden = true;
  fileInput.value = '';
  fileInput.click();
});

fileInput.addEventListener('change', async () => {
  const f = fileInput.files && fileInput.files[0];
  if (!f) return;
  await importFile(f, false);
});

/* ---------- Sound from a video ---------- */
const videoInput = document.getElementById('videoInput');
const MAX_VIDEO_BYTES = 300 * 1024 * 1024;

document.getElementById('btnVideo').addEventListener('click', () => {
  sheet.hidden = true;
  videoInput.value = '';
  videoInput.click();
});

videoInput.addEventListener('change', async () => {
  const f = videoInput.files && videoInput.files[0];
  if (!f) return;
  await importFile(f, true);
});

// Turn decoded audio into a small mono WAV file
function toWav(buf) {
  const rate = buf.sampleRate;
  const len = buf.length;
  const chans = buf.numberOfChannels;
  const mono = new Float32Array(len);
  for (let c = 0; c < chans; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += d[i] / chans;
  }
  const out = new DataView(new ArrayBuffer(44 + len * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + len * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
  str(36, 'data'); out.setUint32(40, len * 2, true);
  for (let i = 0; i < len; i++) {
    const v = Math.max(-1, Math.min(1, mono[i]));
    out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Blob([out.buffer], { type: 'audio/wav' });
}

/* ---------- Recording ---------- */
let recorder = null, chunks = [], recStart = 0, recTick = null, discard = false;

document.getElementById('btnRecord').addEventListener('click', async () => {
  sheet.hidden = true;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    console.error(e);
    toast('Microphone permission is needed to record');
    return;
  }
  chunks = [];
  discard = false;
  const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
    .find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
  recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.onstop = async () => {
    stream.getTracks().forEach(t => t.stop());
    clearInterval(recTick);
    rec.hidden = true;
    if (discard || !chunks.length) return;
    const blob = new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' });
    await addSound(blob, nextRecName());
  };
  recorder.start();
  recStart = Date.now();
  recTime.textContent = '0:00';
  recTime.textContent = `0:00 / 0:${String(MAX_SOUND_S).padStart(2, '0')}`;
  recTick = setInterval(() => {
    const el = (Date.now() - recStart) / 1000;
    if (el >= MAX_SOUND_S) {   // stop by itself at the limit
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      return;
    }
    recTime.textContent = `0:${String(Math.floor(el)).padStart(2, '0')} / 0:${String(MAX_SOUND_S).padStart(2, '0')}`;
  }, 100);
  rec.hidden = false;
  buzz(20);
});

document.getElementById('btnStop').addEventListener('click', () => {
  if (recorder && recorder.state !== 'inactive') recorder.stop();
});

document.getElementById('btnRecCancel').addEventListener('click', () => {
  discard = true;
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  else rec.hidden = true;
});

/* ---------- Edit mode + settings ---------- */
let editMode = false;
const btnEdit = document.getElementById('btnEdit');
const btnDone = document.getElementById('btnDone');
const btnSettings = document.getElementById('btnSettings');
const editHint = document.getElementById('editHint');
const settingsEl = document.getElementById('settings');
const optOverlap = document.getElementById('optOverlap');

function setEditMode(on) {
  editMode = on;
  document.body.classList.toggle('editing', on);
  btnEdit.hidden = on;
  btnSettings.hidden = on;
  btnDone.hidden = !on;
  editHint.hidden = !on;
  if (on) {
    for (const id of [...playing.keys()]) stopSound(id);
    if (!sounds.length && !prefs.get('showViz', true)) { toast('Add a sound first'); setEditMode(false); }
  }
}
btnEdit.addEventListener('click', () => setEditMode(true));
btnDone.addEventListener('click', () => setEditMode(false));

btnSettings.addEventListener('click', () => {
  optOverlap.checked = prefs.get('overlap', false);
  settingsEl.hidden = false;
});
optOverlap.addEventListener('change', () => prefs.set('overlap', optOverlap.checked));
document.getElementById('btnSettingsClose').addEventListener('click', () => { settingsEl.hidden = true; });
settingsEl.addEventListener('click', e => { if (e.target === settingsEl) settingsEl.hidden = true; });

/* ---------- Sampler ---------- */
const editor = (() => {
  const root = document.getElementById('editor');
  const canvas = document.getElementById('edWave');
  const g = canvas.getContext('2d');
  const nameEl = document.getElementById('edName');
  const out = {
    start: document.getElementById('edStart'),
    end: document.getElementById('edEnd'),
    len: document.getElementById('edLen'),
    fin: document.getElementById('edFin'),
    fout: document.getElementById('edFout'),
  };
  const btnPlay = document.getElementById('edPlay');
  const btnZoom = document.getElementById('edZoom');

  const BLOCK = 128;      // samples per peak block
  const FADE_BAND = 44;   // px: top band where fade handles live
  const GRAB = 30;        // px: how close a finger must be to grab a handle

  let sound = null, buf = null, peaks = null, color = '#fff';
  let st = null;          // { start, end, fadeIn, fadeOut } in seconds
  let view = { a: 0, b: 1 };
  let zoomed = false;
  let drag = null;        // which handle is being dragged
  let preview = null;     // { startedAt, region }
  let raf = 0;

  // Min/max peaks per block, mixed down to mono
  function buildPeaks(b) {
    const n = Math.ceil(b.length / BLOCK);
    const max = new Float32Array(n);
    const min = new Float32Array(n);
    const chans = [];
    for (let c = 0; c < b.numberOfChannels; c++) chans.push(b.getChannelData(c));
    for (let i = 0; i < n; i++) {
      let hi = -1, lo = 1;
      const s0 = i * BLOCK, s1 = Math.min(b.length, s0 + BLOCK);
      for (let s = s0; s < s1; s++) {
        let v = 0;
        for (const d of chans) v += d[s];
        v /= chans.length;
        if (v > hi) hi = v;
        if (v < lo) lo = v;
      }
      max[i] = hi; min[i] = lo;
    }
    return { max, min, n };
  }

  const dur = () => buf.duration;
  const W = () => canvas.width;
  const H = () => canvas.height;
  const dpr = () => window.devicePixelRatio || 1;
  const tToX = t => (t - view.a) / (view.b - view.a) * W();
  const xToT = x => view.a + x / W() * (view.b - view.a);

  function fmtS(t) { return t.toFixed(2) + 's'; }
  function fmtF(t) { return t < 1 ? Math.round(t * 1000) + 'ms' : t.toFixed(2) + 's'; }

  function setView() {
    if (zoomed) {
      const len = st.end - st.start;
      const pad = Math.max(len * 0.12, 0.02);
      view = { a: Math.max(0, st.start - pad), b: Math.min(dur(), st.end + pad) };
    } else {
      view = { a: 0, b: dur() };
    }
    btnZoom.classList.toggle('on', zoomed);
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.round(r.width * dpr());
    canvas.height = Math.round(r.height * dpr());
    draw();
  }

  // Envelope gain at time t (for drawing the faded waveform)
  function env(t) {
    if (t < st.start || t > st.end) return 0;
    if (st.fadeIn > 0 && t < st.start + st.fadeIn) return (t - st.start) / st.fadeIn;
    if (st.fadeOut > 0 && t > st.end - st.fadeOut) return (st.end - t) / st.fadeOut;
    return 1;
  }

  function draw() {
    if (!buf) return;
    const w = W(), h = H(), k = dpr();
    const band = FADE_BAND * k;
    const mid = band + (h - band) / 2;
    const amp = (h - band) / 2 - 6 * k;
    g.clearRect(0, 0, w, h);

    const xs = tToX(st.start), xe = tToX(st.end);
    const xfi = tToX(st.start + st.fadeIn), xfo = tToX(st.end - st.fadeOut);

    // Selected region background
    g.fillStyle = 'rgba(255,255,255,0.04)';
    g.fillRect(xs, 0, xe - xs, h);

    // Fade regions highlighted
    g.fillStyle = hexA(color, 0.3);
    if (st.fadeIn > 0) g.fillRect(xs, band, xfi - xs, h - band);
    if (st.fadeOut > 0) g.fillRect(xfo, band, xe - xfo, h - band);

    // Center line
    g.fillStyle = '#2a2a31';
    g.fillRect(0, mid, w, Math.max(1, k));

    // Waveform: one column per pixel
    const spp = (view.b - view.a) * buf.sampleRate / w; // samples per pixel
    for (let x = 0; x < w; x++) {
      const t = xToT(x + 0.5);
      const b0 = Math.floor(xToT(x) * buf.sampleRate / BLOCK);
      const b1 = Math.max(b0 + 1, Math.floor(xToT(x + 1) * buf.sampleRate / BLOCK));
      let hi = -1, lo = 1;
      for (let i = Math.max(0, b0); i < Math.min(peaks.n, b1); i++) {
        if (peaks.max[i] > hi) hi = peaks.max[i];
        if (peaks.min[i] < lo) lo = peaks.min[i];
      }
      if (hi < lo) continue;
      const inSel = t >= st.start && t <= st.end;
      if (!inSel) {
        g.fillStyle = '#3a3a42';
        g.fillRect(x, mid - hi * amp, 1, Math.max(k, (hi - lo) * amp));
        continue;
      }
      const e = env(t);
      if (e < 1) {
        // faint original behind the faded version
        g.fillStyle = hexA(color, 0.28);
        g.fillRect(x, mid - hi * amp, 1, Math.max(k, (hi - lo) * amp));
      }
      g.fillStyle = color;
      g.fillRect(x, mid - hi * amp * e, 1, Math.max(k, (hi - lo) * amp * e));
    }

    // Fade curves
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2 * k;
    g.beginPath();
    g.moveTo(xs, h);
    g.lineTo(xfi, band);
    g.lineTo(xfo, band);
    g.lineTo(xe, h);
    g.stroke();

    // Start / end lines + bottom grab tabs
    for (const x of [xs, xe]) {
      g.fillStyle = '#ffffff';
      g.fillRect(x - k, 0, 2 * k, h);
    }
    tab(xs, h, k, 'start');
    tab(xe, h, k, 'end');

    // Fade handles (squares in the top band)
    fadeHandle(xfi, band, k, drag === 'fadeIn');
    fadeHandle(xfo, band, k, drag === 'fadeOut');

    // Playhead
    if (preview) {
      const c = audioCtx();
      const el = c.currentTime - preview.startedAt;
      if (el >= 0 && el <= preview.region.len) {
        const px = tToX(preview.region.start + el);
        g.fillStyle = '#ffd34d';
        g.fillRect(px - k, band, 2 * k, h - band);
      }
    }

    out.start.textContent = fmtS(st.start);
    out.end.textContent = fmtS(st.end);
    out.len.textContent = fmtS(st.end - st.start);
    out.fin.textContent = fmtF(st.fadeIn);
    out.fout.textContent = fmtF(st.fadeOut);
  }

  function tab(x, h, k, which) {
    const tw = 22 * k, th = 30 * k;
    g.fillStyle = drag === which ? '#ffd34d' : '#ffffff';
    const left = which === 'start' ? x - k : x - tw + k;
    roundRect(left, h - th, tw, th, 6 * k);
    g.fill();
    g.fillStyle = '#111114';
    const cx = left + tw / 2;
    g.fillRect(cx - 4 * k, h - th / 2 - 6 * k, 1.5 * k, 12 * k);
    g.fillRect(cx + 2.5 * k, h - th / 2 - 6 * k, 1.5 * k, 12 * k);
  }

  function fadeHandle(x, band, k, active) {
    const s = 16 * k;
    g.fillStyle = active ? '#ffd34d' : '#ffffff';
    roundRect(x - s / 2, band - s - 6 * k, s, s, 4 * k);
    g.fill();
  }

  function roundRect(x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // Which handle is under the finger?
  function pick(px, py) {
    const k = dpr();
    const x = px * k;
    const xs = tToX(st.start), xe = tToX(st.end);
    const xfi = tToX(st.start + st.fadeIn), xfo = tToX(st.end - st.fadeOut);
    const grab = GRAB * k;
    let cands;
    if (py < FADE_BAND) {
      cands = [['fadeIn', xfi], ['fadeOut', xfo]];
    } else {
      cands = [['start', xs], ['end', xe]];
    }
    let best = null, bestD = Infinity;
    for (const [name, hx] of cands) {
      const d = Math.abs(hx - x);
      if (d < grab && d < bestD) { best = name; bestD = d; }
    }
    // Finger inside the selection (not on a handle): slide the whole selection
    if (best === null && py >= FADE_BAND && x > xs && x < xe) best = 'move';
    return best;
  }

  const MIN_LEN = 0.02;
  let grabOffset = 0;   // for sliding: where in the selection the finger landed

  function applyDrag(px) {
    const t = Math.max(0, Math.min(dur(), xToT(px * dpr())));
    if (drag === 'start') {
      st.start = Math.min(t, st.end - MIN_LEN);
      if (st.end - st.start > MAX_SOUND_S) st.end = st.start + MAX_SOUND_S;
    } else if (drag === 'end') {
      st.end = Math.max(t, st.start + MIN_LEN);
      if (st.end - st.start > MAX_SOUND_S) st.start = st.end - MAX_SOUND_S;
    } else if (drag === 'move') {
      const len = st.end - st.start;
      st.start = Math.max(0, Math.min(dur() - len, t - grabOffset));
      st.end = st.start + len;
    } else if (drag === 'fadeIn') {
      st.fadeIn = Math.max(0, Math.min(t - st.start, st.end - st.start - st.fadeOut));
    } else if (drag === 'fadeOut') {
      st.fadeOut = Math.max(0, Math.min(st.end - t, st.end - st.start - st.fadeIn));
    }
    // keep fades inside the region
    const len = st.end - st.start;
    st.fadeIn = Math.min(st.fadeIn, len);
    st.fadeOut = Math.min(st.fadeOut, len - st.fadeIn);
    // snap tiny fades to zero
    if (st.fadeIn < 0.003) st.fadeIn = 0;
    if (st.fadeOut < 0.003) st.fadeOut = 0;
  }

  canvas.addEventListener('pointerdown', e => {
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    drag = pick(px, py);
    if (!drag) return;
    if (drag === 'move') grabOffset = xToT(px * dpr()) - st.start;
    canvas.setPointerCapture(e.pointerId);
    buzz(10);
    draw();
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const r = canvas.getBoundingClientRect();
    applyDrag(e.clientX - r.left);
    draw();
  });
  const endDrag = () => {
    if (!drag) return;
    const moved = drag === 'start' || drag === 'move';
    drag = null; draw();
    if (vid && !frameTouched && moved) { frameIn.value = st.start; frameOut.textContent = fmtT(st.start); grabFrame(st.start); }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  function stopPreview() {
    stopSound('__preview');
    preview = null;
    btnPlay.innerHTML = '<span class="i-play"></span>';
    cancelAnimationFrame(raf);
    draw();
  }

  async function togglePreview() {
    if (preview) { stopPreview(); return; }
    const tmp = { id: '__preview', start: st.start, end: st.end, fadeIn: st.fadeIn, fadeOut: st.fadeOut };
    const p = await playSound(tmp, { buffer: buf, overlap: false, onEnd: () => { if (preview === p) stopPreview(); } });
    if (!p) return;
    preview = p;
    btnPlay.innerHTML = '<span class="i-stop"></span>';
    const loop = () => { draw(); if (preview) raf = requestAnimationFrame(loop); };
    loop();
  }

  btnPlay.addEventListener('click', togglePreview);
  btnZoom.addEventListener('click', () => { zoomed = !zoomed; setView(); draw(); });
  document.getElementById('edReset').addEventListener('click', () => {
    st = { start: 0, end: Math.min(dur(), MAX_SOUND_S), fadeIn: 0, fadeOut: 0 };
    zoomed = false; setView(); draw();
  });

  let opts = {};
  const helpEl = root.querySelector('.ed-help');
  const saveBtn = document.getElementById('edSave');

  /* Picture + video frame */
  const thumbEl = document.getElementById('edThumb');
  const picChoose = document.getElementById('edPicChoose');
  const picRemove = document.getElementById('edPicRemove');
  const frameRow = document.getElementById('edFrameRow');
  const frameIn = document.getElementById('edFrame');
  const frameOut = document.getElementById('edFrameT');
  const imgInput = document.getElementById('imgInput');
  let pic = null, picUrl = null;           // current picture blob in the editor
  let vid = null, vidUrl = null, frameTouched = false, seekBusy = false, seekWant = null;

  function setPic(blob) {
    pic = blob || null;
    if (picUrl) URL.revokeObjectURL(picUrl);
    picUrl = pic ? URL.createObjectURL(pic) : null;
    thumbEl.style.backgroundImage = picUrl ? `url("${picUrl}")` : '';
    thumbEl.style.backgroundColor = color;
    thumbEl.classList.toggle('empty', !pic);
    picRemove.hidden = !pic;
    picChoose.textContent = pic ? 'Change picture' : 'Choose picture';
  }

  picChoose.addEventListener('click', () => { imgInput.value = ''; imgInput.click(); });
  picRemove.addEventListener('click', () => { setPic(null); frameTouched = true; });
  imgInput.addEventListener('change', async () => {
    const f = imgInput.files && imgInput.files[0];
    if (!f) return;
    try { setPic(await imageFileToJpeg(f)); frameTouched = true; }
    catch (e) { console.error(e); toast("Couldn't open that picture"); }
  });

  // Grab a video frame at time t (seconds) as the picture
  async function grabFrame(t) {
    if (!vid) return;
    seekWant = t;
    if (seekBusy) return;
    seekBusy = true;
    while (seekWant != null && vid) {
      const v = vid, want = seekWant; seekWant = null;
      await new Promise(res => {
        const done = () => { v.removeEventListener('seeked', done); res(); };
        v.addEventListener('seeked', done);
        v.currentTime = Math.min(Math.max(0, want), Math.max(0, (v.duration || 0) - 0.05));
        setTimeout(done, 1500);
      });
      if (v === vid && v.videoWidth) setPic(await squareJpeg(v, v.videoWidth, v.videoHeight));
    }
    seekWant = null;
    seekBusy = false;
  }
  const fmtT = t => Math.floor(t / 60) + ':' + (t % 60).toFixed(1).padStart(4, '0');
  frameIn.addEventListener('input', () => {
    frameTouched = true;
    frameOut.textContent = fmtT(+frameIn.value);
    grabFrame(+frameIn.value);
  });

  function setupVideo(file) {
    vidUrl = URL.createObjectURL(file);
    vid = document.createElement('video');
    vid.muted = true; vid.playsInline = true; vid.preload = 'auto';
    vid.src = vidUrl;
    frameRow.hidden = false;
    vid.addEventListener('loadeddata', () => {
      frameIn.max = vid.duration || 0;
      frameIn.value = st.start;
      frameOut.textContent = fmtT(st.start);
      grabFrame(st.start);
    }, { once: true });
    vid.addEventListener('error', () => { frameRow.hidden = true; }, { once: true });
  }

  function close() {
    stopPreview();
    root.hidden = true;
    if (vid) { vid.removeAttribute('src'); vid.load(); vid = null; }
    if (vidUrl) { URL.revokeObjectURL(vidUrl); vidUrl = null; }
    frameRow.hidden = true;
    sound = buf = peaks = null;
    window.removeEventListener('resize', resize);
  }

  document.getElementById('edCancel').addEventListener('click', () => {
    const o = opts; close(); if (o.onCancel) o.onCancel();
  });
  saveBtn.addEventListener('click', async () => {
    if (opts.onSave) {
      const o = opts, region = { ...st }, b = buf, nm = nameEl.value.trim(), image = pic;
      close();
      await o.onSave(region, nm, b, image);
      return;
    }
    const s = sound;
    s.start = st.start;
    s.end = st.end >= dur() - 0.0005 ? null : st.end;
    s.fadeIn = st.fadeIn;
    s.fadeOut = st.fadeOut;
    const nm = nameEl.value.trim();
    if (nm) s.name = nm.slice(0, 40);
    if (pic) s.image = pic; else delete s.image;
    close();
    await db.put(s);
    render();
    toast('Saved');
  });

  async function open(s, o = {}) {
    opts = o;
    try {
      buf = o.buffer || await getBuffer(s);
    } catch (e) {
      toast("Couldn't open that sound");
      return;
    }
    helpEl.textContent = o.onSave
      ? `Pick up to ${MAX_SOUND_S} seconds to keep. Drag the middle to slide it.`
      : 'Drag the bottom handles to trim, the top squares to fade, the middle to slide.';
    saveBtn.textContent = o.onSave ? 'Add' : 'Save';
    sound = s;
    color = s.color || '#ffffff';
    peaks = buildPeaks(buf);
    const r = regionOf(s, buf);   // already capped at MAX_SOUND_S
    st = { start: r.start, end: r.end, fadeIn: r.fadeIn, fadeOut: r.fadeOut };
    nameEl.value = s.name;
    frameTouched = false;
    setPic(s.image || null);
    if (o.video) setupVideo(o.video);
    zoomed = false;
    setView();
    root.hidden = false;
    window.addEventListener('resize', resize);
    requestAnimationFrame(resize);
  }

  return { open };
})();

function openEditor(sound, o) { return editor.open(sound, o); }

/* ---------- Start ---------- */
(async () => {
  try {
    sounds = (await db.all()) || [];
    sounds.sort((a, b) => a.created - b.created);
  } catch (e) {
    console.error(e);
    sounds = [];
  }
  render();
  addStarterSounds();
})();

/* Default board: added once on first launch (deleting them keeps them gone) */
const STARTERS = [
  { file: 'starter/welcome.wav', name: 'Welcome to Soundz', color: '#3a8ee6' },
];
async function addStarterSounds() {
  if (prefs.get('seeded', false)) return;
  let order = 0, added = 0;
  for (const st of STARTERS) {
    try {
      const res = await fetch(st.file);
      if (!res.ok) continue;
      const blob = await res.blob();
      // created = a tiny number so starters sit at the start of the board
      if (await addSound(blob, st.name, { color: st.color, created: order++ })) added++;
    } catch (e) { console.error(e); }
  }
  if (added) prefs.set('seeded', true);   // only mark done once they were really added
  sounds.sort((a, b) => a.created - b.created);
  render();
}
