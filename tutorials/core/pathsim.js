// Path simulation for any robot: sample a simple path, solve every point in order, and say what would go wrong.
// Pure math (no three.js). Used by the Simulate slide and the sandbox's Path panel.

import * as m from './mat.js';
import { singularities } from './analysis.js';

/** Where a path sits: its centre (mm) and its turn about Z (deg), as one pose (m). G / R move this. */
export const pathFrame = (centreMm, yawDeg) => m.withPosition(m.rotZ(yawDeg * m.DEG), m.scale(centreMm, 0.001));
/** Back from a pose to centre (mm) and yaw (deg); any tilt is dropped, paths stay level. */
export const fromPathFrame = T => ({ centre: m.scale(m.position(T), 1000), yaw: Math.atan2(T[4], T[0]) / m.DEG });

/**
 * Points (m) of a flat shape centred on c, in the horizontal plane: 'Square' | 'Circle'. size = side / diameter.
 * yaw (rad) turns the shape about its centre.
 */
export function shape(kind, c, size, n = 96, yaw = 0) {
  const pts = rawShape(kind, c, size, n);
  if (!yaw) return pts;
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  return pts.map(p => { const x = p[0] - c[0], y = p[1] - c[1]; return [c[0] + cs * x - sn * y, c[1] + sn * x + cs * y, p[2]]; });
}

function rawShape(kind, c, size, n) {
  const h = size / 2;
  if (kind === 'Circle') return Array.from({ length: n + 1 }, (_, k) => {
    const a = k / n * 2 * Math.PI; return [c[0] + h * Math.cos(a), c[1] + h * Math.sin(a), c[2]];
  });
  const corners = [[-h, -h], [h, -h], [h, h], [-h, h], [-h, -h]];
  const per = n / 4, out = [];
  for (let s = 0; s < 4; s++) for (let k = 0; k < per; k++) {
    const t = k / per, a = corners[s], b = corners[s + 1];
    out.push([c[0] + a[0] + (b[0] - a[0]) * t, c[1] + a[1] + (b[1] - a[1]) * t, c[2]]);
  }
  out.push([c[0] - h, c[1] - h, c[2]]);
  return out;
}

/**
 * Solve every point (orientation R, tool) in order, each from the previous answer.
 * Each result: { q, status } with status one of
 *   'ok' | 'no_answer' (solver failed; may or may not be reachable) | 'out_of_reach' (proven) |
 *   'jump' (a joint would turn > 30 deg between neighbours) | 'singular' (wrist/elbow < 5 deg) | 'limit' (< 5 deg from a limit)
 */
export function simulate(chain, points, R, { tool = null, seed = chain.clamp(new Array(chain.n).fill(0)) } = {}) {
  let q = seed, before = false;   // before: the point before this one was solved, so the robot really comes from there
  return points.map(p => {
    const r = chain.ik(m.withPosition(R, p), { seed: q, tool, iterations: 80 });
    if (!r.ok) { before = false; return { q, status: r.status === 'out_of_reach' ? 'out_of_reach' : 'no_answer', p }; }
    const jump = Math.max(...r.q.map((a, i) => Math.abs(a - q[i])));
    const cameFrom = before;
    q = r.q; before = true;
    // getting to the first point, or to the first one reached again after a gap, is not a jump on the path
    if (cameFrom && jump > 30 * m.DEG) return { q, status: 'jump', p };
    const s = singularities(chain.fk(q, tool));
    if (s.wrist < 5 || s.elbow < 5) return { q, status: 'singular', p };
    if (q.some((a, i) => a - chain.limits[i][0] < 5 * m.DEG || chain.limits[i][1] - a < 5 * m.DEG)) return { q, status: 'limit', p };
    return { q, status: 'ok', p };
  });
}

/**
 * Dense, evenly spread samples along a polyline (m), keeping every original point (corners stay sharp).
 * Segments are split so no step is longer than `step`, or longer if the whole path would need more than `max`.
 * With more original points than `max`, every k-th one is kept first (and the last).
 * The result carries `.sources`: the indices (in the result) of the points that were given, not added;
 * `.dropped`: how many given points were left out; `.step`: the longest step used (m). A caller must report the
 * last two when they are not 0 and `step`: the result is then coarser than the path that was authored.
 */
export function densify(points, { step = 0.005, max = 1000 } = {}) {
  let pts = points;
  if (pts.length > max) { const k = pts.length / (max - 1); pts = Array.from({ length: max - 1 }, (_, i) => pts[Math.floor(i * k)]).concat([points[points.length - 1]]); }
  const dropped = points.length - pts.length;
  if (pts.length < 2) { const out = pts.slice(); out.sources = out.map((_, i) => i); out.dropped = dropped; out.step = step; return out; }
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += m.len(m.sub(pts[i], pts[i - 1]));
  const s = Math.max(step, L / Math.max(1, max - pts.length));
  const out = [pts[0]], sources = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(m.len(m.sub(b, a)) / s));
    for (let j = 1; j <= n; j++) out.push(m.lerp(a, b, j / n));
    sources.push(out.length - 1);
  }
  out.sources = sources; out.dropped = dropped; out.step = s;
  return out;
}

export function tally(results) {
  const c = { ok: 0, no_answer: 0, out_of_reach: 0, jump: 0, singular: 0, limit: 0 };
  for (const r of results) c[r.status]++;
  return c;
}
