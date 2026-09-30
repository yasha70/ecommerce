'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { AppStore } = require('./apps');
const { OtpService, OtpError } = require('./otp');
const { RateLimiter } = require('./ratelimit');
const { createProvider } = require('./providers');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function createServer({ cfg = config, apps, otp } = {}) {
  apps = apps || new AppStore(cfg.dataFile);
  otp = otp || new OtpService({ config: cfg, provider: createProvider(cfg.sms) });
  const ipLimiter = new RateLimiter({ limit: cfg.ipRequestsPerMinute, windowMs: 60_000 });

  // A demo app so the landing page works out of the box (not created in production).
  let demoApp = apps.apps.find((a) => a.demo);
  if (!demoApp && process.env.NODE_ENV !== 'production') {
    demoApp = apps.create({ name: 'OTP Demo', allowedOrigins: [cfg.publicUrl] }).app;
    demoApp.demo = true;
    apps.save();
  }

  const sweeper = setInterval(() => { otp.sweep(); ipLimiter.sweep(); }, 60_000);
  sweeper.unref();

  const send = (res, status, data, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
    res.end(JSON.stringify(data));
  };

  const readJson = (req) => new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 10_000) { reject(new OtpError(413, 'payload_too_large', 'Request body too large.')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new OtpError(400, 'invalid_json', 'Request body must be JSON.')); }
    });
    req.on('error', reject);
  });

  const clientIp = (req) => (cfg.trustProxy && req.headers['x-forwarded-for']
    ? req.headers['x-forwarded-for'].split(',')[0].trim()
    : req.socket.remoteAddress);

  const secretAuth = (req) => {
    const h = req.headers.authorization || '';
    const key = h.startsWith('Bearer ') ? h.slice(7).trim() : req.headers.authkey;
    const app = apps.bySecretKey(key);
    if (!app) throw new OtpError(401, 'unauthorized', 'Missing or invalid API key.');
    return app;
  };

  const widgetAuth = (req) => {
    const app = apps.byWidgetKey(req.headers['x-widget-key']);
    if (!app) throw new OtpError(401, 'unauthorized', 'Invalid widget key.');
    if (!apps.originAllowed(app, req.headers.origin)) {
      throw new OtpError(403, 'origin_not_allowed', 'This website is not allowed to use this widget key.');
    }
    return app;
  };

  const corsHeaders = (req) => ({
    'access-control-allow-origin': req.headers.origin || '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-widget-key',
    'access-control-max-age': '600',
    vary: 'Origin',
  });

  const serveStatic = (res, file, type, replacements = {}) => {
    let body = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
    for (const [k, v] of Object.entries(replacements)) body = body.replaceAll(`{{${k}}}`, v);
    res.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-cache' });
    res.end(body);
  };

  // Shared handlers for the server API and the widget API.
  const actions = {
    send: (app, body) => otp.send(app, body.mobile),
    resend: (app, body) => otp.resend(app, body.request_id),
    verify: (app, body) => otp.verify(app, body.request_id, body.otp),
  };

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const route = `${req.method} ${url.pathname}`;
    const isWidget = url.pathname.startsWith('/api/v1/widget/');
    const cors = isWidget ? corsHeaders(req) : {};

    try {
      if (req.method === 'OPTIONS' && isWidget) { res.writeHead(204, cors); return res.end(); }

      if (route === 'GET /') {
        return serveStatic(res, 'index.html', 'text/html', {
          PUBLIC_URL: cfg.publicUrl, WIDGET_KEY: demoApp ? demoApp.widgetKey : '',
        });
      }
      if (route === 'GET /widget.js') {
        return serveStatic(res, 'widget.js', 'application/javascript', { PUBLIC_URL: cfg.publicUrl });
      }
      if (route === 'GET /health') return send(res, 200, { ok: true });

      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/demo/')) {
        const limit = ipLimiter.hit(clientIp(req));
        if (!limit.ok) {
          throw new OtpError(429, 'rate_limited', 'Too many requests.', { retry_after: limit.retryAfter });
        }
      }

      // Server-to-server API (authenticated with the secret key).
      const serverMatch = route.match(/^POST \/api\/v1\/otp\/(send|resend|verify)$/);
      if (serverMatch) {
        const app = secretAuth(req);
        return send(res, 200, await actions[serverMatch[1]](app, await readJson(req)));
      }
      if (route === 'POST /api/v1/token/verify') {
        const app = secretAuth(req);
        const body = await readJson(req);
        return send(res, 200, otp.verifyToken(app, body.token));
      }

      // Browser widget API (public widget key + origin check).
      const widgetMatch = route.match(/^POST \/api\/v1\/widget\/(send|resend|verify)$/);
      if (widgetMatch) {
        const app = widgetAuth(req);
        const result = await actions[widgetMatch[1]](app, await readJson(req));
        return send(res, 200, result, cors);
      }

      // Stand-in for a customer's backend so the landing-page demo is end-to-end.
      if (route === 'POST /demo/confirm' && demoApp) {
        const body = await readJson(req);
        return send(res, 200, otp.verifyToken(demoApp, body.token));
      }

      send(res, 404, { error: 'not_found', message: 'Not found.' }, cors);
    } catch (err) {
      if (err instanceof OtpError) {
        const headers = { ...cors };
        if (err.extra.retry_after) headers['retry-after'] = String(err.extra.retry_after);
        return send(res, err.status, { error: err.code, message: err.message, ...err.extra }, headers);
      }
      console.error('[server] unexpected error', err);
      send(res, 500, { error: 'internal_error', message: 'Something went wrong.' }, cors);
    }
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(config.port, () => {
    console.log(`OTP service listening on ${config.publicUrl} (SMS provider: ${config.sms.provider})`);
  });
}

module.exports = { createServer };
