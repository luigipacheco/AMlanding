// Robot-agnostic measures for teaching: every inverse-kinematics answer for a pose, how close the arm is to each
// singularity, how fast the joints must turn for a tool speed, and joint / linear moves. Pure math, no three.js.

import * as m from './mat.js';

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

/** Put each angle in (-180, 180], or the nearest turn of it inside the joint's limits. */
export function tidy(chain, q) {
  return q.map((a, i) => {
    const [lo, hi] = chain.limits[i];
    let b = wrap(a);
    if (b < lo) b += 2 * Math.PI;
    if (b > hi) b -= 2 * Math.PI;
    return b;
  });
}

/**
 * Every distinct answer found for one TCP pose (up to 8 on a six-axis arm), from many starting guesses.
 * Sorted by distance from `ref` (the robot keeps the closest). Numeric: a rare answer can be missed, so the
 * count is "found", not "exists".
 */
export function allSolutions(chain, target, { tool = null, ref, seeds = 72, iterations = 70 } = {}) {
  let s = 12345;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const span = ([lo, hi]) => [Math.max(lo, -Math.PI), Math.min(hi, Math.PI)];
  const starts = [ref];
  for (let k = 0; k < seeds; k++) starts.push(chain.limits.map(l => { const [a, b] = span(l); return a + rnd() * (b - a); }));
  const found = [];
  for (const q0 of starts) {
    const r = chain.solveFrom(target, q0, tool, { iterations });
    if (!r.ok) continue;
    const q = tidy(chain, r.q);
    if (q.some((a, i) => a < chain.limits[i][0] - 1e-6 || a > chain.limits[i][1] + 1e-6)) continue;
    if (!found.some(f => f.every((a, i) => Math.abs(wrap(a - q[i])) < 0.01))) found.push(q);
  }
  const dist = q => q.reduce((d, a, i) => d + Math.abs(wrap(a - ref[i])), 0);
  return found.sort((a, b) => dist(a) - dist(b));
}

/**
 * How close an fk() result is to the three classic singularities. Works for arms whose J2 and J3 are parallel
 * (UR, KUKA, xArm...). The wrist point is joint 5's origin. Checked against det J on 12 of the 13 robots; the xArm 6
 * is the exception (its J5 and J6 axes are 76 mm apart, so "J4 and J6 in line" is not where it is singular).
 *   shoulder (m):  the wrist point's distance from where J1 stops helping: J1's own axis, or, on robots with a
 *                  shoulder offset like UR, a cylinder around it (radius = `ring`)
 *   elbow (deg):   how far the arm is from fully stretched or folded
 *   wrist (deg):   the angle between the J4 and J6 axes
 * These come from splitting the wrist point's 3x3 Jacobian: det = shoulder term x elbow term.
 */
export function singularities(f) {
  const pw = f.origins[4];
  const col = i => m.cross(f.axes[i], m.sub(pw, f.origins[i]));
  const c2 = col(1), c3 = col(2);
  // The shoulder term is taken where the J5 and J6 axes meet (the point on J6's axis nearest J5's). On a spherical
  // wrist (KUKA, 850) that is the wrist point itself; on UR, whose wrist is offset, joint 5's origin is not the
  // point J1 loses, and the measure used to sit 7 to 11 degrees of J2 away from where the Jacobian drops rank.
  const a = f.axes[4], b = f.axes[5], w = m.sub(f.origins[5], f.origins[4]), ab = m.dot(a, b);
  const ps = m.add(f.origins[5], m.scale(b, (m.dot(w, a) * ab - m.dot(w, b)) / (1 - ab * ab || 1)));
  const shoulder = Math.abs(m.dot(m.cross(f.axes[0], m.sub(ps, f.origins[0])), f.axes[1]));
  const elbow = Math.asin(Math.min(1, m.len(m.cross(c2, c3)) / (m.len(c2) * m.len(c3) || 1))) / m.DEG;
  const wrist = Math.asin(Math.min(1, m.len(m.cross(f.axes[3], f.axes[5])))) / m.DEG;
  const ring = Math.abs(m.dot(m.sub(ps, f.origins[0]), f.axes[1]));
  return { shoulder, elbow, wrist, ring, wristPoint: pw, shoulderPoint: ps };
}

/** Joint speeds (rad/s) for a TCP velocity v = [vx vy vz wx wy wz] (m/s, rad/s) at an fk() result (damped). */
export function jointSpeeds(chain, f, v) {
  const J = chain.jacobian(f), lam = 1e-4;
  const M = J.map((ri, r) => [...J.map((rj, c) => ri.reduce((s, x, k) => s + x * rj[k], 0) + (r === c ? lam * lam : 0)), v[r]]);
  for (let c = 0; c < 6; c++) {
    let p = c;
    for (let r = c + 1; r < 6; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < 6; r++) { const k = M[r][c] / (M[c][c] || 1e-12); for (let j = c; j <= 6; j++) M[r][j] -= k * M[c][j]; }
  }
  const y = new Array(6).fill(0);
  for (let r = 5; r >= 0; r--) { let s = M[r][6]; for (let j = r + 1; j < 6; j++) s -= M[r][j] * y[j]; y[r] = s / (M[r][r] || 1e-12); }
  return Array.from({ length: chain.n }, (_, k) => J.reduce((s, row, r) => s + row[k] * y[r], 0));
}

/** MoveJ: every joint turns evenly from qA to qB. */
export const moveJ = (qA, qB, t) => qA.map((a, i) => a + (qB[i] - a) * t);

/**
 * MoveL: the TCP goes in a straight line (orientation blended), inverse kinematics at every step, each step
 * starting from the one before. Returns samples [{t, q, ok}]; ok = false where the solver did not converge
 * or the arm would have to jump (a joint turning more than ~35 deg between two close samples).
 */
export function moveL(chain, A, B, qA, { tool = null, steps = 60 } = {}) {
  const out = [];
  let q = qA;
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const r = chain.solveFrom(m.blendPose(A, B, t), q, tool, { iterations: 60 });
    const jump = Math.max(...r.q.map((a, i) => Math.abs(a - q[i])));
    out.push({ t, q: r.q, ok: r.ok && jump < 0.6 });
    if (r.ok) q = r.q;
  }
  return out;
}
