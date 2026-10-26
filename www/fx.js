'use strict';
/* Soundz effects: ECHO (delay), SPACE (reverb), LOAD (distortion).
   Each effect has a true dry/wet Mix: 0 = only the original, 1 = only the effect.
   Works with a live AudioContext or an OfflineAudioContext. */
const FX = (() => {

  const TYPES = {
    echo: {
      name: 'ECHO', kind: 'Delay', color: '#5aa2f0',
      defaults: { time: 0.32, repeats: 0.48, tone: 3200, pingpong: false, mix: 0.35 },
      sliders: [
        { k: 'time', label: 'Time', min: 0.02, max: 1, step: 0.01, fmt: v => Math.round(v * 1000) + ' ms' },
        { k: 'repeats', label: 'Repeats', min: 0, max: 0.9, step: 0.01, fmt: v => Math.round(v / 0.9 * 100) + '%' },
        { k: 'tone', label: 'Tone', min: 500, max: 12000, step: 1, log: true, fmt: v => (v / 1000).toFixed(1) + ' kHz' },
      ],
      toggles: [{ k: 'pingpong', label: 'Ping-pong' }],
      summary: p => Math.round(p.time * 1000) + ' ms',
    },
    space: {
      name: 'SPACE', kind: 'Reverb', color: '#a08cff',
      defaults: { room: 'hall', decay: 2.4, damp: 0.4, mix: 0.3 },
      choice: { k: 'room', options: [['room', 'Room'], ['hall', 'Hall'], ['cave', 'Cave']] },
      sliders: [
        { k: 'decay', label: 'Decay', min: 0.2, max: 8, step: 0.1, fmt: v => v.toFixed(1) + ' s' },
        { k: 'damp', label: 'Damp', min: 0, max: 1, step: 0.01, fmt: v => Math.round(v * 100) + '%' },
      ],
      summary: p => ({ room: 'Room', hall: 'Hall', cave: 'Cave' }[p.room] || 'Hall') + ' · ' + p.decay.toFixed(1) + ' s',
    },
    load: {
      name: 'LOAD', kind: 'Distortion', color: '#ff5d6c',
      defaults: { character: 'fuzz', drive: 0.7, tone: 0.55, level: -6, mix: 1 },
      choice: { k: 'character', options: [['warm', 'Warm'], ['crunch', 'Crunch'], ['fuzz', 'Fuzz'], ['bitcrush', 'Bitcrush']] },
      sliders: [
        { k: 'drive', label: 'Drive', min: 0, max: 1, step: 0.01, fmt: v => Math.round(v * 100) + '%' },
        { k: 'tone', label: 'Tone', min: 0, max: 1, step: 0.01, fmt: v => Math.round(v * 100) + '%' },
        { k: 'level', label: 'Level', min: -24, max: 6, step: 0.5, fmt: v => (v > 0 ? '+' : '') + v.toFixed(1) + ' dB' },
      ],
      summary: p => ({ warm: 'Warm', crunch: 'Crunch', fuzz: 'Fuzz', bitcrush: 'Bitcrush' }[p.character] || 'Fuzz') + ' · ' + Math.round(p.drive * 100) + '%',
    },
  };

  const SLOTS = 3;

  function create(type) {
    return { type, on: true, ...JSON.parse(JSON.stringify(TYPES[type].defaults)) };
  }

  function normalize(list) {
    const out = [];
    for (let i = 0; i < SLOTS; i++) {
      const f = list && list[i];
      out.push(f && TYPES[f.type] ? { ...TYPES[f.type].defaults, ...f } : null);
    }
    return out;
  }

  const active = list => normalize(list).filter(f => f && f.on);

  // How long an effect keeps ringing after the sound ends (seconds)
  function tailOf(list) {
    let t = 0;
    for (const f of active(list)) {
      if (f.type === 'echo' && f.repeats > 0.001) {
        // repeats until about -60 dB
        const n = Math.min(40, Math.ceil(Math.log(0.001) / Math.log(Math.max(0.01, f.repeats))));
        t += f.time * (n + 1);
      } else if (f.type === 'echo') t += f.time;
      if (f.type === 'space') t += f.decay * 1.1 + 0.1;
    }
    return Math.min(t, 12);
  }

  /* ---------- building blocks ---------- */

  // True crossfade: dry = cos, wet = sin (equal power). mix 0 => dry only, 1 => wet only.
  function mixer(ctx, mix) {
    const input = ctx.createGain(), output = ctx.createGain();
    const dry = ctx.createGain(), wet = ctx.createGain();
    const m = Math.max(0, Math.min(1, mix));
    dry.gain.value = m >= 1 ? 0 : Math.cos(m * Math.PI / 2);
    wet.gain.value = m <= 0 ? 0 : Math.sin(m * Math.PI / 2);
    input.connect(dry).connect(output);
    wet.connect(output);
    return { input, output, wetIn: wet };
  }

  function buildEcho(ctx, p) {
    const mx = mixer(ctx, p.mix);
    const feed = Math.max(0, Math.min(0.92, p.repeats));
    const tone = Math.max(200, Math.min(16000, p.tone));
    if (!p.pingpong) {
      const d = ctx.createDelay(2), lp = ctx.createBiquadFilter(), fb = ctx.createGain();
      d.delayTime.value = p.time; lp.type = 'lowpass'; lp.frequency.value = tone; fb.gain.value = feed;
      mx.input.connect(d); d.connect(lp); lp.connect(fb).connect(d); lp.connect(mx.wetIn);
    } else {
      const dl = ctx.createDelay(2), dr = ctx.createDelay(2);
      const ll = ctx.createBiquadFilter(), lr = ctx.createBiquadFilter();
      const fl = ctx.createGain(), fr = ctx.createGain();
      const merge = ctx.createChannelMerger(2);
      dl.delayTime.value = p.time; dr.delayTime.value = p.time;
      ll.type = lr.type = 'lowpass'; ll.frequency.value = lr.frequency.value = tone;
      fl.gain.value = fr.gain.value = feed;
      mx.input.connect(dl);
      dl.connect(ll); ll.connect(fl).connect(dr);   // left feeds right
      dr.connect(lr); lr.connect(fr).connect(dl);   // right feeds left
      ll.connect(merge, 0, 0); lr.connect(merge, 0, 1);
      merge.connect(mx.wetIn);
    }
    return mx;
  }

  const irCache = new Map();
  function impulse(ctx, p) {
    const room = { room: [0.008, 0.6], hall: [0.025, 1], cave: [0.06, 1.6] }[p.room] || [0.025, 1];
    const pre = room[0], len = Math.min(10, p.decay * room[1] * 1.2 + 0.1);
    const key = [ctx.sampleRate, p.room, p.decay.toFixed(2)].join('|');
    if (irCache.has(key)) return irCache.get(key);
    const sr = ctx.sampleRate, n = Math.ceil((pre + len) * sr);
    const buf = ctx.createBuffer(2, n, sr);
    const tau = Math.max(0.05, p.decay * room[1]) / 6.9;   // -60 dB at decay
    let seed = 1234567;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      const p0 = Math.floor(pre * sr);
      for (let i = p0; i < n; i++) {
        const t = (i - p0) / sr;
        d[i] = rnd() * Math.exp(-t / tau) * (t < 0.004 ? t / 0.004 : 1);
      }
    }
    irCache.set(key, buf);
    if (irCache.size > 12) irCache.delete(irCache.keys().next().value);
    return buf;
  }

  function buildSpace(ctx, p) {
    const mx = mixer(ctx, p.mix);
    const conv = ctx.createConvolver();
    conv.normalize = true;
    conv.buffer = impulse(ctx, p);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 16000 * Math.pow(1500 / 16000, Math.max(0, Math.min(1, p.damp)));
    const g = ctx.createGain(); g.gain.value = 1.4;   // reverb comes out a bit quiet
    mx.input.connect(conv); conv.connect(lp).connect(g).connect(mx.wetIn);
    return mx;
  }

  const curveCache = new Map();
  function curve(character, drive) {
    const key = character + '|' + drive.toFixed(2);
    if (curveCache.has(key)) return curveCache.get(key);
    const n = 2048, c = new Float32Array(n);
    const k = 1 + drive * 40;
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1) * 2 - 1;
      let y;
      if (character === 'warm') {
        y = Math.tanh(x * (1 + drive * 6)) / Math.tanh(1 + drive * 6);
      } else if (character === 'crunch') {
        const a = x * (1 + drive * 12);
        y = a > 0 ? Math.min(1, a) * 0.95 : Math.max(-0.75, a * 0.85);   // uneven halves = crunchy
        y = Math.tanh(y * 1.4);
      } else if (character === 'bitcrush') {
        const steps = Math.max(2, Math.round(32 - drive * 29));
        y = Math.round(x * steps) / steps;
      } else { // fuzz
        y = Math.max(-1, Math.min(1, x * k * 0.6));
        y = Math.sign(y) * Math.pow(Math.abs(y), 0.6);
      }
      c[i] = y;
    }
    curveCache.set(key, c);
    return c;
  }

  function buildLoad(ctx, p) {
    const mx = mixer(ctx, p.mix);
    const sh = ctx.createWaveShaper();
    sh.curve = curve(p.character, p.drive);
    sh.oversample = '4x';
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1000 * Math.pow(16, Math.max(0, Math.min(1, p.tone)));   // 1k .. 16k
    const out = ctx.createGain();
    out.gain.value = Math.pow(10, p.level / 20);
    mx.input.connect(sh); sh.connect(lp).connect(out).connect(mx.wetIn);
    return mx;
  }

  const BUILD = { echo: buildEcho, space: buildSpace, load: buildLoad };

  // Chain: input -> fx1 -> fx2 -> fx3 -> output. Returns { input, output }.
  function chain(ctx, list) {
    const input = ctx.createGain(), output = ctx.createGain();
    let last = input;
    for (const f of active(list)) {
      try {
        const unit = BUILD[f.type](ctx, f);
        last.connect(unit.input);
        last = unit.output;
      } catch (e) { console.error('fx', f.type, e); }
    }
    last.connect(output);
    return { input, output };
  }

  return { TYPES, SLOTS, create, normalize, active, tailOf, chain };
})();
