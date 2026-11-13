// 10 Collisions: the robot against a box in its cell, the floor, and itself. Each link is the convex hull of the
// robot model's own parts (RobotView.collisionHulls), placed by forward kinematics; core/collide.js says which touch.
import * as m from '../../core/mat.js';
import * as draw from '../../core/draw.js';
import { isoView } from '../../core/stage.js';
import { placePoints, contacts } from '../../core/collide.js';
import { jointInputs, jointsFrom } from './common.js';

const HIT = 'x';                                     // the red of the X axis: what touches

/** The floor the robot stands on: a slab just below it (the base is bolted to it, so only moving links count). */
function floorCorners(r) {
  const R = r.reach * 3, out = [];
  for (const x of [-R, R]) for (const y of [-R, R]) for (const z of [-0.05, -0.002]) out.push(x, y, z);
  return out;
}

/** The box's corners, robot base, m: standing on the floor, centred on (x, y). */
function boxCorners(v) {
  const x = v.bx / 1000, y = v.by / 1000, w = v.bw / 2000, h = v.bh / 1000, out = [];
  for (const dx of [-w, w]) for (const dy of [-w, w]) for (const z of [0, h]) out.push(x + dx, y + dy, z);
  return out;
}

export default {
  num: '10',
  title: 'COLLISIONS',
  body: 'A robot goes wherever its joints are sent: into a fixture, the floor, or its own arm. The controller knows its ' +
    'joint limits, not what is around it.\n\n' +
    "A simulation checks every move against the robot's own shape and the things in the cell, before the robot runs it.",
  try: r => `Turn ${r.joints[0].name} until the arm swings into the box. Then fold ${r.joints[2].name} all the way ` +
    `and turn ${r.joints[1].name} until the arm touches itself, or the floor.`,
  panels: ['MOVE'],

  // the box stands beside the arm, a turn of the first joint away from the tool, a little taller than the wrist
  inputs: r => {
    const p = m.position(r.chain.fk(r.home).flange), turn = 55 * m.DEG;
    const c = [p[0] * Math.cos(turn) - p[1] * Math.sin(turn), p[0] * Math.sin(turn) + p[1] * Math.cos(turn)];
    const R = Math.round(r.reach * 1200), mm = v => Math.round(v * 100) * 10;
    return [
      { type: 'header', label: 'MOVE › JOINTS' },
      ...jointInputs(r),
      { type: 'header', label: 'CELL › BOX  (not a robot setting)' },
      { key: 'bx', label: 'Box X', type: 'slider', min: -R, max: R, step: 10, unit: 'mm', value: mm(c[0]) },
      { key: 'by', label: 'Box Y', type: 'slider', min: -R, max: R, step: 10, unit: 'mm', value: mm(c[1]) },
      { key: 'bw', label: 'Width', type: 'slider', min: 50, max: Math.round(r.reach * 800), step: 10, unit: 'mm', value: mm(r.reach * 0.22) },
      { key: 'bh', label: 'Height', type: 'slider', min: 50, max: Math.round(r.reach * 1600), step: 10, unit: 'mm', value: mm(p[2] + r.reach * 0.15) },
    ];
  },

  // the robot and the box together: aim between them, a little wider than the usual shot
  camera(ctx) {
    const { robot: r, values: v } = ctx, b = [v.bx / 1000, v.by / 1000];
    return isoView(r, { target: [b[0] * 0.45, b[1] * 0.45, r.reach * 0.3], height: r.reach * 1.9 });
  },

  setup(ctx) {
    ctx.mem.box = draw.mesh('box', 'mid');
    ctx.mem.tag = draw.label('', 'alert');
    ctx.group.add(ctx.mem.box, ctx.mem.tag);
  },

  update(ctx) {
    const { robot, values: v, mem } = ctx;
    const q = jointsFrom(robot, v);
    const f = ctx.view.set(q);

    // each link's hull, where forward kinematics puts it (link 0 is the base), and the box
    const hulls = ctx.view.collisionHulls().links;
    const frames = [robot.chain.base, ...f.links];
    const placed = hulls.map((h, k) => placePoints(frames[k], h));
    const found = contacts(placed, [{ name: 'the box', points: boxCorners(v) }, { name: 'the floor', points: floorCorners(robot) }])
      .filter(c => !(c.a === 0 && c.thing === 'the floor'));

    const touched = new Set(found.flatMap(c => [c.a, c.b]).filter(k => k !== null && k > 0));
    ctx.view.highlight([...touched].map(k => k - 1), HIT);
    const boxHit = found.some(c => c.thing === 'the box'), floorHit = found.some(c => c.thing === 'the floor');
    mem.box.position.set(v.bx / 1000, v.by / 1000, v.bh / 2000);
    mem.box.scale.set(v.bw / 1000, v.bw / 1000, v.bh / 1000);
    draw.setTone(mem.box, boxHit ? HIT : 'mid');
    const self = found.some(c => c.b !== null);
    mem.tag.visible = found.length > 0;
    mem.tag.position.set(...(boxHit ? [v.bx / 1000, v.by / 1000, v.bh / 1000 + 0.08 * robot.scale] : m.position(f.links[Math.max(...touched, 1) - 1])));
    const what = [boxHit && 'THE BOX', floorHit && 'THE FLOOR', self && 'ITSELF'].filter(Boolean);
    draw.setLabel(mem.tag, `COLLISION: ${what.join(' + ')}`);

    // one row per thing: which links touch it (by their joint's name), and which pairs touch each other
    const short = k => (k === 0 ? 'base' : robot.joints[k - 1].name);
    const links = name => [...new Set(found.filter(c => c.thing === name).map(c => short(c.a)))].join(' ');
    const pairs = found.filter(c => c.b !== null).map(c => `${short(c.a)}-${short(c.b)}`).join('  ');
    const rows = [['the box', links('the box')], ['the floor', links('the floor')], ['itself', pairs]]
      .filter(([, list]) => list).map(([what, list]) => [[what.padEnd(11), 'g'], [list, 'alert']]);
    ctx.hud.card([
      ...(rows.length ? rows : [[['no contact', 'k']]]),
      '',
      robot.cobot ? [['a cobot stops when it touches', 'g']] : [['an industrial robot does not stop', 'k']],
      [['red: parts that touch', 'g']],
    ]);
  },
};
