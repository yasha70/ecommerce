'use strict';

const crypto = require('node:crypto');
const { sha256 } = require('./apps');
const { normalizeMobile } = require('./phone');

const ONLINE_MS = 3 * 60 * 1000;

/**
 * Your own Android phone as the SMS/missed-call gateway (instead of a paid SMS company).
 * The gateway app (android-gateway/) pairs with a device token, then:
 *   - polls /api/v1/gateway/poll to pick up SMS to send (and to report that it is online)
 *   - posts /api/v1/gateway/call when someone rings it (missed-call verification)
 *   - posts /api/v1/gateway/report after each SMS is sent or fails
 */
class Gateway {
  constructor({ config, store, now = () => Date.now() }) {
    this.store = store;
    this.now = now;
    this.pollSeconds = config.gateway.pollSeconds;
    this.fixedNumber = config.gateway.missedCallNumber;
    this.defaultCountryCode = config.defaultCountryCode;
  }

  async pair(name) {
    const token = 'gw_' + crypto.randomBytes(24).toString('hex');
    const device = {
      id: 'dev_' + crypto.randomBytes(6).toString('hex'),
      name: String(name || 'Gateway phone').slice(0, 40),
      createdAt: new Date(this.now()).toISOString(),
    };
    await this.store.set(`gwdev:${sha256(token)}`, device);
    await this.store.hset('gwdevices', device.id, { ...device, tokenHash: sha256(token) });
    return { device, token };
  }

  async unpair(id) {
    const d = (await this.store.hgetall('gwdevices'))[id];
    if (!d) return false;
    await this.store.del(`gwdev:${d.tokenHash}`);
    await this.store.hdel('gwdevices', id);
    await this.store.hdel('gwstatus', id);
    return true;
  }

  async auth(token) {
    if (typeof token !== 'string' || !/^gw_[0-9a-f]{48}$/.test(token)) return null;
    return this.store.get(`gwdev:${sha256(token)}`);
  }

  async devices() {
    const [devices, status] = await Promise.all([this.store.hgetall('gwdevices'), this.store.hgetall('gwstatus')]);
    return Object.values(devices).map(({ tokenHash, ...d }) => {
      const s = status[d.id] || {};
      return { ...d, ...s, online: !!s.lastSeen && this.now() - s.lastSeen < ONLINE_MS };
    });
  }

  async online(kind) {
    return (await this.devices()).filter((d) => d.online && d[kind]).sort((a, b) => b.lastSeen - a.lastSeen);
  }

  /** The number customers ring for missed-call verification, or null when no phone is online. */
  async missedCallNumber() {
    const [phone] = await this.online('calls');
    if (!phone) return null;
    const n = normalizeMobile(this.fixedNumber || phone.number || '', this.defaultCountryCode);
    return n ? '+' + n : null;
  }

  async enqueueSms({ to, message, expiresAt }) {
    if (!(await this.online('sms')).length) throw new Error('No gateway phone is online for SMS');
    const id = 'sms_' + crypto.randomBytes(8).toString('hex');
    await this.store.push('smsq', { id, to: '+' + to, message, expiresAt }, { ttl: 3600 });
    return { id };
  }

  async poll(device, info = {}) {
    await this.store.hset('gwstatus', device.id, {
      lastSeen: this.now(),
      number: String(info.number || '').replace(/[^\d+]/g, '').slice(0, 16),
      sms: !!info.sms,
      calls: !!info.calls,
      battery: Number.isFinite(info.battery) ? info.battery : null,
      version: String(info.version || '').slice(0, 20),
    });
    let messages = [];
    if (info.sms) {
      messages = (await this.store.popMany('smsq', 10)).filter((m) => m.expiresAt > this.now());
    }
    return { messages, next_poll: messages.length ? 2 : this.pollSeconds };
  }

  async report(device, { id, ok, error }) {
    const day = new Date(this.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
    await this.store.hincr(`stats:${day}`, ok ? 'sms_sent' : 'sms_failed');
    if (!ok) console.error(`[gateway] ${device.name}: SMS ${id} failed: ${String(error).slice(0, 200)}`);
  }

  async countCall(matched) {
    const day = new Date(this.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
    await this.store.hincr(`stats:${day}`, matched ? 'calls_verified' : 'calls_other');
  }

  async stats() {
    const day = new Date(this.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
    return { day, ...(await this.store.hgetall(`stats:${day}`)), queued: await this.store.len('smsq') };
  }
}

module.exports = { Gateway };
