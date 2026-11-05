import * as m from './mat.js';

export function numericTransform(text, mode) {
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(mm|cm|m|deg|rad)?$/.exec(text.trim());
  if (!match) return null;
  const unit = match[2] || (mode === 'grab' ? 'mm' : 'deg');
  const scales = mode === 'grab' ? { mm: .001, cm: .01, m: 1 } : { deg: m.DEG, rad: 1 };
  const result = Number(match[1]) * scales[unit];
  return Number.isFinite(result) ? result : null;
}

export function transformedPose(origin, { mode, axis = null, local = false, exclude = false, amount = null,
  delta = [0, 0, 0], viewAxis = [0, 0, 1] }) {
  const basis = i => local ? m.axis(origin, i) : [0, 1, 2].map(k => +(k === i));
  const direction = axis === null ? (mode === 'grab' ? basis(0) : viewAxis) : basis(axis);
  if (mode === 'grab') {
    let d = amount === null ? delta : m.scale(direction, amount);
    if (axis !== null && amount === null) {
      const component = m.scale(direction, m.dot(d, direction));
      d = exclude ? m.sub(d, component) : component;
    } else if (axis !== null && exclude && amount !== null) {
      d = [0, 1, 2].filter(i => i !== axis).reduce((v, i) => m.add(v, m.scale(basis(i), amount)), [0, 0, 0]);
    }
    return m.withPosition(origin, m.add(m.position(origin), d));
  }
  return m.withPosition(m.mul(m.rotate(direction, amount ?? 0), m.rotationOf(origin)), m.position(origin));
}

/** Modal target interaction. All edits go through the same document transaction as panel controls. */
export class TargetTransform {
  constructor(app) {
    this.app = app; this.canvas = app.stage.renderer.domElement;
    this.lastPointer = null;
    this.pointer = event => {
      const p = [event.clientX, event.clientY]; this.lastPointer = p;
      if (!this.active) return;
      this.startPointer ||= p;
      this.dx = p[0] - this.startPointer[0]; this.dy = p[1] - this.startPointer[1];
      this.queuePreview();
    };
    this.down = event => {
      if (!this.active || ![0, 2].includes(event.button)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      event.button === 2 ? this.cancel() : this.confirm();
    };
    this.blur = () => this.cancel();
    this.canvas.addEventListener('pointermove', this.pointer);
    this.canvas.addEventListener('pointerdown', this.down, true);
    this.canvas.addEventListener('blur', this.blur);
    window.addEventListener('blur', this.blur);
  }
  start(mode) {
    if (this.active) this.cancel();
    const target = this.app.slide.target?.(this.app.ctx);
    if (!target) { this.app.notice('Choose a target in the Move panel; stop path playback before transforming.'); return; }
    this.app.store.begin(mode === 'grab' ? 'Move TCP target' : 'Rotate TCP target');
    this.target = target; this.origin = target.get().slice(); target.begin?.();
    this.mode = mode; this.axis = null; this.local = false; this.exclude = false;
    this.input = ''; this.dx = this.dy = 0; this.startPointer = this.lastPointer;
    this.active = true; this.app.stage.controls.enabled = false;
    this.preview();
  }
  key(event) {
    if (!this.active || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return false;
    if (event.repeat && /^[xyz]$/i.test(event.key)) return true;
    if (event.key === 'Escape') this.cancel();
    else if (event.key === 'Enter') this.confirm();
    else if (/^[xyz]$/i.test(event.key)) {
      const axis = 'xyz'.indexOf(event.key.toLowerCase());
      if (axis !== this.axis || event.shiftKey !== this.exclude) { this.axis = axis; this.local = false; }
      else if (!this.local) this.local = true;
      else { this.axis = null; this.local = false; }
      this.exclude = event.shiftKey && this.mode === 'grab'; this.queuePreview();
    } else if (event.key === 'Backspace') { this.input = this.input.slice(0, -1); this.queuePreview(); }
    else if (/^[0-9.+\-mcderag]$/i.test(event.key)) { this.input += event.key.toLowerCase(); this.queuePreview(); }
    else return false;
    return true;
  }
  queuePreview() {
    this.dirty = true; this.app.loop.invalidate();
  }
  preview() {
    this.dirty = false;
    const numeric = this.input ? numericTransform(this.input, this.mode) : null;
    this.valid = !this.input || numeric !== null;
    if (this.valid) {
      const camera = this.app.stage.camera, matrix = camera.matrixWorld.elements;
      const right = [matrix[0], matrix[1], matrix[2]], up = [matrix[4], matrix[5], matrix[6]];
      const viewAxis = [matrix[8], matrix[9], matrix[10]];
      const height = camera.isOrthographicCamera ? (camera.top - camera.bottom) / camera.zoom
        : 2 * camera.position.distanceTo(this.app.stage.controls.target) * Math.tan(camera.fov * m.DEG / 2) / camera.zoom;
      const scale = height / Math.max(1, this.canvas.clientHeight);
      const delta = m.add(m.scale(right, this.dx * scale), m.scale(up, -this.dy * scale));
      this.target.set(transformedPose(this.origin, { mode: this.mode, axis: this.axis, local: this.local,
        exclude: this.exclude, amount: this.mode === 'rotate' ? numeric ?? this.dx * .01 : numeric, delta, viewAxis }));
      this.app.updateSlide('target');
    }
    const axis = this.axis === null ? 'FREE' : `${this.exclude ? 'EXCLUDE ' : ''}${'XYZ'[this.axis]} ${this.local ? 'LOCAL' : 'GLOBAL'}`;
    this.app.notice(`${this.mode === 'grab' ? 'MOVE' : 'ROTATE'} TARGET · ${axis} · ${this.input || (this.mode === 'grab' ? 'mm' : 'degrees')} · ${this.valid ? 'Enter confirm / Esc cancel' : 'Enter a valid value and unit'}`);
  }
  finish() { this.active = this.dirty = false; this.app.stage.controls.enabled = true; this.app.loop.invalidate(); }
  confirm() {
    if (!this.active) return;
    this.preview(); if (!this.valid) return;
    this.finish(); this.app.store.commit(); this.app.syncHistory(); this.app.notice('Target updated · offline preview');
  }
  cancel() {
    if (!this.active) return;
    this.finish(); this.app.store.cancel(); this.app.restore(); this.app.notice('Transform cancelled');
  }
  dispose() {
    this.finish();
    this.canvas.removeEventListener('pointermove', this.pointer);
    this.canvas.removeEventListener('pointerdown', this.down, true);
    this.canvas.removeEventListener('blur', this.blur);
    window.removeEventListener('blur', this.blur);
  }
}
