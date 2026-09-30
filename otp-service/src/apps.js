'use strict';

const crypto = require('node:crypto');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const CHANNELS = ['missed_call', 'sms'];

/**
 * Registry of client websites ("apps") allowed to use this service, kept in the store.
 * Each app has:
 *   - a secret API key (sk_...) for server-to-server calls; only its hash is stored
 *   - a public widget key (wk_...) for the browser widget, locked to allowed origins
 *   - the verification channels it may use (missed_call, sms)
 */
class AppStore {
  /**
   * `staticApps` are websites defined in the STATIC_APPS setting instead of the admin panel:
   *   [{ "id": "app_pakkabill", "name": "Pakka Bill", "secretKeyHash": "<sha256 of sk_...>",
   *      "widgetKey": "wk_...", "allowedOrigins": ["https://..."], "channels": ["missed_call", "sms"] }]
   * They cannot be deleted from the admin panel.
   */
  constructor(store, staticApps = []) {
    this.store = store;
    this.staticApps = (staticApps || []).map((a) => ({
      ...a,
      allowedOrigins: this.cleanOrigins(a.allowedOrigins),
      channels: this.cleanChannels(a.channels),
      createdAt: a.createdAt || '2026-01-01T00:00:00.000Z',
      static: true,
    }));
  }

  cleanOrigins(list) {
    return [...new Set((list || []).map((o) => String(o).trim().replace(/\/$/, '')).filter(Boolean))];
  }

  cleanChannels(list) {
    const c = (list || CHANNELS).filter((x) => CHANNELS.includes(x));
    return c.length ? c : ['missed_call'];
  }

  /** Creates an app and returns it with the plaintext secret key (shown once). */
  async create({ name, allowedOrigins = [], channels, demo = false }) {
    name = String(name || '').trim().slice(0, 60);
    if (!name) throw new Error('name is required');
    const secretKey = 'sk_' + crypto.randomBytes(24).toString('hex');
    const app = {
      id: 'app_' + crypto.randomBytes(8).toString('hex'),
      name,
      secretKeyHash: sha256(secretKey),
      widgetKey: 'wk_' + crypto.randomBytes(12).toString('hex'),
      allowedOrigins: this.cleanOrigins(allowedOrigins),
      channels: this.cleanChannels(channels),
      demo,
      createdAt: new Date().toISOString(),
    };
    await this.store.hset('apps', app.id, app);
    await this.store.set(`appkey:${app.secretKeyHash}`, app.id);
    await this.store.set(`widget:${app.widgetKey}`, app.id);
    return { app, secretKey };
  }

  async update(id, { name, allowedOrigins, channels }) {
    const app = await this.byId(id);
    if (!app || app.static) return null;
    if (name) app.name = String(name).trim().slice(0, 60);
    if (allowedOrigins) app.allowedOrigins = this.cleanOrigins(allowedOrigins);
    if (channels) app.channels = this.cleanChannels(channels);
    await this.store.hset('apps', app.id, app);
    return app;
  }

  async remove(id) {
    const app = await this.byId(id);
    if (!app || app.static) return false;
    await this.store.hdel('apps', id);
    await this.store.del(`appkey:${app.secretKeyHash}`);
    await this.store.del(`widget:${app.widgetKey}`);
    return true;
  }

  async list() {
    return [...this.staticApps, ...Object.values(await this.store.hgetall('apps'))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))];
  }

  async byId(id) {
    if (!id) return null;
    const fixed = this.staticApps.find((a) => a.id === id);
    if (fixed) return fixed;
    const all = await this.store.hgetall('apps');
    return all[id] || null;
  }

  async bySecretKey(key) {
    if (typeof key !== 'string' || !/^sk_[0-9a-f]{48}$/.test(key)) return null;
    const h = sha256(key);
    const fixed = this.staticApps.find((a) => a.secretKeyHash === h);
    return fixed || this.byId(await this.store.get(`appkey:${h}`));
  }

  async byWidgetKey(key) {
    if (typeof key !== 'string' || !/^wk_[0-9a-f]{24}$/.test(key)) return null;
    const fixed = this.staticApps.find((a) => a.widgetKey === key);
    return fixed || this.byId(await this.store.get(`widget:${key}`));
  }

  /** The demo app on the landing page: missed call only, so it can never be used to send SMS. */
  async demo(publicUrl) {
    const existing = (await this.list()).find((a) => a.demo);
    if (existing) {
      if (!existing.allowedOrigins.includes(publicUrl)) {
        return this.update(existing.id, { allowedOrigins: [...existing.allowedOrigins, publicUrl] });
      }
      return existing;
    }
    return (await this.create({ name: 'OTP Verify demo', allowedOrigins: [publicUrl], channels: ['missed_call'], demo: true })).app;
  }

  originAllowed(app, origin) {
    if (app.allowedOrigins.includes('*')) return true;
    return !!origin && app.allowedOrigins.includes(origin.replace(/\/$/, ''));
  }
}

module.exports = { AppStore, CHANNELS, sha256 };
