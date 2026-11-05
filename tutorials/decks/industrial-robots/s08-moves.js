// 08 Joint move vs linear move between two targets, A and B. Both targets can be moved: with the fields
// (MOVE › TARGETS, pick A or B) or in the viewport with G / R, like the Robot IDE's target.
import * as m from '../../core/mat.js';
import * as draw from '../../core/draw.js';
import { moveJ, moveL } from '../../core/analysis.js';
import { jointRow, poseInputs, poseFrom, setPose } from './common.js';

const POSE_KEY = /^[ab](X|Y|Z|R\d)$/;
const edits = which => v => v.edit === which;

/** Default A and B: either side of the home pose, same tool orientation; shrink until both are solved. */
function defaults(robot) {
  const R = robot.reach, f = robot.forward, side = [f[1], -f[0], 0];
  const T0 = robot.chain.fk(robot.home).flange;
  for (const k of [0.32, 0.25, 0.18, 0.12]) {
    const A = m.withPosition(T0, m.add(m.position(T0), m.add(m.scale(side, k * R), m.scale(f, -0.08 * R))));
    const B = m.withPosition(T0, m.add(m.position(T0), m.add(m.scale(side, -k * R), m.scale(f, 0.12 * R))));
    if (robot.chain.ik(A, { seed: robot.home }).ok && robot.chain.ik(B, { seed: robot.home }).ok) return { A, B };
  }
  return { A: T0, B: T0 };
}

export default {
  num: '08',
  title: 'JOINT MOVE,\nLINEAR MOVE',
  body: r => `Joint move (${r.moves.joint}): every joint turns evenly from A to B. Fast, but the tool swings on a curve.\n\n` +
    `Linear move (${r.moves.linear}): the tool goes in a straight line, with inverse kinematics at every step. ` +
    'Use it while the tool works.',
  try: 'Switch Move to Linear. Then move Target B (or press G) and watch both paths change.',

  panels: ['MOVE'],
  inputs: r => {
    const { A, B } = defaults(r);
    return [
      { type: 'header', label: 'MOVE › MOVE TYPE' },
      { key: 'move', label: 'Move', type: 'menu', options: ['Joint', 'Linear'], value: 'Joint' },
      { type: 'header', label: 'MOVE › TARGETS  (flange)' },
      { key: 'edit', label: 'Target', type: 'menu', options: ['A', 'B'], value: 'B' },
      ...poseInputs(r, 'a', A, { extra: { when: edits('A') } }),
      ...poseInputs(r, 'b', B, { extra: { when: edits('B') } }),
      { type: 'info', label: 'G / R move or rotate the chosen target in the viewport.', tone: 'muted' },
      { type: 'header', label: 'THIS LESSON' },
      { key: 'play', label: 'Play', type: 'menu', options: ['Play', 'Pause'], value: 'Play' },
      { key: 'progress', label: 'Progress', type: 'slider', min: 0, max: 100, step: 1, unit: '%', value: 60 },
    ];
  },

  // the chosen target, for G / R
  target(ctx) {
    const prefix = ctx.values.edit === 'A' ? 'a' : 'b';
    return {
      get: () => poseFrom(ctx.robot, prefix, ctx.values),
      set: T => setPose(ctx, prefix, T),
    };
  },

  setup(ctx) {
    const { mem } = ctx;
    mem.jPath = draw.polyline('ink', true); mem.lPath = draw.polyline('ink');
    mem.ta = draw.triad(); mem.tb = draw.triad();
    mem.la = draw.label('A'); mem.lb = draw.label('B');
    mem.moveTag = draw.label('', 'hl');
    mem.warn = draw.label('', 'alert');
    ctx.group.add(mem.jPath, mem.lPath, mem.ta, mem.tb, mem.la, mem.lb, mem.moveTag, mem.warn);
    mem.t = ctx.values.progress / 100;
    mem.clock = null;
    mem.qA = mem.qB = ctx.robot.home;
    this.solve(ctx);
  },

  /** Targets changed: solve both ends (each from its last answer, so the arm keeps its configuration), rebuild paths. */
  solve(ctx) {
    const { robot, values: v, mem } = ctx;
    const A = mem.A = poseFrom(robot, 'a', v), B = mem.B = poseFrom(robot, 'b', v);
    const a = robot.chain.ik(A, { seed: mem.qA, seeds: [robot.home] });
    const b = robot.chain.ik(B, { seed: a.ok ? a.q : mem.qB, seeds: [mem.qB, robot.home] });
    mem.okA = a.ok; mem.okB = b.ok;
    mem.why = !a.ok ? ['A', a] : !b.ok ? ['B', b] : null;
    if (a.ok) mem.qA = a.q;
    if (b.ok) mem.qB = b.q;
    const S = robot.scale;
    draw.placeTriad(mem.ta, A, 0.1 * S, 0.004); draw.placeTriad(mem.tb, B, 0.1 * S, 0.004);
    mem.la.position.set(...m.position(A)); mem.lb.position.set(...m.position(B));
    draw.setLabel(mem.la, 'A', v.edit === 'A' ? 'hl' : ''); draw.setLabel(mem.lb, 'B', v.edit === 'B' ? 'hl' : '');
    mem.lPath.setPoints([m.position(A), m.position(B)]);
    if (a.ok && b.ok) {
      mem.L = moveL(robot.chain, A, B, mem.qA, { steps: 80 });
      mem.lineOk = mem.L.every(s => s.ok);
      mem.jPath.setPoints(Array.from({ length: 61 }, (_, i) => m.position(robot.chain.fk(moveJ(mem.qA, mem.qB, i / 60)).flange)));
    } else { mem.L = null; mem.jPath.setPoints([]); }
    mem.warn.visible = !!mem.why;
    if (mem.why) {
      const [name, res] = mem.why;
      mem.warn.position.set(...m.position(name === 'A' ? A : B));
      draw.setLabel(mem.warn, res.status === 'out_of_reach' ? `${name} OUT OF REACH` : res.status === 'invalid_input' ? `${name} INVALID` : `${name}: NO ANSWER FOUND`);
    }
  },

  pose(ctx, t) {
    const { robot, values: v, mem } = ctx;
    if (!mem.okA || !mem.okB) return mem.okA ? mem.qA : mem.okB ? mem.qB : robot.home;
    if (v.move === 'Joint' || !mem.L) return moveJ(mem.qA, mem.qB, t);
    const x = t * (mem.L.length - 1), i = Math.min(mem.L.length - 2, Math.floor(x));
    return moveJ(mem.L[i].q, mem.L[i + 1].q, x - i);
  },

  update(ctx, key) {
    const { values: v, mem } = ctx;
    if (key === null || key === 'target' || key === 'edit' || POSE_KEY.test(key || '')) this.solve(ctx);
    if (key === 'progress') { mem.t = v.progress / 100; ctx.set('play', 'Pause'); v.play = 'Pause'; }
    if (key === 'play' && v.play === 'Play') mem.clock = null;
    if (key === 'play' && v.play === 'Pause') ctx.set('progress', mem.t * 100);
    this.show(ctx);
  },

  show(ctx) {
    const { robot, values: v, mem } = ctx;
    const q = this.pose(ctx, mem.t);
    const f = ctx.view.set(q);
    const joint = v.move === 'Joint';
    mem.moveTag.position.set(...m.position(f.flange));
    draw.setLabel(mem.moveTag, joint ? robot.moves.joint : robot.moves.linear);
    const rows = [
      [[robot.moves.joint, joint ? 'hl' : 'g'], [' '.repeat(Math.max(1, 16 - robot.moves.joint.length)), 'g'], ['joint move: angles mixed', 'g']],
      [[robot.moves.linear, joint ? 'g' : 'hl'], [' '.repeat(Math.max(1, 16 - robot.moves.linear.length)), 'g'], ['linear move: pose mixed + IK per step', 'g']],
      '',
      jointRow(robot, q),
      [['progress  ', 'g'], [`${Math.round(mem.t * 100)} %`, 'k']],
    ];
    if (mem.why) {
      const [name, res] = mem.why;
      rows.push([[`target ${name}: ${res.status === 'out_of_reach' ? 'out of reach' : 'no answer found'}`, 'alert']]);
    } else if (!joint && !mem.lineOk) rows.push([['the line passes where the arm cannot follow', 'alert']]);
    rows.push('', [['dashed: joint move path. solid: linear', 'g']], [[robot.moves.lang, 'g']]);
    ctx.hud.card(rows);
  },

  needsTick: ctx => ctx.values.play === 'Play',

  tick(ctx, time) {
    const { values: v, mem } = ctx;
    if (v.play !== 'Play') return;
    if (mem.clock === null) mem.clock = time - mem.t * 3;       // continue from where it is
    const u = ((time - mem.clock) / 3) % 2;                       // 3 s each way
    mem.t = u < 1 ? u : 2 - u;
    ctx.panel.rows.progress?.row.show?.(Math.round(mem.t * 100));
    this.show(ctx);
  },

  camera(ctx) {
    const { robot, mem } = ctx;
    const c = m.lerp(m.position(mem.A), m.position(mem.B), 0.5);
    return { target: [c[0], c[1], c[2] - 0.1 * robot.reach], height: 1.25 * robot.reach, dir: isoDir(robot) };
  },
};

function isoDir(robot) {
  const f = robot.forward, side = [f[1], -f[0]];
  const h = Math.hypot(f[0] + side[0], f[1] + side[1]), e = Math.atan(1 / Math.SQRT2);
  return [(f[0] + side[0]) / h * Math.cos(e), (f[1] + side[1]) / h * Math.cos(e), Math.sin(e)];
}
