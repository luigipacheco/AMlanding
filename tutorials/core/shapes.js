// Default robot drawing: when a robot definition gives no `shapes`, draw it from its kinematics alone.
// One housing per joint (a cylinder along its axis) and one tube from each joint to the next.
// Good enough to teach with; a definition can always hand-author shapes or (later) point to meshes.

import * as m from './mat.js';

/** radii: one per joint (m). Returns shapes per link: [base, link1 .. linkN]. */
export function autoShapes(kin, radii) {
  const n = kin.joints.length;
  const o1 = m.position(kin.joints[0].origin);
  const links = [[{ a: [0, 0, 0], b: o1[2] > 0.02 ? [o1[0], o1[1], o1[2] - radii[0]] : [0, 0, 0.04], r: radii[0] * 1.2, tone: 'dark' }]];
  for (let i = 0; i < n; i++) {
    const r = radii[i], ax = kin.joints[i].axis;
    const shapes = [{ a: m.scale(ax, -r * 1.05), b: m.scale(ax, r * 1.05), r, tone: 'mid', housing: true }];
    const next = i < n - 1 ? m.position(kin.joints[i + 1].origin) : m.position(kin.flange);
    if (m.len(next) > 1e-6) shapes.push({ a: [0, 0, 0], b: next, r: r * 0.7, tone: 'light' });
    if (i === n - 1) {
      const fz = m.axis(kin.flange, 2), p = m.position(kin.flange);
      shapes.push({ a: m.sub(p, m.scale(fz, 0.012)), b: p, r: r * 0.8, tone: 'dark' });
    }
    links.push(shapes);
  }
  return links;
}
