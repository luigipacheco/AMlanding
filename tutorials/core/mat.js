// Small, dependency-free 4x4 math. Matrices are row-major arrays of 16 numbers (M[row * 4 + col]).
// No three.js here on purpose: kinematics must run anywhere (browser, worker, Node tests, a future Animaquina back end).

export const DEG = Math.PI / 180;

/** Finite, right-handed rigid transform. Scale/shear are not robot poses. */
export function isRigidTransform(M, tolerance = 1e-4) {
  if (!M || M.length !== 16 || !Array.from(M).every(Number.isFinite)) return false;
  if ([M[12], M[13], M[14], M[15] - 1].some(v => Math.abs(v) > tolerance)) return false;
  const axes = [0, 1, 2].map(i => [M[i], M[4 + i], M[8 + i]]);
  return axes.every(a => Math.abs(dot(a, a) - 1) <= tolerance)
    && Math.abs(dot(axes[0], axes[1])) <= tolerance
    && Math.abs(dot(axes[0], axes[2])) <= tolerance
    && Math.abs(dot(axes[1], axes[2])) <= tolerance
    && Math.abs(dot(cross(axes[0], axes[1]), axes[2]) - 1) <= tolerance;
}

// ── vectors ─────────────────────────────────────────────────────────────────────
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = a => Math.hypot(a[0], a[1], a[2]);
export const normalize = a => { const l = len(a); return l < 1e-12 ? [0, 0, 0] : scale(a, 1 / l); };
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ── matrices ────────────────────────────────────────────────────────────────────
export const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function mul(A, B) {
  const C = new Array(16);
  for (let r = 0; r < 4; r++) {
    const r4 = r * 4;
    for (let c = 0; c < 4; c++) {
      C[r4 + c] = A[r4] * B[c] + A[r4 + 1] * B[4 + c] + A[r4 + 2] * B[8 + c] + A[r4 + 3] * B[12 + c];
    }
  }
  return C;
}
export const chain = (...Ms) => Ms.reduce((a, b) => mul(a, b));

export const translate = (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];

/** Rotation by angle t (rad) about an axis through the origin (Rodrigues). */
export function rotate(axis, t) {
  const [x, y, z] = normalize(axis);
  const c = Math.cos(t), s = Math.sin(t), C = 1 - c;
  return [
    c + x * x * C, x * y * C - z * s, x * z * C + y * s, 0,
    y * x * C + z * s, c + y * y * C, y * z * C - x * s, 0,
    z * x * C - y * s, z * y * C + x * s, c + z * z * C, 0,
    0, 0, 0, 1,
  ];
}
export const rotX = t => rotate([1, 0, 0], t);
export const rotY = t => rotate([0, 1, 0], t);
export const rotZ = t => rotate([0, 0, 1], t);
/** URDF roll-pitch-yaw: R = Rz(yaw) * Ry(pitch) * Rx(roll). */
export const rpy = (r, p, y) => chain(rotZ(y), rotY(p), rotX(r));

export const position = M => [M[3], M[7], M[11]];
/** Column i of the rotation part: the frame's x (0), y (1) or z (2) axis in parent coordinates. */
export const axis = (M, i) => [M[i], M[4 + i], M[8 + i]];
export const point = (M, v) => [
  M[0] * v[0] + M[1] * v[1] + M[2] * v[2] + M[3],
  M[4] * v[0] + M[5] * v[1] + M[6] * v[2] + M[7],
  M[8] * v[0] + M[9] * v[1] + M[10] * v[2] + M[11],
];
export const direction = (M, v) => [
  M[0] * v[0] + M[1] * v[1] + M[2] * v[2],
  M[4] * v[0] + M[5] * v[1] + M[6] * v[2],
  M[8] * v[0] + M[9] * v[1] + M[10] * v[2],
];
export function withPosition(M, p) { const R = M.slice(); R[3] = p[0]; R[7] = p[1]; R[11] = p[2]; return R; }
export const rotationOf = M => withPosition(M, [0, 0, 0]);

/** Inverse of a rigid transform (rotation + translation). */
export function invert(M) {
  const R = [M[0], M[4], M[8], 0, M[1], M[5], M[9], 0, M[2], M[6], M[10], 0, 0, 0, 0, 1];
  const p = direction(R, position(M));
  R[3] = -p[0]; R[7] = -p[1]; R[11] = -p[2];
  return R;
}

// ── orientation conventions ─────────────────────────────────────────────────────

/** Rotation vector (axis * angle, rad, angle in [0, pi]) — what a UR controller shows as RX RY RZ. */
export function toRotvec(M) {
  const v = [M[9] - M[6], M[2] - M[8], M[4] - M[1]];      // = 2 sin(a) * axis
  const s2 = len(v);
  const c = (M[0] + M[5] + M[10] - 1) / 2;
  const a = Math.atan2(s2 / 2, c);
  if (s2 < 1e-12 && c > 0) return [0, 0, 0];
  if (c > -0.99) return scale(v, a / s2);
  // near a half turn sin(a) is tiny, so read the axis from the symmetric part: (R + R^T)/2 = c I + (1 - c) n n^T
  const k = 1 / (1 - c);
  const nn = [[(M[0] - c) * k, (M[1] + M[4]) / 2 * k, (M[2] + M[8]) / 2 * k],
              [0, (M[5] - c) * k, (M[6] + M[9]) / 2 * k],
              [0, 0, (M[10] - c) * k]];
  const i = nn[0][0] >= nn[1][1] && nn[0][0] >= nn[2][2] ? 0 : nn[1][1] >= nn[2][2] ? 1 : 2;
  const ni = Math.sqrt(Math.max(1e-30, nn[i][i]));
  const get = (r, s) => (r <= s ? nn[r][s] : nn[s][r]);
  let n = normalize([0, 1, 2].map(j => get(i, j) / ni));
  if (dot(n, v) < 0) n = scale(n, -1);
  // a half turn is the same either way round: show it with the first clear component positive
  if (a > Math.PI - 1e-3) { const f = n.find(c => Math.abs(c) > 1e-3); if (f < 0) n = scale(n, -1); }
  return scale(n, a);
}
export function fromRotvec(v) { const a = len(v); return a < 1e-12 ? identity() : rotate(v, a); }

/** Z-Y-X Euler angles [A, B, C] (rad) with R = Rz(A) * Ry(B) * Rx(C) — what a KUKA controller shows as A B C. */
export function toZYX(M) {
  const B = Math.atan2(-M[8], Math.hypot(M[0], M[4]));
  if (Math.abs(Math.cos(B)) > 1e-3) return [Math.atan2(M[4], M[0]), B, Math.atan2(M[9], M[10])];
  return [Math.atan2(-M[1], M[5]), B, 0];     // gimbal lock: put everything in A
}
export const fromZYX = (A, B, C) => chain(rotZ(A), rotY(B), rotX(C));

// ── quaternions [w, x, y, z] (for blending orientations) ────────────────────────
export function toQuat(M) {
  const t = M[0] + M[5] + M[10];
  let w, x, y, z;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; w = s / 4; x = (M[9] - M[6]) / s; y = (M[2] - M[8]) / s; z = (M[4] - M[1]) / s; }
  else if (M[0] > M[5] && M[0] > M[10]) { const s = Math.sqrt(1 + M[0] - M[5] - M[10]) * 2; w = (M[9] - M[6]) / s; x = s / 4; y = (M[1] + M[4]) / s; z = (M[2] + M[8]) / s; }
  else if (M[5] > M[10]) { const s = Math.sqrt(1 + M[5] - M[0] - M[10]) * 2; w = (M[2] - M[8]) / s; x = (M[1] + M[4]) / s; y = s / 4; z = (M[6] + M[9]) / s; }
  else { const s = Math.sqrt(1 + M[10] - M[0] - M[5]) * 2; w = (M[4] - M[1]) / s; x = (M[2] + M[8]) / s; y = (M[6] + M[9]) / s; z = s / 4; }
  return [w, x, y, z];
}
export function fromQuat([w, x, y, z]) {
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 0,
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), 0,
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ];
}
export function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (d < 0) { b = b.map(v => -v); d = -d; }
  if (d > 0.9995) { const r = a.map((v, i) => v + (b[i] - v) * t); const l = Math.hypot(...r); return r.map(v => v / l); }
  const th = Math.acos(d), s = Math.sin(th);
  return a.map((v, i) => (v * Math.sin((1 - t) * th) + b[i] * Math.sin(t * th)) / s);
}
/** Blend two poses: position in a straight line, orientation the short way round. */
export function blendPose(A, B, t) {
  return withPosition(fromQuat(slerp(toQuat(A), toQuat(B), t)), lerp(position(A), position(B), t));
}
