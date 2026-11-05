// The 3D view: white background, desk-mat floor, an isometric camera you can orbit,
// and labels drawn as HTML on top.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);   // robots are Z-up

// Light desk mat: white, thin grey lines every 10 cm, darker every 50 cm.
const FLOOR_FRAG = `
varying vec2 vW;
float grid(vec2 p, float s) {
  vec2 c = p / s;
  vec2 g = abs(fract(c - 0.5) - 0.5) / fwidth(c);
  return 1.0 - min(min(g.x, g.y), 1.0);
}
void main() {
  float minor = grid(vW, 0.1) * clamp(1.5 - fwidth(vW.x) * 40.0, 0.0, 1.0);
  float major = grid(vW, 0.5);
  vec3 c = vec3(1.0);
  c = mix(c, vec3(0.945, 0.95, 0.955), minor);
  c = mix(c, vec3(0.87, 0.88, 0.89), major);
  gl_FragColor = vec4(c, 1.0);
}`;
const FLOOR_VERT = `
varying vec2 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xy;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export class Stage {
  constructor(root) {
    this.root = root;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#ffffff');

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.className = 'gl';
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('aria-label', 'Robotics viewport. Middle mouse orbit, Shift middle mouse pan, wheel zoom. Press question mark for shortcuts.');
    root.appendChild(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'labels';
    root.appendChild(this.labels.domElement);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 200);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    // Middle mouse as in Blender; left drag too, because trackpads have no middle button (Blender's
    // "emulate 3 button mouse" idea). Right button stays free for cancelling a G / R transform.
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: null };
    this.renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
    this.invalidate = () => {};
    this.onChange = () => this.invalidate();
    this.controls.addEventListener('change', this.onChange);
    this.onPointer = event => {
      this.renderer.domElement.focus({ preventScroll: true });
      this.controls.mouseButtons.MIDDLE = event.ctrlKey || event.metaKey ? THREE.MOUSE.DOLLY : THREE.MOUSE.ROTATE;
    };
    this.renderer.domElement.addEventListener('pointerdown', this.onPointer, true);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShaderMaterial({ vertexShader: FLOOR_VERT, fragmentShader: FLOOR_FRAG }));
    floor.position.z = -0.001;
    this.scene.add(floor);
    this.floor = floor;

    this.insets = () => ({ left: 0, right: 0 });
    this.shot = { target: [0, 0, 0.4], height: 2.4, dir: [-0.6, 0.6, 0.5] };
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
  }

  /**
   * Point the camera. target: what to look at (m); height: how many metres fit top to bottom;
   * dir: from the target towards the camera. The target lands in the middle of the free space
   * between the text column and the panel.
   */
  frame(shot) {
    // Flush the previous orbit's damping before setting an exact named view.
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false; this.controls.update(); this.controls.enableDamping = damping;
    this.shot = { ...this.shot, ...shot };
    const { target, dir } = this.shot;
    const distance = this.camera.isPerspectiveCamera ? this.shot.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) : 50;
    const d = new THREE.Vector3(...dir).normalize().multiplyScalar(distance);
    this.camera.position.set(target[0] + d.x, target[1] + d.y, target[2] + d.z);
    this.camera.zoom = 1;
    this.controls.target.set(...target);
    this.camera.lookAt(...target);
    this.resize();
  }

  align(axis, opposite = false) {
    const directions = { 1: [0, -1, 0], 3: [1, 0, 0], 7: [0, -1e-6, 1] };
    if (!directions[axis]) return;
    if (this.camera.isPerspectiveCamera) this.toggleProjection();
    this.frame({ target: this.controls.target.toArray(), height: this.shot.height / this.camera.zoom,
      dir: directions[axis].map(v => v * (opposite ? -1 : 1)) });
  }

  toggleProjection() {
    const old = this.camera, target = this.controls.target.clone();
    const dir = old.position.clone().sub(target).normalize();
    const height = old.isOrthographicCamera ? this.shot.height / old.zoom
      : 2 * old.position.distanceTo(target) * Math.tan(THREE.MathUtils.degToRad(old.fov / 2)) / old.zoom;
    this.camera = old.isOrthographicCamera
      ? new THREE.PerspectiveCamera(45, 1, 0.01, 200)
      : new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 200);
    this.controls.object = this.camera;
    this.frame({ target: target.toArray(), dir: dir.toArray(), height });
  }

  /** Draw inside `host` (an area) instead of the whole page. */
  mount(host) {
    host.append(this.renderer.domElement, this.labels.domElement);
    this.root = host;
    this.resize();
  }

  resize() {
    const W = Math.max(1, this.root.clientWidth), H = Math.max(1, this.root.clientHeight);
    this.renderer.setSize(W, H);
    this.labels.setSize(W, H);
    const { left = 0, right = 0, top = 0, bottom = 0 } = this.insets();
    const sx = (left + (W - right)) / 2 / W;            // where the target should sit across the screen
    const sy = (top + (H - bottom)) / 2 / H;            // and down it (a docked editor below takes room)
    const halfH = this.shot.height / 2, halfW = halfH * W / H;
    const cx = (0.5 - sx) * 2 * halfW, cy = (sy - 0.5) * 2 * halfH;
    if (this.camera.isOrthographicCamera) Object.assign(this.camera, { left: -halfW + cx, right: halfW + cx, top: halfH + cy, bottom: -halfH + cy });
    else {
      this.camera.aspect = W / H;
      this.camera.setViewOffset(W, H, (0.5 - sx) * W, (0.5 - sy) * H, W, H);
    }
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  render() {
    const changed = this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
    return changed;
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointer, true);
    this.controls.removeEventListener('change', this.onChange);
    this.controls.dispose();
    this.floor.geometry.dispose(); this.floor.material.dispose();
    this.scene.clear(); this.renderer.dispose();
    this.renderer.domElement.remove(); this.labels.domElement.remove();
  }
}

/** The house view: true isometric from the tool side, so the arm reaches towards you. */
export function isoView(robot, { target, height, along = 0.3 } = {}) {
  const f = robot.forward, R = robot.reach;
  const side = [f[1], -f[0]];
  const h = Math.hypot(f[0] + side[0], f[1] + side[1]);
  const e = Math.atan(1 / Math.SQRT2);               // 35.26 deg
  return {
    target: target || [f[0] * R * along, f[1] * R * along, R * 0.32],
    height: height || R * 1.45,
    dir: [(f[0] + side[0]) / h * Math.cos(e), (f[1] + side[1]) / h * Math.cos(e), Math.sin(e)],
  };
}
