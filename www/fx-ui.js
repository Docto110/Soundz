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
    let open = fx.findIndex(f => f);   // first filled slot starts open
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

    function render() {
      root.replaceChildren();
      fx.forEach((f, i) => {
        if (!f) {
          const pick = el('div', { class: 'fx-pick' });
          for (const [type, T] of Object.entries(FX.TYPES)) {
            pick.append(el('button', {
              type: 'button', class: 'fx-pickbtn', style: `--fx:${T.color}`,
              onclick: () => { fx[i] = FX.create(type); open = i; changed(); render(); },
            }, T.name));
          }
          root.append(el('div', { class: 'fx-empty' }, el('span', {}, `Slot ${i + 1} · pick an effect`), pick));
          return;
        }
        const T = FX.TYPES[f.type];
        const isOpen = open === i;
        const head = el('div', { class: 'fx-head' },
          el('span', { class: 'fx-num' }, String(i + 1)),
          el('button', {
            type: 'button', class: 'fx-title', 'aria-expanded': String(isOpen),
            onclick: () => { open = isOpen ? -1 : i; render(); },
          }, el('span', { class: 'fx-name' }, T.name), el('span', { class: 'fx-sum' }, T.summary(f))),
          el('input', {
            type: 'checkbox', class: 'switch fx-on', 'aria-label': T.name + ' on', checked: f.on,
            onchange: e => { f.on = e.target.checked; changed(); render(); },
          }));
        const card = el('div', { class: 'fx-slot' + (f.on ? '' : ' off'), style: `--fx:${T.color}` }, head);
        if (isOpen) {
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
          for (const s of T.sliders) body.append(slider(f, s));
          for (const t of T.toggles || []) {
            body.append(el('label', { class: 'fx-toggle' }, t.label,
              el('input', { type: 'checkbox', class: 'switch', checked: !!f[t.k], onchange: e => { f[t.k] = e.target.checked; changed(); render(); } })));
          }
          body.append(mixRow(f));
          const move = (d) => { const j = i + d; [fx[i], fx[j]] = [fx[j], fx[i]]; open = j; changed(); render(); };
          body.append(el('div', { class: 'fx-actions' },
            el('button', { type: 'button', class: 'fx-act', disabled: i === 0, 'aria-label': 'Move up', onclick: () => move(-1) }, '↑ Earlier'),
            el('button', { type: 'button', class: 'fx-act', disabled: i === FX.SLOTS - 1, 'aria-label': 'Move down', onclick: () => move(1) }, '↓ Later'),
            el('button', { type: 'button', class: 'fx-act danger', onclick: () => { fx[i] = null; open = -1; changed(); render(); } }, 'Remove')));
          card.append(body);
        }
        root.append(card);
      });
    }

    render();
    return { get: () => fx };
  }

  return { mount };
})();
