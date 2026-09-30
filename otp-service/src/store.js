'use strict';

/**
 * Key-value storage. Two interchangeable backends with the same async API:
 *   - UpstashStore: Upstash Redis over its REST API (what Vercel's Redis/KV integration gives you).
 *     Used whenever KV_REST_API_URL + KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_*) are set.
 *   - MemoryStore: in-process, for local development and tests.
 * All keys are prefixed with "otp:" so the service can share a database with another app.
 */

const PREFIX = 'otp:';

class UpstashStore {
  constructor(url, token) {
    this.url = url.replace(/\/$/, '');
    this.token = token;
    this.kind = 'redis';
  }

  async call(path, payload, timeoutMs = 10_000) {
    for (let attempt = 0; ; attempt++) {
      let res, data;
      try {
        res = await fetch(this.url + path, {
          method: 'POST',
          headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        });
        data = await res.json().catch(() => ({}));
      } catch (err) {
        if (attempt < 1) continue;
        throw new Error(`Database unreachable: ${err.message}`);
      }
      if (res.status >= 500 && attempt < 1) continue;
      if (!res.ok || data.error) throw new Error(`Database error: ${data.error || res.status}`);
      return data;
    }
  }

  async cmd(...args) { return (await this.call('', args)).result; }

  async get(key) {
    const v = await this.cmd('GET', PREFIX + key);
    return v == null ? null : JSON.parse(v);
  }

  /** Stores JSON. Returns false when `nx` is set and the key already exists. */
  async set(key, value, { ttl, nx } = {}) {
    const args = ['SET', PREFIX + key, JSON.stringify(value)];
    if (ttl) args.push('EX', Math.max(1, Math.ceil(ttl)));
    if (nx) args.push('NX');
    return (await this.cmd(...args)) === 'OK';
  }

  async del(key) { await this.cmd('DEL', PREFIX + key); }

  async ttl(key) { return this.cmd('TTL', PREFIX + key); }

  /** Increments a counter that expires `ttl` seconds after its first increment. */
  async incr(key, ttl) {
    const out = await this.call('/pipeline', [['INCR', PREFIX + key], ['TTL', PREFIX + key]]);
    // Set the expiry whenever it is missing, so a counter can never get stuck without one.
    if (out[1].result < 0) await this.cmd('EXPIRE', PREFIX + key, ttl);
    return out[0].result;
  }

  async push(key, value, { ttl } = {}) {
    const cmds = [['RPUSH', PREFIX + key, JSON.stringify(value)]];
    if (ttl) cmds.push(['EXPIRE', PREFIX + key, ttl]);
    await this.call('/pipeline', cmds);
  }

  async popMany(key, count) {
    const v = await this.cmd('LPOP', PREFIX + key, count);
    return (v || []).map((x) => JSON.parse(x));
  }

  async len(key) { return this.cmd('LLEN', PREFIX + key); }

  async hset(key, field, value) { await this.cmd('HSET', PREFIX + key, field, JSON.stringify(value)); }
  async hdel(key, field) { await this.cmd('HDEL', PREFIX + key, field); }
  async hgetall(key) {
    const flat = (await this.cmd('HGETALL', PREFIX + key)) || [];
    const out = {};
    for (let i = 0; i < flat.length; i += 2) out[flat[i]] = JSON.parse(flat[i + 1]);
    return out;
  }
  async hincr(key, field, by = 1) { return this.cmd('HINCRBY', PREFIX + key, field, by); }
}

class MemoryStore {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.kv = new Map(); // key -> { v, exp }
    this.kind = 'memory';
  }

  live(key) {
    const e = this.kv.get(key);
    if (e && e.exp && e.exp <= this.now()) { this.kv.delete(key); return undefined; }
    return e;
  }

  async get(key) { const e = this.live(key); return e ? structuredClone(e.v) : null; }

  async set(key, value, { ttl, nx } = {}) {
    if (nx && this.live(key)) return false;
    this.kv.set(key, { v: structuredClone(value), exp: ttl ? this.now() + ttl * 1000 : 0 });
    return true;
  }

  async del(key) { this.kv.delete(key); }

  async ttl(key) {
    const e = this.live(key);
    if (!e) return -2;
    return e.exp ? Math.ceil((e.exp - this.now()) / 1000) : -1;
  }

  async incr(key, ttl) {
    const e = this.live(key);
    if (e) { e.v += 1; return e.v; }
    this.kv.set(key, { v: 1, exp: this.now() + ttl * 1000 });
    return 1;
  }

  async push(key, value, { ttl } = {}) {
    const e = this.live(key) || { v: [], exp: 0 };
    e.v.push(structuredClone(value));
    if (ttl) e.exp = this.now() + ttl * 1000;
    this.kv.set(key, e);
  }

  async popMany(key, count) {
    const e = this.live(key);
    return e ? e.v.splice(0, count) : [];
  }

  async len(key) { const e = this.live(key); return e ? e.v.length : 0; }

  hash(key) {
    let e = this.live(key);
    if (!e) { e = { v: {}, exp: 0 }; this.kv.set(key, e); }
    return e.v;
  }
  async hset(key, field, value) { this.hash(key)[field] = structuredClone(value); }
  async hdel(key, field) { delete this.hash(key)[field]; }
  async hgetall(key) { return structuredClone(this.hash(key)); }
  async hincr(key, field, by = 1) { const h = this.hash(key); h[field] = (h[field] || 0) + by; return h[field]; }
}

function createStore() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return new UpstashStore(url, token);
  if (process.env.VERCEL) {
    console.error('[store] No Redis configured: connect a Redis (Upstash) store to this Vercel project.');
  }
  return new MemoryStore();
}

module.exports = { createStore, MemoryStore, UpstashStore };
