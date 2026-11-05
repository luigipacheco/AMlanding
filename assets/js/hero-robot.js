// The robot in the hero: a different robot on every visit, moving slowly, drawn with the tutorials' viewer
// (tutorials/, exported from animaquina-academy). The bar under it changes the model: arrows step through them,
// the menu picks one. Orbit with the mouse; the page keeps the wheel for scrolling. If anything fails, the still
// image stays.
const hero = document.getElementById('hero-robot');
try {
  const [{ Stage, isoView }, { RobotView }, { loadRobots }] = await Promise.all([
    import('../../tutorials/core/stage.js'), import('../../tutorials/core/robot-view.js'), import('../../tutorials/robots/index.js'),
  ]);
  const robots = await loadRobots();
  const stage = new Stage(hero);
  stage.controls.enableZoom = false;

  // the model picker
  const bar = document.createElement('div'); bar.className = 'robot-pick';
  const button = (label, tip) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = tip; b.setAttribute('aria-label', tip); return b; };
  const prev = button('‹', 'Previous robot'), next = button('›', 'Next robot');
  const menu = document.createElement('select'); menu.setAttribute('aria-label', 'Robot model');
  for (const maker of [...new Set(robots.map(r => r.maker))]) {
    const group = document.createElement('optgroup'); group.label = maker;
    for (const r of robots.filter(x => x.maker === maker)) {
      const o = document.createElement('option'); o.value = r.id; o.textContent = `${r.maker} ${r.name}`; group.append(o);
    }
    menu.append(group);
  }
  // learn with this robot: the tutorial opens with whichever model is showing
  const learn = document.createElement('a'); learn.className = 'robot-learn';
  learn.textContent = 'Learn with this robot →';
  bar.append(prev, menu, next, learn);
  hero.append(bar);

  let robot = null, view = null, t0 = performance.now();
  const show = r => {
    if (view) { stage.scene.remove(view.group); view.dispose(); }
    robot = r; menu.value = r.id;
    learn.href = `tutorials/learn.html?t=industrial-robots&robot=${encodeURIComponent(r.id)}`;
    learn.title = `Introduction to Industrial Robots, with the ${r.maker} ${r.name}`;
    view = new RobotView(r);
    view.onModel = () => hero.classList.add('live');
    stage.scene.add(view.group);
    stage.frame({ ...isoView(r), height: r.reach * 1.55 });
    t0 = performance.now();
  };
  const step = d => show(robots[(robots.indexOf(robot) + d + robots.length) % robots.length]);
  prev.onclick = () => step(-1);
  next.onclick = () => step(1);
  menu.onchange = () => show(robots.find(r => r.id === menu.value));

  show(robots[Math.floor(Math.random() * robots.length)]);   // a different robot on every visit
  setTimeout(() => hero.classList.add('live'), 2500);
  (function loop() {
    requestAnimationFrame(loop);
    if (document.hidden) return;
    const t = (performance.now() - t0) / 1000;
    view.set(robot.home.map((a, i) => a + 0.16 * Math.sin(t * 0.45 + i * 0.9) * (i < 3 ? 1 : 1.7)));
    stage.render();
  })();
} catch (error) {
  console.warn('Hero robot not shown:', error);
}
