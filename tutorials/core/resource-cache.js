// Ref-counted async assets. Retain only a small number of unused models; failed requests are retryable.
export class ResourceCache {
  constructor(load, dispose, maxUnused = 1) {
    this.load = load; this.releaseValue = dispose; this.maxUnused = maxUnused; this.entries = new Map();
  }
  acquire(key) {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { refs: 0, settled: false, value: null };
      entry.promise = Promise.resolve().then(() => this.load(key)).then(value => {
        entry.settled = true; entry.value = value; this.trim(); return value;
      }, error => {
        entry.settled = true;
        if (this.entries.get(key) === entry) this.entries.delete(key);
        throw error;
      });
      this.entries.set(key, entry);
    }
    entry.refs++;
    this.entries.delete(key); this.entries.set(key, entry);
    let released = false;
    return { promise: entry.promise, release: () => {
      if (released) return; released = true; entry.refs--; this.trim();
    } };
  }
  trim() {
    const unused = [...this.entries].filter(([, e]) => !e.refs && e.settled);
    for (const [key, entry] of unused.slice(0, Math.max(0, unused.length - this.maxUnused))) {
      this.entries.delete(key); if (entry.value) this.releaseValue(entry.value);
    }
  }
  clearUnused() { const keep = this.maxUnused; this.maxUnused = 0; this.trim(); this.maxUnused = keep; }
  close() { this.maxUnused = 0; this.trim(); }
}
