// Default robot drawing: when a robot definition gives no `shapes`, draw it from its kinematics alone.
// One housing per joint (a cylinder along its axis) and one tube from each joint to the next.
// Good enough to teach with; a definition can always hand-author shapes or (later) point to meshes.

import * as m from './mat.js';

/** Endpoints in robot-base metres. barrelAxis points from the nib to the cap in TCP-local coordinates. */
export function penProfile(f, barrelAxis = [0, 0, 1]) {
  const tip = m.position(f.tcp), flange = m.position(f.flange);
  const distance = m.len(m.sub(tip, flange));
  if (distance <= 1e-5) return null;
  // Fit the 160 mm pen and its holder to a short tool offset, independently of robot reach.
  const scale = Math.min(1, distance / 0.2), direction = m.direction(f.tcp, barrelAxis);
  const back = length => m.add(tip, m.scale(direction, length * scale));
  return { scale, tip, neck: back(0.03), shoulder: back(0.14), cap: back(0.16), flange,
    mount: m.add(flange, m.scale(m.axis(f.flange, 2), 0.015 * scale)) };
}

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

/** n points on a circle of radius r about centre c, square to direction d. */
export function ring(c, d, r, n = 16) {
  const u0 = m.normalize(d), helper = Math.abs(u0[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = m.normalize(m.cross(u0, helper)), w = m.cross(u0, u), out = [];
  for (let i = 0; i < n; i++) {
    const t = i / n * 2 * Math.PI;
    out.push(...m.add(c, m.add(m.scale(u, r * Math.cos(t)), m.scale(w, r * Math.sin(t)))));
  }
  return out;
}
/** Points around a cylinder from a to b of radius r (a ring at each end), for its hull. */
export const cylinderPoints = (a, b, r) => [...ring(a, m.sub(b, a), r), ...ring(b, m.sub(b, a), r)];
