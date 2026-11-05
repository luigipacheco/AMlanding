// three.js building blocks shared by the robot view and the slides.
// Shading copies the Blender decks' `Viz` material: flat colour, lit from the camera
// (dot of the normal and a headlight mapped -1..1 to 0.55..1), so nothing ever goes grey.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// Animaquina (light): ink + lime. XYZ stay red / green / blue: that is the robotics convention, not decoration.
export const TONES = {
  light: '#eeeeec',
  mid: '#b9b9b5',
  dark: '#1a1a1a',
  ink: '#111111',
  accent: '#d9ff00',
  x: '#e5484d',
  y: '#30a46c',
  z: '#2f7fd1',
};

const hexToVec = h => new THREE.Vector3(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);

const VERT = `
varying vec3 vN;
void main() {
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FRAG = `
uniform vec3 color;
varying vec3 vN;
void main() {
  float d = dot(normalize(vN), normalize(vec3(0.0, 0.6, 1.0)));
  gl_FragColor = vec4(color * mix(0.55, 1.0, d * 0.5 + 0.5), 1.0);
}`;

const materials = {};
export function material(tone) {
  if (!materials[tone]) {
    materials[tone] = new THREE.ShaderMaterial({ uniforms: { color: { value: hexToVec(TONES[tone] || tone) } }, vertexShader: VERT, fragmentShader: FRAG });
  }
  return materials[tone];
}

// unit shapes along +Y, centred on the origin; placed with `place()`
const GEO = {
  cyl: new THREE.CylinderGeometry(1, 1, 1, 32),
  cone: new THREE.ConeGeometry(1, 1, 24),
  sphere: new THREE.SphereGeometry(1, 24, 16),
};
const sharedGeometry = new Set(Object.values(GEO));
let owners = 0;
export function retainDrawingResources() { owners++; }
export function releaseDrawingResources() {
  if (--owners > 0) return;
  owners = 0;
  for (const geometry of sharedGeometry) geometry.dispose();
  for (const [key, value] of Object.entries(materials)) { value.dispose(); delete materials[key]; }
}

export const v3 = a => new THREE.Vector3(a[0], a[1], a[2]);

/** A cylinder (or cone, pointing a -> b) mesh, moved later with place(). */
export function mesh(kind = 'cyl', tone = 'light') {
  const m = new THREE.Mesh(GEO[kind], material(tone));
  m.userData.tone = tone;
  return m;
}

const _y = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3();
/** Stretch a unit shape between points a and b with radius r. */
export function place(obj, a, b, r) {
  _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const l = _d.length();
  obj.visible = l > 1e-6;
  if (!obj.visible) return obj;
  obj.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  obj.quaternion.setFromUnitVectors(_y, _d.divideScalar(l));
  obj.scale.set(r, l, r);
  return obj;
}

export function setTone(obj, tone) {
  obj.traverse(o => { if (o.isMesh) o.material = material(tone); });
}

/** Arrow: shaft + head. place with placeArrow(). */
export function arrow(tone = 'ink') {
  const g = new THREE.Group();
  g.add(mesh('cyl', tone), mesh('cone', tone));
  return g;
}
export function placeArrow(g, from, dir, length, r = 0.006) {
  const head = Math.min(length * 0.35, r * 6);
  const end = [from[0] + dir[0] * length, from[1] + dir[1] * length, from[2] + dir[2] * length];
  const neck = [end[0] - dir[0] * head, end[1] - dir[1] * head, end[2] - dir[2] * head];
  place(g.children[0], from, neck, r);
  place(g.children[1], neck, end, r * 2.4);
  return g;
}

/** Frame triad (X red, Y green, Z blue). place with placeTriad(g, M4x4 row-major). */
export function triad() {
  const g = new THREE.Group();
  g.add(arrow('x'), arrow('y'), arrow('z'));
  return g;
}
export function placeTriad(g, M, size = 0.12, r = 0.005) {
  const p = [M[3], M[7], M[11]];
  for (let i = 0; i < 3; i++) placeArrow(g.children[i], p, [M[i], M[4 + i], M[8 + i]], size, r);
  return g;
}

/** Text tag pinned to a 3D point. cls: '' | 'hl' | 'grey' | 'alert'. */
export function label(text, cls = '') {
  const el = document.createElement('div');
  el.className = 'tag';
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  el.appendChild(s);
  const o = new CSS2DObject(el);
  o.userData.span = s;
  return o;
}
export function setLabel(o, text, cls) {
  if (text !== undefined) o.userData.span.textContent = text;
  if (cls !== undefined) o.userData.span.className = cls;
  return o;
}

/** Release slide-owned resources, retaining common primitive geometry/materials. */
/**
 * Draw helpers in front of the robot (Blender's "In Front"): a heavy model such as a KUKA would otherwise hide what
 * sits inside it (a wrist point, a joint axis). Gives the objects their own copy of the material (disposed with them).
 */
export function inFront(...objects) {
  for (const obj of objects) obj.traverse(o => {
    if (!o.material) return;
    o.material = o.material.clone();
    o.material.depthTest = false; o.material.depthWrite = false;
    o.renderOrder = 10;
  });
}

export function dispose(group) {
  const geometry = new Set(), ownedMaterials = new Set(), sharedMaterials = new Set(Object.values(materials));
  group.traverse(o => {
    if (o.isCSS2DObject) o.element.remove();
    if (o.geometry && !sharedGeometry.has(o.geometry)) geometry.add(o.geometry);
    for (const mat of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (mat && !sharedMaterials.has(mat)) ownedMaterials.add(mat);
    }
  });
  group.removeFromParent();
  for (const geo of geometry) geo.dispose();
  for (const mat of ownedMaterials) mat.dispose();
  group.clear();
}

/** row-major 4x4 array -> THREE.Matrix4 */
export function matrix4(M, target = new THREE.Matrix4()) {
  return target.set(...M);
}

// ── paths, dot clouds, floor zones (slides 05-10) ───────────────────────────────

/** A polyline (1px). dashed: for "this is not where the tool goes straight" paths. setPoints(list of [x,y,z]). */
export function polyline(tone = 'ink', dashed = false) {
  const geo = new THREE.BufferGeometry();
  const mat = dashed
    ? new THREE.LineDashedMaterial({ color: TONES[tone] || tone, dashSize: 0.02, gapSize: 0.015 })
    : new THREE.LineBasicMaterial({ color: TONES[tone] || tone });
  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  line.setPoints = pts => {
    const needed = Math.max(2, pts.length);
    if (!geo.attributes.position || geo.attributes.position.count < needed) {
      // Free the old GPU buffer before replacing the attribute; grow geometrically for animated trails.
      const capacity = Math.max(needed, (geo.attributes.position?.count || 0) * 2);
      geo.dispose();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    }
    const attribute = geo.attributes.position;
    pts.forEach((p, i) => attribute.setXYZ(i, ...p));
    attribute.needsUpdate = true;
    geo.setDrawRange(0, pts.length);
    geo.computeBoundingSphere();
    if (dashed) line.computeLineDistances();
  };
  return line;
}

const DOT_VERT = `
attribute float size;
attribute vec3 fill;
attribute float edge;
varying vec3 vFill;
varying float vEdge;
void main() {
  vFill = fill; vEdge = edge;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size;
}`;
const DOT_FRAG = `
varying vec3 vFill;
varying float vEdge;
void main() {
  vec2 p = abs(gl_PointCoord - 0.5) * 2.0;
  float d = max(p.x, p.y);
  if (vEdge > 0.5 && d > 0.62) { gl_FragColor = vec4(0.067, 0.067, 0.067, 1.0); return; }
  gl_FragColor = vec4(vFill, 1.0);
}`;
/** n square dots (screen-sized). set(i, [x,y,z], hexFill, sizePx, edged). Call commit() after a batch. */
export function dots(n) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), fill = new Float32Array(n * 3), size = new Float32Array(n), edge = new Float32Array(n);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('fill', new THREE.BufferAttribute(fill, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('edge', new THREE.BufferAttribute(edge, 1));
  const pts = new THREE.Points(geo, new THREE.ShaderMaterial({ vertexShader: DOT_VERT, fragmentShader: DOT_FRAG }));
  pts.frustumCulled = false;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  pts.set = (i, p, hex, px, edged) => {
    pos.set(p, i * 3);
    const c = hexToVec(TONES[hex] || hex);
    fill.set([c.x, c.y, c.z], i * 3);
    size[i] = px * dpr; edge[i] = edged ? 1 : 0;
  };
  pts.commit = () => { for (const k of ['position', 'fill', 'size', 'edge']) geo.attributes[k].needsUpdate = true; };
  return pts;
}

/** A flat filled disc or ring on the floor (z just above 0). opacity < 1 for zones. */
export function disc(tone, { inner = 0, opacity = 1 } = {}) {
  const geo = inner > 0 ? new THREE.RingGeometry(inner, 1, 96) : new THREE.CircleGeometry(1, 96);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: TONES[tone] || tone, transparent: opacity < 1, opacity, depthWrite: false }));
  mesh.renderOrder = -1;
  return mesh;
}
/** An ink circle outline of radius r (m) around (x, y), at height z. */
export function circle(tone = 'ink') {
  const line = polyline(tone);
  line.place = (c, r, z = 0.002) => line.setPoints(Array.from({ length: 129 }, (_, k) => {
    const a = k / 128 * Math.PI * 2; return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a), z];
  }));
  return line;
}
