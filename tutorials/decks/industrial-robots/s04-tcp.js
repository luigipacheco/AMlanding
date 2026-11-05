// 04 The tool and the TCP: offset + rotation from the flange, a pen that follows it.
// The robot is driven by inverse kinematics: you place the TCP target, the arm solves for it. Change the tool and the
// TCP stays on the target while the arm moves to keep it there: every target is reached with the TCP.
import * as m from '../../core/mat.js';
import * as draw from '../../core/draw.js';
import { isoView } from '../../core/stage.js';
import { poseInputs, poseFrom, setPose, jointRow, poseRows } from './common.js';

const defaultTool = r => r.poseMatrix(r.tool.xyz, r.tool.rot);

export default {
  num: '04',
  title: 'THE TOOL\nAND THE TCP',
  body: 'The robot only knows its flange. The Tool Centre Point (TCP) is the tip of the tool: ' +
    'an offset and a rotation from the flange, set once per tool.\n\n' +
    'Every target is reached with the TCP, so a wrong TCP means every move is wrong.',
  try: r => `Change Tool Z, then Tool X: the TCP stays on the target and the arm moves to keep it there. ` +
    `Tilt the tool with Tool ${r.orient.labels[1]}. Then move the target (or press G in the view).`,

  panels: ['ROBOTS', 'MOVE', 'WATCH'],
  // G / R move the TCP target in the view
  target: ctx => ({ get: () => poseFrom(ctx.robot, 't', ctx.values), set: T => setPose(ctx, 't', T) }),
  inputs: r => [
    ...poseInputs(r, 't', r.chain.fk(r.home, defaultTool(r)).tcp, { header: 'MOVE › TARGET  (TCP, inverse kinematics)' }),
    ...poseInputs(r, 'tool', defaultTool(r), {
      header: 'ROBOTS › TOOL  (from the flange)', labelPrefix: 'Tool ',
      xyzRange: [[-300, 300], [-300, 300], [0, 500]],
    }),
  ],

  camera(ctx) {
    const { robot, view } = ctx;
    const p = m.position(view.f.flange);
    return { target: [p[0], p[1], p[2] - 0.08], height: robot.reach * 0.85 + 0.1, dir: isoView(robot).dir };
  },

  setup(ctx) {
    const g = ctx.group, mem = ctx.mem;
    mem.q = ctx.robot.home;
    mem.flangeFrame = draw.triad();
    mem.tcpFrame = draw.triad();
    mem.targetFrame = draw.triad();
    mem.link = draw.mesh('cyl', 'ink');
    mem.flangeTag = draw.label('flange', 'grey');
    mem.tcpTag = draw.label('TCP', 'hl');
    mem.fail = draw.label('', 'alert');
    g.add(mem.flangeFrame, mem.tcpFrame, mem.targetFrame, mem.link, mem.flangeTag, mem.tcpTag, mem.fail);
    ctx.view.showPen(true);
  },

  update(ctx) {
    const { robot, values: v, mem } = ctx;
    const tool = poseFrom(robot, 'tool', v);
    const T = poseFrom(robot, 't', v);
    // inverse kinematics: the joints that put this TCP (with this tool) on the target
    const res = robot.chain.ik(T, { seed: mem.q || robot.home, seeds: [robot.home], tool });
    const q = res.ok ? res.q : mem.q || robot.home;          // keep the last good pose on screen
    if (res.ok) mem.q = q;
    const f = ctx.view.set(q, tool);
    const pf = m.position(f.flange), pt = m.position(f.tcp);
    draw.placeTriad(mem.flangeFrame, f.flange, 0.07, 0.003);
    draw.placeTriad(mem.tcpFrame, f.tcp, 0.11, 0.004);
    mem.targetFrame.visible = m.isRigidTransform(T);
    if (mem.targetFrame.visible) draw.placeTriad(mem.targetFrame, T, 0.18, 0.006);
    draw.place(mem.link, pf, pt, 0.003);
    mem.flangeTag.position.set(...pf);
    mem.tcpTag.position.set(...pt);
    mem.fail.visible = !res.ok;
    if (!res.ok) {
      mem.fail.position.set(...m.position(res.status === 'invalid_input' ? f.tcp : T));
      draw.setLabel(mem.fail, res.status === 'invalid_input' ? 'INVALID TARGET' : res.status === 'out_of_reach' ? 'OUT OF REACH' : 'NO ANSWER FOUND');
    }

    ctx.hud.card([
      [['TARGET  ', 'hl'], ['where the TCP must go', 'g']],
      ...poseRows(robot, T, 'hl'),
      [['TOOL  ', 'k'], ['from the flange', 'g']],
      ...poseRows(robot, tool, 'g'),
      [['     ↓  inverse kinematics, with this tool', 'g']],
      res.ok ? jointRow(robot, q)
        : res.status === 'out_of_reach' ? [['no answer: too far for this arm with this tool', 'alert']]
        : res.status === 'invalid_input' ? [['invalid target input', 'alert']]
          : [['no answer found', 'alert'], [`  (${(res.pe * 1000).toFixed(1)} mm off)`, 'g']],
      [['flange  ', 'k'], ['where the robot itself goes', 'g']],
      ...poseRows(robot, f.flange, 'g'),
      '',
      [[robot.where.tcp, 'g']],
    ]);
  },
};
