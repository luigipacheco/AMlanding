import * as draw from './draw.js';
import * as m from './mat.js';

/** An ink arrow along each joint axis, sized to the robot. Returns an update(view, which[]) function. */
export function jointAxes(ctx, { front = false } = {}) {
  const n = ctx.robot.dof, L = ctx.robot.reach * 0.1;
  const arrows = Array.from({ length: n }, () => draw.arrow('ink'));
  arrows.forEach(a => ctx.group.add(a));
  if (front) draw.inFront(...arrows);             // seen through the robot's own shells (heavy arms hide them)
  return (which = [...Array(n).keys()], thick = []) => {
    arrows.forEach((a, i) => {
      a.visible = which.includes(i);
      if (!a.visible) return;
      const c = ctx.view.centre(i), d = ctx.view.axis(i);
      const r = thick.includes(i) ? 0.007 : 0.0045;
      const h = Math.min(ctx.view.extents[i], ctx.robot.reach * 0.1);
      draw.placeArrow(a, m.sub(c, m.scale(d, h + L * 0.4)), d, 2 * h + L * 1.4, r);
    });
  };
}

/** One label per joint, at its housing. Returns update(texts[], classes[]). */
export function jointLabels(ctx) {
  const tags = ctx.robot.joints.map(() => draw.label(''));
  tags.forEach(t => ctx.group.add(t));
  return (texts, classes = []) => tags.forEach((t, i) => {
    t.position.set(...ctx.view.centre(i));
    draw.setLabel(t, texts[i] ?? '', classes[i] ?? 'grey');
    t.visible = !!texts[i];
  });
}
