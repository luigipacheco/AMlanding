// 09 Safety: zones around the robot slow it down, then stop it, as a person gets close.
import * as m from '../../core/mat.js';
import * as draw from '../../core/draw.js';

const zone = (v, r) => {
  const d = Math.hypot(v.px, v.py) / 1000;
  return d < r + v.stop / 1000 ? 'stop' : d < r + v.slow / 1000 ? 'slow' : 'free';
};
const SPEED = { free: 1, slow: 0.3, stop: 0 };

export default {
  num: '09',
  title: 'SAFETY',
  body: r => r.cobot
    ? `A robot does not see you. A ${r.name} stops when it hits something, but a tool, a part or a fast move can still hurt.\n\n` +
      'Zones around it slow it down, then stop it, as you get close.'
    : `A robot does not see you. A ${r.name} does not stop when it hits something: it works behind a fence, ` +
      'or with scanners that watch zones around it.\n\nThe zones slow it down, then stop it, as you get close.',
  try: 'Walk the person towards the robot with Person X and Y.',
  panels: [],

  inputs: r => {
    const R = r.reach * 1000, slow = 1000, stop = 300;
    const side = [r.forward[1], -r.forward[0]];
    const d = R + slow - 150;                   // just inside the slow zone
    const span = R + slow + 1200;
    return [
      { type: 'header', label: 'ROBOT CONTROLLER › SAFETY ZONES' },
      { key: 'stop', label: 'Stop zone', type: 'slider', min: 0, max: 1000, step: 10, unit: 'mm', value: stop },
      { key: 'slow', label: 'Slow zone', type: 'slider', min: 200, max: 2500, step: 10, unit: 'mm', value: slow },
      { type: 'header', label: 'PERSON  (not a robot setting)' },
      { key: 'px', label: 'Person X', type: 'slider', min: -span, max: span, step: 10, unit: 'mm', value: Math.round(side[0] * d * 0.8 + r.forward[0] * d * 0.6) },
      { key: 'py', label: 'Person Y', type: 'slider', min: -span, max: span, step: 10, unit: 'mm', value: Math.round(side[1] * d * 0.8 + r.forward[1] * d * 0.6) },
    ];
  },

  setup(ctx) {
    const mem = ctx.mem, g = ctx.group;
    mem.slowDisc = draw.disc('accent', { opacity: 0.22 });
    mem.stopDisc = draw.disc('#111111', { opacity: 0.12 });
    mem.reach = draw.circle('ink');
    mem.slowEdge = draw.circle('ink');
    mem.stopEdge = draw.circle('ink');
    mem.body = draw.mesh('cyl', 'mid');
    mem.head = draw.mesh('sphere', 'mid');
    mem.tag = draw.label('', 'hl');
    mem.labels = ['REACH', 'STOP', 'SLOW'].map(t => draw.label(t, 'grey'));
    g.add(mem.slowDisc, mem.stopDisc, mem.reach, mem.slowEdge, mem.stopEdge, mem.body, mem.head, mem.tag, ...mem.labels);
    mem.phase = 0; mem.last = null;
  },

  update(ctx) {
    const { robot, values: v, mem } = ctx, R = robot.reach;
    const rStop = R + v.stop / 1000, rSlow = R + v.slow / 1000;
    mem.slowDisc.scale.set(rSlow, rSlow, 1); mem.slowDisc.position.z = 0.001;
    mem.stopDisc.scale.set(rStop, rStop, 1); mem.stopDisc.position.z = 0.002;
    mem.reach.place([0, 0], R, 0.004); mem.stopEdge.place([0, 0], rStop, 0.004); mem.slowEdge.place([0, 0], rSlow, 0.004);
    const lab = robot.forward.map(c => -c);   // labels behind the robot, out of the way
    [R, rStop, rSlow].forEach((r, i) => mem.labels[i].position.set(lab[0] * r, lab[1] * r, 0.01));

    const p = [v.px / 1000, v.py / 1000];
    const z = mem.zone = zone(v, R);
    const tone = z === 'stop' ? 'dark' : z === 'slow' ? 'accent' : 'mid';
    draw.place(mem.body, [p[0], p[1], 0], [p[0], p[1], 1.45], 0.2);
    draw.place(mem.head, [p[0], p[1], 1.52], [p[0], p[1], 1.74], 0.12);
    draw.setTone(mem.body, tone); draw.setTone(mem.head, tone);
    mem.tag.position.set(p[0], p[1], 1.9);
    draw.setLabel(mem.tag, z === 'stop' ? 'ROBOT STOPPED' : z === 'slow' ? 'ROBOT SLOW' : 'FULL SPEED', z === 'stop' ? 'alert' : z === 'slow' ? 'hl' : '');

    const dist = Math.round(Math.hypot(...p) * 1000);
    ctx.hud.card([
      [['robot speed   ', 'g'], [z === 'stop' ? '0 %  stopped' : z === 'slow' ? '30 %' : '100 %', z === 'stop' ? 'alert' : z === 'slow' ? 'hl' : 'k']],
      [['person        ', 'g'], [`${dist} mm from the base`, 'k']],
      '',
      robot.cobot ? [['cobot: also stops when it touches something', 'g']] : [['industrial robot: fence or scanner required', 'k']],
      [['first run of every program: 10 % speed', 'k']],
      [[robot.where.safety, 'g']],
    ]);
  },

  // the robot keeps working (J1 sweeping), at the speed its zone allows
  tick(ctx, time) {
    const { robot, mem } = ctx;
    const dt = mem.last === null ? 0 : Math.min(0.1, time - mem.last);
    mem.last = time;
    mem.phase += dt * SPEED[mem.zone || 'free'];
    const q = robot.home.slice();
    q[0] += 0.6 * Math.sin(mem.phase * 1.2);
    q[1] += 0.12 * Math.sin(mem.phase * 2.4);
    ctx.view.set(q);
  },

  camera(ctx) {
    const { robot, values: v } = ctx;
    const r = robot.reach + v.slow / 1000;
    const f = robot.forward, side = [f[1], -f[0]], e = 62 * m.DEG;
    const h = Math.hypot(f[0] + side[0], f[1] + side[1]);
    return { target: [0, 0, 0.3], height: 2.3 * r, dir: [(f[0] + side[0]) / h * Math.cos(e), (f[1] + side[1]) / h * Math.cos(e), Math.sin(e)] };
  },
};
