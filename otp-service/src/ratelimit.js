'use strict';

/** Sliding-window rate limiter kept in memory. */
class RateLimiter {
  constructor({ limit, windowMs }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map(); // key -> timestamps[]
  }

  /** Records a hit. Returns { ok, retryAfter } where retryAfter is in seconds. */
  hit(key, now = Date.now()) {
    const since = now - this.windowMs;
    const list = (this.hits.get(key) || []).filter((t) => t > since);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      return { ok: false, retryAfter: Math.ceil((list[0] + this.windowMs - now) / 1000) };
    }
    list.push(now);
    this.hits.set(key, list);
    return { ok: true, retryAfter: 0 };
  }

  sweep(now = Date.now()) {
    const since = now - this.windowMs;
    for (const [key, list] of this.hits) {
      const kept = list.filter((t) => t > since);
      if (kept.length) this.hits.set(key, kept);
      else this.hits.delete(key);
    }
  }
}

module.exports = { RateLimiter };
