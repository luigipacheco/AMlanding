// 06 Reach: a vertical slice of test targets through the base, each tested with inverse kinematics.
// Computed a few rows per frame so the page stays responsive.
import * as m from '../../core/mat.js';
import * as draw from '../../core/draw.js';

const STATUS_LOOK = {
  converged: ['accent', 9, true],        // reachable: lime square, ink edge
  out_of_reach: ['#c9c9c4', 4, false],   // proven out of reach: small grey
  not_converged: ['#8d8d88', 4, false],  // no answer found: small darker grey
};

export default {
  num: '06',
  title: 'REACH',
  body: r => 'Every square is a target, tested with inverse kinematics. Lime: solved. Grey: out of reach or no answer found.\n\n' +
    `The ${r.name} reaches about ${Math.round(r.reach * 1000)} mm, but not its own base, ` +
    'and how the tool is turned changes what it can reach.',
  try: 'Switch Tool from Down to Forward.',

  panels: [],
  inputs: () => [{ type: 'header', label: 'THIS LESSON' }, { key: 'tool', label: 'Tool', type: 'menu', options: ['Down', 'Forward'], value: 'Down' }],

  setup(ctx) {
    const { robot, mem } = ctx, R = robot.reach;
    const f = robot.forward;
    // the slice: through J1's axis, along the arm's forward direction
    const step = R / 22;
    mem.pts = [];
    const nu = Math.round(2.7 * R / step), nz = Math.round(1.6 * R / step);
    for (let j = 0; j <= nz; j++) {
      const row = [];
      for (let i = 0; i <= nu; i++) {
        const u = -1.35 * R + i * step, z = 0.03 + j * step;
        row.push([f[0] * u, f[1] * u, z]);
      }
      if (j % 2) row.reverse();              // serpentine: each target starts from its neighbour's answer
      mem.pts.push(...row);
    }
    mem.dots = draw.dots(mem.pts.length);
    mem.pts.forEach((p, i) => mem.dots.set(i, p, '#e4e4e0', 3, false));
    mem.dots.commit();
    ctx.group.add(mem.dots);
  },

  update(ctx) {
    const { robot, values: v, mem } = ctx;
    const down = robot.chain.fk(robot.home).flange;
    let R = m.rotationOf(down);
    if (v.tool === 'Forward') {
      const z = m.axis(down, 2), want = robot.forward;
      const ax = m.cross(z, want);
      R = m.mul(m.rotate(ax, Math.acos(Math.max(-1, Math.min(1, m.dot(z, want))))), R);
    }
    mem.R = R;
    mem.next = 0;
    mem.seed = robot.home;
    mem.count = { converged: 0, out_of_reach: 0, not_converged: 0 };
    mem.pts.forEach((p, i) => mem.dots.set(i, p, '#e4e4e0', 3, false));
    mem.dots.commit();
    ctx.view.set(robot.home);
    this.card(ctx);
  },

  needsTick: ctx => ctx.mem.next < ctx.mem.pts.length,

  tick(ctx) {
    const { robot, mem } = ctx;
    if (mem.next >= mem.pts.length) return;
    const t0 = performance.now();
    while (mem.next < mem.pts.length && performance.now() - t0 < 10) {
      const i = mem.next++;
      const T = m.withPosition(mem.R, mem.pts[i]);
      // start from the neighbour's answer, then home, then home turned round (for targets behind the base)
      const turned = robot.home.map((a, k) => (k === 0 ? a + Math.PI * (a > 0 ? -1 : 1) : a));
      const r = robot.chain.ik(T, { seed: mem.seed, seeds: [robot.home, robot.chain.clamp(turned)], iterations: 60 });
      if (r.ok) mem.seed = r.q;
      mem.count[r.status]++;
      const [tone, px, edged] = STATUS_LOOK[r.status];
      mem.dots.set(i, mem.pts[i], tone, px, edged);
    }
    mem.dots.commit();
    this.card(ctx);
  },

  card(ctx) {
    const { mem, values: v } = ctx, c = mem.count, n = mem.pts.length;
    const rows = [
      [['tool ', 'g'], [v.tool.toLowerCase(), 'hl']],
      '',
      [['reachable          ', 'g'], [`${c.converged}`, 'k']],
      [['out of reach       ', 'g'], [`${c.out_of_reach}`, 'k'], ['   proven by distance', 'g']],
    ];
    if (c.not_converged) rows.push([['no answer found    ', 'g'], [`${c.not_converged}`, 'k'], ['   the solver gave up', 'g']]);
    rows.push('', mem.next < n ? [['checking ', 'g'], [`${Math.round(mem.next / n * 100)} %`, 'k']] : [['all targets checked', 'g']],
      [['check reach before you design the part', 'g']]);
    ctx.hud.card(rows);
  },

  camera(ctx) {
    const { robot } = ctx, R = robot.reach, f = robot.forward;
    const side = [f[1], -f[0], 0], e = 12 * m.DEG;
    return { target: [0, 0, 0.78 * R], height: 1.9 * R, dir: [side[0] * Math.cos(e), side[1] * Math.cos(e), Math.sin(e)] };
  },
};
