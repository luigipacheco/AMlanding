// learn.html?t=<tutorial id>: runs one tutorial inside the Animaquina-style workspace.
import { App } from '../core/app.js';
import { loadRobots } from '../robots/index.js';
import { TUTORIALS } from '../decks/index.js';

const ready = TUTORIALS.filter(t => t.load);
const id = new URL(location.href).searchParams.get('t');
const tutorial = ready.find(t => t.id === id) || ready[0];
const [robots, deck] = await Promise.all([loadRobots(), tutorial.load().then(mod => mod.default)]);
document.title = `${deck.title} · Animaquina Tutorials`;
new App({ root: document.getElementById('app'), robots, deck }).start();
