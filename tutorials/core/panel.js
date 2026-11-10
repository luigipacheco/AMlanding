// The inputs panel.
//
// Robot IDE (opts.interactive): Blender's N sidebar. A vertical tab strip (Animaquina / View) and, in the
// Animaquina tab, the add-on's own four panels (animaquina/ui/panels.py): Robots, Move, Path, Watch. Each panel
// collapses; a gear opens its settings (the add-on's Robot / Move / Path Settings popovers); sub-sections collapse
// like Blender sub-panels.
// Tutorials: a flat list; the strip of four panel names lights up where the slide's controls live in Animaquina.
//
// Specs:
//   { key, label, type: 'slider', min, max, step, value, unit }
//   { key, label, type: 'menu', options: [...], value }
//   { key, label, type: 'select', options: [{ value, label }], value }
//   { key, label, type: 'text', value }
//   { key, label, type: 'button' }                        onChange(key, true) when pressed
//   { type: 'buttons', items: [{ key, label, disabled, note }] }
//   { key, type: 'list', items: [{ value, label, sub }], value }   onChange(key, value) when a row is picked
//   { type: 'header', label }        { type: 'info', key?, label, tone?: 'warn' | 'muted' }
//   { type: 'readout', key, label, value }               live text, set with panel.setText(key, text)
// Any spec: tab ('ROBOTS' | 'MOVE' | 'PATH' | 'WATCH' | 'VIEW'), section (sub-panel title), gear (true: the
// section opens from the panel's gear), open (sub-panel starts open), when (values => bool),
// disabled + note (shown greyed with the reason), view (view state such as a scrub position: changes are not undo steps).

export const TABS = ['ROBOTS', 'MOVE', 'PATH', 'WATCH'];
const NAMES = { ROBOTS: 'Robots', MOVE: 'Move', PATH: 'Path', WATCH: 'Watch' };
const SIDE = ['Item', 'View'];   // the right sidebar; Animaquina's panels have their own sidebar on the left
const STORE_KEY = 'animaquina.sidebar';
let uid = 0;

function loadState() {
  // only what has the right shape: a damaged entry must not stop the page from starting
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY)) || {}, out = {};
    const flags = o => o && typeof o === 'object' && !Array.isArray(o);
    if (typeof s.side === 'string') out.side = s.side;
    if (flags(s.open)) out.open = s.open;
    if (flags(s.sub)) out.sub = s.sub;
    if (typeof s.leftHidden === 'boolean') out.leftHidden = s.leftHidden;
    return out;
  } catch { return {}; }
}
function saveState(state) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* private window: keep in memory */ }
}

export class Panel {
  constructor(root) {
    this.el = document.createElement('aside');
    this.el.className = 'panel';
    this.el.innerHTML = `
      <button class="sheet-toggle" type="button" aria-expanded="false"></button>
      <div class="panel-tabs" role="tablist"></div>
      <div class="panel-body"></div>
      <div class="panel-foot"></div>
      <nav class="side-tabs" aria-label="Sidebar tabs"></nav>`;
    root.appendChild(this.el);
    this.tabsEl = this.el.querySelector('.panel-tabs');
    this.body = this.el.querySelector('.panel-body');
    this.foot = this.el.querySelector('.panel-foot');
    this.sideEl = this.el.querySelector('.side-tabs');
    // phones: the tutorial's controls fold into one bar; tap it to open them over the bottom of the screen
    this.sheetBtn = this.el.querySelector('.sheet-toggle');
    this.sheetBtn.addEventListener('click', () => this.setSheet(!this.el.classList.contains('sheet-open')));
    this.setSheet(false);
    this.rows = {};
    this.state = { side: 'Item', open: { ROBOTS: true, MOVE: true, PATH: false, WATCH: true }, sub: {}, ...loadState() };
    if (!SIDE.includes(this.state.side)) this.state.side = 'Item';
    this.root = root;
  }

  get visible() { return !this.el.classList.contains('hidden') && !this.el.classList.contains('empty'); }
  setSheet(open) {
    this.el.classList.toggle('sheet-open', open);
    this.sheetBtn.setAttribute('aria-expanded', String(open));
    this.sheetBtn.innerHTML = open ? '<span>Hide controls</span><span>\u25be</span>' : '<span>Controls</span><span>\u25b4</span>';
    this.onLayout?.();
  }
  toggle() { this.el.classList.toggle('hidden'); this.onVisibility?.(); }

  /** Kept for older callers: in the sidebar, "active" means the open panel. */
  get active() { return this.lastRevealed || 'MOVE'; }
  set active(tab) { this.reveal(tab); }

  /**
   * opts: { interactive (Robot IDE sidebar), used: [panel names] (tutorial strip), titles: { ROBOTS: '…' },
   *         begin(label), commit() (undo transactions), foot: text }
   */
  build(specs, values, onChange, opts = {}) {
    // A rebuild must not move the reader: remember where each sidebar was scrolled and which control had the keyboard.
    const scroll = [this.body, this.leftBody].map(b => b?.scrollTop || 0);
    const focused = Object.entries(this.rows || {}).find(([, r]) => r.row.contains(document.activeElement));
    const part = focused && [...focused[1].row.querySelectorAll('button, [tabindex="0"]')].indexOf(document.activeElement);
    Object.assign(this, { specs, values, onChange, opts });
    this.foot.textContent = opts.foot || '';
    this.rows = {};
    this.body.innerHTML = '';
    if (this.leftBody) this.leftBody.innerHTML = '';
    this.leftEl?.classList.toggle('absent', !opts.interactive);
    this.el.classList.toggle('sidebar', !!opts.interactive);
    if (opts.interactive) this.buildSidebar(specs);
    else this.buildFlat(specs);
    this.refresh();
    [this.body, this.leftBody].forEach((b, i) => { if (b) b.scrollTop = scroll[i]; });
    if (focused && !focused[0].startsWith('_')) {
      const row = this.rows[focused[0]]?.row, again = row && [...row.querySelectorAll('button, [tabindex="0"]')];
      (again?.[Math.max(0, part)] || again?.[0])?.focus({ preventScroll: true });
    }
  }

  // ── tutorials: flat list + lit strip ─────────────────────────────────────────
  buildFlat(specs) {
    this.sideEl.innerHTML = '';
    this.tabsEl.innerHTML = '';
    for (const t of TABS) {
      const b = document.createElement('button');
      b.textContent = t;
      b.disabled = true;
      const used = (this.opts.used || []).includes(t);
      b.classList.toggle('on', used);
      b.title = used ? `This slide's controls live in Animaquina's ${NAMES[t]} panel` : '';
      this.tabsEl.appendChild(b);
    }
    if (!specs.length) this.body.innerHTML = '<div class="empty">Nothing to change on this slide.</div>';
    this.el.classList.toggle('empty', !specs.length);
    specs.forEach((s, i) => this.body.appendChild(this.row(s, i)));
  }

  // ── Robot IDE: Blender N sidebar ─────────────────────────────────────────────
  buildSidebar(specs) {
    this.tabsEl.innerHTML = '';
    this.sideEl.innerHTML = '';
    for (const name of SIDE) {
      const b = document.createElement('button');
      b.textContent = name;
      b.className = name === this.state.side ? 'on' : '';
      b.setAttribute('aria-pressed', name === this.state.side ? 'true' : 'false');
      b.addEventListener('click', () => { this.state.side = name; saveState(this.state); this.build(this.specs, this.values, this.onChange, this.opts); });
      this.sideEl.appendChild(b);
    }
    let index = 0;
    // Panels hold controls, as Blender's do. A standing hint (muted text that never changes) becomes the tooltip of
    // the control above it, or of the one below when it comes first; a list that is only hints still shows them
    // (the empty state). opts.hints: 'inline' puts them all back.
    const isHint = s => s.type === 'info' && s.tone === 'muted' && !s.key && this.opts.hints !== 'inline';
    const rowsFor = list => {
      if (!list.some(s => !isHint(s) && s.type !== 'header')) return list.map(s => this.row(s, index++));
      const rows = []; let waiting = [];
      const tip = (row, text) => { row.title = [row.title, text].filter(Boolean).join('\n'); row.classList.add('has-hint'); };
      for (const s of list) {
        if (isHint(s)) { index++; if (rows.length) tip(rows[rows.length - 1], s.label); else waiting.push(s.label); continue; }
        const row = this.row(s, index++);
        for (const text of waiting) tip(row, text);
        waiting = []; rows.push(row);
      }
      return rows;
    };
    // right: Item or View
    {
      const tab = this.state.side.toUpperCase();
      const view = document.createElement('div');
      view.className = 'bpanel open';
      view.innerHTML = '<div class="bpanel-head static"><span class="bpanel-title"></span></div><div class="bpanel-content"></div>';
      view.querySelector('.bpanel-title').textContent = this.opts.titles?.[tab] ? `${this.state.side} · ${this.opts.titles[tab]}` : this.state.side;
      view.lastChild.append(...rowsFor(specs.filter(s => s.tab === tab)));
      this.body.appendChild(view);
    }
    // left: Animaquina's panels (Robots / Move / Path / Watch), always there, so Item and Animaquina show together
    this.ensureLeft();
    this.panels = {};
    for (const tab of TABS) {
      const mine = specs.filter(s => s.tab === tab);
      if (!mine.length) continue;
      const box = document.createElement('section');
      box.className = 'bpanel';
      box.dataset.tab = tab;
      const head = document.createElement('div');
      head.className = 'bpanel-head';
      const toggle = document.createElement('button');
      toggle.className = 'bpanel-toggle';
      const title = this.opts.titles?.[tab];
      toggle.innerHTML = `<span class="tri" aria-hidden="true"></span><span class="bpanel-title"></span>`;
      toggle.lastChild.textContent = title ? `${NAMES[tab]} · ${title}` : NAMES[tab];
      toggle.addEventListener('click', () => this.setOpen(tab, !this.state.open[tab]));
      head.appendChild(toggle);
      const content = document.createElement('div');
      content.className = 'bpanel-content';
      const gearSpecs = mine.filter(s => s.gear);
      if (gearSpecs.length) {
        const gear = document.createElement('button');
        gear.className = 'gear';
        gear.title = `${NAMES[tab]} settings`;
        gear.setAttribute('aria-label', `${NAMES[tab]} settings`);
        gear.textContent = '⚙';
        const pop = document.createElement('div');
        pop.className = 'gear-pop';
        pop.innerHTML = `<div class="gear-title">${NAMES[tab]} Settings</div>`;
        pop.append(...rowsFor(gearSpecs));
        const gk = `gear:${tab}`;
        const show = on => { pop.hidden = !on; gear.classList.toggle('on', on); gear.setAttribute('aria-expanded', on ? 'true' : 'false'); };
        show(!!this.state.sub[gk]);
        gear.addEventListener('click', () => {
          this.state.sub[gk] = !this.state.sub[gk]; saveState(this.state); show(this.state.sub[gk]);
          if (this.state.sub[gk]) this.setOpen(tab, true);
        });
        head.appendChild(gear);
        content.appendChild(pop);
      }
      // main rows, then collapsible sub-panels in the order they appear
      const plain = mine.filter(s => !s.gear && !s.section);
      content.append(...rowsFor(plain));
      const sections = [...new Set(mine.filter(s => !s.gear && s.section).map(s => s.section))];
      for (const name of sections) {
        const sk = `${tab}:${name}`;
        const list = mine.filter(s => !s.gear && s.section === name);
        const sub = document.createElement('div');
        sub.className = 'bsub';
        const sh = document.createElement('button');
        sh.className = 'bsub-head';
        sh.innerHTML = `<span class="tri" aria-hidden="true"></span><span></span>`;
        sh.lastChild.textContent = name;
        const body = document.createElement('div');
        body.className = 'bsub-content';
        body.append(...rowsFor(list));
        const open = this.state.sub[sk] ?? !!list.some(s => s.open);
        const set = on => { sub.classList.toggle('open', on); sh.setAttribute('aria-expanded', on ? 'true' : 'false'); };
        set(open);
        sh.addEventListener('click', () => { this.state.sub[sk] = !sub.classList.contains('open'); saveState(this.state); set(this.state.sub[sk]); });
        sub.append(sh, body);
        content.appendChild(sub);
      }
      box.append(head, content);
      this.leftBody.appendChild(box);
      this.panels[tab] = { box, toggle };
      this.applyOpen(tab);
    }
  }

  /** The left sidebar (Animaquina's panels), made once. Its header folds it to a strip. */
  ensureLeft() {
    if (this.leftEl) return;
    const el = this.leftEl = document.createElement('aside');
    el.className = 'panel sidebar left';
    el.innerHTML = '<div class="left-head"><span class="left-title">Animaquina</span><button class="left-fold" type="button"></button></div><div class="panel-body"></div>';
    this.leftBody = el.querySelector('.panel-body');
    const hide = el.querySelector('.left-fold');
    hide.textContent = '\u2039'; hide.title = 'Hide the Animaquina panels (the \u25e7 button in the top bar brings them back)';
    const show = () => {
      const hidden = !!this.state.leftHidden;
      el.classList.toggle('hidden', hidden); this.root.classList.toggle('left-hidden', hidden);
      this.onVisibility?.();
    };
    hide.onclick = () => this.toggleLeft(false);
    this.root.appendChild(el);
    this.showLeft = show;
    show();
  }
  get leftVisible() { return !!this.leftEl && !this.leftEl.classList.contains('absent') && !this.leftEl.classList.contains('hidden'); }
  /** Show / hide the left sidebar (Animaquina's panels). on: true / false, or toggle. */
  toggleLeft(on = !!this.state.leftHidden) {
    this.state.leftHidden = !on; saveState(this.state);
    this.showLeft?.(); this.onLayout?.();
  }

  /** Switch the right sidebar tab (Item / View). */
  showSide(name) {
    if (!SIDE.includes(name) || !this.opts?.interactive || this.state.side === name) return;
    this.state.side = name; saveState(this.state);
    this.build(this.specs, this.values, this.onChange, this.opts);
  }

  setOpen(tab, on) { this.state.open[tab] = on; saveState(this.state); this.applyOpen(tab); }
  applyOpen(tab) {
    const p = this.panels?.[tab]; if (!p) return;
    const on = !!this.state.open[tab];
    p.box.classList.toggle('open', on);
    p.toggle.setAttribute('aria-expanded', on ? 'true' : 'false');
  }

  /** Open a panel so the user sees the controls a shortcut just used (unfolding the left sidebar if needed). */
  reveal(tab) {
    this.lastRevealed = tab;
    if (!this.opts?.interactive) return;
    if (this.state.leftHidden) this.toggleLeft(true);
    this.setOpen(tab, true);
    this.panels?.[tab]?.box.scrollIntoView({ block: 'nearest' });
  }
  markTabs() {}

  // ── rows ─────────────────────────────────────────────────────────────────────
  row(s, i) {
    const row = document.createElement('div');
    row.className = `row ${s.type}`;
    if (s.type === 'header') row.textContent = s.label;
    else this[s.type](row, s);
    if (s.disabled) {
      row.classList.add('disabled');
      row.title = s.note || '';
      row.querySelectorAll('input, select, button').forEach(el => { el.disabled = true; });
    }
    this.rows[s.key || `_${i}`] = { row, spec: s };
    return row;
  }

  label(row, s) {
    const id = `in${++uid}`;
    const lab = document.createElement('label');
    lab.textContent = s.label;
    lab.htmlFor = id;
    row.appendChild(lab);
    return id;
  }

  /**
   * Blender-style number field: name and value in one bar, the fill shows where the value sits in its range.
   *   drag sideways      change it (the full width = the full range); Shift: fine, Ctrl: snap to coarse steps
   *   click / Enter      type a value (Enter confirm, Esc cancel)
   *   arrow keys         one step (Shift: ten); Home / End: min / max
   * One drag or one typed edit = one undo step.
   */
  slider(row, s) {
    const step = s.step ?? 0.1, dec = decimals(step), span = s.max - s.min;
    const snap = step < 1 ? step * 50 : step * 5;
    const field = document.createElement('div');
    field.className = 'bfield';
    field.tabIndex = 0;
    field.setAttribute('role', 'slider');
    field.setAttribute('aria-label', s.label);
    field.setAttribute('aria-valuemin', s.min);
    field.setAttribute('aria-valuemax', s.max);
    field.innerHTML = '<span class="bfield-fill"></span><span class="bfield-name"></span><span class="bfield-value"></span>';
    const [fill, name, val] = field.children;
    name.textContent = s.label;
    row.appendChild(field);

    const clamp = v => (s.softRange ? v : Math.min(s.max, Math.max(s.min, v)));
    const round = v => +(+v).toFixed(dec);
    const text = v => `${round(v).toFixed(dec)}${s.unit ? ` ${s.unit}` : ''}`;
    const show = v => {
      fill.style.width = `${Math.max(0, Math.min(1, (v - s.min) / (span || 1))) * 100}%`;
      val.textContent = text(v);
      field.setAttribute('aria-valuenow', v);
      field.setAttribute('aria-valuetext', text(v));
    };
    show(this.values[s.key]);
    row.show = show;

    // drag (with a small dead zone so a click stays a click)
    let drag = null;
    field.addEventListener('pointerdown', e => {
      if (e.button !== 0 || field.classList.contains('editing') || row.classList.contains('disabled')) return;
      e.preventDefault();
      field.focus({ preventScroll: true });
      field.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, start: this.values[s.key], moved: false, last: e.clientX, value: this.values[s.key] };
    });
    field.addEventListener('pointermove', e => {
      if (!drag) return;
      if (!drag.moved && Math.abs(e.clientX - drag.x) < 3) return;
      if (!drag.moved) { drag.moved = true; field.classList.add('dragging'); if (!s.view) this.opts.begin?.(s.label); }
      const perPx = (span || 1) / Math.max(40, field.clientWidth) * (e.shiftKey ? 0.1 : 1);
      drag.value += (e.clientX - drag.last) * perPx;       // relative, so Shift can slow down mid-drag
      drag.last = e.clientX;
      let v = clamp(drag.value);
      v = e.ctrlKey || e.metaKey ? Math.round(v / snap) * snap : Math.round(v / step) * step;
      v = round(clamp(v));
      if (v !== this.values[s.key]) { show(v); this.change(s.key, v, false); }
    });
    const end = e => {
      if (!drag) return;
      const moved = drag.moved; drag = null;
      field.classList.remove('dragging');
      if (field.hasPointerCapture?.(e.pointerId)) field.releasePointerCapture(e.pointerId);
      if (moved && !s.view) this.opts.commit?.();
      else if (!moved && e.type === 'pointerup') edit();
    };
    field.addEventListener('pointerup', end);
    field.addEventListener('pointercancel', end);

    // type a value
    const edit = () => {
      if (field.classList.contains('editing')) return;
      field.classList.add('editing');
      const input = document.createElement('input');
      input.type = 'text'; input.inputMode = 'decimal'; input.className = 'bfield-input';
      input.value = round(this.values[s.key]);
      input.setAttribute('aria-label', `${s.label}${s.unit ? ` (${s.unit})` : ''}`);
      field.appendChild(input);
      input.focus(); input.select();
      let done = false;
      const finish = ok => {
        if (done) return; done = true;
        // a number, with an optional unit after it; anything else (a stray G, "abc") leaves the value as it was
        const typed = /^\s*([+-]?(?:\d+[.,]?\d*|[.,]\d+)(?:e[+-]?\d+)?)\s*[a-z°%/]*\s*$/i.exec(input.value);
        const n = typed ? Number(typed[1].replace(',', '.')) : NaN;
        input.remove(); field.classList.remove('editing');
        const v = ok && Number.isFinite(n) ? round(clamp(n)) : this.values[s.key];
        show(v);
        if (v !== this.values[s.key]) this.change(s.key, v);   // clicking in and out is not an edit
        field.focus({ preventScroll: true });
      };
      input.addEventListener('keydown', e => {
        e.stopPropagation();                               // typing never triggers shortcuts
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      });
      input.addEventListener('blur', () => finish(true));
      input.addEventListener('pointerdown', e => e.stopPropagation());
    };

    // keyboard
    field.addEventListener('keydown', e => {
      if (e.target !== field) return;
      const stepKeys = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };
      let v = null;
      if (stepKeys[e.key]) v = this.values[s.key] + stepKeys[e.key] * step * (e.shiftKey ? 10 : 1);
      else if (e.key === 'Home' && !s.softRange) v = s.min;   // a soft range has no ends: Home stays "frame all"
      else if (e.key === 'End' && !s.softRange) v = s.max;
      else if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); e.stopPropagation(); edit(); return; }
      else return;
      e.preventDefault(); e.stopPropagation();             // arrows here never change slides
      v = round(clamp(v));
      show(v); this.change(s.key, v);
    });
  }

  menu(row, s) {
    const id = this.label(row, s);
    const seg = document.createElement('div');
    seg.className = 'seg';
    seg.setAttribute('role', 'radiogroup');
    row.firstChild.removeAttribute('for'); row.firstChild.id = id;
    seg.setAttribute('aria-labelledby', id);
    s.options.forEach(o => {
      const b = document.createElement('button');
      b.textContent = o;
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => { row.show(o); this.change(s.key, o); });
      seg.appendChild(b);
    });
    if (s.options.length > 3) seg.classList.add('wrap');
    row.appendChild(seg);
    row.show = v => [...seg.children].forEach(b => {
      b.classList.toggle('on', b.textContent === v);
      b.setAttribute('aria-checked', b.textContent === v ? 'true' : 'false');
      b.tabIndex = b.textContent === v ? 0 : -1;
    });
    seg.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      const buttons = [...seg.children], index = buttons.indexOf(document.activeElement);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1
        : (index + (['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next].click(); buttons[next].focus();
    });
    row.show(this.values[s.key]);
  }

  select(row, s) {
    const id = this.label(row, s);
    const sel = document.createElement('select');
    sel.id = id;
    for (const o of s.options) sel.add(new Option(o.label, o.value));
    sel.value = this.values[s.key];
    sel.addEventListener('change', () => this.change(s.key, sel.value));
    row.appendChild(sel);
    row.show = v => { sel.value = v; };
  }

  text(row, s) {
    const id = this.label(row, s);
    const input = document.createElement('input');
    input.type = 'text'; input.id = id; input.maxLength = 64;
    input.value = this.values[s.key] ?? '';
    input.placeholder = s.placeholder || '';
    input.addEventListener('change', () => this.change(s.key, input.value.trim().slice(0, 64)));
    row.appendChild(input);
    row.show = v => { input.value = v ?? ''; };
  }

  /** A Blender-style UI list: one row per item, the active one lit. s.items: [{ value, label, sub }] */
  list(row, s) {
    const box = document.createElement('div');
    box.className = 'ulist';
    box.setAttribute('role', 'listbox');
    box.setAttribute('aria-label', s.label || 'List');
    for (const it of s.items) {
      const b = document.createElement('button');
      b.className = 'ulist-item';
      b.setAttribute('role', 'option');
      b.dataset.value = it.value;
      b.innerHTML = '<span class="ul-name"></span><span class="ul-sub"></span>';
      b.firstChild.textContent = it.label;
      b.lastChild.textContent = it.sub || '';
      b.addEventListener('click', () => { if (it.value === s.value) return; this.values[s.key] = it.value; this.press(s.key, s.label, it.value); });
      box.appendChild(b);
    }
    row.appendChild(box);
    row.show = v => [...box.children].forEach(b => {
      const on = b.dataset.value === v;
      b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    row.show(s.value);
  }

  button(row, s) {
    const b = document.createElement('button');
    b.className = 'btn-row';
    b.textContent = s.label;
    b.addEventListener('click', () => this.press(s.key, s.label));
    row.appendChild(b);
  }

  buttons(row, s) {
    for (const item of s.items) {
      const b = document.createElement('button');
      b.className = 'btn-row';
      b.textContent = item.label;
      if (item.disabled) { b.disabled = true; b.title = item.note || ''; }
      b.addEventListener('click', () => this.press(item.key, item.label));
      row.appendChild(b);
    }
  }

  info(row, s) {
    row.textContent = s.label;
    if (s.tone) row.classList.add(s.tone);
    row.setText = t => { row.textContent = t; };
  }

  readout(row, s) {
    const lab = document.createElement('span');
    lab.className = 'readout-label'; lab.textContent = s.label;
    const val = document.createElement('span');
    val.className = 'readout-value'; val.textContent = s.value ?? '';
    row.append(lab, val);
    row.setText = t => { val.textContent = t; };
  }

  press(key, label, value = true) { this.opts.begin?.(label); this.onChange(key, value); this.opts.commit?.(); }

  change(key, v, commit = true) {
    const view = this.rows[key]?.spec.view;      // view state (a scrub position): not an edit, so not an undo step
    if (!view) this.opts.begin?.(this.rows[key]?.spec.label || key);
    this.values[key] = v;
    this.onChange(key, v);
    this.refresh();
    if (commit && !view) this.opts.commit?.();
  }

  /** Set an input from code (e.g. a slide syncing joints and target); does not call onChange. */
  set(key, v) {
    this.values[key] = v;
    this.rows[key]?.row.show?.(v);
  }

  /** Update a live 'readout' or keyed 'info' row. */
  setText(key, text) { this.rows[key]?.row.setText?.(text); }

  refresh() {
    for (const { row, spec } of Object.values(this.rows)) {
      row.style.display = !spec.when || spec.when(this.values) ? '' : 'none';
    }
  }
}

const decimals = step => {
  const [coefficient, exponent = '0'] = String(step).toLowerCase().split('e');
  return Math.max(0, (coefficient.split('.')[1]?.length || 0) - Number(exponent));
};
