// Convex hulls of point sets (three.js's ConvexHull), for collision shapes: only the hull's corners are kept, a few
// hundred points instead of a mesh's thousands.

import { Vector3 } from 'three';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';

const GRID = 1e-4;              // points closer than 0.1 mm count as one

/** The corners of the convex hull of flat points [x, y, z, ...] (m), as flat points. Flat or tiny sets: the points. */
export function hullPoints(flat) {
  const seen = new Map();
  for (let i = 0; i + 2 < flat.length; i += 3) {
    const x = flat[i], y = flat[i + 1], z = flat[i + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    const key = `${Math.round(x / GRID)},${Math.round(y / GRID)},${Math.round(z / GRID)}`;
    if (!seen.has(key)) seen.set(key, [x, y, z]);
  }
  const unique = [...seen.values()];
  if (unique.length < 5) return unique.flat();
  let corners = null;
  try {
    const hull = new ConvexHull().setFromPoints(unique.map(p => new Vector3(...p)));
    const out = new Set();
    for (const face of hull.faces) {
      let e = face.edge;
      do { out.add(e.head().point); e = e.next; } while (e !== face.edge);
    }
    if (out.size >= 4) corners = [...out].flatMap(p => [p.x, p.y, p.z]);
  } catch { /* flat or degenerate: the points themselves */ }
  return corners || unique.flat();
}
