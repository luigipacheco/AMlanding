// Authored parameters only. DOM, solver caches, playback and hardware sessions are not persisted.
// Node graphs are checked by core/nodes/graph.js, given by the Robot IDE (setGraphParser) so that tutorials,
// which never hold Nodes objects, do not load the node system.
let graphs = null;
export function setGraphParser(g) { graphs = g; }
const parseGraph = source => { if (!graphs) throw new Error('This project has Nodes objects: open it in the Robot IDE'); return graphs.parseGraph(source); };
const defaultGraph = () => graphs?.defaultGraph() ?? { nodes: [{ id: 'n1', kind: 'output', x: 320, y: 40, params: {} }], links: [] };
const MAX_IMPORT_FACES = 200000;   // as core/mesh-import.js

export const MAX_PROJECT_BYTES = 32_000_000;   // imported meshes make projects large
const copy = value => structuredClone(value);
const safeKey = key => typeof key === 'string' && key.length <= 200
  && !['__proto__', 'constructor', 'prototype'].includes(key);
const plain = value => value && typeof value === 'object' && !Array.isArray(value);

export function parseProject(text, robotIds) {
  if (typeof text !== 'string' || text.length > MAX_PROJECT_BYTES) throw new Error('Project must be smaller than 32 MB');
  const source = JSON.parse(text);
  if (source?.schemaVersion !== 1 || !robotIds.includes(source.activeRobotId) || !plain(source.contexts)) {
    throw new Error('Unsupported project version or robot');
  }
  const entries = Object.entries(source.contexts);
  if (entries.length > 256) throw new Error('Too many project contexts');
  const contexts = {};
  for (const [id, context] of entries) {
    if (!safeKey(id) || !robotIds.includes(context?.robotId) || !plain(context.values)) throw new Error('Invalid project context');
    const values = Object.entries(context.values);
    if (values.length > 256) throw new Error('Too many parameters');
    for (const [key, value] of values) {
      if (!safeKey(key) || !(typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
        || (typeof value === 'string' && value.length <= 256))) throw new Error(`Invalid parameter: ${key}`);
    }
    contexts[id] = { robotId: context.robotId, values: Object.fromEntries(values) };
  }
  const out = { schemaVersion: 1, activeRobotId: source.activeRobotId, contexts };
  if (source.registry !== undefined && source.registry !== null) out.registry = parseRegistry(source.registry, robotIds);
  if (source.objects !== undefined && source.objects !== null) out.objects = parseObjects(source.objects);
  if (source.assets !== undefined && source.assets !== null) out.assets = parseAssets(source.assets);
  if (source.timeline !== undefined && source.timeline !== null) out.timeline = parseTimeline(source.timeline);
  if (typeof source.playhead === 'number' && Number.isFinite(source.playhead) && source.playhead >= 0) out.playhead = Math.min(source.playhead, out.timeline?.end ?? 3600);
  if (source.selected !== undefined && source.selected !== null) {
    if (!out.objects?.some(o => o.uid === source.selected)) throw new Error('Invalid selection');
    out.selected = source.selected;
  }
  return out;
}

/**
 * Scene objects (Shift+A): simple shapes placed in the scene, in world coordinates.
 * [{ uid, type, name, pos: [x, y, z mm], rot: [rx, ry, rz deg, X-Y-Z], size: [x, y, z mm], verts?: [x, y] (grid) }]
 * A grid is flat: its size z is 0. Projects from before the grid used 'plane', read as a grid.
 * A geometry object has no size: it holds a node graph (core/nodes/graph.js) that makes its geometry.
 * An empty has only a place (position and rotation): a reference that nodes read with Object Info.
 */
export const MAX_OBJECTS = 64;
export const OBJECT_TYPES = ['grid', 'cube', 'cylinder', 'sphere', 'geometry', 'empty'];
/** How an empty is drawn (Blender's empty display types; Arrows is the red / green / blue frame, like the TCP). */
export const EMPTY_DISPLAYS = ['Plain Axes', 'Arrows', 'Circle', 'Cube', 'Sphere'];
export function parseObjects(source) {
  if (!Array.isArray(source) || source.length > MAX_OBJECTS) throw new Error('Invalid scene objects');
  const seen = new Set();
  const nums = (a, n, max) => Array.isArray(a) && a.length === n && a.every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max);
  return source.map(o => {
    if (!plain(o) || typeof o.uid !== 'string' || !/^o\d{1,4}$/.test(o.uid) || seen.has(o.uid)) throw new Error('Invalid object id');
    const type = o.type === 'plane' ? 'grid' : o.type;
    if (!OBJECT_TYPES.includes(type)) throw new Error(`Unknown object type: ${o.type}`);
    if (typeof o.name !== 'string' || o.name.length > 64) throw new Error('Invalid object name');
    if (type === 'geometry' || type === 'empty') {
      if (!nums(o.pos, 3, 100000) || !nums(o.rot, 3, 3600)) throw new Error('Invalid object transform');
      seen.add(o.uid);
      const out = { uid: o.uid, type, name: o.name, pos: o.pos.slice(), rot: o.rot.slice() };
      if (type === 'geometry') out.graph = parseGraph(o.graph ?? defaultGraph());
      if (type === 'empty') {
        out.display = o.display ?? 'Plain Axes'; out.dsize = o.dsize ?? 200;
        if (!EMPTY_DISPLAYS.includes(out.display) || !(typeof out.dsize === 'number' && out.dsize >= 1 && out.dsize <= 10000)) throw new Error('Invalid empty display');
      }
      return out;
    }
    if (!nums(o.pos, 3, 100000) || !nums(o.rot, 3, 3600) || !nums(o.size, 3, 100000) || o.size.some(v => v < 0)
      || o.size[0] === 0 || o.size[1] === 0 || (type !== 'grid' && o.size[2] === 0)) throw new Error('Invalid object transform');
    seen.add(o.uid);
    const out = { uid: o.uid, type, name: o.name, pos: o.pos.slice(), rot: o.rot.slice(), size: o.size.slice() };
    if (type === 'grid') {
      const verts = o.verts ?? [11, 11];
      if (!nums(verts, 2, 200) || verts.some(v => !Number.isInteger(v) || v < 2)) throw new Error('Invalid grid vertices');
      out.verts = verts.slice();
      if (o.type === 'plane') out.size[2] = 0;
    }
    return out;
  });
}

/**
 * The timeline (core/timeline.js): { end (s), tasks: [{ id, robot, name, start (s), duration (s), paths: [object uids] }] }.
 * A task whose robot or objects are gone stays in the file and shows as broken; it is not an error.
 */
export const MAX_TASKS = 64;
export function parseTimeline(source) {
  if (!plain(source) || !Array.isArray(source.tasks) || source.tasks.length > MAX_TASKS) throw new Error('Invalid timeline');
  const end = source.end;
  if (typeof end !== 'number' || !(end >= 1 && end <= 3600)) throw new Error('Invalid timeline length');
  const seen = new Set();
  const tasks = source.tasks.map(k => {
    if (!plain(k) || typeof k.id !== 'string' || !/^t\d{1,4}$/.test(k.id) || seen.has(k.id)) throw new Error('Invalid task id');
    if (typeof k.robot !== 'string' || !/^r\d{1,4}$/.test(k.robot)) throw new Error('Invalid task robot');
    if (typeof k.name !== 'string' || k.name.length > 64) throw new Error('Invalid task name');
    if (![k.start, k.duration].every(v => typeof v === 'number' && Number.isFinite(v)) || k.start < 0 || k.start > 3600 || !(k.duration >= 0.1 && k.duration <= 3600)) throw new Error('Invalid task timing');
    if (!Array.isArray(k.paths) || k.paths.length > MAX_CHAIN || !k.paths.every(p => typeof p === 'string' && /^o\d{1,4}$/.test(p))) throw new Error('Invalid task paths');
    seen.add(k.id);
    return { id: k.id, robot: k.robot, name: k.name, start: k.start, duration: k.duration, paths: k.paths.slice() };
  });
  return { end, tasks };
}

/**
 * Imported mesh files, by id: { name, positions: [x, y, z, ...] (file units), faces: [[i, ...]] }.
 * Kept outside the undo history (ProjectStore.assets); saved with the project.
 */
export const MAX_ASSETS = 16;
export function parseAssets(source) {
  if (!plain(source) || Object.keys(source).length > MAX_ASSETS) throw new Error('Invalid imported files');
  const out = new Map();
  let faces = 0;
  for (const [id, a] of Object.entries(source)) {
    if (!/^a[0-9a-z]{1,16}$/.test(id) || !plain(a) || typeof a.name !== 'string' || a.name.length > 128) throw new Error('Invalid imported file');
    if (!Array.isArray(a.positions) || a.positions.length % 3 || !a.positions.every(v => typeof v === 'number' && Number.isFinite(v))) throw new Error(`Invalid points in ${a.name}`);
    const n = a.positions.length / 3;
    if (!Array.isArray(a.faces) || (faces += a.faces.length) > MAX_IMPORT_FACES * 2) throw new Error('Too many imported faces');
    for (const f of a.faces) if (!Array.isArray(f) || f.length < 3 || f.length > 64 || !f.every(i => Number.isInteger(i) && i >= 0 && i < n)) throw new Error(`Invalid faces in ${a.name}`);
    out.set(id, { name: a.name, positions: Float64Array.from(a.positions), faces: a.faces.map(f => f.slice()) });
  }
  return out;
}

/**
 * The robot registry (Animaquina's robot slots): every robot in the scene, each with its own base.
 * { robots: [{ uid, model, name, base: [x, y, z (mm), yaw (deg)], paths?: [object uid, ...] }], active: uid }
 * paths: the robot's path chain, Nodes objects followed in order (a missing object is skipped, not an error).
 */
export const MAX_ROBOTS = 8;
export const MAX_CHAIN = 16;
export function parseRegistry(source, robotIds) {
  if (!plain(source) || !Array.isArray(source.robots) || !source.robots.length || source.robots.length > MAX_ROBOTS) {
    throw new Error('Invalid robot registry');
  }
  const seen = new Set();
  const robots = source.robots.map(r => {
    if (!plain(r) || typeof r.uid !== 'string' || !/^r\d{1,4}$/.test(r.uid) || seen.has(r.uid)) throw new Error('Invalid robot id');
    if (!robotIds.includes(r.model)) throw new Error(`Unknown robot model: ${r.model}`);
    if (typeof r.name !== 'string' || r.name.length > 64) throw new Error('Invalid robot name');
    if (!Array.isArray(r.base) || r.base.length !== 4 || !r.base.every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 100000)) {
      throw new Error('Invalid robot base');
    }
    seen.add(r.uid);
    const out = { uid: r.uid, model: r.model, name: r.name, base: r.base.slice() };
    if (r.paths !== undefined) {
      if (!Array.isArray(r.paths) || r.paths.length > MAX_CHAIN || !r.paths.every(p => typeof p === 'string' && /^o\d{1,4}$/.test(p))) throw new Error('Invalid path chain');
      out.paths = r.paths.slice();
    }
    return out;
  });
  if (!seen.has(source.active)) throw new Error('Invalid active robot');
  return { robots, active: source.active };
}

/** A small, UI-independent document owner. Transactions group a drag or modal edit into one undo step. */
export class ProjectStore {
  constructor(robotIds, { limit = 100 } = {}) {
    this.robotIds = robotIds;
    this.limit = limit;
    this.data = { schemaVersion: 1, activeRobotId: robotIds[0], contexts: {} };
    this.past = []; this.future = []; this.pending = null; this.revision = 0;
    this.assets = new Map();   // imported meshes: big and unchanging, so outside the undo snapshots
  }

  /** Add an imported mesh; returns its id. */
  addAsset(name, positions, faces) {
    const id = `a${Date.now().toString(36)}${(this.assets.size + 1).toString(36)}`;
    this.assets.set(id, { name: String(name).slice(0, 128), positions: Float64Array.from(positions), faces });
    return id;
  }

  values(id, robotId, specs) {
    const context = this.data.contexts[id] ||= { robotId, values: {} };
    const values = context.values;
    // Whitelist parameters against the active editor's schema. Missing/new inputs use their defaults.
    const keys = new Set();
    for (const s of specs) {
      if (!s.key || !Object.hasOwn(s, 'value')) continue;
      keys.add(s.key);
      if (s.transient) { values[s.key] = s.value; continue; }   // mirrors data held elsewhere (registry, objects)
      const v = values[s.key];
      const options = s.options?.map(o => typeof o === 'object' ? o.value : o);
      const valid = s.type === 'slider' ? Number.isFinite(v) && (s.softRange || (v >= s.min && v <= s.max))
        : options ? options.includes(v) : typeof v === typeof s.value;
      if (!valid) values[s.key] = s.value;
    }
    for (const key of Object.keys(values)) if (!keys.has(key)) delete values[key];
    return values;
  }

  begin(label = 'Edit') { if (!this.pending) this.pending = { label, data: copy(this.data) }; }
  commit() {
    const previous = this.pending; this.pending = null;
    if (!previous || JSON.stringify(previous.data) === JSON.stringify(this.data)) return false;
    this.past.push(previous); if (this.past.length > this.limit) this.past.shift();
    this.future = []; this.revision++; return true;
  }
  cancel() { if (!this.pending) return false; this.data = this.pending.data; this.pending = null; this.revision++; return true; }
  undo() {
    if (this.pending) this.commit();
    const entry = this.past.pop(); if (!entry) return false;
    this.future.push({ label: entry.label, data: copy(this.data) });
    this.data = entry.data; this.revision++; return true;
  }
  redo() {
    if (this.pending) this.commit();
    const entry = this.future.pop(); if (!entry) return false;
    this.past.push({ label: entry.label, data: copy(this.data) });
    this.data = entry.data; this.revision++; return true;
  }
  serialize() {
    // only the imported files some node still uses
    const used = new Set();
    for (const o of this.data.objects || []) for (const n of o.graph?.nodes || []) if (n.kind === 'import_mesh' && n.params.asset) used.add(n.params.asset);
    const assets = {};
    for (const id of used) {
      const a = this.assets.get(id);
      if (a) assets[id] = { name: a.name, positions: Array.from(a.positions, v => Math.round(v * 1e6) / 1e6), faces: a.faces };
    }
    const doc = used.size ? { ...this.data, assets } : this.data;
    return used.size ? JSON.stringify(doc) : JSON.stringify(doc, null, 2);
  }
  load(text) {
    const data = parseProject(text, this.robotIds); // validation must finish before mutating the existing document
    const assets = data.assets || new Map(); delete data.assets;
    this.data = data; this.assets = assets; this.past = []; this.future = []; this.pending = null; this.revision++;
  }
}
