// Inputs, readouts and 3D helpers shared by the slides of this deck. All robot-agnostic.

import * as m from '../../core/mat.js';

const { DEG } = m;

// ── inputs ──────────────────────────────────────────────────────────────────────

/** One slider per joint, named the robot's way (J1.. or A1..), starting at its home pose. */
export const jointInputs = (robot, extra = {}) => robot.joints.map((j, i) => ({
  key: `j${i}`, label: j.name, type: 'slider', unit: '°', step: 0.1,
  min: j.limits[0], max: j.limits[1], value: robot.home[i] / DEG, ...extra,
}));
export const jointsFrom = (robot, v) => robot.joints.map((_, i) => v[`j${i}`] * DEG);
export function setJoints(ctx, q) { q.forEach((a, i) => ctx.set(`j${i}`, a / DEG)); }

/** X Y Z (mm) + the robot's orientation, as the controller writes them, starting at pose M. */
export function poseInputs(robot, prefix, M, { header, labelPrefix = '', xyzRange, extra = {} } = {}) {
  const v = robot.poseValues(M), o = robot.orient, R = robot.reach * 1000;
  const ranges = xyzRange || [[-R * 1.15, R * 1.15], [-R * 1.15, R * 1.15], [-R * 0.3, R * 1.4]];
  return [
    ...(header ? [{ type: 'header', label: header, ...extra }] : []),
    ...['X', 'Y', 'Z'].map((n, i) => ({ key: `${prefix}${n}`, label: labelPrefix + n, type: 'slider', unit: 'mm', step: 0.1,
      min: Math.round(ranges[i][0]), max: Math.round(ranges[i][1]), softRange: true, value: +v.xyz[i].toFixed(1), ...extra })),
    ...o.labels.map((n, i) => ({ key: `${prefix}R${i}`, label: labelPrefix + n, type: 'slider', unit: o.unit, step: o.step,
      min: o.range[0], max: o.range[1], softRange: true, value: +v.rot[i].toFixed(o.decimals), ...extra })),
  ];
}
export const poseFrom = (robot, prefix, v) =>
  robot.poseMatrix([v[`${prefix}X`], v[`${prefix}Y`], v[`${prefix}Z`]], [0, 1, 2].map(i => v[`${prefix}R${i}`]));
export function setPose(ctx, prefix, M) {
  const v = ctx.robot.poseValues(M);
  ['X', 'Y', 'Z'].forEach((n, i) => ctx.set(`${prefix}${n}`, v.xyz[i]));
  v.rot.forEach((a, i) => ctx.set(`${prefix}R${i}`, a));
}

// ── readouts (card rows) ────────────────────────────────────────────────────────

const num = (v, d, w) => { const s = (Math.abs(v) < 0.5 * 10 ** -d ? 0 : v).toFixed(d); return s.padStart(w); };

/** "J  0.0, -70.0, ..." the robot's way. */
export function jointRow(robot, q, tone = 'k') {
  const letter = robot.joints[0].name.replace(/\d+$/, '');
  return [[`${letter}  `, 'g'], [q.map(a => num(a / DEG, 1, 0)).join(', '), tone], [' °', 'g']];
}
/** Two rows: position mm, orientation in the robot's own convention. */
export function poseRows(robot, M, tone = 'k') {
  const v = robot.poseValues(M), o = robot.orient;
  return [
    ['X', 'Y', 'Z'].flatMap((n, i) => [[`${n} `, 'g'], [num(v.xyz[i], 1, 7) + '  ', tone]]).concat([['mm', 'g']]),
    o.labels.flatMap((n, i) => [[`${n.padEnd(2)} `, 'g'], [num(v.rot[i], o.decimals, 6) + '  ', tone]]).concat([[o.unit, 'g']]),
  ];
}
export const toolMatrix = (robot, t) => robot.poseMatrix(t.xyz, t.rot);

// ── 3D helpers ──────────────────────────────────────────────────────────────────

export { jointAxes, jointLabels } from '../../core/joint-annotations.js';
