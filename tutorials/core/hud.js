// Slide text on top of the 3D view: kicker, number, title, body, TRY line, and a code card.
//
// Card rows: a string, or a list of [text, tone] parts. Tones: k (ink), g (muted), hl (lime highlight), alert (inverted).

export class Hud {
  constructor(root, deck) {
    this.el = document.createElement('section');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="kicker eyebrow"></div>
      <div class="num label-accent"></div>
      <h1 class="title"></h1>
      <div class="body"></div>
      <div class="try"><b class="label-ink">TRY</b> <span></span></div>
      <div class="card"><div class="card-head"><span class="card-title"></span><button class="card-fold" type="button"></button></div><pre class="card-body"></pre></div>`;
    root.appendChild(this.el);
    this.pager = document.createElement('nav');
    this.pager.className = 'pager';
    this.pager.innerHTML = `<button class="prev" title="Previous (←)">‹</button><span class="count"></span><button class="next" title="Next (→)">›</button><button class="view" title="Reset view (V)">⟲</button>`;
    root.appendChild(this.pager);
    this.deck = deck;
    this.q = s => this.el.querySelector(s);
    // a titled card (the Robot IDE overlay) folds to its title; remembered in this browser
    try { this.folded = localStorage.getItem('animaquina.overlay.folded') !== '0'; } catch { this.folded = true; }   // folded until opened
    this.q('.card-fold').onclick = () => {
      this.folded = !this.folded;
      try { localStorage.setItem('animaquina.overlay.folded', this.folded ? '1' : '0'); } catch { /* private window */ }
      this.foldState();
    };
  }

  foldState() {
    const c = this.q('.card'), b = this.q('.card-fold');
    c.classList.toggle('folded', this.folded);
    b.textContent = this.folded ? '+' : '–';
    b.title = this.folded ? 'Show the overlay' : 'Fold the overlay';
    b.setAttribute('aria-expanded', String(!this.folded));
  }

  show(slide, robot, index, total) {
    const text = v => (typeof v === 'function' ? v(robot) : v || '');
    // the kicker links home (the landing page) and names where you are
    this.q('.kicker').innerHTML = `<a href="${esc(this.deck.home || '../')}">${esc(this.deck.kicker)}</a>&nbsp;·&nbsp;` +
      `${esc(this.deck.title.toUpperCase())}&nbsp;·&nbsp;${esc(`${robot.maker} ${robot.name}`.toUpperCase())}`;
    this.q('.num').textContent = slide.num;
    this.q('.title').textContent = text(slide.title);
    this.q('.body').innerHTML = text(slide.body).split('\n\n').map(p => `<p>${p}</p>`).join('');
    const t = text(slide.try);
    this.q('.try').style.display = t ? '' : 'none';
    this.q('.try span').textContent = t;
    this.card([]);
    this.pager.querySelector('.count').textContent = `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
  }

  /** Card rows (see above). title: a heading with a fold button, so the card can fold to it. */
  card(rows, { title } = {}) {
    const c = this.q('.card');
    c.style.display = rows.length ? '' : 'none';
    c.classList.toggle('titled', !!title);
    this.q('.card-title').textContent = title || '';
    this.q('.card-body').innerHTML = rows.map(r => (typeof r === 'string' ? [[r, 'k']] : r)
      .map(([t, tone]) => `<span class="${tone || 'k'}">${esc(t)}</span>`).join('')).join('\n');
    if (title) this.foldState(); else c.classList.remove('folded');
  }

}

const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
