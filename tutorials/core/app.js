// Runs a deck: one slide at a time, one robot at a time.
//
// A slide is a plain object (see decks/industrial-robots/*.js):
//   num, title, body, try      text (strings, or functions of the robot)
//   inputs(robot, app)         -> panel specs (see panel.js)
//   panels                     which Animaquina panels the slide's controls belong to (lit up in the tab strip)
//   setup(ctx)                 build the slide's own 3D objects into ctx.group
//   update(ctx, key)           inputs changed (key = which one, null on enter)
//   tick(ctx, seconds)         optional, every frame
//   camera(ctx)                optional, -> stage.frame() shot; defaults to the iso view
//
// ctx = { robot, view, stage, hud, panel, group, values, set(key, v), mem, app }
// A deck with `workspace: true` is the sandbox: one "slide", working tabs, no pager.
// Slides never name a brand: they read joint names, conventions and wording from ctx.robot.

import * as THREE from 'three';
import { Stage, isoView } from './stage.js';
import { RobotView, createModelAssets } from './robot-view.js';
import { Panel } from './panel.js';
import { Hud } from './hud.js';
import { dispose, retainDrawingResources, releaseDrawingResources, matrix4 } from './draw.js';
import * as m from './mat.js';
// The Robot IDE's editors load only for the IDE (loadEditorModules, called by apps/workspace.js), so a tutorial
// never loads them and can be published without them.
let RobotRegistry, SceneObjects, NodeEditor, NavGizmo, attachSearch, Timeline, TimelineUI, AreaManager, WORKSPACE_NAMES = [];
export async function loadEditorModules() {
  const [registry, objects, nodeEditor, gizmo, search, timeline, timelineUI, areas, layout, graph, document] = await Promise.all([
    import('./registry.js'), import('./scene-objects.js'), import('./node-editor.js'), import('./nav-gizmo.js'),
    import('./search-menu.js'), import('./timeline.js'), import('./timeline-ui.js'), import('./areas.js'), import('./layout.js'),
    import('./nodes/graph.js'), import('./document.js'),
  ]);
  ({ RobotRegistry } = registry); ({ SceneObjects } = objects); ({ NodeEditor } = nodeEditor); ({ NavGizmo } = gizmo);
  ({ attachSearch } = search); ({ Timeline } = timeline); ({ TimelineUI } = timelineUI); ({ AreaManager } = areas);
  ({ WORKSPACE_NAMES } = layout);
  document.setGraphParser(graph);                 // project files with Nodes objects need the node graph checks
}
import { ProjectStore, MAX_PROJECT_BYTES, MAX_OBJECTS, parseProject } from './document.js';
// The Robot IDE's own shortcut sheet (tutorials keep theirs, below).
const IDE_HELP = '<h2>Shortcuts</h2><p>The editor under the pointer has the keyboard, as in Blender. While you type in a field, keys go to the field.</p><p><strong>3D Viewport</strong> · Middle mouse, or left drag on a trackpad: orbit · Shift + drag: pan · wheel: zoom · Numpad 1 / 3 / 7: front / right / top (Ctrl: opposite) · Numpad 5: projection · Home: frame all · Numpad . : frame selected.</p><p>Shift+A: add · G / R: move / rotate (X Y Z: axis, again: local, again: free; Shift + axis: plane; type a value) · Enter or click: confirm · Esc or right click: cancel · X: delete (asks) · Delete: delete at once · Tab: to the Node Editor · T: toolbar · N: Item / View.</p><p><strong>Node Editor</strong> · Shift+A: add · drag a socket: link · X: delete · Shift+D: duplicate · A: select all · Home: frame.</p><p><strong>Timeline</strong> · Space: play / pause, from any editor · drag a task or its ends · X: delete the task (asks) · Home: to the start.</p><p>Ctrl+Space: maximize the area under the pointer · Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z: undo, redo. Everything edits the offline scene.</p><form method="dialog"><button>Close</button></form>';
import { RenderLoop } from './render-loop.js';
import { editorAction, viewportAction, GLOBAL_ACTIONS } from './keymap.js';
import { TargetTransform } from './transform.js';

export class App {
  constructor({ root, robots, deck }) {
    Object.assign(this, { root, robots, deck });
    this.store = new ProjectStore(robots.map(r => r.id));
    this.views = new Map();
  }

  start() {
    if (this.started) return this;
    this.started = true;
    retainDrawingResources();
    this.assets = createModelAssets();
    this.stage = new Stage(this.root);
    this.hud = new Hud(this.root, this.deck);
    this.panel = new Panel(this.root);
    this.panel.onLayout = () => this.afterPanels();
    this.panel.onVisibility = () => this.syncPanelButtons?.();
    this.elapsed = 0;
    this.loop = new RenderLoop(time => {
      if (document.hidden || this.disposed) return false;
      const dt = this.lastTime == null ? 0 : Math.min(.1, (time - this.lastTime) / 1000);
      this.elapsed += dt;
      this.lastTime = time;
      if (this.timeline?.playing) this.timeline.advance(dt);
      if (this.transform?.dirty) this.transform.preview();
      const active = this.slide?.needsTick ? this.slide.needsTick(this.ctx) : !!this.slide?.tick;
      if (active) this.slide.tick(this.ctx, this.elapsed);
      const changed = this.stage.render();
      this.gizmo?.update();
      const again = changed || active || !!this.timeline?.playing;
      if (!again) this.lastTime = null;   // idle: the next frame starts a new clock, so Play does not begin with a jump
      return again;
    });
    this.stage.invalidate = () => { if (!document.hidden) this.loop.invalidate(); };
    if (this.deck.workspace) this.root.classList.add('workspace');
    this.stage.insets = () => {
      const wide = this.root.clientWidth > 900;
      return {
        left: this.areas ? Math.max(0, (this.toolbarEl?.getBoundingClientRect().right || 0) - this.stage.root.getBoundingClientRect().left)
          : !wide ? 0 : this.deck.workspace ? Math.max(this.toolbarEl?.getBoundingClientRect().right || 0, this.sideEdges().left)
          : this.hud.el.getBoundingClientRect().right,
        right: this.areas ? 0 : !wide ? 0 : this.deck.workspace ? this.sideEdges().right
          : this.panel.visible ? this.root.clientWidth - this.panel.el.getBoundingClientRect().left : 0,
        // phones, tutorials: the robot sits between the slide text (top) and the controls bar (bottom)
        top: this.areas ? 0 : this.deck.workspace ? 34 : !wide ? this.hud.el.getBoundingClientRect().bottom - this.root.getBoundingClientRect().top : 0,
        bottom: this.areas ? 0 : !wide && !this.deck.workspace ? this.root.getBoundingClientRect().bottom - (this.panel.visible ? this.panel.el : this.hud.pager).getBoundingClientRect().top
          : (this.timelineUI?.root.offsetHeight || 0)
          + (this.nodeEditor?.isOpen && !this.nodeEditor.root.classList.contains('max') ? this.nodeEditor.root.offsetHeight : 0),
      };
    };

    const url = new URL(location.href);
    const rid = url.searchParams.get('robot');
    if (this.deck.workspace) {
      // Robot IDE: many robots, each in its own collection (core/registry.js)
      this.registry = new RobotRegistry(this);
      this.registry.ensure(rid);
      this.objects = new SceneObjects(this);   // Shift+A shapes
      this.timeline = new Timeline(this);      // tasks in time, one track per robot
      this.robot = this.registry.def(this.registry.active);
    } else this.robot = this.robots.find(r => r.id === rid) || this.robots[0];
    this.useRobot(this.robot);
    this.go(this.indexFromHash());

    this.transform = new TargetTransform(this);
    this.onKey = e => this.key(e);
    this.onHash = () => { const i = this.indexFromHash(); if (i !== this.index) this.go(i); };
    this.onVisibility = () => {
      this.lastTime = null;
      if (document.hidden) { this.transform.cancel(); this.loop.suspend(); }
      else this.loop.invalidate();
    };
    window.addEventListener('keydown', this.onKey);   // whole page: shortcuts work before the viewport is clicked
    window.addEventListener('hashchange', this.onHash);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.hud.pager.querySelector('.prev').onclick = () => this.go(this.index - 1);
    this.hud.pager.querySelector('.next').onclick = () => this.go(this.index + 1);
    this.hud.pager.querySelector('.view').onclick = () => this.frame();

    this.buildTools();
    if (this.deck.workspace) this.buildEditor();
    this.loop.invalidate();
    return this;
  }

  indexFromHash() {
    const h = location.hash.slice(1);
    const i = this.deck.slides.findIndex(s => s.num === h);
    return i < 0 ? 0 : i;
  }

  key(e) {
    if (e.target.closest?.('input, select, textarea, [contenteditable]:not([contenteditable="false"]), dialog')) return;
    const inNodes = !!e.target.closest?.('.node-editor, .node-add');   // the node editor has its own keys; only the global ones reach here
    if (!inNodes && this.areas && e.key === ' ' && (e.ctrlKey || e.metaKey)) {   // Ctrl+Space: maximize the area under the pointer
      e.preventDefault();
      this.areas.toggleMax(this.areas.maxPath === null ? (this.hoverArea?.dataset.path ?? null) : null);
      return;
    }
    if (this.transform.active) {
      if (!inNodes && this.transform.key(e)) { e.preventDefault(); e.stopPropagation(); }
      return;
    }
    const action = editorAction(e, { lessons: !this.deck.workspace });
    if (!action) return;
    if (inNodes && !GLOBAL_ACTIONS.includes(action)) return;
    // Blender's rule: the editor under the pointer has the keyboard. G, X, Shift+A... act on the 3D Viewport only while
    // the pointer is over it (or over no area at all, as right after the page opens).
    const over = this.areas ? this.hoverType : null;
    if (viewportAction(action) && over && over !== 'view3d') return;
    e.preventDefault();
    if (action === 'panel') { if (this.areas) this.toggleArea('properties'); else { this.panel.toggle(); this.afterPanels(); } }
    else if (action === 'frame') this.frameAll();
    else if (action === 'selection') this.frameSelected();
    else if (action === 'projection') this.stage.toggleProjection();
    else if (action.startsWith('view:') || action.startsWith('opposite:')) this.stage.align(action.split(':')[1], action.startsWith('opposite:'));
    else if (action === 'next') this.go(this.index + 1);
    else if (action === 'previous') this.go(this.index - 1);
    else if (action === 'undo' || action === 'redo') this.history(action);
    else if (action === 'grab' || action === 'rotate') this.transform.start(action);
    else if (action === 'help') this.help.showModal();
    else if (action === 'add' && this.objects) this.openAddMenu(this.lastPointer);
    else if (action === 'toolbar' && this.toolbarEl) { this.toolbarEl.hidden = !this.toolbarEl.hidden; }
    else if (action === 'delete' && this.objects?.selected) this.confirmDelete();
    else if (action === 'delete-now' && this.objects?.selected) this.deleteSelected();
    else if (action === 'play' && this.timeline) this.timeline.toggle();
    else if (action === 'nodes' && this.nodeEditor && this.areas && this.objects?.selected?.type === 'geometry') this.nodeEditor.open();
    else if (action === 'nodes' && this.nodeEditor && this.areas) {
      // areas stay where the user put them: Tab goes to the Node Editor when it is on screen, and never closes it
      if (this.nodeEditor.isOpen) this.nodeEditor.root.focus({ preventScroll: true });
      else this.notice('Tab opens the nodes of a Nodes object: select one, or add one with Shift+A > Nodes');
    }
    else if (action === 'nodes' && this.nodeEditor) {
      if (this.objects?.selected?.type === 'geometry' || this.nodeEditor.isOpen) this.nodeEditor.toggle();
      else this.notice('Tab opens the nodes of a Nodes object: select one, or add one with Shift+A > Nodes');
    }
  }

  useRobot(robot) {
    if (!robot) return;
    if (this.registry) {                         // one view per robot instance, placed by the registry
      this.robot = robot;
      this.store.data.activeRobotId = robot.id;
      this.registry.sync();
      this.view = this.views.get(this.registry.active.uid);
      this.view.onModel = () => {
        if (!this.disposed && this.slide) {
          this.updateSlide(null);
          if (this.view.modelError) this.notice('Model unavailable; showing the simplified robot. Use Retry model.');
        }
      };
      const url = new URL(location.href);
      url.searchParams.set('robot', robot.id);
      history.replaceState(null, '', url);
      return;
    }
    if (this.view) this.view.group.removeFromParent();
    this.robot = robot;
    this.store.data.activeRobotId = robot.id;
    this.view = this.views.get(robot.id) || new RobotView(robot, this.assets);
    this.views.delete(robot.id); this.views.set(robot.id, this.view);
    while (this.views.size > 2) {
      const [id, old] = this.views.entries().next().value;
      old.dispose(); this.views.delete(id);
    }
    // when the real model arrives, labels and arrows move to its parts: redraw the slide
    this.view.onModel = () => {
      if (!this.disposed && this.view.robot === robot && this.slide) {
        this.updateSlide(null);
        if (this.view.modelError) this.notice('Model unavailable; showing the simplified robot. Use Retry model.');
      }
    };
    this.stage.scene.add(this.view.group);
    const url = new URL(location.href);
    url.searchParams.set('robot', robot.id);
    history.replaceState(null, '', url);
  }

  setRobot(id) {
    if (!this.robots.some(r => r.id === id)) return;
    if (this.registry) {                         // the active robot changes model; its own joints / target reset
      this.registryEdit('Change robot model', () => this.registry.setModel(this.registry.active.uid, id));
      return;
    }
    if (id === this.robot.id) return;
    this.useRobot(this.robots.find(r => r.id === id));
    this.go(this.index, true);
  }

  go(i, force = false) {
    this.transform?.cancel();
    const slides = this.deck.slides;
    i = Math.max(0, Math.min(slides.length - 1, i));
    if (i === this.index && !force) return;
    if (this.group) dispose(this.group);

    this.index = i;
    const slide = this.slide = slides[i];
    const robot = this.robot;
    const group = this.group = new THREE.Group();
    this.stage.scene.add(group);

    const specs = slide.inputs ? slide.inputs(robot, this) : [];
    const sk = this.registry ? `workspace/${this.registry.active.uid}` : `${this.deck.title}/${robot.id}/${slide.num}`;
    if (this.registry) { group.matrixAutoUpdate = false; matrix4(this.registry.base(this.registry.active), group.matrix); }
    const values = this.store.values(sk, robot.id, specs);
    if (Object.hasOwn(values, 'robot')) values.robot = robot.id;
    const mem = {};
    this.ctx = {
      robot, view: this.view, stage: this.stage, hud: this.hud, panel: this.panel, group, values, mem, app: this,
      registry: this.registry, instance: this.registry?.active,
      set: (key, v) => this.panel.set(key, v),
    };

    this.view.reset();
    this.hud.show(slide, robot, i, slides.length);
    const ws = !!this.deck.workspace;
    this.panel.build(specs, values, key => this.updateSlide(key), {
      interactive: ws,
      used: slide.panels || [],
      titles: slide.titles?.(robot, values, this),
      begin: label => this.store.begin(label),
      commit: () => { this.store.commit(); this.syncHistory(); },
      foot: ws ? 'N sidebar · ? shortcuts' : '← → slides · N panel · ? shortcuts',
    });
    slide.setup?.(this.ctx);
    slide.update?.(this.ctx, null);
    if (!force) this.frame();                   // rebuilding the same view (edits, undo) keeps the camera
    this.syncViewInfo();
    if (!this.deck.workspace && location.hash.slice(1) !== slide.num) history.replaceState(null, '', `${location.pathname}${location.search}#${slide.num}`);
  }

  frame() {
    let shot = this.slide.camera ? this.slide.camera(this.ctx) : isoView(this.robot);
    if (this.registry) shot = { ...shot, target: m.point(this.registry.base(this.registry.active), shot.target) };
    this.stage.frame(shot);
  }

  /** Home / Frame All: every robot in the scene. */
  frameAll() {
    if (!this.registry || this.registry.robots.length < 2) return this.frame();
    const b = this.registry.bounds();
    this.stage.frame({ target: [b.centre[0], b.centre[1], b.reach * 0.35], height: b.span * 0.6, dir: isoView(this.robot).dir });
  }

  /** One undoable registry edit, then rebuild around the (maybe new) active robot. */
  registryEdit(label, fn) {
    this.transform?.cancel();
    this.store.begin(label);
    const changed = fn();
    this.store.commit(); this.syncHistory();
    if (changed !== false) this.restore();
  }
  activateRobot(uid) { this.registryEdit('Select robot', () => this.registry.activate(uid)); }
  addRobot(modelId) { this.registryEdit('Add robot', () => !!this.registry.add(modelId)); }
  removeRobot(uid) { this.registryEdit('Remove robot', () => this.registry.remove(uid)); }

  /** Base fields changed: move the collections and the slide group without rebuilding the panel. */
  placeRobots() {
    if (!this.registry) return;
    this.registry.sync();
    matrix4(this.registry.base(this.registry.active), this.group.matrix);
    this.group.matrixWorldNeedsUpdate = true;
    this.stage.invalidate();
  }

  updateSlide(key) { this.slide.update?.(this.ctx, key); this.stage.invalidate(); }

  frameTarget() {
    const T = this.slide.target?.(this.ctx)?.get() || this.view.f.tcp;
    this.stage.frame({ target: [T[3], T[7], T[11]], height: Math.max(.2, this.robot.reach * .6) });
  }

  restore() {
    if (this.registry) {
      this.registry.ensure(this.store.data.activeRobotId);   // a project saved before the registry existed
      this.objects?.sync();
      this.useRobot(this.registry.def(this.registry.active));
      this.go(this.index, true); this.syncHistory();
      this.nodeEditor?.render(); this.nodeEditor?.syncMode(); this.timelineUI?.render();
      return;
    }
    const robot = this.robots.find(r => r.id === this.store.data.activeRobotId);
    if (robot !== this.robot) this.useRobot(robot);
    this.go(this.index, true); this.syncHistory();
  }

  // ── areas (core/areas.js): the screen as Blender-like areas, one editor in each ────────────────
  buildAreas() {
    // the 3D view is one element: the canvas, its labels and its own overlays (mode, toolbar, gizmo, overlay card)
    const view = this.viewHost = document.createElement('div');
    view.className = 'view3d';
    this.stage.mount(view);
    view.append(this.nodeEditor.mode, this.toolbarEl, this.gizmo.root, this.hud.el);
    this.panel.leftEl?.classList.remove('hidden', 'absent');
    this.panel.el.classList.remove('hidden');
    this.areas = new AreaManager(this, {
      view3d: view, properties: this.panel.el, animaquina: this.panel.leftEl,
      timeline: this.timelineUI.root, nodes: this.nodeEditor.root,
      spreadsheet: this.nodeEditor.sheet.root,
    });
    this.nodeEditor.root.hidden = false;
    this.root.classList.add('areas-on');
    // editors redraw when their area changes size
    this.areaObserver = new ResizeObserver(() => this.onAreas());
    for (const node of [view, this.timelineUI.root, this.nodeEditor.root, this.nodeEditor.sheet.root]) this.areaObserver.observe(node);
    this.areas.render();
  }
  /** After the layout changed or an area was resized. */
  onAreas() {
    if (!this.areas) return;
    this.nodeEditor?.syncSpreadsheetArea();
    this.stage.resize();
    this.timelineUI?.render();
    if (this.nodeEditor?.isOpen) { this.nodeEditor.render(); this.nodeEditor.syncMode(); }
    else this.nodeEditor?.syncMode();
    this.syncPanelButtons();
  }
  /** N / the sidebar buttons: show or hide an area, next to the 3D view (Properties left, Animaquina right). */
  toggleArea(type) {
    if (this.areas.has(type)) this.areas.remove(type);
    else this.areas.ensure(type, { near: 'view3d', dir: 'row', ratio: type === 'properties' ? 0.22 : 0.26, first: type === 'properties' });
  }

  /** A sidebar was shown or hidden: the 3D view, the timeline and the node editor take the room. */
  afterPanels() { this.layoutSides(); this.stage.resize(); this.timelineUI?.render(); this.nodeEditor?.drawLinks?.(); this.syncPanelButtons(); }

  /** Where the free middle of the screen starts and ends (px from each side), from the sidebars that show. */
  sideEdges() {
    const W = this.root.clientWidth, out = { left: 0, right: 0 };
    for (const el of [this.panel.el, this.panel.leftEl]) {
      if (!el || el.classList.contains('hidden') || el.classList.contains('absent') || !el.offsetParent) continue;
      const r = el.getBoundingClientRect(), root = this.root.getBoundingClientRect();
      if (r.left + r.width / 2 < root.left + W / 2) out.left = Math.max(out.left, r.right - root.left + 10);
      else out.right = Math.max(out.right, root.right - r.left + 10);
    }
    return out;
  }
  /** Everything between the sidebars (3D controls, node editor, timeline, gizmo) follows these two numbers. */
  layoutSides() {
    if (!this.deck.workspace || this.areas) return;
    const e = this.root.clientWidth > 900 ? this.sideEdges() : { left: 0, right: 0 };
    this.root.style.setProperty('--edge-l', `${e.left}px`);
    this.root.style.setProperty('--edge-r', `${e.right}px`);
  }
  /** The top bar's sidebar buttons are lit while their sidebar shows. */
  syncPanelButtons() {
    const b = a => this.toolbar?.querySelector?.(`.topbar [data-action="${a}"]`);
    b('panel')?.classList.toggle('on', this.areas ? this.areas.has('properties') : this.panel.visible);
    b('panelLeft')?.classList.toggle('on', this.areas ? this.areas.has('animaquina') : this.panel.leftVisible);
    for (const n of WORKSPACE_NAMES) b(`ws:${n}`)?.classList.toggle('on', this.areas?.workspace === n);
  }

  /** The playhead moved (scrub or playback): every robot to its pose at that time. */
  onTime() {
    if (!this.ctx) return;
    this.slide?.onTime?.(this.ctx);
    this.registry?.sync();
    this.timelineUI?.drawTime();
    this.stage.invalidate();
  }

  /** Rebuild after a node edit: the Item tab's data counts and any path made from the nodes follow. */
  refreshScene() { this.go(this.index, true); }

  /** The line under the mode switch: which robot is active and which object is selected (Blender's viewport text). */
  syncViewInfo() {
    if (!this.viewInfo) return;
    const robot = this.registry?.active.name, o = this.objects?.selected;
    const type = o ? (o.type === 'geometry' ? 'Nodes' : o.type[0].toUpperCase() + o.type.slice(1)) : '';
    this.viewInfo.replaceChildren();
    const part = (text, cls) => { const s = document.createElement('span'); s.textContent = text; if (cls) s.className = cls; this.viewInfo.append(s); };
    part(robot || '', 'vi-robot');
    if (o) { part(' \u00b7 '); part(o.name, 'vi-object'); if (!o.name.startsWith(type)) part(` ${type}`, 'vi-type'); }
    else part(' \u00b7 nothing selected', 'vi-type');
  }

  /** Numpad . : frame the selected object, or else the active target. */
  frameSelected() {
    const o = this.objects?.selected;
    if (!o) return this.frameTarget();
    const size = o.size ? Math.max(...o.size) / 1000 : 0.6;
    this.stage.frame({ target: o.pos.map(v => v / 1000), height: Math.max(0.4, size * 2.5) });
  }

  history(action) {
    this.transform?.cancel();
    if (this.store[action]()) this.restore();
  }

  syncHistory() {
    if (!this.toolbar) return;
    this.toolbar.querySelector('[data-action="undo"]').disabled = !this.store.past.length;
    this.toolbar.querySelector('[data-action="redo"]').disabled = !this.store.future.length;
  }

  notice(text) { if (this.message) this.message.textContent = text; }

  buildTools() {
    const ws = !!this.deck.workspace;
    const actions = {
      undo: ['Undo', () => this.history('undo')], redo: ['Redo', () => this.history('redo')],
      save: ['Save', () => {
        this.transform.confirm(); if (this.transform.active) return;
        this.store.commit(); this.syncHistory();
        const text = this.store.serialize();
        try { parseProject(text, this.store.robotIds); }   // what Open will do with it
        catch (error) { this.notice(`Not saved: this project would not open again (${error.message}). Undo the last change and save again.`); return; }
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const a = document.createElement('a'); a.href = url; a.download = 'animaquina-project.json'; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }],
      open: ['Open', () => this.file.click()],
      import: ['Import', () => this.meshFile?.click()],
      panel: ['Panel', () => { if (this.areas) this.toggleArea('properties'); else { this.panel.toggle(); this.afterPanels(); } }],
      panelLeft: ['Animaquina panels', () => { if (this.areas) this.toggleArea('animaquina'); else this.panel.toggleLeft(); }],
      ...Object.fromEntries(WORKSPACE_NAMES.map(n => [`ws:${n}`, [n, () => this.areas?.setWorkspace(n)]])),
      nodes: ['Nodes', () => this.nodeEditor?.toggle()],
      projection: ['Ortho / Perspective', () => this.stage.toggleProjection()],
      front: ['Front', () => this.stage.align('1')], right: ['Right', () => this.stage.align('3')], top: ['Top', () => this.stage.align('7')],
      grab: ['Move target', () => { this.stage.renderer.domElement.focus(); this.transform.start('grab'); }],
      rotate: ['Rotate target', () => { this.stage.renderer.domElement.focus(); this.transform.start('rotate'); }],
      retry: ['Retry model', () => { this.view.loadModel(this.robot.model); }],
      help: ['Shortcuts', () => this.help.showModal()],
      frame: ['Frame', () => this.frameAll()],
      add: ['Add', b => { const r = b.getBoundingClientRect(); this.openAddMenu([r.left, r.bottom + 4]); }],
    };
    const button = (action, label = actions[action][0], tip) => {
      const b = document.createElement('button'); b.textContent = label; b.dataset.action = action;
      if (tip) { b.title = tip; if (label.length <= 2) b.setAttribute('aria-label', tip); }   // an icon alone has no name
      b.onclick = () => {
        if (this.transform.active && !['save', 'grab', 'rotate'].includes(action)) this.transform.cancel();
        actions[action][1](b); this.toolbar.open = false;
      };
      return b;
    };
    this.message = document.createElement('div'); this.message.className = 'workspace-message';
    this.message.setAttribute('role', 'status');
    if (ws) {
      // Robot IDE: one thin top bar (like Blender's), the editor gets the rest of the screen
      const bar = this.toolbar = document.createElement('header'); bar.className = 'topbar';
      bar.setAttribute('aria-label', 'Editor');
      const home = document.createElement('a'); home.className = 'topbar-brand'; home.href = this.deck.home || '../';
      home.textContent = 'Animaquina'; home.title = 'Animaquina home';
      bar.appendChild(home);
      const groups = [
        [['open', 'Open', 'Open a project (.json)'], ['save', 'Save', 'Save the project (.json)'],
          ['import', 'Import', 'Import a mesh (.stl, .obj) as a Nodes object, ready for processing nodes. You can also drop the file on the window']],
        [['undo', '↶', 'Undo · Ctrl+Z'], ['redo', '↷', 'Redo · Ctrl+Shift+Z']],
        [['add', 'Add', 'Add a shape, nodes or a robot · Shift+A']],
        WORKSPACE_NAMES.map(n => [`ws:${n}`, n, `${n} workspace`]),
      ];
      for (const g of groups) {
        const el = document.createElement('div'); el.className = 'topbar-group';
        el.append(...g.map(([a, label, tip]) => button(a, label, tip)));
        bar.appendChild(el);
      }
      const right = document.createElement('div'); right.className = 'topbar-group topbar-right';
      // the two sidebars: Animaquina's panels (left) and Item / View (right, N as in Blender)
      right.append(button('panel', '\u25e7', 'Show / hide Item / View (left) · N'), button('panelLeft', '\u25e8', 'Show / hide the Animaquina panels (right)'),
        button('help', '?', 'Shortcuts'));
      bar.append(this.message, right);
      this.root.append(bar, this.file = document.createElement('input'));
    } else {
      this.toolbar = document.createElement('details'); this.toolbar.className = 'workspace-tools';
      this.toolbar.setAttribute('aria-label', 'Workspace tools');
      const summary = document.createElement('summary'); summary.textContent = 'Workspace tools';
      const items = document.createElement('div'); items.className = 'tool-items';
      this.toolbar.append(summary, items);
      for (const a of ['undo', 'redo', 'save', 'open', 'panel', 'projection', 'front', 'right', 'top', 'grab', 'rotate', 'retry', 'help']) items.appendChild(button(a));
      this.file = document.createElement('input');
    }
    this.file.type = 'file'; this.file.accept = '.json,application/json'; this.file.hidden = true;
    this.file.onchange = async () => {
      const file = this.file.files[0]; if (!file) return;
      await this.openProject(file);
      this.file.value = '';
    };
    if (ws) {
      // Import: a mesh file becomes a Nodes object (Import Mesh -> Group Output); drop files on the window too
      this.meshFile = document.createElement('input');
      this.meshFile.type = 'file'; this.meshFile.accept = '.stl,.obj'; this.meshFile.hidden = true;
      this.meshFile.onchange = async () => { const file = this.meshFile.files[0]; if (file) await this.importMesh(file); this.meshFile.value = ''; };
      this.root.append(this.meshFile);
      this.onDragOver = e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } };
      this.onDrop = e => {
        const file = e.dataTransfer?.files?.[0]; if (!file) return;
        e.preventDefault();
        if (/\.(stl|obj)$/i.test(file.name)) this.importMesh(file);
        else if (/\.json$/i.test(file.name)) this.openProject(file);
        else this.notice(`${file.name}: drop an .stl or .obj mesh, or a .json project`);
      };
      this.root.addEventListener('dragover', this.onDragOver);
      this.root.addEventListener('drop', this.onDrop);
    }
    this.help = document.createElement('dialog'); this.help.className = 'shortcut-help';
    this.help.innerHTML = ws ? IDE_HELP : '<h2>Viewport shortcuts</h2><p>Middle mouse, or left drag on a trackpad: orbit · Shift + drag: pan · wheel / Ctrl + middle mouse: zoom.</p><p>N: panel · Numpad 1 / 3 / 7: front / right / top (Ctrl: opposite) · Numpad 5: projection · Home: frame all · Numpad decimal: frame target.</p><p>G / R: move / rotate the active TCP target. X / Y / Z: axis; repeat for local, repeat again to release. Shift + axis: plane. Type mm / cm / m or deg / rad; defaults are mm and degrees.</p><p>Enter / left click: confirm · Esc / right click: cancel · Ctrl/Cmd + Z: undo · Ctrl/Cmd + Shift + Z: redo. These edit offline state.</p><p>Shortcuts work anywhere on the page except while typing in a field. Learn: arrows or PageUp/PageDown change slides. P and V remain presentation aliases.</p><form method="dialog"><button>Close</button></form>';
    if (ws) this.root.append(this.help);
    else this.root.append(this.toolbar, this.file, this.message, this.help);
    this.syncHistory();
  }

  // ── Robot IDE editor: selection, Shift+A, toolbar ───────────────────────────
  /** One undoable scene edit (objects or selection), then rebuild the panel around it. */
  sceneEdit(label, fn) {
    this.transform?.cancel();
    this.store.begin(label);
    const changed = fn();
    this.store.commit(); this.syncHistory();
    if (changed !== false) this.restore();
  }
  addObject(type) {
    if (this.objects.list.length >= MAX_OBJECTS) { this.notice(`The scene holds up to ${MAX_OBJECTS} objects: delete one first`); return; }
    this.sceneEdit(`Add ${type}`, () => !!this.objects.add(type));
    this.panel.showSide?.('Item');
  }

  async openProject(file) {
    try {
      if (file.size > MAX_PROJECT_BYTES) throw new Error('Project must be smaller than 32 MB');
      const text = await file.text(), s = this.store;
      const before = { data: s.data, assets: s.assets, past: s.past, future: s.future };
      s.load(text);
      try { this.restore(); }
      catch (error) { Object.assign(s, before, { pending: null }); s.revision++; this.restore(); throw error; }
      this.notice('Project opened · offline preview');
    } catch (error) { this.notice(`Could not open project: ${error.message}`); }
  }

  /**
   * Import a mesh file (.stl, .obj) as a Nodes object named after the file: its graph is Import Mesh -> Group Output,
   * so processing nodes (Slice, Transform...) go in between. The file is kept outside undo and saved with the project.
   */
  async importMesh(file) {
    try {
      const [{ parseMeshFile, MAX_IMPORT_BYTES }, graphs] = await Promise.all([import('./mesh-import.js'), import('./nodes/graph.js')]);
      if (file.size > MAX_IMPORT_BYTES) throw new Error('File is larger than 30 MB');
      if (this.objects.list.length >= MAX_OBJECTS) throw new Error(`the scene holds up to ${MAX_OBJECTS} objects`);
      const mesh = parseMeshFile(file.name, await file.arrayBuffer());
      const id = this.store.addAsset(file.name, mesh.positions, mesh.faces);
      const name = file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Mesh';
      this.sceneEdit(`Import ${file.name}`, () => {
        const o = this.objects.add('geometry');
        if (!o) return false;
        o.name = name;
        const node = graphs.addNode(o.graph, 'import_mesh', 40, 40);
        node.params.asset = id;
        graphs.connect(o.graph, node.id, 'mesh', o.graph.nodes.find(n => n.kind === 'output').id, 'geometry');
        return true;
      });
      this.panel.showSide?.('Item');
      this.notice(`Imported ${file.name}: ${mesh.positions.length / 3} points, ${mesh.faces.length} faces · Tab to add nodes`);
    } catch (error) { this.notice(`Could not import ${file.name}: ${error.message}`); }
  }
  deleteSelected() { const o = this.objects?.selected; if (o) this.sceneEdit(`Delete ${o.name}`, () => this.objects.remove(o.uid)); }
  /** X: ask first, as Blender does (Delete does it at once; both are one undo step). */
  confirmDelete(at) { const o = this.objects?.selected; if (o) this.confirm(`Delete ${o.name}`, () => this.deleteSelected(), at); }

  /**
   * Blender's confirmation: a one-button menu under the pointer. Enter or a click does it; Esc, or a click
   * anywhere else, does not.
   */
  confirm(label, run, at = this.lastPointer) {
    this.closeConfirm();
    const menu = this.confirmEl = document.createElement('div');
    menu.className = 'add-menu confirm-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Confirm');
    const title = document.createElement('div'); title.className = 'add-title'; title.textContent = 'OK?';
    const ok = document.createElement('button'); ok.type = 'button'; ok.textContent = label; ok.setAttribute('role', 'menuitem');
    ok.onclick = () => { this.closeConfirm(); run(); };
    menu.append(title, ok);
    menu.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); this.closeConfirm(); } });
    this.root.append(menu);
    const [x, y] = at || [innerWidth / 2, innerHeight / 2], r = this.root.getBoundingClientRect();
    // the button sits under the pointer, so the answer is one click or Enter away
    menu.style.left = `${Math.max(8, Math.min(x - r.left - 24, r.width - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y - r.top - menu.offsetHeight + 14, r.height - menu.offsetHeight - 8))}px`;
    this.onConfirmOutside = e => { if (!menu.contains(e.target)) { this.skipPick = true; this.closeConfirm(); } };
    window.addEventListener('pointerdown', this.onConfirmOutside, true);
    ok.focus({ preventScroll: true });
  }
  closeConfirm() {
    if (!this.confirmEl) return;
    window.removeEventListener('pointerdown', this.onConfirmOutside, true);
    this.confirmEl.remove(); this.confirmEl = null;
    this.focusHover();
  }

  // ── Blender's rule: the area under the pointer has the keyboard ─────────────────────
  get hoverType() { return this.hoverArea?.isConnected ? [...this.hoverArea.classList].find(c => c.startsWith('area-'))?.slice(5) ?? null : null; }
  /** The pointer moved onto `target`: its area takes the keyboard. */
  hover(target) {
    const area = target?.closest?.('.area') || null;
    if (area === this.hoverArea) return;
    this.hoverArea = area;
    this.focusHover();
  }
  /** After the layout was redrawn the pointer may be over another area without having moved. */
  rehover() {
    if (!this.lastPointer) return;
    this.hoverArea = document.elementFromPoint(...this.lastPointer)?.closest?.('.area') || null;
    this.focusHover();
  }
  /** Give the keyboard to the editor in the area under the pointer, unless someone is typing or a menu is open. */
  focusHover() {
    const area = this.hoverArea;
    if (!area?.isConnected || this.transform?.active) return;
    const at = document.activeElement;
    if (at?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), .add-menu, dialog')) return;
    if (at !== area && area.contains(at)) return;                       // already in this area (a field, the editor itself)
    const editor = { view3d: this.stage.renderer.domElement, nodes: this.nodeEditor?.root, timeline: this.timelineUI?.root }[this.hoverType]
      || area.querySelector('.attribute-table:not([hidden])') || area;
    editor.focus({ preventScroll: true });
  }

  buildEditor() {
    const canvas = this.stage.renderer.domElement;
    // click to select (a click, not an orbit drag): the nearest object or robot; empty space clears
    this.onPointerTrack = e => { this.lastPointer = [e.clientX, e.clientY]; if (!e.buttons) this.hover(e.target); };
    window.addEventListener('pointermove', this.onPointerTrack);
    this.onPickDown = e => {
      // the click that dismissed a menu is not also a click on the scene
      if (this.skipPick) { this.skipPick = false; this.pickStart = null; return; }
      this.pickStart = e.button === 0 ? [e.clientX, e.clientY] : null;
    };
    this.onPickUp = e => {
      const p = this.pickStart; this.pickStart = null;
      if (!p || e.button !== 0 || Math.hypot(e.clientX - p[0], e.clientY - p[1]) > 4 || this.transform.active) return;
      const rect = canvas.getBoundingClientRect(), ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), this.stage.camera);
      ray.params.Line.threshold = 0.008; ray.params.Points.threshold = 0.008;   // curves are thin: pick within 8 mm
      const r = this.registry.pick(ray), o = this.objects.pick(ray);
      if (o && (!r || o.distance <= r.distance)) {
        if (o.uid !== this.store.data.selected) this.sceneEdit('Select', () => this.objects.select(o.uid));
      } else if (r) {
        if (r.uid !== this.registry.active.uid || this.store.data.selected) {
          this.sceneEdit('Select robot', () => { this.objects.select(null); this.registry.activate(r.uid); });
        }
      } else if (this.store.data.selected) this.sceneEdit('Deselect', () => this.objects.select(null));
    };
    canvas.addEventListener('pointerdown', this.onPickDown);
    canvas.addEventListener('pointerup', this.onPickUp);

    // the toolbar (Blender's T panel), at the left edge of the viewport
    const bar = this.toolbarEl = document.createElement('nav');
    bar.className = 'toolbar'; bar.setAttribute('aria-label', 'Tools');
    const tools = [
      ['select', '\u2196', 'Select · click an object or a robot', () => {}],
      ['grab', '\u2725', 'Move · G', () => { canvas.focus(); this.transform.start('grab'); }],
      ['rotate', '\u27f3', 'Rotate · R', () => { canvas.focus(); this.transform.start('rotate'); }],
      ['add', '+', 'Add · Shift+A', b => { const r = b.getBoundingClientRect(); this.openAddMenu([r.right + 6, r.top]); }],
      ['delete', '\u00d7', 'Delete · X', b => { const r = b.getBoundingClientRect(); this.confirmDelete([r.right + 30, r.bottom]); }],
    ];
    for (const [id, icon, tip, run] of tools) {
      const b = document.createElement('button');
      b.textContent = icon; b.title = tip; b.setAttribute('aria-label', tip); b.dataset.tool = id;
      b.addEventListener('click', () => run(b));
      bar.appendChild(b);
    }
    // the Add menu (Shift+A)
    const menu = this.addMenu = document.createElement('div');
    menu.className = 'add-menu'; menu.hidden = true; menu.setAttribute('role', 'menu');
    const section = (title, items) => {
      const h = document.createElement('div'); h.className = 'add-title'; h.textContent = title; menu.appendChild(h);
      for (const [label, run] of items) {
        const b = document.createElement('button'); b.textContent = label; b.setAttribute('role', 'menuitem');
        b.addEventListener('click', () => { this.closeAddMenu(); run(); });
        menu.appendChild(b);
      }
    };
    section('Mesh', [['Grid', () => this.addObject('grid')], ['Cube', () => this.addObject('cube')],
      ['Cylinder', () => this.addObject('cylinder')], ['Sphere', () => this.addObject('sphere')]]);
    section('Empty', [['Empty', () => this.addObject('empty')]]);
    section('Procedural', [['Nodes', () => { this.addObject('geometry'); this.nodeEditor.open(); }],
      ['Import STL / OBJ\u2026', () => this.meshFile?.click()]]);
    section('Robot', [['Robot', () => this.addRobot(this.robot.id)]]);
    this.addSearch = attachSearch(menu, 'Search\u2026');
    menu.addEventListener('keydown', e => {
      e.stopPropagation();
      const items = this.addSearch.visible(), i = items.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); this.closeAddMenu(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const down = e.key === 'ArrowDown', next = i < 0 ? (down ? 0 : items.length - 1) : (i + (down ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();   // nothing matches the search: nothing to move to
      }
    });
    this.onOutside = e => { if (!menu.hidden && !menu.contains(e.target)) { this.skipPick = true; this.closeAddMenu(); } };
    window.addEventListener('pointerdown', this.onOutside, true);
    this.root.append(bar, menu);
    this.editorEls = [bar, menu];
    this.nodeEditor = new NodeEditor(this);
    this.gizmo = new NavGizmo(this);
    this.timelineUI = new TimelineUI(this);
    this.timelineUI.render();
    this.buildAreas();
    this.syncPanelButtons();
    this.layoutSides();
    this.onSideResize = () => this.layoutSides();
    window.addEventListener('resize', this.onSideResize);
    this.stage.resize();

    this.objects.sync();
  }

  openAddMenu(at) {
    const menu = this.addMenu; if (!menu) return;
    this.transform?.cancel();
    menu.hidden = false;
    const [x, y] = at || [this.root.clientWidth / 2, this.root.clientHeight / 2];
    menu.style.left = `${Math.max(8, Math.min(x, this.root.clientWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, this.root.clientHeight - menu.offsetHeight - 8))}px`;
    this.addSearch.reset();
  }
  closeAddMenu() { if (this.addMenu) this.addMenu.hidden = true; }

  dispose() {
    if (this.disposed) return; this.disposed = true;
    this.registry?.dispose();
    this.objects?.dispose(); this.editorEls?.forEach(el => el.remove()); this.nodeEditor?.dispose(); this.gizmo?.dispose(); this.timelineUI?.dispose(); window.removeEventListener('resize', this.onSideResize); this.root.removeEventListener('dragover', this.onDragOver); this.root.removeEventListener('drop', this.onDrop); this.areas?.dispose(); this.areaObserver?.disconnect();
    if (this.onPickDown) {
      this.stage.renderer.domElement.removeEventListener('pointerdown', this.onPickDown);
      this.stage.renderer.domElement.removeEventListener('pointerup', this.onPickUp);
      window.removeEventListener('pointermove', this.onPointerTrack);
      window.removeEventListener('pointerdown', this.onOutside, true);
    }
    this.transform?.dispose(); this.loop.dispose();
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('hashchange', this.onHash);
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.group) dispose(this.group);
    for (const view of this.views.values()) view.dispose();
    this.views.clear(); this.assets.dispose();
    this.stage.dispose(); releaseDrawingResources();
    for (const el of [this.hud.el, this.hud.pager, this.panel.el, this.toolbar, this.file, this.message, this.help]) el?.remove();
    this.root.classList.remove('workspace');
  }
}
