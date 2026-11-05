// 03 Forward and inverse kinematics, one slide with a Mode switch.
// Forward: joint sliders -> flange pose. Inverse: type the pose (the controller's way) -> joint angles.
import * as m from '../../core/mat.js';
import * as draw from '../../core/draw.js';
import { jointInputs, jointsFrom, setJoints, poseInputs, poseFrom, setPose, jointRow, poseRows, jointAxes } from './common.js';

const fwd = v => v.mode === 'Forward';
const inv = v => v.mode === 'Inverse';

export default {
  num: '03',
  title: 'FORWARD AND\nINVERSE KINEMATICS',
  body: 'Forward: give the joint angles, get where the tool is. Always exactly one answer.\n\n' +
    'Inverse: give where the tool should be, get the joint angles. Maybe none, maybe many. ' +
    'The robot solves this for every target you give it.',
  try: 'Switch Mode to Inverse, then change X and Z until the arm cannot follow.',

  panels: ['MOVE', 'WATCH'],
  target: ctx => inv(ctx.values) ? { get: () => poseFrom(ctx.robot, 't', ctx.values), set: T => setPose(ctx, 't', T) } : null,
  inputs: r => [
    { key: 'mode', label: 'Mode', type: 'menu', options: ['Forward', 'Inverse'], value: 'Forward' },
    { type: 'header', label: 'MOVE › JOINTS', when: fwd },
    ...jointInputs(r, { when: fwd }),
    ...poseInputs(r, 't', r.chain.fk(r.home).flange, { header: 'MOVE › TARGET  (flange)', extra: { when: inv } }),
  ],

  setup(ctx) {
    ctx.mem.q = jointsFrom(ctx.robot, ctx.values);
    ctx.mem.axes = jointAxes(ctx);
    ctx.mem.tcp = draw.triad();
    ctx.mem.target = draw.triad();
    ctx.mem.tag = draw.label('', 'alert');
    ctx.group.add(ctx.mem.tcp, ctx.mem.target, ctx.mem.tag);
  },

  update(ctx, key) {
    const { robot, values: v, mem } = ctx;
    // switching keeps the robot where it is: copy the current pose / angles into the other mode's inputs
    if (key === 'mode') {
      if (inv(v)) setPose(ctx, 't', mem.f.flange);
      else setJoints(ctx, mem.q);
    }
    let q, ok = true, T = null, res = null;
    if (fwd(v)) q = jointsFrom(robot, v);
    else {
      T = poseFrom(robot, 't', v);
      res = robot.chain.ik(T, { seed: mem.q || robot.home, seeds: [robot.home] });
      ok = res.ok;
      q = ok ? res.q : mem.q || robot.home;      // keep the last good pose on screen
      if (ok) setJoints(ctx, q);
    }
    // honest failure (code review R1): "out of reach" only when distance proves it
    const why = !res || ok ? '' : res.status === 'invalid_input' ? 'INVALID TARGET'
      : res.status === 'out_of_reach' ? 'OUT OF REACH' : 'NO ANSWER FOUND';
    mem.q = q;
    const f = mem.f = ctx.view.set(q);
    const S = robot.reach / 1.3;

    mem.axes(fwd(v) ? undefined : []);
    draw.placeTriad(mem.tcp, f.flange, 0.1 * S, 0.004);
    mem.target.visible = inv(v) && m.isRigidTransform(T);
    if (mem.target.visible) draw.placeTriad(mem.target, T, 0.2 * S, 0.007);
    mem.tag.visible = inv(v) && !ok;
    if (T) { mem.tag.position.set(...m.position(res?.status === 'invalid_input' ? f.flange : T)); draw.setLabel(mem.tag, why); }

    const rows = fwd(v)
      ? [
        [['FORWARD  ', 'hl'], ['angles in, pose out', 'g']],
        '',
        [['JOINT SPACE', 'hl']],
        jointRow(robot, q),
        [['     ↓  forward kinematics', 'g']],
        [['CARTESIAN SPACE  ', 'k'], ['flange', 'g']],
        ...poseRows(robot, f.flange),
        '',
        [['one answer, always', 'g']],
      ]
      : [
        [['INVERSE  ', 'hl'], ['pose in, angles out', 'g']],
        '',
        [['CARTESIAN SPACE  ', 'hl'], ['flange', 'g']],
        ...poseRows(robot, T),
        [['     ↓  inverse kinematics', 'g']],
        [['JOINT SPACE', 'k']],
        ok ? jointRow(robot, q)
          : res.status === 'invalid_input' ? [['invalid target input', 'alert']]
          : res.status === 'out_of_reach' ? [['no answer: too far for this arm', 'alert']]
            : [['no answer found', 'alert'], [`  (${(res.pe * 1000).toFixed(1)} mm off)`, 'g']],
        '',
        [['none, one or many answers', 'g']],
      ];
    ctx.hud.card(rows);
  },
};
