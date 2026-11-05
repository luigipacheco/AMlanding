// 00 Title. The robot is picked here, in Animaquina's Robots panel, and stays for the whole tutorial.
import { OUTLINE } from './outline.js';

export default {
  num: '00',
  title: 'INTRODUCTION TO\nINDUSTRIAL ROBOTS',
  body: r => `We take a ${r.name} apart: its joints, how angles become a tool position and back, ` +
    'where it can reach, where it gets stuck, how it moves, and how to stay safe.\n\n' +
    'Every slide is live, and the panel on the right is laid out like Animaquina: each control sits where you ' +
    'will find it there (Robots, Move, Path, Watch).',
  try: 'Pick your robot. It stays with you for the whole tutorial.',
  panels: ['ROBOTS'],

  inputs: (r, app) => [
    { type: 'header', label: 'ROBOTS › MODEL' },
    { key: 'robot', label: 'Robot', type: 'select', value: r.id,
      options: app.robots.map(x => ({ value: x.id, label: `${x.maker} ${x.name}` })) },
  ],

  update(ctx, key) {
    if (key === 'robot') { ctx.app.setRobot(ctx.values.robot); return; }
    const r = ctx.robot;
    ctx.hud.card([
      [[`${r.maker} ${r.name}`, 'hl'], [`   reach ~${Math.round(r.reach * 1000)} mm`, 'g']],
      '',
      ...OUTLINE.map(([n, t]) => [[`${n}  `, 'g'], [t, 'k']]),
    ]);
  },

  // a slow idle sway so the title is alive
  tick(ctx, t) {
    const h = ctx.robot.home;
    ctx.view.set(h.map((a, i) => a + 0.12 * Math.sin(t * 0.5 + i * 0.9) * (i < 3 ? 1 : 1.6)));
  },
};
