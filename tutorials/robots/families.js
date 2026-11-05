// What a robot's maker decides (names, conventions, the controller's words), per brand.
// The geometry and kinematics come from Animaquina's rigs (robots/library.json, made by tools/export_robots.py);
// this file only adds how each controller talks about them.

export const FAMILIES = {
  UR: {
    maker: 'Universal Robots',
    joints: [
      ['J1', 'base', 'turns the whole arm about the vertical axis'],
      ['J2', 'shoulder', 'lifts and lowers the upper arm'],
      ['J3', 'elbow', 'bends the forearm'],
      ['J4', 'wrist 1', 'tilts the wrist'],
      ['J5', 'wrist 2', 'swings the tool sideways'],
      ['J6', 'wrist 3', 'spins the tool'],
    ],
    home: [0, -70, 100, -120, -90, 0],          // tool down, arm in front (the Blender deck's pose)
    orientation: 'rotvec',                       // RX RY RZ, rad
    toolAxis: 'z',
    tool: { xyz: [0, 0, 200], rot: [0, 0, 0] },
    where: { tcp: 'PolyScope: Installation > General > TCP', safety: 'PolyScope: Installation > Safety' },
    cobot: true,                                 // stops on contact (force limits)
    moves: { joint: 'movej', linear: 'movel', lang: 'URScript' },
    simulator: 'URSim',
  },
  KUKA: {
    maker: 'KUKA',
    joints: [
      ['A1', 'base', 'turns the whole arm about the vertical axis'],
      ['A2', 'shoulder', 'lifts and lowers the arm'],
      ['A3', 'elbow', 'bends the forearm'],
      ['A4', 'forearm roll', 'rolls the forearm'],
      ['A5', 'wrist', 'bends the wrist'],
      ['A6', 'flange', 'spins the tool'],
    ],
    home: [0, -60, 90, 0, 60, 0],
    orientation: 'abc',                          // A B C, deg (Z-Y-X)
    toolAxis: 'x',                               // KUKA's tool direction is the tool frame's X
    tool: { xyz: [0, 0, 200], rot: [0, -90, 0] },// B -90 turns the tool's X out along the flange's Z
    where: { tcp: 'KRL: $TOOL  (tool data X Y Z A B C)', safety: 'KUKA.SafeOperation' },
    cobot: false,                                // works behind a fence or a scanner
    moves: { joint: 'PTP', linear: 'LIN', lang: 'KRL' },
    simulator: 'KUKA.Sim',
  },
  XARM: {
    maker: 'UFACTORY',
    joints: [
      ['J1', 'base', 'turns the whole arm about the vertical axis'],
      ['J2', 'shoulder', 'lifts and lowers the arm'],
      ['J3', 'elbow', 'bends the forearm'],
      ['J4', 'forearm roll', 'rolls the forearm'],
      ['J5', 'wrist', 'bends the wrist'],
      ['J6', 'flange', 'spins the tool'],
    ],
    home: [0, -20, -40, 0, 60, 0],
    orientation: 'rpy',                          // roll pitch yaw, deg
    toolAxis: 'z',
    tool: { xyz: [0, 0, 150], rot: [0, 0, 0] },
    where: { tcp: 'xArm SDK: set_tcp_offset([x, y, z, roll, pitch, yaw])', safety: 'xArm SDK: set_reduced_mode, set_collision_sensitivity' },
    cobot: true,
    moves: { joint: 'set_servo_angle', linear: 'set_position', lang: 'xArm SDK' },
    simulator: null,                             // not named until checked
  },
};

// Per-robot changes to the family defaults.
export const OVERRIDES = {
  uf850: { home: [0, -20, -50, 0, -30, 0] },     // its J3 / J5 turn the other way from the xArm 6
  kr10r900: { model: 'KUKA KR 10 R900 sixx' },
  kr120r3900: { model: 'KUKA KR 120 R3900 ultra K' },
};

// Menu order.
export const ORDER = ['ur5e', 'ur10e', 'ur16e', 'ur20', 'kr6r700-2', 'kr10r900', 'kr10r900-2', 'kr10r1100',
  'kr10r1100-2', 'kr30ha', 'kr120r3900', 'ufxarm6', 'uf850'];
