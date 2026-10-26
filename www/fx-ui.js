'use strict';
/* The Effects tab in the sampler: 3 slots that fold open. */
const FXUI = (() => {

  function el(tag, props = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k === 'style') e.setAttribute('style', v);
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    for (const kid of kids) if (kid != null) e.append(kid);
    return e;
  }

  // slider position (0..1000) <-> value, with optional log scale
  const toPos = (s, v) => s.log
    ? Math.round(Math.log(v / s.min) / Math.log(s.max / s.min) * 1000)
    : Math.round((v - s.min) / (s.max - s.min) * 1000);
  const fromPos = (s, p) => {
    const t = p / 1000;
    let v = s.log ? s.min * Math.pow(s.max / s.min, t) : s.min + t * (s.max - s.min);
    return Math.round(v / s.step) * s.step;
  };

  function mount(root, list, onChange) {
    let fx = FX.normalize(list);
    let open = fx.length ? 0 : -1;   // first effect starts open
    let adding = false;               // the "+ Add effect" picker is showing
    const changed = () => onChange(fx);

    function slider(f, s) {
      const out = el('output', { class: 'fx-val' }, s.fmt(f[s.k]));
      const inp = el('input', {
        type: 'range', min: 0, max: 1000, step: 1, value: toPos(s, f[s.k]),
        'aria-label': s.label,
        oninput: e => { f[s.k] = fromPos(s, +e.target.value); out.textContent = s.fmt(f[s.k]); changed(); },
      });
      return el('div', { class: 'fx-row' }, el('span', { class: 'fx-lbl' }, s.label), inp, out);
    }

    function mixRow(f) {
      const read = () => `DRY ${Math.round((1 - f.mix) * 100)} · WET ${Math.round(f.mix * 100)}`;
      const out = el('span', { class: 'fx-mixval' }, read());
      const inp = el('input', {
        type: 'range', min: 0, max: 100, step: 1, value: Math.round(f.mix * 100), 'aria-label': 'Mix, dry to wet',
        oninput: e => { f.mix = +e.target.value / 100; out.textContent = read(); changed(); },
      });
      return el('div', { class: 'fx-mix' },
        el('div', { class: 'fx-mixtop' }, el('span', { class: 'fx-mixname' }, 'MIX'), out),
        inp,
        el('div', { class: 'fx-mixends' }, el('span', {}, 'DRY · original only'), el('span', {}, 'WET · effect only')));
    }

    function card(f, i) {
      const T = FX.TYPES[f.type];
      const isOpen = open === i;
      const grip = el('button', {
        type: 'button', class: 'fx-grip', 'aria-label': `Drag to reorder ${T.name}`,
        onpointerdown: e => startDrag(e, i),
      }, gripIcon());
      const head = el('div', { class: 'fx-head' },
        grip,
        el('span', { class: 'fx-num' }, String(i + 1)),
        el('button', {
          type: 'button', class: 'fx-title', 'aria-expanded': String(isOpen),
          onclick: () => { open = isOpen ? -1 : i; render(); },
        }, el('span', { class: 'fx-name' }, T.name), el('span', { class: 'fx-sum' }, T.summary(f))),
        el('input', {
          type: 'checkbox', class: 'switch fx-on', 'aria-label': T.name + ' on', checked: f.on,
          onchange: e => { f.on = e.target.checked; changed(); render(); },
        }));
      const box = el('div', { class: 'fx-slot' + (f.on ? '' : ' off'), style: `--fx:${T.color}` }, head);
      if (!isOpen) return box;
      const body = el('div', { class: 'fx-body' });
      if (T.choice) {
        const seg = el('div', { class: 'fx-seg', role: 'group' });
        for (const [v, label] of T.choice.options) {
          seg.append(el('button', {
            type: 'button', 'aria-pressed': String(f[T.choice.k] === v),
            onclick: () => { f[T.choice.k] = v; changed(); render(); },
          }, label));
        }
        body.append(seg);
      }
      for (const t of T.toggles || []) {
        body.append(el('label', { class: 'fx-toggle' }, t.label,
          el('input', { type: 'checkbox', class: 'switch', checked: !!f[t.k], onchange: e => { f[t.k] = e.target.checked; changed(); render(); } })));
      }
      for (const s of T.sliders) if (!s.showIf || s.showIf(f)) body.append(slider(f, s));
      if (!T.noMix) body.append(mixRow(f));
      body.append(el('div', { class: 'fx-actions' },
        el('button', { type: 'button', class: 'fx-act danger', onclick: () => { fx.splice(i, 1); open = -1; changed(); render(); } }, 'Remove')));
      box.append(body);
      return box;
    }

    function gripIcon() {
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
      for (const [x, y] of [[9, 6], [15, 6], [9, 12], [15, 12], [9, 18], [15, 18]]) {
        const c = document.createElementNS(ns, 'circle');
        c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', 1.7);
        svg.append(c);
      }
      return svg;
    }

    /* Drag to reorder: the grabbed card follows the finger, the others slide aside */
    function startDrag(e, from) {
      if (fx.length < 2) return;
      e.preventDefault();
      const handle = e.currentTarget;
      const cards = [...root.querySelectorAll('.fx-slot')];
      const me = cards[from];
      const rects = cards.map(c => c.getBoundingClientRect());
      const gap = cards.length > 1 ? rects[1].top - rects[0].bottom : 10;
      const shift = rects[from].height + gap;
      const y0 = e.clientY;
      let to = from;
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}
      me.classList.add('dragging');
      cards.forEach(c => { if (c !== me) c.classList.add('shifting'); });
      if (navigator.vibrate) try { navigator.vibrate(10); } catch (_) {}

      const move = ev => {
        const dy = ev.clientY - y0;
        me.style.transform = `translateY(${dy}px) scale(1.02)`;
        const mid = rects[from].top + rects[from].height / 2 + dy;
        to = from;
        for (let k = 0; k < rects.length; k++) {
          if (k === from) continue;
          const kMid = rects[k].top + rects[k].height / 2;
          if (k > from && mid > kMid) to = Math.max(to, k);
          if (k < from && mid < kMid) to = Math.min(to, k);
        }
        cards.forEach((c, k) => {
          if (c === me) return;
          let t = 0;
          if (from < to && k > from && k <= to) t = -shift;
          if (from > to && k < from && k >= to) t = shift;
          c.style.transform = t ? `translateY(${t}px)` : '';
        });
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        if (to !== from) {
          const [item] = fx.splice(from, 1);
          fx.splice(to, 0, item);
          if (open === from) open = to;
          else if (open > from && open <= to) open--;
          else if (open < from && open >= to) open++;
          changed();
        }
        render();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    }

    function render() {
      root.replaceChildren();
      fx.forEach((f, i) => root.append(card(f, i)));
      if (fx.length >= FX.SLOTS) {
        root.append(el('p', { class: 'fx-full' }, `That's the max of ${FX.SLOTS} effects. Remove one to add another.`));
        return;
      }
      if (!adding) {
        root.append(el('button', {
          type: 'button', class: 'fx-add', onclick: () => { adding = true; render(); },
        }, el('span', { class: 'fx-plus', 'aria-hidden': 'true' }, '+'), fx.length ? 'Add effect' : 'Add an effect'));
        return;
      }
      const pick = el('div', { class: 'fx-pick' });
      for (const [type, T] of Object.entries(FX.TYPES)) {
        pick.append(el('button', {
          type: 'button', class: 'fx-pickbtn', style: `--fx:${T.color}`,
          onclick: () => { fx.push(FX.create(type)); open = fx.length - 1; adding = false; changed(); render(); },
        }, T.name));
      }
      root.append(el('div', { class: 'fx-empty' },
        el('div', { class: 'fx-emptytop' },
          el('span', {}, `Effect ${fx.length + 1} of ${FX.SLOTS} · pick one`),
          el('button', { type: 'button', class: 'fx-cancel', onclick: () => { adding = false; render(); } }, 'Cancel')),
        pick));
    }

    render();
    return { get: () => fx };
  }

  return { mount };
})();
