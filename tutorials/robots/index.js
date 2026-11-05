// Every robot the sandbox knows: Animaquina's rigs (library.json) + their family conventions (families.js).
// Add a robot: put it in robots.blend, re-run tools/export_robots.py, and (if it is a new brand) add a family.

import * as m from '../core/mat.js';
import { makeRobot } from '../core/robot.js';
import { autoShapes } from '../core/shapes.js';
import { FAMILIES, OVERRIDES, ORDER } from './families.js';

/** One library.json entry -> robot definition (plain data, no fetching: also used by the Node tests). */
export function fromLibrary(entry, base = '') {
  const fam = FAMILIES[entry.brand];
  const o = OVERRIDES[entry.id] || {};
  const model = o.model || entry.model;
  const kinematics = { joints: entry.joints.map(j => ({ origin: j.origin, axis: j.axis, offset: 0 })), flange: entry.flange };
  const def = {
    id: entry.id,
    maker: fam.maker,
    name: model.startsWith(fam.maker) ? model.slice(fam.maker.length).trim() : model,
    kinematics,
    joints: fam.joints.map(([name, role, does], i) => ({ name, role, does, limits: entry.joints[i].limits })),
    home: o.home || fam.home,
    orientation: fam.orientation,
    toolAxis: fam.toolAxis,
    tool: fam.tool,
    where: fam.where,
    model: entry.glb ? base + entry.glb : null,
    limitsSource: entry.limitsSource,
    cobot: fam.cobot,
    moves: fam.moves,
    simulator: fam.simulator,
  };
  // sizes: reach is baked by tools/bake_library.mjs (sampled once, not on every page load); which way the arm
  // points at J1 = 0 comes from the home pose
  const chain = makeRobot({ ...def, reach: 1, forward: [1, 0, 0], shapes: [] }).chain;
  // Unbaked imports use a cheap conservative display bound. Sampling belongs in the bake tool only.
  const baked = Number.isFinite(entry.displayReach) && entry.displayReach > 0;
  const reach = baked ? entry.displayReach : Math.max(0.1, chain.maxReach());
  def.displayReachSource = baked ? 'baked_sample' : 'link_bound';
  def.limitsBorrowed = /borrowed from/i.test(entry.limitsSource || '');
  const ph = m.position(chain.fk(def.home.map(v => v * m.DEG)).flange);
  def.reach = Math.round(reach * 100) / 100;
  def.forward = Math.abs(ph[0]) >= Math.abs(ph[1]) ? [Math.sign(ph[0]), 0, 0] : [0, Math.sign(ph[1]), 0];
  def.shapes = autoShapes(kinematics, [0.11, 0.1, 0.085, 0.065, 0.055, 0.045].map(r => r * def.reach / 1.2));
  def.scale = Math.min(3, Math.max(0.6, def.reach / 1.3));   // for pens, arrows, the default tool
  return def;
}

export function robotsFrom(library, base = '') {
  const byId = Object.fromEntries(library.map(e => [e.id, e]));
  const ids = [...ORDER.filter(id => byId[id]), ...library.map(e => e.id).filter(id => !ORDER.includes(id))];
  return ids.filter(id => FAMILIES[byId[id].brand]).map(id => makeRobot(fromLibrary(byId[id], base)));
}

/** Browser: load the library next to this file. */
export async function loadRobots() {
  const url = new URL('./library.json', import.meta.url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Robot library failed to load (${response.status})`);
  const library = await response.json();
  return robotsFrom(library, new URL('./', import.meta.url).href);
}
