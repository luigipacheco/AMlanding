// 11 Simulate: run a short path in simulation before any real move, then the three steps to the real robot.
import * as m from '../../core/mat.js';
import * as draw from '../../core/draw.js';
import { shape, simulate, tally, pathFrame, fromPathFrame } from '../../core/pathsim.js';
import { toolMatrix } from './common.js';

const LOOK = {
  ok: ['#111111', 4, false],
  singular: ['accent', 9, true],
  limit: ['accent', 9, true],
  jump: ['accent', 9, true],
  no_answer: ['#111111', 10, false],
  out_of_reach: ['#111111', 10, false],
};

export default {
  num: '11',
  title: 'SIMULATE',
  body: 'Before a real robot moves, run the program in simulation: every point reached, no joint near its limit, ' +
    'no singularity, no sudden jump.\n\n' +
    "Then check it in the maker's software, and run it slowly the first time.",
  try: 'Make Size bigger until the path breaks. Then move it: Center X / Y, or press G (R turns it).',
  panels: ['PATH', 'WATCH'],

  inputs: r => {
    const c = m.position(r.chain.fk(r.home, toolMatrix(r, r.tool)).tcp).map(v => Math.round(v * 100) * 10);
    const R = Math.round(r.reach * 1500);
    return [
    { type: 'header', label: 'PATH › SHAPE' },
    { key: 'shape', label: 'Shape', type: 'menu', options: ['Square', 'Circle'], value: 'Square' },
    { key: 'size', label: 'Size', type: 'slider', min: 50, max: Math.round(r.reach * 1800), step: 10, unit: 'mm', value: Math.round(r.reach * 350 / 10) * 10 },
    { key: 'height', label: 'Height', type: 'slider', min: 0, max: Math.round(r.reach * 1200), step: 10, unit: 'mm',
      value: Math.round(Math.max(50, m.position(r.chain.fk(r.home, toolMatrix(r, r.tool)).tcp)[2] * 1000) / 10) * 10 },
    { type: 'header', label: 'PATH › PLACEMENT  (from the base)' },
    { key: 'cx', label: 'Center X', type: 'slider', min: -R, max: R, step: 1, unit: 'mm', softRange: true, value: c[0] },
    { key: 'cy', label: 'Center Y', type: 'slider', min: -R, max: R, step: 1, unit: 'mm', softRange: true, value: c[1] },
    { key: 'yaw', label: 'Yaw', type: 'slider', min: -180, max: 180, step: 0.5, unit: '°', value: 0 },
    { type: 'info', label: 'G / R move or turn the path in the viewport.', tone: 'muted' },
  ];
  },

  // the path itself, for G / R: centre + yaw
  target(ctx) {
    const v = ctx.values;
    return {
      get: () => pathFrame([v.cx, v.cy, v.height], v.yaw),
      set: T => {
        const p = fromPathFrame(T);
        ctx.set('cx', Math.round(p.centre[0])); ctx.set('cy', Math.round(p.centre[1]));
        ctx.set('height', Math.max(0, Math.round(p.centre[2]))); ctx.set('yaw', Math.round(p.yaw * 2) / 2);
      },
    };
  },

  setup(ctx) {
    const mem = ctx.mem;
    mem.dots = draw.dots(200);
    mem.trail = draw.polyline('ink');
    mem.frame = draw.triad();                  // the path's handle: centre and direction
    ctx.group.add(mem.dots, mem.trail, mem.frame);
    mem.tool = toolMatrix(ctx.robot, ctx.robot.tool);
    ctx.view.showPen(true);
  },

  update(ctx) {
    const { robot, values: v, mem } = ctx;
    const home = robot.chain.fk(robot.home, mem.tool).tcp;
    const F = pathFrame([v.cx, v.cy, v.height], v.yaw);
    mem.points = shape(v.shape, m.position(F), v.size / 1000, 96, v.yaw * m.DEG);
    // the tool turns with the path
    mem.res = simulate(robot.chain, mem.points, m.mul(m.rotZ(v.yaw * m.DEG), m.rotationOf(home)), { tool: mem.tool, seed: robot.home });
    draw.placeTriad(mem.frame, F, 0.08 * robot.scale, 0.003);
    mem.count = tally(mem.res);
    for (let i = 0; i < 200; i++) {
      const r = mem.res[i];
      if (r) { const [tone, px, edged] = LOOK[r.status]; mem.dots.set(i, r.p, tone, px, edged); }
      else mem.dots.set(i, [0, 0, -10], '#ffffff', 0, false);
    }
    mem.dots.commit();
    mem.start = null;
    mem.lastIndex = null;
    const c2 = mem.count, n = mem.res.length;
    const fail = c2.no_answer + c2.out_of_reach;
    const num = (x, bad) => [`${x}`.padStart(4), x ? bad : 'k'];
    ctx.hud.card([
      [['WATCH  ', 'g'], [`${n} points`, 'k']],
      [['reached            ', 'g'], [`${n - fail}`.padStart(4), fail ? 'alert' : 'k'], [` / ${n}`, 'g']],
      [['near a singularity ', 'g'], num(c2.singular, 'hl')],
      [['near a joint limit ', 'g'], num(c2.limit, 'hl')],
      [['sudden joint jump  ', 'g'], num(c2.jump, 'hl')],
      '',
      [['1  ', 'hl'], ['simulate it: here, or in Animaquina', 'k']],
      [['2  ', 'hl'], [`check it in ${robot.simulator || "the maker's own software"}`, 'k']],
      [['3  ', 'hl'], ['first real run: 10 % speed, hand on the E-stop', 'k']],
    ]);
  },

  // play the path; the pen leaves an ink trail
  needsTick: ctx => !!ctx.mem.res?.length,
  tick(ctx, time) {
    const { mem } = ctx;
    if (!mem.res?.length) return;
    if (mem.start === null) mem.start = time;
    const n = mem.res.length, u = ((time - mem.start) / 8) % 1, k = Math.min(n - 1, Math.floor(u * n));
    if (mem.lastIndex === k) return;
    mem.lastIndex = k;
    ctx.view.set(mem.res[k].q, mem.tool);
    mem.trail.setPoints(mem.res.slice(0, k + 1).filter(r => r.status !== 'no_answer' && r.status !== 'out_of_reach').map(r => r.p));
  },

  camera(ctx) {
    const { robot } = ctx;
    const c = m.position(robot.chain.fk(robot.home).flange);
    const f = robot.forward, side = [f[1], -f[0]], e = Math.atan(1 / Math.SQRT2);
    const h = Math.hypot(f[0] + side[0], f[1] + side[1]);
    return { target: [c[0] * 0.6, c[1] * 0.6, robot.reach * 0.3], height: 1.5 * robot.reach,
      dir: [(f[0] + side[0]) / h * Math.cos(e), (f[1] + side[1]) / h * Math.cos(e), Math.sin(e)] };
  },
};
