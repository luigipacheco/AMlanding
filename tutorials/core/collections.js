// Collections (Blender's Outliner): everything in the project as a tree, laid out by what belongs to what, so the
// relationships show:
//   Robots   each robot: its target (an Empty), its path chain (the objects it follows, in order), its timeline
//            tasks and its connection to a real robot
//   Objects  the scene's collections (store.data.collections, as Blender's: named groups of objects; the one named
//            Obstacles is what RMPflow keeps the robot away from), each with its objects, then the objects in no
//            collection. For a Nodes object, the objects its graph reads (Object Info); for any object, the robots
//            whose path or target it is and the Nodes objects that read it
// Texts are not scene content and stay in the Text Editor, as in Blender's View Layer outliner.
// A click selects what the row stands for (an object, a robot, a task), as a click in its own editor does.
// The tree is drawn from the project document, so it follows every edit and undo.

import { nextId, MAX_COLLECTIONS } from './document.js';
import * as m from './mat.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const ICON = { robot: '⚙', target: '◎', empty: '✛', grid: '▦', cube: '▣', cylinder: '◫', sphere: '◯', geometry: '⬡',
  chain: '⤳', task: '▷', link: '⇄', reads: '←', missing: '⚠', collection: '❏' };
const TYPE = { grid: 'Grid', cube: 'Cube', cylinder: 'Cylinder', sphere: 'Sphere', geometry: 'Nodes', empty: 'Empty' };

/** Who uses an object: { target: [robot], paths: [robot], readers: [nodes object] }. Pure: the project's data only. */
export function relations(data) {
  const robots = data.registry?.robots || [], objects = data.objects || [];
  const of = uid => ({
    target: robots.filter(r => r.target === uid),
    paths: robots.filter(r => (r.paths || []).includes(uid)),
    readers: objects.filter(o => o.type === 'geometry' && reads(o).includes(uid)),
  });
  return { of, reads };
}
/** The objects a Nodes object's graph reads with Object Info. */
export function reads(o) {
  return [...new Set((o.graph?.nodes || []).filter(n => n.kind === 'object_info' && n.params?.object).map(n => n.params.object))];
}

// ── collections: the project's named groups of objects ─────────────────────────
/** The collection RMPflow avoids unless another is chosen (the add-on's Puppet Mode takes an obstacle collection). */
export const OBSTACLES = 'Obstacles';
/** Blender's names: base, then base.001, base.002... */
export function uniqueName(taken, base) {
  const names = new Set(taken);
  let name = base, i = 1;
  while (names.has(name)) name = `${base.slice(0, 58)}.${String(i++).padStart(3, '0')}`;
  return name;
}
/** The collections an object is in. */
export function collectionsWith(data, uid) { return (data.collections || []).filter(c => c.objects.includes(uid)); }
/** A new, empty collection (edits data: call inside an undo step). Null when the project holds the most. */
export function newCollection(data, name = 'Collection') {
  const list = data.collections ||= [];
  if (list.length >= MAX_COLLECTIONS) return null;
  const c = { id: nextId(data, 'c', list.map(x => x.id)), name: uniqueName(list.map(x => x.name), name), objects: [] };
  list.push(c);
  return c;
}
/** Blender's M (Move to Collection): the object leaves every collection and joins `id` ('' leaves them all). */
export function moveToCollection(data, uid, id) {
  for (const c of data.collections || []) c.objects = c.objects.filter(u => u !== uid);
  const c = (data.collections || []).find(x => x.id === id);
  if (c) c.objects.push(uid);
}
/** Delete a collection; its objects stay in the scene (Blender's Delete, not Delete Hierarchy). */
export function removeCollection(data, id) { data.collections = (data.collections || []).filter(c => c.id !== id); }
/**
 * The collection RMPflow avoids: choice '' (the default) is the one named Obstacles, 'none' is none, else a
 * collection id (null when it was deleted).
 */
export function obstacleCollection(data, choice = '') {
  const list = data.collections || [];
  if (choice === 'none') return null;
  return choice ? list.find(c => c.id === choice) || null : list.find(c => c.name === OBSTACLES) || null;
}
/**
 * The sphere around an object's geometry (evaluated, object space, metres) placed by its matrix: the centre of its
 * bounding box and the farthest corner, as the add-on's obstacles_from_slot does. Null for no points (an empty).
 */
export function boundingSphere(geometry, matrix) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  let any = false;
  for (const g of [geometry?.mesh, geometry?.curves]) {
    const d = g?.attributes?.position?.data;
    if (!d) continue;
    for (let i = 0; i + 2 < d.length; i += 3) {
      for (let k = 0; k < 3; k++) { if (d[i + k] < lo[k]) lo[k] = d[i + k]; if (d[i + k] > hi[k]) hi[k] = d[i + k]; }
      any = true;
    }
  }
  if (!any) return null;
  const corners = [];
  for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) corners.push(m.point(matrix, [x, y, z]));
  const centre = [0, 1, 2].map(k => corners.reduce((a, c) => a + c[k], 0) / 8);
  return { centre, radius: Math.max(...corners.map(c => Math.hypot(c[0] - centre[0], c[1] - centre[1], c[2] - centre[2]))) };
}

export class Collections {
  constructor(app) {
    this.app = app;
    this.root = el('div', 'collections');
    this.root.tabIndex = -1;
    this.root.setAttribute('role', 'tree');
    this.root.setAttribute('aria-label', 'Collections');
    this.open = { Robots: true, Objects: true };
    this.revision = -1;
    this.shut = new Set();                     // collections drawn closed (view state)
  }

  /** Draw again when the project changed since the last drawing (or always, with force). */
  refresh(force = false) { if (force || this.app.store.revision !== this.revision) this.render(); }

  render() {
    const app = this.app, data = app.store.data, reg = app.registry;
    if (!reg) return;
    this.revision = app.store.revision;
    const objects = data.objects || [], byUid = new Map(objects.map(o => [o.uid, o]));
    const { of } = relations(data), selected = data.selected, active = reg.active?.uid;
    const tasks = app.timeline?.tasks || [];
    const frag = document.createDocumentFragment();

    const row = (depth, icon, label, { sub = '', on, selected: sel = false, title = '', tone = '' } = {}) => {
      const r = el(on ? 'button' : 'div', `col-row${sel ? ' selected' : ''}${tone ? ` ${tone}` : ''}`);
      if (on) { r.type = 'button'; r.onclick = on; }
      r.setAttribute('role', 'treeitem'); r.style.paddingLeft = `${6 + depth * 14}px`;
      if (title) r.title = title;
      r.append(el('span', 'col-icon', icon), el('span', 'col-label', label));
      if (sub) r.append(el('span', 'col-sub', sub));
      frag.append(r);
    };
    const section = (name, count) => {
      const h = el('button', 'col-section', `${this.open[name] ? '▾' : '▸'} ${name}  ${count}`);
      h.type = 'button'; h.setAttribute('aria-expanded', String(!!this.open[name]));
      h.onclick = () => { this.open[name] = !this.open[name]; this.render(); };
      frag.append(h);
      return this.open[name];
    };
    const selectObject = o => () => {
      const owner = reg.robots.find(r => r.target === o.uid);
      if (o.uid !== data.selected || (owner && owner.uid !== active)) {
        app.sceneEdit('Select', () => { app.objects.select(o.uid); if (owner) reg.activate(owner.uid); });
      }
      app.panel.showSide?.('Item');
    };
    const objectRow = (depth, uid, label) => {
      const o = byUid.get(uid);
      if (!o) { row(depth, ICON.missing, label || uid, { sub: 'missing', tone: 'warn', title: 'This object was deleted' }); return; }
      row(depth, ICON[o.type] || '•', o.name, { sub: label || TYPE[o.type], on: selectObject(o), selected: o.uid === selected });
    };

    // ── robots and what belongs to each ───────────────────────────────────────
    if (section('Robots', reg.robots.length)) {
      for (const inst of reg.robots) {
        const def = reg.def(inst), isActive = inst.uid === active;
        row(0, ICON.robot, inst.name, { sub: `${def.maker} ${def.name}${isActive ? ' · active' : ''}`, selected: isActive && !selected,
          on: () => { if (!isActive || selected) app.sceneEdit('Select robot', () => { app.objects.select(null); reg.activate(inst.uid); }); } });
        if (inst.target) objectRow(1, inst.target, 'Target');
        const chain = inst.paths || [];
        if (chain.length) {
          row(1, ICON.chain, 'Path chain', { sub: `${chain.length} in order` });
          chain.forEach((uid, i) => objectRow(2, uid, `${i + 1}. path`));
        }
        for (const k of tasks.filter(t => t.robot === inst.uid)) {
          row(1, ICON.task, k.name, { sub: `task · ${k.start.toFixed(1)}–${(k.start + k.duration).toFixed(1)} s`, selected: app.timelineUI?.selected === k.id,
            on: () => {
              if (!isActive) app.activateRobot(inst.uid);
              if (app.timelineUI) { app.timelineUI.selected = k.id; app.timelineUI.render(); }
              this.render();
            } });
        }
        const said = app.live?.describe(inst.uid);
        if (said) row(1, ICON.link, said.state, { sub: 'connection', tone: said.status === 'error' ? 'warn' : '' });
      }
    }

    // ── objects, by collection: what each reads and what uses it ──────────────
    const collections = data.collections || [];
    const objectEntry = (depth, o) => {
      const r = of(o.uid);
      const uses = [...r.target.map(x => `${x.name}'s target`), ...r.paths.map(x => `${x.name}'s path`), ...r.readers.map(x => `read by ${x.name}`)];
      row(depth, ICON[o.type] || '•', o.name, { sub: uses.length ? uses.join(' · ') : TYPE[o.type], on: selectObject(o), selected: o.uid === selected });
      if (o.type === 'geometry') for (const uid of reads(o)) objectRow(depth + 1, uid, 'read by Object Info');
    };
    if (section('Objects', objects.length)) {
      for (const c of collections) {
        const members = c.objects.map(uid => byUid.get(uid)).filter(Boolean);
        const shut = this.shut.has(c.id);
        frag.append(this.collectionRow(c, members.length, shut));
        if (!shut) for (const o of members) objectEntry(1, o);
      }
      const grouped = new Set(collections.flatMap(c => c.objects));
      for (const o of objects) if (!grouped.has(o.uid)) objectEntry(0, o);
      const hasObstacles = collections.some(c => c.name === OBSTACLES);
      const add = el('button', 'col-row col-add', '+ New Collection');
      add.type = 'button';
      add.title = hasObstacles ? "A new, empty collection: the Item tab's Collection puts objects in it"
        : "A new collection, named Obstacles: RMPflow keeps the robot away from the objects in it (the Item tab's Collection puts objects in it)";
      add.disabled = collections.length >= MAX_COLLECTIONS;
      add.onclick = () => app.sceneEdit('New collection', () => !!newCollection(data, hasObstacles ? 'Collection' : OBSTACLES));
      frag.append(add);
    }

    this.root.replaceChildren(frag);
  }

  /** A collection's row: click opens or closes it, double-click renames it (Blender's), x deletes it. */
  collectionRow(c, count, shut) {
    const app = this.app, data = app.store.data;
    const r = el('div', 'col-row col-coll');
    r.setAttribute('role', 'treeitem'); r.setAttribute('aria-expanded', String(!shut));
    const obstacle = obstacleCollection(data) === c;
    r.title = `${obstacle ? 'RMPflow keeps the robot away from these objects (by default). ' : ''}Double-click: rename`;
    const label = el('span', 'col-label', c.name);
    const toggle = el('button', 'col-toggle', shut ? '▸' : '▾'); toggle.type = 'button';
    toggle.setAttribute('aria-label', `${shut ? 'Open' : 'Close'} ${c.name}`);
    toggle.onclick = () => { if (this.shut.has(c.id)) this.shut.delete(c.id); else this.shut.add(c.id); this.render(); };
    r.append(toggle, el('span', 'col-icon', ICON.collection), label,
      el('span', 'col-sub', `${count} object${count === 1 ? '' : 's'}${obstacle ? ' · RMPflow obstacles' : ''}`));
    r.ondblclick = e => {
      if (e.target.closest('input, button')) return;
      const input = el('input', 'col-rename'); input.value = c.name; input.maxLength = 64; input.setAttribute('aria-label', 'Collection name');
      let ended = false;
      const done = save => {
        if (ended) return; ended = true;
        const name = input.value.trim();
        if (save && name && name !== c.name) {
          app.sceneEdit('Rename collection', () => { const x = (data.collections || []).find(y => y.id === c.id); if (!x) return false; x.name = name; });
        } else this.render();
      };
      input.onkeydown = ev => { ev.stopPropagation(); if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); };
      input.onblur = () => done(true);
      label.replaceWith(input); input.focus(); input.select();
    };
    const x = el('button', 'col-x', '×'); x.type = 'button'; x.title = `Delete ${c.name} (its objects stay in the scene)`;
    x.setAttribute('aria-label', `Delete collection ${c.name}`);
    x.onclick = () => { app.sceneEdit(`Delete ${c.name}`, () => removeCollection(data, c.id)); app.notice(`${c.name} deleted; its objects stay · Ctrl+Z brings it back`); };
    r.append(x);
    return r;
  }
}
