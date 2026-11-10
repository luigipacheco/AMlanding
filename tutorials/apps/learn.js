// learn.html?t=<tutorial id>: runs one tutorial inside the Animaquina-style workspace.
import { App } from '../core/app.js';
import { loadRobots } from '../robots/index.js';
import { TUTORIALS } from '../decks/index.js';

const ready = TUTORIALS.filter(t => t.load);
const id = new URL(location.href).searchParams.get('t');
const tutorial = ready.find(t => t.id === id) || ready[0];
try {
  const [robots, deck] = await Promise.all([loadRobots(), tutorial.load().then(mod => mod.default)]);
  document.title = `${deck.title} · Animaquina Tutorials`;
  new App({ root: document.getElementById('app'), robots, deck }).start();
} catch (error) {
  // a blank page says nothing: name what failed (no network for the robot library, a damaged file...)
  const box = document.createElement('p');
  box.style.cssText = 'margin:24px;font:14px/1.5 monospace;white-space:pre-wrap';
  box.textContent = `Animaquina could not start.\n${error?.message || error}\n\nReload the page. Offline, the robot library and its models must be served with it.`;
  document.getElementById('app').replaceChildren(box);
  throw error;
}
