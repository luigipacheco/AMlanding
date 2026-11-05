// 11 What's next: the end of the tutorial. A short recap, and where to go from here (links into the home page).
// The robot moves slowly, as on the home page; nothing to change on this slide.
import { isoView } from '../../core/stage.js';

export default {
  num: '11',
  title: "WHAT'S\nNEXT",
  body: r => `You have seen what every robot programmer checks: joints and frames, forward and inverse kinematics, ` +
    `the TCP, reach, singularities, moves, safety and simulation, on the ${r.maker} ${r.name}.\n\n` +
    'Animaquina brings it to your robot, in Blender: a live digital twin, real-time control and visual programming. ' +
    'Want a robot cell, or a workshop for your team? We do that too.',
  cta: [
    { label: 'Download Animaquina for Blender →', href: '#download', primary: true },
    { label: 'Robot cells', href: '#cells' },
    { label: 'Workshops & services', href: '#services' },
    { label: 'Start again', href: 'learn.html?t=industrial-robots#00' },
  ],
  panels: [],
  inputs: () => [],

  camera: ctx => ({ ...isoView(ctx.robot), height: ctx.robot.reach * 1.6 }),

  update(ctx) { ctx.hud.card([]); ctx.view.set(ctx.robot.home); },
  tick(ctx, t) {
    const r = ctx.robot;
    ctx.view.set(r.home.map((a, i) => a + 0.16 * Math.sin(t * 0.45 + i * 0.9) * (i < 3 ? 1 : 1.7)));
  },
};
