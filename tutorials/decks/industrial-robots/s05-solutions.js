// 05 One target, many solutions: every inverse-kinematics answer for one flange pose.
import * as m from '../../core/mat.js';
import * as draw from '../../core/draw.js';
import { Chain } from '../../core/kinematics.js';
import { allSolutions } from '../../core/analysis.js';
import { poseInputs, poseFrom, jointRow } from './common.js';

export default {
  num: '05',
  title: 'ONE TARGET,\nMANY SOLUTIONS',
  body: 'One tool pose, many ways to get there: shoulder left or right, elbow up or down, wrist flipped or not. ' +
    'Usually up to 8 on a six-axis arm.\n\n' +
    'Joint limits rule some out. The robot keeps the answer closest to where it already is: number 1.',
  try: 'Step Answer from 1 to the last. Then move X.',
  panels: ['MOVE'],

  inputs: r => [
    { type: 'header', label: 'THIS LESSON' },
    { key: 'sol', label: 'Answer', type: 'slider', min: 1, max: 8, step: 1, value: 1 },
    ...poseInputs(r, 't', r.chain.fk(r.home).flange, { header: 'MOVE › TARGET  (flange)' }),
  ],

  setup(ctx) {
    ctx.mem.target = draw.triad();
    ctx.mem.tag = draw.label('', 'hl');
    ctx.group.add(ctx.mem.target, ctx.mem.tag);
    // the same arm with no joint limits, to show how many answers the geometry alone allows
    ctx.mem.free = new Chain({ joints: ctx.robot.chain.joints, flange: ctx.robot.chain.flange });
  },

  update(ctx, key) {
    const { robot, values: v, mem } = ctx;
    const T = poseFrom(robot, 't', v);
    if (key !== 'sol' || !mem.sols) {
      mem.sols = allSolutions(robot.chain, T, { ref: robot.home });
      mem.all = allSolutions(mem.free, T, { ref: robot.home }).length;
    }
    const sols = mem.sols, k = Math.min(v.sol, sols.length) - 1;
    const q = k >= 0 ? sols[k] : robot.home;
    ctx.view.set(q);
    const S = robot.reach / 1.3;
    draw.placeTriad(mem.target, T, 0.18 * S, 0.006);
    mem.tag.position.set(...m.position(T));
    draw.setLabel(mem.tag, k >= 0 ? `ANSWER ${k + 1} / ${sols.length}` : 'NO ANSWER FOUND', k >= 0 ? 'hl' : 'alert');

    const rows = [[['one flange pose, every answer found', 'g']], ''];
    sols.forEach((s, i) => rows.push([
      [`${i + 1}  `, i === k ? 'hl' : 'g'], ...jointRow(robot, s, i === k ? 'k' : 'g'),
      [i === 0 ? '   kept' : '', 'g'],
    ]));
    if (!sols.length) rows.push([['no answer found inside the joint limits', 'alert']]);
    rows.push('', [[`${mem.all}`, 'k'], [' answers for this arm, ', 'g'], [`${sols.length}`, 'hl'], [' inside its joint limits', 'g']]);
    ctx.hud.card(rows);
  },
};
