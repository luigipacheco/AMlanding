// Turns a robot definition (plain data, see robots/*.js) into something slides can use:
// a kinematic chain plus the maker's own way of writing poses. Slides only talk to this,
// never to a specific brand, so any robot that fills in the definition works on every slide.

import * as m from './mat.js';
import { Chain } from './kinematics.js';

const { DEG } = m;

// Readouts near a tool-down pose: a rig is never exactly there (the bundled ones are within 0.06 deg), and the
// exact words then jump about (A 90.05, B 89.999, C 89.94 for what is "0 90 0"). So the controller words are tidied
// within this angle; mat.js says what that costs (up to 0.11 deg of rotation in a pose read back from its words).
const READOUT = 1e-3;

/** How a controller writes orientation. Values are in the controller's own units. */
export const ORIENTATIONS = {
  // Universal Robots: rotation vector, rad
  rotvec: {
    labels: ['RX', 'RY', 'RZ'], unit: 'rad', decimals: 3, range: [-Math.PI, Math.PI], step: 0.001,
    toMatrix: v => m.fromRotvec(v),
    fromMatrix: M => m.toRotvec(M, READOUT),
  },
  // KUKA (and others): A B C = Z-Y-X Euler angles, degrees
  abc: {
    labels: ['A', 'B', 'C'], unit: '°', decimals: 1, range: [-180, 180], step: 0.1,
    toMatrix: v => m.fromZYX(v[0] * DEG, v[1] * DEG, v[2] * DEG),
    fromMatrix: M => m.toZYX(M, READOUT).map(a => a / DEG),
  },
  // UFACTORY xArm: roll pitch yaw, degrees (R = Rz(yaw) Ry(pitch) Rx(roll), the same matrix as A B C, written the other way round)
  rpy: {
    labels: ['Roll', 'Pitch', 'Yaw'], unit: '°', decimals: 1, range: [-180, 180], step: 0.1,
    toMatrix: v => m.fromZYX(v[2] * DEG, v[1] * DEG, v[0] * DEG),
    fromMatrix: M => m.toZYX(M, READOUT).map(a => a / DEG).reverse(),
  },
};

export function makeRobot(def) {
  const orient = ORIENTATIONS[def.orientation];
  if (!orient) throw new Error(`${def.id}: unknown orientation "${def.orientation}"`);
  const limits = def.joints.map(j => j.limits.map(v => v * DEG));
  const robot = {
    ...def,
    orient,
    dof: def.joints.length,
    chain: new Chain(def.kinematics, limits),
    home: def.home.map(v => v * DEG),
    toolAxisIndex: { x: 0, y: 1, z: 2 }[def.toolAxis || 'z'],

    /** 4x4 (m) from a pose written the controller's way: xyz in mm, rotation in its own convention. */
    poseMatrix(xyzMm, rot) {
      return m.withPosition(orient.toMatrix(rot), m.scale(xyzMm, 0.001));
    },
    /** The controller's way of writing a 4x4: { xyz: mm, rot: [3] in its own units }. */
    poseValues(M) {
      return { xyz: m.scale(m.position(M), 1000), rot: orient.fromMatrix(M) };
    },
  };
  return robot;
}
