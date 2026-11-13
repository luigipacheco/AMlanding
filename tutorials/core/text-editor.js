// The Text Editor (Blender's): named text blocks kept in the project (store.data.texts, core/document.js parseTexts),
// saved with it and undoable. One kind of text, as in Blender: a robot program, a script or a note is a text; its
// name's extension says which (Path > Export > Open in Text Editor names it as its file: .script or .src).
// Typing is one undo step per pause (or until the editor loses focus), as the panels' drags are.

import { nextId, MAX_TEXTS, MAX_TEXT_CHARS } from './document.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const IDLE_MS = 800;

export class TextEditor {
  constructor(app) {
    this.app = app;
    this.currentId = null;
    const root = this.root = el('div', 'text-editor');
    root.tabIndex = -1;
    const bar = el('div', 'te-bar');
    this.pick = el('select'); this.pick.setAttribute('aria-label', 'Text');
    this.pick.onchange = () => this.open(this.pick.value, { reveal: false });
    this.name = el('input'); this.name.setAttribute('aria-label', 'Text name'); this.name.maxLength = 64;
    this.name.onchange = () => this.rename(this.name.value);
    const add = el('button', '', '+ New'); add.type = 'button'; add.title = 'A new text'; add.onclick = () => this.create();
    this.download = el('button', '', 'Download'); this.download.type = 'button'; this.download.title = 'Save this text as a file';
    this.download.onclick = () => this.save();
    this.del = el('button', '', 'Delete'); this.del.type = 'button'; this.del.title = 'Delete this text (undo brings it back)';
    this.del.onclick = () => this.remove();
    bar.append(this.pick, this.name, add, this.download, this.del);
    const body = el('div', 'te-body');
    this.gutter = el('pre', 'te-gutter'); this.gutter.setAttribute('aria-hidden', 'true');
    this.area = el('textarea', 'te-text'); this.area.spellcheck = false; this.area.wrap = 'off';
    this.area.setAttribute('aria-label', 'Text');
    this.area.addEventListener('input', () => this.typed());
    this.area.addEventListener('blur', () => this.settle());
    this.area.addEventListener('scroll', () => { this.gutter.scrollTop = this.area.scrollTop; });
    this.area.addEventListener('keydown', e => {
      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {   // indent, as a code editor, instead of leaving
        e.preventDefault();
        this.area.setRangeText('    ', this.area.selectionStart, this.area.selectionEnd, 'end');
        this.typed();
      }
      e.stopPropagation();                                                // the editor's keys stay here
    });
    this.empty = el('p', 'te-empty', 'No texts yet. + New makes one; Path > Export > Open in Text Editor puts a generated program here.');
    body.append(this.gutter, this.area);
    this.body = body;
    root.append(bar, body, this.empty);
    this.render();
  }

  get texts() { return this.app.store.data.texts || []; }
  get text() { return this.texts.find(t => t.id === this.currentId) || this.texts[0] || null; }

  /** A new text (one undo step); opens it. Named Text, Text.001, ... as Blender's unless a name is given. */
  create({ name = 'Text', body = '' } = {}) {
    const data = this.app.store.data, texts = data.texts ||= [];
    if (texts.length >= MAX_TEXTS) { this.app.notice(`A project holds up to ${MAX_TEXTS} texts: delete one first`); return null; }
    const names = new Set(texts.map(t => t.name));
    let base = String(name || 'Text').slice(0, 64), unique = base, i = 1;
    while (names.has(unique)) unique = `${base.slice(0, 58)}.${String(i++).padStart(3, '0')}`;
    this.settle();
    this.app.store.begin('New text');
    const text = { id: nextId(data, 'x', texts.map(t => t.id)), name: unique, body: String(body).slice(0, MAX_TEXT_CHARS) };
    texts.push(text);
    this.app.store.commit(); this.app.syncHistory();
    this.open(text.id);
    return text;
  }

  /** Show a text (and, unless reveal is false, make sure an area shows the Text Editor). */
  open(id, { reveal = true } = {}) {
    this.settle();
    this.currentId = id;
    if (reveal) this.app.areas?.ensure('text', { near: 'view3d', dir: 'row', ratio: 0.4 });
    this.render();
  }

  rename(name) {
    const t = this.text; name = String(name || '').trim().slice(0, 64);
    if (!t || !name || name === t.name) { this.render(); return; }
    this.app.store.begin('Rename text'); t.name = name; this.app.store.commit(); this.app.syncHistory();
    this.render();
  }

  remove() {
    const t = this.text; if (!t) return;
    this.settle();
    this.app.store.begin(`Delete ${t.name}`);
    this.app.store.data.texts = this.texts.filter(x => x !== t);
    this.app.store.commit(); this.app.syncHistory();
    this.currentId = null; this.render();
    this.app.notice(`${t.name} deleted · Ctrl+Z brings it back`);
  }

  /** Typing: the text changes in the document; one undo step per pause. */
  typed() {
    const t = this.text; if (!t) return;
    if (!this.editing) { this.app.store.begin(`Edit ${t.name}`); this.editing = true; }
    t.body = this.area.value.slice(0, MAX_TEXT_CHARS);
    this.numbers();
    clearTimeout(this.idle); this.idle = setTimeout(() => this.settle(), IDLE_MS);
  }
  settle() {
    clearTimeout(this.idle);
    if (!this.editing) return;
    this.editing = false;
    this.app.store.commit(); this.app.syncHistory();
  }

  save() {
    const t = this.text; if (!t) return;
    const filename = /\.[a-z0-9]+$/i.test(t.name) ? t.name : `${t.name}.txt`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([t.body], { type: 'text/plain;charset=utf-8' }));
    a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  numbers() {
    const n = this.area.value.split('\n').length;
    if (n !== this.lines) { this.lines = n; this.gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n'); }
  }

  render() {
    const texts = this.texts, t = this.text;
    if (t) this.currentId = t.id;
    this.pick.replaceChildren(...texts.map(x => new Option(x.name, x.id)));
    if (t) this.pick.value = t.id;
    for (const c of [this.pick, this.name, this.download, this.del]) c.disabled = !t;
    this.empty.hidden = !!t; this.body.hidden = !t;
    this.area.disabled = !t;
    this.name.value = t?.name || '';
    if (this.area.value !== (t?.body ?? '') && !(this.editing && document.activeElement === this.area)) this.area.value = t?.body ?? '';
    this.numbers();
  }
}
