'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * Registry of client websites ("apps") allowed to use this service.
 * Each app has:
 *   - a secret API key (sk_...) for server-to-server calls; only its hash is stored
 *   - a public widget key (wk_...) for the browser widget, locked to allowed origins
 */
class AppStore {
  constructor(file) {
    this.file = path.resolve(file);
    this.apps = [];
    this.load();
  }

  load() {
    try {
      this.apps = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      this.apps = [];
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.apps, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  /** Creates an app and returns it together with the plaintext secret key (shown once). */
  create({ name, allowedOrigins = [] }) {
    if (!name) throw new Error('name is required');
    const secretKey = 'sk_' + crypto.randomBytes(24).toString('hex');
    const app = {
      id: 'app_' + crypto.randomBytes(8).toString('hex'),
      name,
      secretKeyHash: sha256(secretKey),
      widgetKey: 'wk_' + crypto.randomBytes(12).toString('hex'),
      allowedOrigins: allowedOrigins.map((o) => o.replace(/\/$/, '')),
      createdAt: new Date().toISOString(),
    };
    this.apps.push(app);
    this.save();
    return { app, secretKey };
  }

  bySecretKey(key) {
    if (typeof key !== 'string' || !key.startsWith('sk_')) return null;
    const h = sha256(key);
    return this.apps.find((a) =>
      crypto.timingSafeEqual(Buffer.from(a.secretKeyHash), Buffer.from(h))) || null;
  }

  byWidgetKey(key) {
    return this.apps.find((a) => a.widgetKey === key) || null;
  }

  byId(id) {
    return this.apps.find((a) => a.id === id) || null;
  }

  originAllowed(app, origin) {
    if (!app.allowedOrigins.length) return false;
    if (app.allowedOrigins.includes('*')) return true;
    return !!origin && app.allowedOrigins.includes(origin.replace(/\/$/, ''));
  }
}

module.exports = { AppStore };
