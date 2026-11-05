// Demand-driven scheduling with an explicit animation predicate. No idle RAF polling.
export class RenderLoop {
  // The defaults are wrapped: browsers throw "Illegal invocation" if requestAnimationFrame is called as this.request().
  constructor(frame, { request = cb => requestAnimationFrame(cb), cancel = id => cancelAnimationFrame(id) } = {}) {
    this.frame = frame; this.request = request; this.cancel = cancel;
    this.id = null; this.stopped = false;
  }
  invalidate = () => {
    if (this.stopped || this.id !== null) return;
    this.id = this.request(time => {
      this.id = null;
      if (!this.stopped && this.frame(time)) this.invalidate();
    });
  };
  suspend() { if (this.id !== null) this.cancel(this.id); this.id = null; }
  dispose() { this.suspend(); this.stopped = true; }
}
