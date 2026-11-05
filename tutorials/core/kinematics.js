// Robot-agnostic kinematics for serial arms. Pure math, no three.js.
//
// A chain is a list of revolute joints. Each joint has:
//   origin  fixed 4x4 transform from the previous link frame to this joint's frame (before it turns)
//   axis    unit vector, in that frame, the joint turns about
//   offset  added to the joint value (rad), for controllers whose zero is not the model's zero
// plus a fixed `flange` transform from the last link frame to the vendor's flange frame.
//
// Two ways to write one: dh() for Denavit-Hartenberg tables (UR publishes these), serial() for
// URDF-style origin + axis lists (ROS, most other makers). Both give the same chain object.

import * as m from './mat.js';

/** Standard DH rows [{d, a, alpha, offset}] (m, rad): T_i = Rz(q_i + offset) Tz(d) Tx(a) Rx(alpha). */
export function dh(rows) {
  const post = r => m.chain(m.translate(0, 0, r.d), m.translate(r.a, 0, 0), m.rotX(r.alpha));
  return {
    joints: rows.map((r, i) => ({ origin: i === 0 ? m.identity() : post(rows[i - 1]), axis: [0, 0, 1], offset: r.offset || 0 })),
    flange: post(rows[rows.length - 1]),
  };
}

/** URDF-style joints [{xyz, rpy, axis}] (m, rad) and a flange {xyz, rpy} on the last link. */
export function serial(list, flange = {}) {
  const tf = o => m.chain(m.translate(...(o.xyz || [0, 0, 0])), m.rpy(...(o.rpy || [0, 0, 0])));
  return {
    joints: list.map(j => ({ origin: tf(j), axis: m.normalize(j.axis), offset: j.offset || 0 })),
    flange: tf(flange),
  };
}

function solveLinear(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / (M[r][r] || 1e-12);
  }
  return x;
}

export class Chain {
  constructor(kin, limits) {
    if (!kin?.joints?.length || !m.isRigidTransform(kin.flange) || (kin.base && !m.isRigidTransform(kin.base))) {
      throw new TypeError('A chain needs joints and rigid flange/base transforms');
    }
    if (kin.joints.some(j => !m.isRigidTransform(j.origin) || !j.axis || j.axis.length !== 3
      || !j.axis.every(Number.isFinite) || Math.abs(m.len(j.axis) - 1) > 1e-4
      || !Number.isFinite(j.offset ?? 0))) throw new TypeError('Invalid joint frame, axis or offset');
    this.joints = kin.joints.map(j => ({ ...j, offset: j.offset ?? 0 }));
    this.flange = kin.flange;
    this.base = kin.base || m.identity();
    this.n = kin.joints.length;
    this.limits = limits || this.joints.map(() => [-2 * Math.PI, 2 * Math.PI]);
    if (this.limits.length !== this.n || this.limits.some(l => l.length !== 2 || !l.every(Number.isFinite) || l[0] > l[1])) {
      throw new TypeError('Each joint needs ordered finite limits');
    }
  }

  validJoints(q) { return Array.isArray(q) && q.length === this.n && q.every(Number.isFinite); }

  invalid(message) {
    return { q: this.clamp(new Array(this.n).fill(0)), ok: false, status: 'invalid_input',
      message, ep: null, eo: null, pe: null, oe: null, iterations: 0 };
  }

  clamp(q) { return q.map((v, i) => Math.min(this.limits[i][1], Math.max(this.limits[i][0], v))); }

  /**
   * Forward kinematics. q in rad, tool = 4x4 from flange to TCP (optional).
   * Returns every link frame, each joint's world origin and axis, the flange and the TCP.
   */
  fk(q, tool = null) {
    let T = this.base;
    const links = [], origins = [], axes = [];
    for (let i = 0; i < this.n; i++) {
      const j = this.joints[i];
      T = m.mul(T, j.origin);
      origins.push(m.position(T));
      axes.push(m.normalize(m.direction(T, j.axis)));
      T = m.mul(T, m.rotate(j.axis, q[i] + j.offset));
      links.push(T);
    }
    const flange = m.mul(T, this.flange);
    return { q, links, origins, axes, flange, tcp: tool ? m.mul(flange, tool) : flange };
  }

  /** Geometric Jacobian (6 x n, world frame) of the TCP for an fk() result. */
  jacobian(f) {
    const p = m.position(f.tcp);
    const J = [[], [], [], [], [], []];
    for (let i = 0; i < this.n; i++) {
      const z = f.axes[i], v = m.cross(z, m.sub(p, f.origins[i]));
      J[0].push(v[0]); J[1].push(v[1]); J[2].push(v[2]);
      J[3].push(z[0]); J[4].push(z[1]); J[5].push(z[2]);
    }
    return J;
  }

  /** How far a TCP pose is from a target: position (m) and rotation (rad) errors, world frame. */
  error(target, tcp) {
    const ep = m.sub(m.position(target), m.position(tcp));
    const eo = m.toRotvec(m.mul(m.rotationOf(target), m.invert(m.rotationOf(tcp))));
    return { ep, eo, pe: m.len(ep), oe: m.len(eo) };
  }

  /**
   * Damped least squares from one seed. Works for any 6-axis (or redundant) chain.
   * status: 'converged', or 'not_converged' (the budget ran out: this alone does NOT prove the pose unreachable).
   * The residual (pe m, oe rad) is always measured at the q that is returned.
   */
  solveFrom(target, seed, tool, { iterations = 150, posTol = 1e-5, rotTol = 1e-4, damping = 0.01 } = {}) {
    if (!m.isRigidTransform(target) || (tool != null && !m.isRigidTransform(tool)) || !this.validJoints(seed)
      || !Number.isInteger(iterations) || iterations < 0 || iterations > 10000
      || ![posTol, rotTol, damping].every(v => Number.isFinite(v) && v > 0)) {
      return this.invalid('Expected rigid poses, finite joint seeds and positive solver tolerances');
    }
    let q = this.clamp(seed.slice());
    for (let it = 0; it < iterations; it++) {
      const f = this.fk(q, tool);
      const e = this.error(target, f.tcp);
      if (e.pe < posTol && e.oe < rotTol) return { q, ok: true, status: 'converged', ...e, iterations: it };
      const J = this.jacobian(f), err = [...e.ep, ...e.eo];
      const A = J.map((ri, r) => J.map((rj, c) => ri.reduce((s, v, k) => s + v * rj[k], 0) + (r === c ? damping * damping : 0)));
      const y = solveLinear(A, err);
      let dq = q.map((_, k) => J.reduce((s, row, r) => s + row[k] * y[r], 0));
      const big = Math.max(...dq.map(Math.abs));
      if (big > 0.25) dq = dq.map(v => v * 0.25 / big);
      q = this.clamp(q.map((v, k) => v + dq[k]));
    }
    const e = this.error(target, this.fk(q, tool).tcp);
    const ok = e.pe < posTol && e.oe < rotTol;
    return { q, ok, status: ok ? 'converged' : 'not_converged', ...e, iterations };
  }

  /**
   * A distance no TCP can ever exceed from J1's origin: the sum of every fixed link offset (triangle inequality).
   * A target farther than this is out of reach for certain, whatever the joint values.
   */
  maxReach(tool = null) {
    const l = M => m.len(m.position(M));
    return this.joints.slice(1).reduce((s, j) => s + l(j.origin), 0) + l(this.flange) + (tool ? l(tool) : 0);
  }

  /**
   * Inverse kinematics: joint values (rad) that put the TCP on `target` (4x4).
   * Tries the seed first (so motion stays continuous), then any extra seeds.
   * status: 'converged' | 'out_of_reach' (proven by distance, see maxReach) | 'not_converged' (no answer found;
   * the pose may still be reachable from another start or may need an orientation the wrist cannot give).
   */
  /**
   * True only when no joint values can reach `target` (proof by distances, never by a failed search):
   *  1. the TCP is farther from J1's origin than every link offset added up (maxReach), or
   *  2. with this orientation, the last joint's origin (fixed by the target pose) is farther from anywhere
   *     J2's origin can be (a circle around J1's axis) than the links between them added up.
   */
  provenUnreachable(target, tool = null) {
    const l = M => m.len(m.position(M));
    const T1 = m.mul(this.base, this.joints[0].origin);
    const p1 = m.position(T1);
    if (m.len(m.sub(m.position(target), p1)) > this.maxReach(tool) + 1e-6) return true;
    if (this.n < 3) return false;
    const end = tool ? m.mul(this.flange, tool) : this.flange;        // last link frame -> TCP, fixed
    const pLast = m.position(m.mul(target, m.invert(end)));          // origin of the last joint, fixed by the target
    const links = this.joints.slice(2).reduce((s, j) => s + l(j.origin), 0);
    // J2's origin sweeps a circle about J1's axis
    const z1 = m.normalize(m.direction(T1, this.joints[0].axis));
    const p2 = m.position(m.mul(T1, this.joints[1].origin));
    const c = m.add(p1, m.scale(z1, m.dot(m.sub(p2, p1), z1)));
    const rho = m.len(m.sub(p2, c));
    const d = m.sub(pLast, c), ax = m.dot(d, z1), rad = m.len(m.sub(d, m.scale(z1, ax)));
    return Math.hypot(ax, rad - rho) > links + 1e-6;
  }

  ik(target, { seed, tool = null, seeds = [], ...opts } = {}) {
    if (!m.isRigidTransform(target) || (tool != null && !m.isRigidTransform(tool)) || !Array.isArray(seeds)) {
      return this.invalid('Invalid target, tool or seed list');
    }
    const starts = [seed, ...seeds].filter(s => s != null);
    if (starts.some(s => !this.validJoints(s))) return this.invalid('Invalid joint seed');
    if (!starts.length) starts.push(this.clamp(new Array(this.n).fill(0)));
    // Validate options before applying reach bounds; malformed input is never an unreachable pose.
    if (opts.iterations !== undefined && (!Number.isInteger(opts.iterations) || opts.iterations < 0 || opts.iterations > 10000)) {
      return this.invalid('Invalid iteration budget');
    }
    const check = this.solveFrom(target, starts[0], tool, { ...opts, iterations: 0 });
    if (check.status === 'invalid_input') return check;
    if (this.provenUnreachable(target, tool)) {
      return { ...check, ok: false, status: 'out_of_reach' };
    }
    let best = null;
    for (const s of starts) {
      const r = this.solveFrom(target, s, tool, opts);
      if (r.ok) return r;
      if (!best || r.pe + 0.2 * r.oe < best.pe + 0.2 * best.oe) best = r;
    }
    return best;
  }
}
