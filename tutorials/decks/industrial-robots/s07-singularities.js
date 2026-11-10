// 07 Singularities: live measures of the three classic ones, and what they do to joint speed.
import * as m from '../../core/mat.js';
import * as draw from '../../core/draw.js';
import { singularities, jointSpeeds } from '../../core/analysis.js';
import { jointInputs, jointsFrom, jointAxes } from './common.js';

const NEAR = { wrist: 10, elbow: 10, shoulder: 0.05 };   // deg, deg, m

export default {
  num: '07',
  title: 'SINGULARITIES',
  body: r => 'Where two joints line up, the arm loses a direction. Near it, small tool moves need huge joint speeds: ' +
    'the robot jerks or stops.\n\n' +
    `Wrist: ${r.joints[3].name} and ${r.joints[5].name} in line. Elbow: arm straight. ` +
    'Shoulder: the wrist right above the base axis' + (r.maker === 'Universal Robots' ? ', on the ring around it.' : '.'),
  try: r => `Turn ${r.joints[4].name} to 0. Then stretch the arm with ${r.joints[2].name}.`,

  // starts close to a wrist singularity: the wrist joint 25 deg from straight
  panels: ['MOVE', 'WATCH'],
  inputs: r => [{ type: 'header', label: 'MOVE › JOINTS' }].concat(jointInputs(r).map((s, i) => (i === 4 ? { ...s, value: Math.sign(r.home[4] || 1) * 25 } : s))),

  setup(ctx) {
    const mem = ctx.mem;
    mem.axes = jointAxes(ctx, { front: true });
    mem.ring = draw.circle('ink');
    mem.axisLine = draw.polyline('ink', true);
    mem.wp = draw.mesh('sphere', 'ink');
    mem.tag = draw.label('', 'hl');
    ctx.group.add(mem.ring, mem.axisLine, mem.wp, mem.tag);
    draw.inFront(mem.ring, mem.axisLine, mem.wp);   // the helpers stay visible inside heavy arms (KUKA's wrist housing)
  },

  update(ctx) {
    const { robot, values: v, mem } = ctx;
    const q = jointsFrom(robot, v);
    const f = ctx.view.set(q);
    const s = singularities(f);
    const near = { wrist: s.wrist < NEAR.wrist, elbow: s.elbow < NEAR.elbow, shoulder: s.shoulder < NEAR.shoulder * robot.scale };
    ctx.view.highlight([near.shoulder && 0, near.elbow && 2, near.wrist && 4].filter(i => i !== false));
    mem.axes([3, 5], near.wrist ? [3, 5] : []);

    // where the shoulder singularity lives: J1's axis, or a ring around it at the wrist's height
    const o = f.origins[0], pw = s.shoulderPoint;   // the point that has to stay off J1's axis (or ring)
    if (s.ring > 0.02) { mem.ring.visible = true; mem.ring.place([o[0], o[1]], s.ring, pw[2]); }
    else mem.ring.visible = false;
    mem.axisLine.setPoints([[o[0], o[1], 0], [o[0], o[1], robot.reach * 1.3]]);
    draw.place(mem.wp, m.sub(pw, [0, 0, 0.012]), m.add(pw, [0, 0, 0.012]), 0.012 * robot.scale);
    const which = near.wrist ? 'WRIST' : near.elbow ? 'ELBOW' : near.shoulder ? 'SHOULDER' : '';
    mem.tag.visible = !!which;
    mem.tag.position.set(...pw);
    draw.setLabel(mem.tag, `${which} SINGULARITY`);

    // what it costs: joint speeds for the tool moving 100 mm/s along X
    const w = jointSpeeds(robot.chain, f, [0.1, 0, 0, 0, 0, 0]).map(x => Math.abs(x) / m.DEG);
    const k = w.indexOf(Math.max(...w));
    const row = (name, val, unit, note, isNear) => [[name, isNear ? 'hl' : 'k'], [' '.repeat(10 - name.length), 'g'],
      [' '.repeat(Math.max(0, 9 - `${val}${unit}`.length)), 'g'], [`${val}${unit}`, isNear ? 'hl' : 'k'], [`   ${note}`, 'g']];
    ctx.hud.card([
      row('wrist', s.wrist.toFixed(1), ' °', `${robot.joints[3].name} and ${robot.joints[5].name} in line at 0`, near.wrist),
      row('elbow', s.elbow.toFixed(1), ' °', 'arm straight at 0', near.elbow),
      row('shoulder', (s.shoulder * 1000).toFixed(0), ' mm', s.ring > 0.02 ? 'wrist on the ring at 0' : 'wrist over the base axis at 0', near.shoulder),
      '',
      [['tool at 100 mm/s along X needs ', 'g'], [`${robot.joints[k].name} ${w[k].toFixed(0)} °/s`, w[k] > 180 ? 'alert' : 'k']],
      [['lime: close to a singularity. plan around it', 'g']],
    ]);
  },
};
