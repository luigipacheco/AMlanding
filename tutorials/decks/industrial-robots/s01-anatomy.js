// 01 Anatomy: pick a joint, see its axis, turn it.
import * as m from '../../core/mat.js';
import * as draw from '../../core/draw.js';
import { jointAxes, jointLabels } from './common.js';

const name = j => `${j.name} ${j.role}`;

export default {
  num: '01',
  title: 'ANATOMY',
  body: r => `A ${r.name} has six joints in a row, from the base to the tool. Each one turns about a single axis (black arrow).\n\n` +
    'The first three place the wrist in space. The last three, the wrist, turn the tool.',
  try: 'Pick a joint, then drag Turn.',
  panels: ['MOVE'],

  inputs: r => [
    { type: 'header', label: 'MOVE › JOINTS' },
    { key: 'joint', label: 'Joint', type: 'menu', options: r.joints.map(name), value: name(r.joints[0]) },
    { key: 'turn', label: 'Turn', type: 'slider', min: -180, max: 180, step: 1, unit: '°', value: 0 },
  ],

  setup(ctx) {
    ctx.mem.axes = jointAxes(ctx);
    ctx.mem.labels = jointLabels(ctx);
    ctx.mem.flange = draw.label('flange', 'grey');
    ctx.group.add(ctx.mem.flange);
  },

  update(ctx, key) {
    const { robot, values: v } = ctx;
    if (key === 'joint') ctx.set('turn', 0), v.turn = 0;
    const i = robot.joints.findIndex(j => name(j) === v.joint);
    const q = robot.home.slice();
    q[i] = m.DEG * Math.max(robot.joints[i].limits[0], Math.min(robot.joints[i].limits[1], robot.home[i] / m.DEG + v.turn));
    const f = ctx.view.set(q);
    ctx.view.highlight([i]);
    ctx.mem.axes([i], [i]);
    ctx.mem.labels(robot.joints.map((j, k) => (k === i ? name(j) : '')), robot.joints.map(() => 'hl'));
    ctx.mem.flange.position.set(...m.position(f.flange));

    const j = robot.joints[i];
    ctx.hud.card([
      [[`${j.name}  `, 'hl'], [j.role, 'hl']],
      [[j.does, 'k']],
      [[`range ${j.limits[0]} to ${j.limits[1]} °`, 'g']],
      [[i < 3 ? 'arm joint: places the wrist' : 'wrist joint: turns the tool', 'g']],
    ]);
  },
};
