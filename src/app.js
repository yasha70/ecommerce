'use strict';
const path = require('node:path');
const express = require('express');
const config = require('./config');
const { sessionMiddleware } = require('./auth');
const { blouseSvg } = require('./images');
const storeRoutes = require('./routes/store');
const adminRoutes = require('./routes/admin');
const { renderInvoice } = require('./invoice');

function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  app.use(express.json({ limit: '8mb' }));
  app.use(sessionMiddleware(db));

  // Reject cross-site state-changing requests (CSRF defence for cookie sessions).
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    let host = null;
    try { host = origin ? new URL(origin).host : req.headers.host; } catch { /* malformed or "null" origin */ }
    if (host !== req.headers.host) return res.status(403).json({ error: 'Cross-site request blocked.' });
    next();
  });

  app.use('/api/admin', adminRoutes(db));
  app.use('/api', storeRoutes(db));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

  app.get('/img/blouse.svg', (req, res) => {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(blouseSvg(req.query));
  });

  app.get('/invoice/:num', (req, res) => {
    const html = renderInvoice(db, req.params.num, req.user, req.query.t);
    if (!html) return res.status(404).send('Invoice not found.');
    res.type('html').send(html);
  });

  app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d' }));
  app.get('/admin/order-tools', (_req, res) => res.sendFile(path.join(config.publicDir, 'admin', 'order-tools.html')));
  app.use(express.static(config.publicDir, { extensions: ['html'] }));
  app.get('/admin*', (_req, res) => res.sendFile(path.join(config.publicDir, 'admin', 'index.html')));
  // SPA fallback: everything else renders the storefront shell.
  app.get('*', (_req, res) => res.sendFile(path.join(config.publicDir, 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong. Please try again.' : err.message });
  });

  return app;
}

module.exports = { createApp };
