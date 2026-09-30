'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const { createStore } = require('./store');
const { AppStore } = require('./apps');
const { Gateway } = require('./gateway');
const { OtpService, OtpError } = require('./otp');
const { createProvider } = require('./providers');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const APK_URL = process.env.GATEWAY_APK_URL ||
  'https://github.com/yasha70/ecommerce/releases/download/otp-gateway-latest/OTPGateway.apk';

/** Builds the request handler used both by the local server (server.js) and Vercel (api/index.js). */
function createHandler({ cfg = config, store = createStore(), now } = {}) {
  const apps = new AppStore(store, cfg.staticApps);
  const gateway = new Gateway({ config: cfg, store, now });
  const otp = new OtpService({ config: cfg, store, gateway, provider: createProvider(cfg.sms, gateway), now });

  const send = (res, status, data, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
    res.end(JSON.stringify(data));
  };

  const readJson = async (req) => {
    // Vercel may already have parsed the body.
    if (req.body !== undefined && req.body !== null) {
      if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
      try { return JSON.parse(String(req.body) || '{}'); } catch { throw new OtpError(400, 'invalid_json', 'Request body must be JSON.'); }
    }
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 20_000) throw new OtpError(413, 'payload_too_large', 'Request body too large.');
      chunks.push(c);
    }
    if (!chunks.length) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new OtpError(400, 'invalid_json', 'Request body must be JSON.'); }
  };

  const clientIp = (req) => (cfg.trustProxy && req.headers['x-forwarded-for']
    ? String(req.headers['x-forwarded-for']).split(',')[0].trim()
    : req.socket?.remoteAddress || 'unknown');

  const limit = async (key, max, windowSec, message = 'Too many requests. Please slow down.') => {
    const n = await store.incr(`rl:${key}`, windowSec);
    if (n > max) {
      throw new OtpError(429, 'rate_limited', message, { retry_after: Math.max(1, await store.ttl(`rl:${key}`)) });
    }
  };

  const bearer = (req) => {
    const h = String(req.headers.authorization || '');
    return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  };

  const secretAuth = async (req) => {
    const app = await apps.bySecretKey(bearer(req) || req.headers.authkey);
    if (!app) throw new OtpError(401, 'unauthorized', 'Missing or invalid API key.');
    return app;
  };

  const widgetAuth = async (req) => {
    const app = await apps.byWidgetKey(req.headers['x-widget-key']);
    if (!app) throw new OtpError(401, 'unauthorized', 'Invalid widget key.');
    if (!apps.originAllowed(app, req.headers.origin)) {
      throw new OtpError(403, 'origin_not_allowed', 'This website is not allowed to use this widget key.');
    }
    return app;
  };

  const adminAuth = async (req, ip) => {
    if (!cfg.adminPassword) throw new OtpError(503, 'admin_disabled', 'Set ADMIN_PASSWORD to use the admin panel.');
    const given = Buffer.from(crypto.createHash('sha256').update(bearer(req)).digest('hex'));
    const want = Buffer.from(crypto.createHash('sha256').update(cfg.adminPassword).digest('hex'));
    if (!crypto.timingSafeEqual(given, want)) {
      await limit(`admin:${ip}`, 10, 900, 'Too many wrong passwords. Wait 15 minutes.');
      throw new OtpError(401, 'unauthorized', 'Wrong admin password.');
    }
  };

  const gatewayAuth = async (req) => {
    const device = await gateway.auth(bearer(req));
    if (!device) throw new OtpError(401, 'unauthorized', 'This phone is not paired. Pair it again from the admin panel.');
    return device;
  };

  const corsHeaders = (req) => ({
    'access-control-allow-origin': req.headers.origin || '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-widget-key',
    'access-control-max-age': '600',
    vary: 'Origin',
  });

  const page = (res, file, type, replacements = {}) => {
    let body = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
    for (const [k, v] of Object.entries(replacements)) body = body.replaceAll(`{{${k}}}`, v);
    res.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'public, max-age=0, must-revalidate' });
    res.end(body);
  };

  const publicApp = ({ secretKeyHash, ...a }) => a;

  // Actions shared by the server API (secret key) and the widget API (widget key).
  const actions = {
    config: async (app) => ({
      name: app.name,
      channels: app.channels,
      missed_call_online: app.channels.includes('missed_call') && !!(await gateway.missedCallNumber()),
    }),
    send: (app, b) => otp.send(app, b.mobile, b.channel),
    resend: (app, b) => otp.resend(app, b.request_id),
    verify: (app, b) => otp.verify(app, b.request_id, b.otp),
    status: (app, b) => otp.status(app, b.request_id),
  };

  const admin = {
    'GET overview': async () => ({
      store: store.kind,
      public_url: cfg.publicUrl,
      sms_provider: cfg.sms.provider,
      apk_url: APK_URL,
      apps: (await apps.list()).map(publicApp),
      devices: await gateway.devices(),
      stats: await gateway.stats(),
    }),
    'POST apps': async (b) => {
      const { app, secretKey } = await apps.create({ name: b.name, allowedOrigins: b.allowed_origins, channels: b.channels });
      return { app: publicApp(app), secret_key: secretKey };
    },
    'POST apps/update': async (b) => {
      const app = await apps.update(b.id, { name: b.name, allowedOrigins: b.allowed_origins, channels: b.channels });
      if (!app) throw new OtpError(404, 'not_found', 'App not found, or it is set in STATIC_APPS and cannot be changed here.');
      return { app: publicApp(app) };
    },
    'POST apps/delete': async (b) => ({ deleted: await apps.remove(b.id) }),
    'POST devices/pair': async (b) => {
      const { device, token } = await gateway.pair(b.name);
      return { device, token, server: cfg.publicUrl };
    },
    'POST devices/unpair': async (b) => ({ deleted: await gateway.unpair(b.id) }),
  };

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname.replace(/\/$/, '') || '/';
    const route = `${req.method} ${p}`;
    const isWidget = p.startsWith('/api/v1/widget/');
    const cors = isWidget ? corsHeaders(req) : {};
    const ip = clientIp(req);

    try {
      if (req.method === 'OPTIONS' && isWidget) { res.writeHead(204, cors); return res.end(); }

      if (route === 'GET /') {
        const demo = await apps.demo(cfg.publicUrl);
        return page(res, 'index.html', 'text/html', { PUBLIC_URL: cfg.publicUrl, WIDGET_KEY: demo.widgetKey });
      }
      if (route === 'GET /widget.js') return page(res, 'widget.js', 'application/javascript', { PUBLIC_URL: cfg.publicUrl });
      if (route === 'GET /admin') return page(res, 'admin.html', 'text/html', { PUBLIC_URL: cfg.publicUrl });
      if (route === 'GET /gateway.apk') { res.writeHead(302, { location: APK_URL }); return res.end(); }
      if (route === 'GET /health') {
        return send(res, 200, {
          ok: true,
          store: store.kind,
          missed_call_online: !!(await gateway.missedCallNumber()),
          sms_online: cfg.sms.provider !== 'phone' || (await gateway.online('sms')).length > 0,
        });
      }

      // Gateway phone. Not IP-limited: it polls continuously.
      const gw = route.match(/^POST \/api\/v1\/gateway\/(poll|report|call)$/);
      if (gw) {
        const device = await gatewayAuth(req);
        const b = await readJson(req);
        if (gw[1] === 'poll') return send(res, 200, await gateway.poll(device, b));
        if (gw[1] === 'report') { await gateway.report(device, b); return send(res, 200, { ok: true }); }
        const matched = await otp.incomingCall(b.from);
        await gateway.countCall(matched);
        return send(res, 200, { ok: true, verified: matched > 0 });
      }

      if (p.startsWith('/api/') || p.startsWith('/demo/')) {
        // Status polling while waiting for a missed call is frequent, so it gets a larger budget.
        const polling = p.endsWith('/status');
        await limit(`ip:${polling ? 'poll:' : ''}${ip}`, cfg.ipRequestsPerMinute * (polling ? 3 : 1), 60);
      }

      const adm = route.match(/^(GET|POST) \/api\/v1\/admin\/(.+)$/);
      if (adm) {
        await adminAuth(req, ip);
        const fn = admin[`${adm[1]} ${adm[2]}`];
        if (!fn) throw new OtpError(404, 'not_found', 'Not found.');
        return send(res, 200, await fn(adm[1] === 'POST' ? await readJson(req) : {}));
      }

      const srv = route.match(/^POST \/api\/v1\/otp\/(config|send|resend|verify|status)$/);
      if (srv) {
        const app = await secretAuth(req);
        return send(res, 200, await actions[srv[1]](app, await readJson(req)));
      }
      if (route === 'POST /api/v1/token/verify') {
        const app = await secretAuth(req);
        return send(res, 200, await otp.verifyToken(app, (await readJson(req)).token));
      }

      const wid = route.match(/^POST \/api\/v1\/widget\/(config|send|resend|verify|status)$/);
      if (wid) {
        const app = await widgetAuth(req);
        return send(res, 200, await actions[wid[1]](app, await readJson(req)), cors);
      }

      // Stands in for a customer's backend so the landing-page demo is end-to-end.
      if (route === 'POST /demo/confirm') {
        const demo = await apps.demo(cfg.publicUrl);
        return send(res, 200, await otp.verifyToken(demo, (await readJson(req)).token));
      }

      send(res, 404, { error: 'not_found', message: 'Not found.' }, cors);
    } catch (err) {
      if (err instanceof OtpError) {
        const headers = { ...cors };
        if (err.extra.retry_after) headers['retry-after'] = String(err.extra.retry_after);
        return send(res, err.status, { error: err.code, message: err.message, ...err.extra }, headers);
      }
      console.error('[server] unexpected error', err);
      send(res, 500, { error: 'internal_error', message: 'Something went wrong. Please try again.' }, cors);
    }
  };
}

module.exports = { createHandler };
