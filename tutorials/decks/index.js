// Every tutorial the academy lists. A tutorial with `load` opens in learn.html?t=<id>; the others are shown as
// coming, with where they live today. Add a tutorial: make a deck folder like industrial-robots/ and list it here.
// Numbers follow the Robots course plan (Robots-Course-Plan.md, next to the Blender decks).

export const TUTORIALS = [
  {
    id: 'industrial-robots',
    num: '01',
    title: 'Introduction to Industrial Robots',
    summary: 'Joints, forward and inverse kinematics, the TCP, reach, singularities, moves, safety, collisions and ' +
      'simulation, on any of 13 robots. Also a first tour of where things live in Animaquina.',
    slides: 13,
    status: 'ready',
    load: () => import('./industrial-robots/deck.js'),
  },
  {
    id: 'animaquina',
    num: '02',
    title: 'Animaquina: Driving a Robot from Blender',
    summary: 'Planned. The contents are still to decide.',
    status: 'planned',
  },
  {
    id: 'digital-fabrication',
    num: '03',
    title: 'Digital Fabrication: Toolpaths',
    summary: 'Targets and order, drawing, printing, carving, smart toolpaths and robot code.',
    status: 'in Blender',
    note: 'Built as an interactive Blender deck; the web version comes next.',
  },
];
