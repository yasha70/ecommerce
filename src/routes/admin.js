'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const config = require('../config');
const { tx } = require('../db');
const { requireAdmin } = require('../auth');
const { slugify } = require('../seed');
const { publicOrder, pushHistory, restock, refreshRating } = require('./store');

const ORDER_STATUSES = ['placed', 'confirmed', 'packed', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'return_requested', 'returned'];
const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refund_initiated', 'refunded'];
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

function str(v, max = 200) {
  return String(v ?? '').trim().slice(0, max);
}

function badRequest(res, error) {
  return res.status(400).json({ error });
}

function csvCell(v) {
  const s = String(v ?? '');
  // Neutralise spreadsheet formula injection and quote every cell.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

function productInput(body) {
  const name = str(body.name, 150);
  if (!name) throw Object.assign(new Error('Product name is required.'), { status: 400 });
  const price = Math.round(Number(body.price));
  const mrp = Math.round(Number(body.mrp || body.price));
  if (!(price > 0) || !(mrp >= price)) throw Object.assign(new Error('Enter a valid price, and an MRP greater than or equal to the price.'), { status: 400 });
  const stock = {};
  for (const size of config.store.sizes) stock[size] = Math.max(0, Math.floor(Number(body.stock?.[size]) || 0));
  const images = (Array.isArray(body.images) ? body.images : []).map((u) => str(u, 500))
    .filter((u) => u.startsWith('/uploads/') || u.startsWith('/img/') || /^https:\/\//.test(u));
  return {
    name, slug: slugify(body.slug || name), description: str(body.description, 5000),
    category_id: Number(body.category_id) || null, fabric: str(body.fabric, 60), sleeve: str(body.sleeve, 60),
    neck: str(body.neck, 60), occasion: str(body.occasion, 60), work: str(body.work, 60), color: str(body.color, 40),
    swatch: /^#?[0-9a-f]{6}$/i.test(body.swatch || '') ? body.swatch.replace('#', '').toLowerCase() : null,
    style_code: slugify(str(body.style_code, 60)) || null,
    price, mrp, stock: JSON.stringify(stock), images: JSON.stringify(images),
    tags: str(body.tags, 300).toLowerCase(), featured: body.featured ? 1 : 0, is_new: body.is_new ? 1 : 0,
    custom_stitching: body.custom_stitching ? 1 : 0, active: body.active === false ? 0 : 1,
  };
}

module.exports = function adminRoutes(db) {
  const r = express.Router();
  r.use(requireAdmin);

  // ---------- Dashboard ----------
  r.get('/stats', (_req, res) => {
    const valid = "status NOT IN ('cancelled', 'returned')";
    const totals = db.prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue, COALESCE(AVG(total), 0) AS aov
      FROM orders WHERE ${valid}`).get();
    const today = db.prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue FROM orders
      WHERE ${valid} AND date(created_at) = date('now')`).get();
    const customers = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'customer'").get().n;
    const pending = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status IN ('placed', 'confirmed', 'packed')").get().n;
    const returns = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'return_requested'").get().n;
    const byStatus = db.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all();
    const daily = db.prepare(`SELECT date(created_at) AS day, COUNT(*) AS orders, SUM(total) AS revenue FROM orders
      WHERE ${valid} AND created_at >= date('now', '-29 days') GROUP BY day ORDER BY day`).all();
    const topProducts = db.prepare(`SELECT i.product_id, i.name, SUM(i.qty) AS units, SUM(i.qty * (i.price + i.stitching_fee)) AS revenue
      FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.${valid} GROUP BY i.product_id ORDER BY units DESC LIMIT 5`).all();
    const byCategory = db.prepare(`SELECT c.name, SUM(i.qty * i.price) AS revenue FROM order_items i JOIN orders o ON o.id = i.order_id
      JOIN products p ON p.id = i.product_id JOIN categories c ON c.id = p.category_id WHERE o.${valid} GROUP BY c.id ORDER BY revenue DESC`).all();
    const lowStock = [];
    for (const p of db.prepare('SELECT id, name, stock FROM products WHERE active = 1').all()) {
      const stock = JSON.parse(p.stock);
      const low = Object.entries(stock).filter(([, n]) => n <= 2);
      if (low.length) lowStock.push({ id: p.id, name: p.name, sizes: low.map(([s, n]) => `${s}: ${n}`) });
    }
    const recent = db.prepare('SELECT order_number, name, total, status, payment_status, created_at FROM orders ORDER BY id DESC LIMIT 8').all();
    const unreadMessages = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE handled = 0').get().n;
    res.json({ totals, today, customers, pending, returns, byStatus, daily, topProducts, byCategory, lowStock: lowStock.slice(0, 12), recent, unreadMessages });
  });

  // ---------- Uploads ----------
  r.post('/upload', (req, res) => {
    const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(String(req.body.dataUrl || ''));
    if (!m || !IMAGE_TYPES[m[1]]) return badRequest(res, 'Please upload a PNG, JPG, WEBP or GIF image.');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 5 * 1024 * 1024) return badRequest(res, 'Images must be smaller than 5 MB.');
    fs.mkdirSync(config.uploadDir, { recursive: true });
    const file = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${IMAGE_TYPES[m[1]]}`;
    fs.writeFileSync(path.join(config.uploadDir, file), buf);
    res.status(201).json({ url: `/uploads/${file}` });
  });

  // ---------- Products ----------
  r.get('/products', (req, res) => {
    const q = `%${str(req.query.q, 80).toLowerCase()}%`;
    const rows = db.prepare(`SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE LOWER(p.name) LIKE ? ORDER BY p.id DESC`).all(q);
    res.json(rows.map((p) => ({ ...p, stock: JSON.parse(p.stock), images: JSON.parse(p.images) })));
  });

  r.post('/products', (req, res) => {
    const p = productInput(req.body);
    if (db.prepare('SELECT 1 FROM products WHERE slug = ?').get(p.slug)) p.slug = `${p.slug}-${Date.now().toString(36)}`;
    const cols = Object.keys(p);
    const id = db.prepare(`INSERT INTO products (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...Object.values(p)).lastInsertRowid;
    res.status(201).json({ id: Number(id), slug: p.slug });
  });

  r.put('/products/:id', (req, res) => {
    const id = Number(req.params.id);
    const p = productInput(req.body);
    if (db.prepare('SELECT 1 FROM products WHERE slug = ? AND id != ?').get(p.slug, id)) return badRequest(res, 'Another product already uses this URL slug.');
    const cols = Object.keys(p);
    const result = db.prepare(`UPDATE products SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(p), id);
    if (!result.changes) return res.status(404).json({ error: 'Product not found.' });
    res.json({ id, slug: p.slug });
  });

  r.delete('/products/:id', (req, res) => {
    const id = Number(req.params.id);
    const ordered = db.prepare('SELECT 1 FROM order_items WHERE product_id = ? LIMIT 1').get(id);
    // Products with order history are archived so old orders keep their links.
    if (ordered) db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(id);
    else db.prepare('DELETE FROM products WHERE id = ?').run(id);
    res.json({ ok: true, archived: !!ordered });
  });

  // ---------- Categories ----------
  r.get('/categories', (_req, res) => {
    res.json(db.prepare('SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS count FROM categories c ORDER BY c.id').all());
  });

  r.post('/categories', (req, res) => {
    const name = str(req.body.name, 80);
    if (!name) return badRequest(res, 'Category name is required.');
    const slug = slugify(req.body.slug || name);
    if (db.prepare('SELECT 1 FROM categories WHERE slug = ?').get(slug)) return badRequest(res, 'A category with this slug already exists.');
    db.prepare('INSERT INTO categories (slug, name, description, color) VALUES (?, ?, ?, ?)')
      .run(slug, name, str(req.body.description, 300), /^[0-9a-f]{6}$/i.test(req.body.color) ? req.body.color : '7a1f2b');
    res.status(201).json({ ok: true });
  });

  r.put('/categories/:id', (req, res) => {
    const name = str(req.body.name, 80);
    if (!name) return badRequest(res, 'Category name is required.');
    db.prepare('UPDATE categories SET name = ?, description = ?, color = COALESCE(?, color) WHERE id = ?')
      .run(name, str(req.body.description, 300), /^[0-9a-f]{6}$/i.test(req.body.color) ? req.body.color : null, Number(req.params.id));
    res.json({ ok: true });
  });

  r.delete('/categories/:id', (req, res) => {
    const id = Number(req.params.id);
    if (db.prepare('SELECT 1 FROM products WHERE category_id = ?').get(id)) return badRequest(res, 'Move or delete the products in this category first.');
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  // ---------- Orders ----------
  function orderFilter(query) {
    const where = [];
    const params = [];
    if (ORDER_STATUSES.includes(query.status)) { where.push('status = ?'); params.push(query.status); }
    if (PAYMENT_STATUSES.includes(query.payment)) { where.push('payment_status = ?'); params.push(query.payment); }
    if (query.q) {
      where.push('(order_number LIKE ? OR name LIKE ? OR email LIKE ? OR phone LIKE ?)');
      const like = `%${str(query.q, 80)}%`;
      params.push(like, like, like, like);
    }
    return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
  }

  r.get('/orders', (req, res) => {
    const { sql, params } = orderFilter(req.query);
    res.json(db.prepare(`SELECT o.*, (SELECT SUM(qty) FROM order_items WHERE order_id = o.id) AS units FROM orders o ${sql} ORDER BY id DESC LIMIT 500`)
      .all(...params).map((o) => ({ ...o, address: JSON.parse(o.address), history: undefined })));
  });

  r.get('/orders.csv', (req, res) => {
    const { sql, params } = orderFilter(req.query);
    const rows = db.prepare(`SELECT o.*, GROUP_CONCAT(i.name || ' [' || i.size || '] x' || i.qty, '; ') AS items
      FROM orders o LEFT JOIN order_items i ON i.order_id = o.id ${sql.replace(/\b(status|payment_status|order_number|name|email|phone)\b/g, 'o.$1')}
      GROUP BY o.id ORDER BY o.id DESC`).all(...params);
    const header = ['Order', 'Date', 'Customer', 'Email', 'Phone', 'City', 'Pincode', 'Items', 'Subtotal', 'Discount', 'Stitching', 'Shipping', 'COD Fee', 'Total', 'Payment', 'Payment Status', 'Status', 'Tracking'];
    const lines = rows.map((o) => {
      const a = JSON.parse(o.address);
      return [o.order_number, o.created_at, o.name, o.email, o.phone, a.city, a.pincode, o.items, o.subtotal, o.discount, o.stitching,
        o.shipping, o.cod_fee, o.total, o.payment_method, o.payment_status, o.status, o.tracking_number].map(csvCell).join(',');
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send([header.map(csvCell).join(','), ...lines].join('\n'));
  });

  r.get('/orders/:num', (req, res) => {
    const o = db.prepare('SELECT * FROM orders WHERE order_number = ?').get(req.params.num);
    if (!o) return res.status(404).json({ error: 'Order not found.' });
    res.json(publicOrder(db, o));
  });

  r.put('/orders/:num', (req, res) => {
    const o = db.prepare('SELECT * FROM orders WHERE order_number = ?').get(req.params.num);
    if (!o) return res.status(404).json({ error: 'Order not found.' });
    const status = req.body.status ?? o.status;
    const payment = req.body.payment_status ?? o.payment_status;
    if (!ORDER_STATUSES.includes(status)) return badRequest(res, 'Unknown order status.');
    if (!PAYMENT_STATUSES.includes(payment)) return badRequest(res, 'Unknown payment status.');
    if (o.status === 'cancelled' && status !== 'cancelled') return badRequest(res, 'Cancelled orders cannot be reopened.');
    tx(db, () => {
      let history = o.history;
      if (status !== o.status) {
        history = pushHistory(o, status, str(req.body.note, 200) || undefined);
        // Put stock back when an order is cancelled or a return is received.
        if (status === 'cancelled' || (status === 'returned' && o.status !== 'returned')) restock(db, o.id);
      }
      const autoPaid = status === 'delivered' && o.payment_method === 'cod' ? 'paid' : payment;
      db.prepare('UPDATE orders SET status = ?, payment_status = ?, tracking_number = ?, notes = ?, history = ? WHERE id = ?').run(
        status, autoPaid, req.body.tracking_number !== undefined ? str(req.body.tracking_number, 60) || null : o.tracking_number,
        req.body.notes !== undefined ? str(req.body.notes, 1000) || null : o.notes, history, o.id,
      );
    });
    res.json(publicOrder(db, db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id)));
  });

  // ---------- Coupons ----------
  r.get('/coupons', (_req, res) => res.json(db.prepare('SELECT * FROM coupons ORDER BY code').all()));

  r.post('/coupons', (req, res) => {
    const code = str(req.body.code, 30).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const type = req.body.type === 'flat' ? 'flat' : 'percent';
    const value = Math.round(Number(req.body.value));
    if (!code) return badRequest(res, 'Coupon code is required.');
    if (!(value > 0) || (type === 'percent' && value > 90)) return badRequest(res, 'Enter a valid discount value (percent coupons max 90%).');
    const num = (v) => (v === '' || v == null ? null : Math.max(0, Math.round(Number(v)) || 0));
    db.prepare(`INSERT INTO coupons (code, description, type, value, min_order, max_discount, usage_limit, expires_at, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (code) DO UPDATE SET description = excluded.description, type = excluded.type, value = excluded.value,
      min_order = excluded.min_order, max_discount = excluded.max_discount, usage_limit = excluded.usage_limit,
      expires_at = excluded.expires_at, active = excluded.active`)
      .run(code, str(req.body.description, 200), type, value, num(req.body.min_order) || 0, num(req.body.max_discount),
        num(req.body.usage_limit), str(req.body.expires_at, 30) || null, req.body.active === false ? 0 : 1);
    res.status(201).json({ ok: true });
  });

  r.delete('/coupons/:code', (req, res) => {
    db.prepare('DELETE FROM coupons WHERE code = ?').run(req.params.code);
    res.json({ ok: true });
  });

  // ---------- Customers ----------
  r.get('/customers', (req, res) => {
    const like = `%${str(req.query.q, 80)}%`;
    res.json(db.prepare(`SELECT u.id, u.name, u.email, u.phone, u.role, u.created_at,
      (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS orders,
      (SELECT COALESCE(SUM(total), 0) FROM orders o WHERE o.user_id = u.id AND o.status NOT IN ('cancelled', 'returned')) AS spent
      FROM users u WHERE u.name LIKE ? OR u.email LIKE ? ORDER BY u.id DESC`).all(like, like));
  });

  // ---------- Reviews ----------
  r.get('/reviews', (_req, res) => {
    res.json(db.prepare(`SELECT r.*, u.name AS author, p.name AS product, p.slug FROM reviews r
      JOIN users u ON u.id = r.user_id JOIN products p ON p.id = r.product_id ORDER BY r.created_at DESC LIMIT 300`).all());
  });

  r.put('/reviews/:id', (req, res) => {
    const review = db.prepare('SELECT product_id FROM reviews WHERE id = ?').get(Number(req.params.id));
    if (!review) return res.status(404).json({ error: 'Review not found.' });
    db.prepare('UPDATE reviews SET approved = ? WHERE id = ?').run(req.body.approved ? 1 : 0, Number(req.params.id));
    refreshRating(db, review.product_id);
    res.json({ ok: true });
  });

  r.delete('/reviews/:id', (req, res) => {
    const review = db.prepare('SELECT product_id FROM reviews WHERE id = ?').get(Number(req.params.id));
    if (!review) return res.status(404).json({ error: 'Review not found.' });
    db.prepare('DELETE FROM reviews WHERE id = ?').run(Number(req.params.id));
    refreshRating(db, review.product_id);
    res.json({ ok: true });
  });

  // ---------- Messages & newsletter ----------
  r.get('/messages', (_req, res) => res.json(db.prepare('SELECT * FROM messages ORDER BY handled, id DESC').all()));

  r.put('/messages/:id', (req, res) => {
    db.prepare('UPDATE messages SET handled = ? WHERE id = ?').run(req.body.handled ? 1 : 0, Number(req.params.id));
    res.json({ ok: true });
  });

  r.get('/newsletter', (_req, res) => res.json(db.prepare('SELECT * FROM newsletter ORDER BY created_at DESC').all()));

  return r;
};

module.exports.ORDER_STATUSES = ORDER_STATUSES;
