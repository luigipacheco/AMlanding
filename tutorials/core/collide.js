// Do two convex shapes touch? GJK (Gilbert-Johnson-Keerthi) on point sets: each shape is the convex hull of its
// points, so only the hull's corners are needed (core/hull.js keeps those). Pure: no three.js.
//
// Used for the robot's own links against each other and against things around it: each link is the hull of the
// robot model's meshes in its own frame (RobotView.collisionHulls), placed by forward kinematics.

import * as m from './mat.js';

/** Flat points [x, y, z, ...] moved by a row-major 4x4 matrix, as a new Float64Array. */
export function placePoints(M, flat) {
  const out = new Float64Array(flat.length);
  for (let i = 0; i < flat.length; i += 3) {
    const x = flat[i], y = flat[i + 1], z = flat[i + 2];
    out[i] = M[0] * x + M[1] * y + M[2] * z + M[3];
    out[i + 1] = M[4] * x + M[5] * y + M[6] * z + M[7];
    out[i + 2] = M[8] * x + M[9] * y + M[10] * z + M[11];
  }
  return out;
}

/** The point of a set farthest along direction d. */
function support(P, d) {
  let best = 0, most = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    const s = P[i] * d[0] + P[i + 1] * d[1] + P[i + 2] * d[2];
    if (s > most) { most = s; best = i; }
  }
  return [P[best], P[best + 1], P[best + 2]];
}

/** A point of the Minkowski difference A - B, farthest along d. */
const supportAB = (A, B, d) => m.sub(support(A, d), support(B, m.scale(d, -1)));
const tripleCross = (a, b, c) => m.cross(m.cross(a, b), c);   // (a x b) x c
const centre = P => {
  const c = [0, 0, 0], n = P.length / 3;
  for (let i = 0; i < P.length; i += 3) { c[0] += P[i]; c[1] += P[i + 1]; c[2] += P[i + 2]; }
  return m.scale(c, 1 / n);
};

/**
 * Whether the convex hulls of point sets A and B (flat [x, y, z, ...], in one frame) overlap. Touching faces count as
 * not overlapping (within floating point); a shape inside the other counts as overlapping.
 */
export function overlap(A, B) {
  if (A.length < 3 || B.length < 3) return false;
  let d = m.sub(centre(A), centre(B));
  if (m.dot(d, d) < 1e-18) d = [1, 0, 0];
  let simplex = [supportAB(A, B, d)];
  d = m.scale(simplex[0], -1);
  for (let iter = 0; iter < 64; iter++) {
    if (m.dot(d, d) < 1e-24) return true;           // the origin lies on the simplex
    const a = supportAB(A, B, d);
    if (m.dot(a, d) <= 0) return false;              // the difference never reaches the origin: apart
    simplex.push(a);
    const next = nearest(simplex);
    if (!next) return true;                          // the tetrahedron holds the origin
    [simplex, d] = next;
  }
  return true;                                       // no progress (degenerate, deep): treat as touching
}

/** The sub-simplex nearest the origin and the direction from it towards the origin; null when it encloses it. */
function nearest(s) {
  const a = s[s.length - 1], ao = m.scale(a, -1);
  if (s.length === 2) {
    const b = s[0], ab = m.sub(b, a);
    if (m.dot(ab, ao) > 0) {
      const d = tripleCross(ab, ao, ab);
      return [[b, a], m.dot(d, d) > 1e-24 ? d : anyNormal(ab)];
    }
    return [[a], ao];
  }
  if (s.length === 3) {
    const [c, b] = s, ab = m.sub(b, a), ac = m.sub(c, a), abc = m.cross(ab, ac);
    if (m.dot(m.cross(abc, ac), ao) > 0) {
      if (m.dot(ac, ao) > 0) return [[c, a], tripleCross(ac, ao, ac)];
      return nearest([b, a]);
    }
    if (m.dot(m.cross(ab, abc), ao) > 0) return nearest([b, a]);
    if (m.dot(abc, ao) > 0) return [[c, b, a], abc];
    return [[b, c, a], m.scale(abc, -1)];
  }
  // tetrahedron: a is the newest point; test the three faces that hold it
  const [d0, c, b] = s, ab = m.sub(b, a), ac = m.sub(c, a), ad = m.sub(d0, a);
  const abc = m.cross(ab, ac), acd = m.cross(ac, ad), adb = m.cross(ad, ab);
  if (m.dot(abc, ao) > 0) return nearest([c, b, a]);
  if (m.dot(acd, ao) > 0) return nearest([d0, c, a]);
  if (m.dot(adb, ao) > 0) return nearest([b, d0, a]);
  return null;
}

const anyNormal = v => m.cross(v, Math.abs(v[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);

/**
 * Which placed shapes touch. links: placed link hulls (index = link: 0 base .. n); things: [{ name, points }]
 * placed. Neighbouring links always meet at their joint, so they are not compared.
 * Returns [{ a: link, b: link | null, thing: name | null }].
 */
export function contacts(links, things = []) {
  const out = [];
  for (let i = 0; i < links.length; i++) {
    for (let j = i + 2; j < links.length; j++) if (overlap(links[i], links[j])) out.push({ a: i, b: j, thing: null });
    for (const t of things) if (overlap(links[i], t.points)) out.push({ a: i, b: null, thing: t.name });
  }
  return out;
}
