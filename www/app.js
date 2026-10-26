'use strict';

/* ---------- Settings ---------- */
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
let ctx;
const buffers = new Map();   // id -> AudioBuffer
const playing = new Map();   // id -> AudioBufferSourceNode

function audioCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
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

function stopSound(id) {
  const src = playing.get(id);
  if (src) { try { src.stop(); } catch (_) {} }
  playing.delete(id);
  const el = tileEl(id);
  if (el) el.classList.remove('playing');
}

async function playSound(sound) {
  stopSound(sound.id); // tapping again restarts it
  try {
    const c = audioCtx();
    const buf = await getBuffer(sound);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.onended = () => {
      if (playing.get(sound.id) === src) {
        playing.delete(sound.id);
        const el = tileEl(sound.id);
        if (el) el.classList.remove('playing');
      }
    };
    playing.set(sound.id, src);
    src.start();
    const el = tileEl(sound.id);
    if (el) el.classList.add('playing');
  } catch (e) {
    console.error(e);
    toast("Couldn't play that sound");
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

function makeTile(sound) {
  const el = document.createElement('button');
  el.className = 'tile';
  el.dataset.id = sound.id;
  el.style.setProperty('--c', sound.color);
  el.style.setProperty('--hold', (DELETE_MS - TAP_MAX_MS) + 'ms');
  el.innerHTML = '<span class="fill"></span><span class="trash"></span><span class="name"></span>';
  el.querySelector('.name').textContent = sound.name;

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

  el.addEventListener('pointermove', e => {
    if (!active) return;
    if (Math.abs(e.clientX - startX) > MOVE_CANCEL_PX || Math.abs(e.clientY - startY) > MOVE_CANCEL_PX) reset();
  });

  el.addEventListener('pointerup', () => {
    if (!active) return;
    const held = Date.now() - downAt;
    reset();
    if (held < TAP_MAX_MS) playSound(sound);
  });

  el.addEventListener('pointercancel', reset);
  el.addEventListener('pointerleave', reset);
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

async function addSound(blob, name) {
  const used = new Set(sounds.map(s => s.color));
  const free = COLORS.filter(c => !used.has(c));
  const pool = free.length ? free : COLORS;
  const sound = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    name,
    blob,
    color: pool[Math.floor(Math.random() * pool.length)],
    created: Date.now(),
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
  const name = (f.name || 'Sound').replace(/\.[^.]+$/, '').slice(0, 40) || nextRecName();
  await addSound(f, name);
});

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
  recTick = setInterval(() => {
    const s = Math.floor((Date.now() - recStart) / 1000);
    recTime.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }, 250);
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
})();
