// Draws any robot definition: one group per link, moved by the chain's forward kinematics.
// Shows simple shapes straight away, then swaps in the robot's real model (GLB from Animaquina's rigs)
// once it has loaded. Also carries an optional pen tool that follows the TCP frame and the tool direction.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import * as m from './mat.js';
import { mesh, place, material, matrix4 } from './draw.js';
import { ResourceCache } from './resource-cache.js';

export function createModelAssets() {
  const draco = new DRACOLoader().setDecoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/gltf/');
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const cache = new ResourceCache(url => loader.loadAsync(url).then(g => g.scene), scene => {
    const geometries = new Set(), materials = new Set(), textures = new Set();
    scene.traverse(o => {
      if (o.geometry) geometries.add(o.geometry);
      for (const mat of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (!mat) continue;
        materials.add(mat);
        for (const value of Object.values(mat)) if (value?.isTexture) textures.add(value);
      }
    });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
  }, 1);
  return { cache, dispose() { cache.close(); draco.dispose(); } };
}

export class RobotView {
  constructor(robot, assets) {
    this.robot = robot;
    this.assets = assets || createModelAssets();
    this.ownsAssets = !assets;
    this.group = new THREE.Group();
    this.links = [];
    this.housings = [];      // per joint: meshes that light up when the joint is picked
    this.centres = [];       // per joint: where its label and axis arrow go, in its link frame
    this.extents = [];       // per joint: half the length to cover along its axis
    this.simple = [];        // the simple shapes, hidden once the model is in
    robot.shapes.forEach((shapes, li) => {
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      for (const s of shapes) {
        const o = place(mesh('cyl', s.tone), s.a, s.b, s.r);
        g.add(o);
        this.simple.push(o);
        if (s.housing && li > 0) {
          (this.housings[li - 1] ||= []).push(o);
          this.centres[li - 1] ||= m.lerp(s.a, s.b, 0.5);
          this.extents[li - 1] ||= m.len(m.sub(s.b, s.a)) / 2;
        }
      }
      this.links.push(g);
      this.group.add(g);
    });
    for (let i = 0; i < robot.dof; i++) { this.centres[i] ||= [0, 0, 0]; this.extents[i] ||= 0.05; }
    this.pen = new Pen();
    this.group.add(this.pen.group);
    this.tool = null;
    this.highlighted = [];
    this.set(robot.home);
    this.ready = robot.model ? this.loadModel(robot.model) : Promise.resolve();
  }

  async loadModel(url) {
    if (!url || this.disposed || this.modelLoaded || this.loading) return;
    this.loading = true;
    const asset = this.assets.cache.acquire(url);
    this.asset = asset;
    let scene;
    try { scene = await asset.promise; } catch (e) {
      asset.release(); this.loading = false;
      if (!this.disposed) { this.modelError = true; this.onModel?.(); console.warn(`${this.robot.id}: model failed, keeping simple shapes`, e); }
      return;
    }
    this.loading = false;
    if (this.disposed) return;
    this.modelError = false; this.modelLoaded = true;
    const housings = [];
    for (let k = 0; k < this.links.length; k++) {
      const node = scene.getObjectByName(`link_${k}`);
      if (!node) continue;
      this.simple.filter(o => o.parent === this.links[k]).forEach(o => o.removeFromParent());
      const part = node.clone(true);
      part.position.set(0, 0, 0); part.quaternion.identity(); part.scale.set(1, 1, 1);
      part.traverse(o => {
        if (!o.isMesh) return;
        const c = (Array.isArray(o.material) ? o.material[0] : o.material)?.color;
        o.userData.tone = c ? `#${c.getHexString()}` : 'mid';
        o.material = material(o.userData.tone);
      });
      // Measure the part in its own (link) frame BEFORE it hangs on the posed link: once attached, Box3.setFromObject
      // reads world space, which is wherever the robot happened to be posed (labels / arrows landed 0.2-0.8 m off).
      part.updateMatrixWorld(true);
      const ownBox = new THREE.Box3().setFromObject(part);
      this.links[k].add(part);
      if (k > 0) {
        const list = [];
        part.traverse(o => o.isMesh && list.push(o));
        housings[k - 1] = list;
        // label / arrow: middle of the part's extent along the joint axis (link frame: the axis passes through 0)
        const ax = this.robot.chain.joints[k - 1].axis;
        const box = ownBox;
        let lo = Infinity, hi = -Infinity;
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
          const t = x * ax[0] + y * ax[1] + z * ax[2];
          lo = Math.min(lo, t); hi = Math.max(hi, t);
        }
        if (isFinite(lo)) { this.centres[k - 1] = m.scale(ax, (lo + hi) / 2); this.extents[k - 1] = (hi - lo) / 2; }
      }
    }
    housings.forEach((list, i) => { if (list) this.housings[i] = list; });
    this.highlight(this.highlighted, this.highlightTone);
    this.onModel?.();
  }

  /** Pose the robot. q in rad; tool = 4x4 flange -> TCP or null. Returns the fk result. */
  set(q, tool = this.tool) {
    this.tool = tool;
    const f = this.robot.chain.fk(q, tool);
    this.f = f;
    matrix4(this.robot.chain.base, this.links[0].matrix);
    f.links.forEach((T, i) => matrix4(T, this.links[i + 1].matrix));
    this.links.forEach(g => g.matrixWorldNeedsUpdate = true);
    this.pen.update(f, this.robot);
    return f;
  }

  /** World point of joint i's label / axis arrow. */
  centre(i) { return m.point(this.f.links[i], this.centres[i]); }
  axis(i) { return this.f.axes[i]; }

  /** Colour some joints' moving parts (indices), everything else back to normal. */
  highlight(indices = [], tone = 'accent') {
    this.highlighted = indices;
    this.highlightTone = tone;
    this.housings.forEach((list, i) => list?.forEach(o => { o.material = material(indices.includes(i) ? tone : o.userData.tone); }));
  }

  showPen(on) { this.pen.group.visible = on; this.pen.update(this.f, this.robot); }

  reset() {
    this.highlight([]);
    this.showPen(false);
    this.set(this.robot.home, null);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.onModel = null;
    this.group.removeFromParent(); this.group.clear();
    this.asset?.release();
    if (this.ownsAssets) this.assets.dispose();
  }
}

/** A pen held in a small mount: the tip sits on the TCP and points along the tool direction. */
class Pen {
  constructor() {
    this.group = new THREE.Group();
    this.group.visible = false;
    this.parts = {
      tip: mesh('cone', 'dark'), body: mesh('cyl', 'dark'), cap: mesh('cyl', 'accent'),
      plate: mesh('cyl', 'mid'), bar: mesh('cyl', 'mid'),
    };
    Object.values(this.parts).forEach(p => this.group.add(p));
  }
  update(f, robot) {
    if (!this.group.visible || !f) return;
    const s = robot.scale || 1;
    const tip = m.position(f.tcp), d = m.axis(f.tcp, robot.toolAxisIndex);
    const fp = m.position(f.flange), n = m.axis(f.flange, 2);
    const at = k => m.sub(tip, m.scale(d, k * s));
    const show = m.len(m.sub(tip, fp)) > 0.06 * s;
    Object.values(this.parts).forEach(p => p.visible = show);
    if (!show) return;
    const P = this.parts;
    place(P.tip, at(0.03), tip, 0.015 * s);
    place(P.body, at(0.14), at(0.03), 0.015 * s);
    place(P.cap, at(0.16), at(0.14), 0.017 * s);
    place(P.plate, fp, m.add(fp, m.scale(n, 0.015 * s)), 0.04 * s);
    place(P.bar, m.add(fp, m.scale(n, 0.015 * s)), at(0.16), 0.008 * s);
  }
}
