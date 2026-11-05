// 02 Jog: one slider per joint.
import { jointInputs, jointsFrom, jointAxes, jointLabels } from './common.js';

export default {
  num: '02',
  title: 'JOG',
  body: 'Jogging: moving one joint at a time, by hand.\n\n' +
    'Each joint turns about its axis (black arrow) and swings everything after it.',
  try: r => `Turn ${r.joints[0].name}, then ${r.joints[1].name}. Watch what moves with each.`,

  panels: ['MOVE', 'WATCH'],
  inputs: r => [{ type: 'header', label: 'MOVE › JOINTS' }, ...jointInputs(r)],

  setup(ctx) {
    ctx.mem.axes = jointAxes(ctx);
    ctx.mem.labels = jointLabels(ctx);
    ctx.mem.last = 0;
  },

  update(ctx, key) {
    const { robot, values: v } = ctx;
    if (key?.startsWith('j')) ctx.mem.last = +key.slice(1);
    const a = ctx.mem.last;
    const q = jointsFrom(robot, v);
    ctx.view.set(q);
    ctx.view.highlight([a]);
    ctx.mem.axes(undefined, [a]);
    ctx.mem.labels(robot.joints.map((j, i) => (i === a ? j.name : '')), robot.joints.map(() => 'hl'));
    ctx.hud.card([
      [['joint angles', 'g']],
      ...robot.joints.map((j, i) => [
        [`${j.name}  `, i === a ? 'hl' : 'g'],
        [`${(q[i] * 180 / Math.PI).toFixed(1).padStart(7)} °  `, i === a ? 'hl' : 'k'],
        [j.role, 'g'],
      ]),
    ]);
  },
};
