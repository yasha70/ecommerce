'use strict';
const crypto = require('node:crypto');
const express = require('express');
const config = require('../config');
const { tx } = require('../db');
const { quote, QuoteError, parseProduct, CUSTOM, MEASUREMENT_FIELDS } = require('../pricing');
const payments = require('../payments');
const {
  hashPassword, verifyPassword, setSession, clearSession, requireUser, rateLimit,
} = require('../auth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[6-9]\d{9}$/;
const PIN_RE = /^[1-9]\d{5}$/;

const SORTS = {
  popular: 'p.sold_count DESC, p.rating_avg DESC',
  new: 'p.created_at DESC, p.id DESC',
  price_asc: 'p.price ASC',
  price_desc: 'p.price DESC',
  rating: 'p.rating_avg DESC, p.rating_count DESC',
  discount: '(p.mrp - p.price) * 1.0 / p.mrp DESC',
};

// Pincode zones by first digit (approximate regions of India) for delivery estimates.
const ZONES = {
  1: ['North India', 4], 2: ['North India', 4], 3: ['West India', 4], 4: ['West India', 3],
  5: ['South India', 2], 6: ['South India', 3], 7: ['East India', 5], 8: ['East India', 6], 9: ['Army Postal Service', 8],
};

const CANCELLABLE = ['placed', 'confirmed'];

function orderToken(orderNumber) {
  return crypto.createHmac('sha256', config.sessionSecret).update(`order:${orderNumber}`).digest('base64url').slice(0, 24);
}

function str(v, max = 200) {
  return String(v ?? '').trim().slice(0, max);
}

function validateAddress(a) {
  const addr = {
    name: str(a?.name, 80), phone: str(a?.phone, 15).replace(/\D/g, '').slice(-10),
    line1: str(a?.line1), line2: str(a?.line2), city: str(a?.city, 60),
    state: str(a?.state, 60), pincode: str(a?.pincode, 6),
  };
  if (!addr.name) throw new QuoteError('Please enter the recipient name.');
  if (!PHONE_RE.test(addr.phone)) throw new QuoteError('Please enter a valid 10-digit mobile number.');
  if (!addr.line1 || !addr.city || !addr.state) throw new QuoteError('Please complete the delivery address.');
  if (!PIN_RE.test(addr.pincode)) throw new QuoteError('Please enter a valid 6-digit pincode.');
  return addr;
}

function publicOrder(db, order) {
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id)
    .map((i) => ({ ...i, measurements: i.measurements ? JSON.parse(i.measurements) : null }));
  return {
    ...order,
    address: JSON.parse(order.address),
    history: JSON.parse(order.history),
    items,
    token: orderToken(order.order_number),
    canCancel: CANCELLABLE.includes(order.status),
    canReturn: order.status === 'delivered' && withinReturnWindow(order),
  };
}

function withinReturnWindow(order) {
  const delivered = JSON.parse(order.history).filter((h) => h.status === 'delivered').pop();
  if (!delivered) return false;
  return Date.now() - new Date(delivered.at).getTime() <= config.store.returnDays * 86400000;
}

function pushHistory(order, status, note) {
  const h = JSON.parse(order.history);
  h.push({ status, at: new Date().toISOString(), ...(note ? { note } : {}) });
  return JSON.stringify(h);
}

function restock(db, orderId) {
  const items = db.prepare('SELECT product_id, size, qty FROM order_items WHERE order_id = ?').all(orderId);
  const get = db.prepare('SELECT stock FROM products WHERE id = ?');
  const set = db.prepare('UPDATE products SET stock = ?, sold_count = MAX(0, sold_count - ?) WHERE id = ?');
  for (const it of items) {
    if (it.size === CUSTOM || !it.product_id) continue;
    const row = get.get(it.product_id);
    if (!row) continue;
    const stock = JSON.parse(row.stock);
    stock[it.size] = (stock[it.size] || 0) + it.qty;
    set.run(JSON.stringify(stock), it.qty, it.product_id);
  }
}

function refreshRating(db, productId) {
  db.prepare(`UPDATE products SET
    rating_avg = COALESCE((SELECT ROUND(AVG(rating), 1) FROM reviews WHERE product_id = ? AND approved = 1), 0),
    rating_count = (SELECT COUNT(*) FROM reviews WHERE product_id = ? AND approved = 1)
    WHERE id = ?`).run(productId, productId, productId);
}

function listProducts(db, q) {
  const where = ['p.active = 1'];
  const params = [];
  const multi = (field, value) => {
    const vals = String(value).split(',').map((v) => v.trim()).filter(Boolean);
    if (!vals.length) return;
    where.push(`${field} IN (${vals.map(() => '?').join(',')})`);
    params.push(...vals);
  };
  if (q.category) multi('c.slug', q.category);
  if (q.fabric) multi('p.fabric', q.fabric);
  if (q.sleeve) multi('p.sleeve', q.sleeve);
  if (q.neck) multi('p.neck', q.neck);
  if (q.occasion) multi('p.occasion', q.occasion);
  if (q.work) multi('p.work', q.work);
  if (q.color) multi('p.color', q.color);
  if (q.featured) where.push('p.featured = 1');
  if (q.new) where.push('p.is_new = 1');
  if (q.sale) where.push('p.mrp - p.price >= p.mrp * 0.35');
  if (q.minPrice) { where.push('p.price >= ?'); params.push(Number(q.minPrice) || 0); }
  if (q.maxPrice) { where.push('p.price <= ?'); params.push(Number(q.maxPrice) || 1e9); }
  if (q.rating) { where.push('p.rating_avg >= ?'); params.push(Number(q.rating) || 0); }
  if (q.size) {
    const sizes = String(q.size).split(',').filter((s) => config.store.sizes.includes(s));
    if (sizes.length) where.push(`(${sizes.map(() => "COALESCE(json_extract(p.stock, '$.\"' || ? || '\"'), 0) > 0").join(' OR ')})`);
    params.push(...sizes);
  }
  if (q.ids) {
    const ids = String(q.ids).split(',').map(Number).filter(Boolean).slice(0, 100);
    where.push(`p.id IN (${ids.map(() => '?').join(',') || 'NULL'})`);
    params.push(...ids);
  }
  if (q.q) {
    const terms = str(q.q, 80).toLowerCase().split(/\s+/).filter(Boolean);
    for (const t of terms) {
      where.push("(LOWER(p.name) LIKE ? ESCAPE '\\' OR p.tags LIKE ? ESCAPE '\\' OR LOWER(c.name) LIKE ? ESCAPE '\\')");
      const like = `%${t.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      params.push(like, like, like);
    }
  }
  const sql = `FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) AS n ${sql}`).get(...params).n;
  const limit = Math.max(1, Math.min(60, Number(q.limit) || 12));
  const page = Math.max(1, Number(q.page) || 1);
  const order = SORTS[q.sort] || SORTS.popular;
  const rows = db.prepare(`SELECT p.*, c.slug AS category_slug, c.name AS category_name,
    (SELECT COUNT(*) FROM products v WHERE v.style_code = p.style_code AND v.active = 1) AS variant_count
    ${sql} ORDER BY ${order}, p.id LIMIT ? OFFSET ?`)
    .all(...params, limit, (page - 1) * limit);
  return { products: rows.map(summary), total, page, pages: Math.max(1, Math.ceil(total / limit)), limit };
}

function summary(row) {
  const p = parseProduct(row);
  const inStock = Object.values(p.stock).some((n) => n > 0);
  return {
    id: p.id, slug: p.slug, name: p.name, price: p.price, mrp: p.mrp, images: p.images,
    category: p.category_name, categorySlug: p.category_slug, fabric: p.fabric, color: p.color,
    swatch: p.swatch, styleCode: p.style_code, variantCount: p.variant_count || 1,
    rating: p.rating_avg, ratingCount: p.rating_count, isNew: !!p.is_new, featured: !!p.featured,
    inStock: inStock || !!p.custom_stitching, customStitching: !!p.custom_stitching,
    sizesInStock: Object.keys(p.stock).filter((s) => p.stock[s] > 0),
  };
}

module.exports = function storeRoutes(db) {
  const r = express.Router();
  const authLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 30 });
  const formLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20 });

  // ---------- Store info ----------
  r.get('/config', (_req, res) => {
    res.json({ ...config.store, measurementFields: MEASUREMENT_FIELDS, paymentProvider: payments.providerName() });
  });

  r.get('/categories', (_req, res) => {
    res.json(db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.active = 1) AS count,
      (SELECT images FROM products p WHERE p.category_id = c.id AND p.active = 1 ORDER BY featured DESC, sold_count DESC LIMIT 1) AS images
      FROM categories c ORDER BY c.id`).all()
      .map((c) => ({ ...c, image: c.images ? JSON.parse(c.images)[0] : null, images: undefined })));
  });

  // ---------- Catalog ----------
  r.get('/products', (req, res) => res.json(listProducts(db, req.query)));

  r.get('/products/facets', (_req, res) => {
    const distinct = (col) => db.prepare(`SELECT ${col} AS v, COUNT(*) AS n FROM products WHERE active = 1 AND ${col} IS NOT NULL AND ${col} != '' GROUP BY ${col} ORDER BY n DESC, v`).all();
    const price = db.prepare('SELECT MIN(price) AS min, MAX(price) AS max FROM products WHERE active = 1').get();
    res.json({
      fabric: distinct('fabric'), sleeve: distinct('sleeve'), neck: distinct('neck'),
      occasion: distinct('occasion'), work: distinct('work'), color: distinct('color'),
      sizes: config.store.sizes, price,
    });
  });

  r.get('/search/suggest', (req, res) => {
    const q = str(req.query.q, 60);
    if (q.length < 2) return res.json({ products: [], categories: [] });
    const like = `%${q.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const products = db.prepare(`SELECT id, slug, name, price, images FROM products WHERE active = 1
      AND (LOWER(name) LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\') ORDER BY sold_count DESC LIMIT 6`).all(like, like)
      .map((p) => ({ ...p, image: JSON.parse(p.images)[0], images: undefined }));
    const categories = db.prepare("SELECT slug, name FROM categories WHERE LOWER(name) LIKE ? ESCAPE '\\' LIMIT 3").all(like);
    res.json({ products, categories });
  });

  r.get('/products/:slug', (req, res) => {
    const row = db.prepare(`SELECT p.*, c.slug AS category_slug, c.name AS category_name FROM products p
      LEFT JOIN categories c ON c.id = p.category_id WHERE p.slug = ? AND p.active = 1`).get(req.params.slug);
    if (!row) return res.status(404).json({ error: 'Product not found.' });
    const p = parseProduct(row);
    const reviews = db.prepare(`SELECT r.id, r.rating, r.title, r.body, r.verified, r.created_at, u.name AS author, r.user_id
      FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.product_id = ? AND r.approved = 1 ORDER BY r.created_at DESC`).all(p.id);
    const breakdown = [5, 4, 3, 2, 1].map((star) => ({ star, count: reviews.filter((x) => x.rating === star).length }));
    const related = db.prepare(`SELECT p.*, c.slug AS category_slug, c.name AS category_name FROM products p
      LEFT JOIN categories c ON c.id = p.category_id WHERE p.active = 1 AND p.id != ? AND (p.category_id = ? OR p.occasion = ?)
      ORDER BY (p.category_id = ?) DESC, p.sold_count DESC LIMIT 8`).all(p.id, p.category_id, p.occasion, p.category_id).map(summary);
    const inWishlist = req.user ? !!db.prepare('SELECT 1 FROM wishlist WHERE user_id = ? AND product_id = ?').get(req.user.id, p.id) : false;
    const myReview = req.user ? reviews.find((x) => x.user_id === req.user.id) || null : null;
    const variants = p.style_code
      ? db.prepare('SELECT slug, color, swatch, images, stock FROM products WHERE style_code = ? AND active = 1 ORDER BY id').all(p.style_code)
        .map((v) => ({ slug: v.slug, color: v.color, swatch: v.swatch, image: JSON.parse(v.images)[0], inStock: Object.values(JSON.parse(v.stock)).some((n) => n > 0) }))
      : [];
    res.json({
      ...summary(row), description: p.description, sleeve: p.sleeve, neck: p.neck, occasion: p.occasion, work: p.work,
      stock: p.stock, reviews: reviews.map(({ user_id, ...rest }) => rest), breakdown, related, inWishlist, myReview: !!myReview, variants,
    });
  });

  r.post('/products/:id/reviews', requireUser, (req, res) => {
    const productId = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(productId)) return res.status(404).json({ error: 'Product not found.' });
    const rating = Math.round(Number(req.body.rating));
    if (!(rating >= 1 && rating <= 5)) return res.status(400).json({ error: 'Please choose a rating between 1 and 5 stars.' });
    const body = str(req.body.body, 2000);
    if (body.length < 5) return res.status(400).json({ error: 'Please write a few words about the product.' });
    const verified = db.prepare(`SELECT 1 FROM order_items i JOIN orders o ON o.id = i.order_id
      WHERE o.user_id = ? AND i.product_id = ? AND o.status = 'delivered' LIMIT 1`).get(req.user.id, productId) ? 1 : 0;
    db.prepare(`INSERT INTO reviews (product_id, user_id, rating, title, body, verified) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (product_id, user_id) DO UPDATE SET rating = excluded.rating, title = excluded.title, body = excluded.body,
      verified = excluded.verified, created_at = datetime('now')`).run(productId, req.user.id, rating, str(req.body.title, 120), body, verified);
    refreshRating(db, productId);
    res.json({ ok: true });
  });

  // ---------- Delivery ----------
  r.get('/pincode/:pin', (req, res) => {
    const pin = req.params.pin;
    if (!PIN_RE.test(pin)) return res.status(400).json({ error: 'Please enter a valid 6-digit pincode.' });
    const [region, days] = ZONES[pin[0]];
    const eta = new Date(Date.now() + days * 86400000);
    res.json({ pincode: pin, region, deliverable: true, cod: pin[0] !== '9', days, eta: eta.toISOString() });
  });

  // ---------- Cart & checkout ----------
  r.post('/cart/quote', (req, res) => res.json(quote(db, req.body)));

  r.get('/coupons', (_req, res) => {
    res.json(db.prepare(`SELECT code, description, type, value, min_order, max_discount FROM coupons
      WHERE active = 1 AND (expires_at IS NULL OR expires_at > datetime('now'))
      AND (usage_limit IS NULL OR used_count < usage_limit) ORDER BY min_order`).all());
  });

  r.post('/orders', (req, res) => {
    const paymentMethod = req.body.paymentMethod === 'cod' ? 'cod' : 'online';
    const address = validateAddress(req.body.address);
    const email = str(req.user?.email || req.body.email, 120).toLowerCase();
    if (!EMAIL_RE.test(email)) throw new QuoteError('Please enter a valid email address.');

    const order = tx(db, () => {
      const q = quote(db, { items: req.body.items, coupon: req.body.coupon, paymentMethod });
      if (q.couponError) throw new QuoteError(q.couponError);
      if (q.warnings.length) throw new QuoteError('Some items in your cart changed. Please review your cart.');
      if (paymentMethod === 'cod' && (!q.codAvailable || address.pincode[0] === '9')) throw new QuoteError('Cash on Delivery is not available for this order.');

      const seq = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM orders').get().n;
      const orderNumber = `SS${100300 + seq}${crypto.randomInt(10, 99)}`;
      const history = JSON.stringify([{ status: 'placed', at: new Date().toISOString() }]);
      const id = Number(db.prepare(`INSERT INTO orders (order_number, user_id, email, name, phone, address, subtotal, discount, shipping,
        cod_fee, stitching, total, coupon_code, payment_method, status, history, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'placed', ?, ?)`).run(
        orderNumber, req.user?.id ?? null, email, address.name, address.phone, JSON.stringify(address),
        q.subtotal, q.discount, q.shipping, q.codFee, q.stitching, q.total, q.coupon?.code ?? null, paymentMethod, history,
        str(req.body.notes, 500) || null,
      ).lastInsertRowid);

      const insItem = db.prepare('INSERT INTO order_items (order_id, product_id, name, image, size, price, stitching_fee, qty, measurements) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const getStock = db.prepare('SELECT stock FROM products WHERE id = ?');
      const setStock = db.prepare('UPDATE products SET stock = ?, sold_count = sold_count + ? WHERE id = ?');
      for (const l of q.lines) {
        insItem.run(id, l.productId, l.name, l.image, l.size, l.price, l.stitchingFee, l.qty, l.measurements ? JSON.stringify(l.measurements) : null);
        const stock = JSON.parse(getStock.get(l.productId).stock);
        if (l.size !== CUSTOM) stock[l.size] -= l.qty;
        setStock.run(JSON.stringify(stock), l.qty, l.productId);
      }
      if (q.coupon) db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE code = ?').run(q.coupon.code);
      if (req.user && req.body.saveAddress) {
        const exists = db.prepare('SELECT 1 FROM addresses WHERE user_id = ? AND line1 = ? AND pincode = ?').get(req.user.id, address.line1, address.pincode);
        if (!exists) {
          const first = !db.prepare('SELECT 1 FROM addresses WHERE user_id = ?').get(req.user.id);
          db.prepare('INSERT INTO addresses (user_id, name, phone, line1, line2, city, state, pincode, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(req.user.id, address.name, address.phone, address.line1, address.line2, address.city, address.state, address.pincode, first ? 1 : 0);
        }
      }
      return db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    });
    res.status(201).json(publicOrder(db, order));
  });

  // Loads an order the requester may access: owner, admin, or anyone holding the order token.
  function loadOrder(req, res, next) {
    const order = db.prepare('SELECT * FROM orders WHERE order_number = ?').get(req.params.num);
    const token = req.query.t || req.body?.token;
    const ok = order && ((req.user && (req.user.id === order.user_id || req.user.role === 'admin'))
      || (token && token === orderToken(order.order_number)));
    if (!ok) return res.status(404).json({ error: 'Order not found.' });
    req.order = order;
    next();
  }

  r.get('/orders', requireUser, (req, res) => {
    const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
    res.json(orders.map((o) => publicOrder(db, o)));
  });

  r.get('/orders/:num', loadOrder, (req, res) => res.json(publicOrder(db, req.order)));

  function payable(o) {
    if (o.payment_method !== 'online') throw new QuoteError('This order is Cash on Delivery.');
    if (o.status === 'cancelled') throw new QuoteError('This order was cancelled.');
  }

  function markPaid(o, ref) {
    const fresh = db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id);
    if (fresh.payment_status === 'paid') return;
    db.prepare("UPDATE orders SET payment_status = 'paid', payment_ref = ?, status = CASE WHEN status = 'placed' THEN 'confirmed' ELSE status END, history = ? WHERE id = ?")
      .run(ref, fresh.status === 'placed' ? pushHistory(fresh, 'confirmed', 'Payment received') : fresh.history, o.id);
  }

  // Starts a payment with the active provider (demo or Razorpay).
  r.post('/orders/:num/payment-session', loadOrder, async (req, res, next) => {
    try {
      const o = req.order;
      payable(o);
      if (o.payment_status === 'paid') return res.json({ provider: payments.providerName(), paid: true });
      const session = await payments.provider().createSession(o, config.store);
      if (session.gatewayOrderId) db.prepare('UPDATE orders SET gateway_order_id = ? WHERE id = ?').run(session.gatewayOrderId, o.id);
      res.json({ ...session, gatewayOrderId: undefined, total: o.total, orderNumber: o.order_number });
    } catch (err) { next(err); }
  });

  // Confirms a payment. Demo mode trusts the simulated gateway; Razorpay verifies the payment signature.
  r.post('/orders/:num/pay', loadOrder, (req, res) => {
    const o = req.order;
    payable(o);
    if (o.payment_status !== 'paid') {
      const result = payments.provider().verify(o, req.body);
      if (result.ok) markPaid(o, result.ref);
      else db.prepare("UPDATE orders SET payment_status = 'failed' WHERE id = ?").run(o.id);
    }
    res.json(publicOrder(db, db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id)));
  });

  // Razorpay server-to-server confirmation (Dashboard → Webhooks → payment.captured).
  r.post('/payments/razorpay/webhook', (req, res) => {
    const evt = payments.razorpay.parseWebhook(req.rawBody || '', req.headers['x-razorpay-signature']);
    if (evt) {
      const o = db.prepare('SELECT * FROM orders WHERE order_number = ? OR (gateway_order_id IS NOT NULL AND gateway_order_id = ?)')
        .get(evt.orderNumber || '', evt.gatewayOrderId || '');
      if (o && o.payment_method === 'online') markPaid(o, evt.ref);
    }
    res.json({ ok: true });
  });

  r.post('/orders/:num/cancel', loadOrder, (req, res) => {
    const o = req.order;
    if (!CANCELLABLE.includes(o.status)) return res.status(400).json({ error: 'This order can no longer be cancelled.' });
    tx(db, () => {
      restock(db, o.id);
      const payment = o.payment_status === 'paid' ? 'refund_initiated' : o.payment_status;
      db.prepare("UPDATE orders SET status = 'cancelled', payment_status = ?, history = ? WHERE id = ?")
        .run(payment, pushHistory(o, 'cancelled', str(req.body.reason, 200) || 'Cancelled by customer'), o.id);
    });
    res.json(publicOrder(db, db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id)));
  });

  r.post('/orders/:num/return', loadOrder, (req, res) => {
    const o = req.order;
    if (o.status !== 'delivered' || !withinReturnWindow(o)) {
      return res.status(400).json({ error: `Returns are accepted within ${config.store.returnDays} days of delivery.` });
    }
    const reason = str(req.body.reason, 300);
    if (!reason) return res.status(400).json({ error: 'Please tell us why you are returning this order.' });
    db.prepare("UPDATE orders SET status = 'return_requested', history = ? WHERE id = ?").run(pushHistory(o, 'return_requested', reason), o.id);
    res.json(publicOrder(db, db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id)));
  });

  r.get('/track', (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE order_number = ? AND email = ? COLLATE NOCASE')
      .get(str(req.query.order, 30).toUpperCase(), str(req.query.email, 120));
    if (!order) return res.status(404).json({ error: 'No order found with that order number and email.' });
    res.json(publicOrder(db, order));
  });

  // ---------- Auth & account ----------
  r.post('/auth/register', authLimiter, (req, res) => {
    const name = str(req.body.name, 80);
    const email = str(req.body.email, 120).toLowerCase();
    const phone = str(req.body.phone, 15).replace(/\D/g, '').slice(-10);
    const password = String(req.body.password || '');
    if (!name) return res.status(400).json({ error: 'Please enter your name.' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
    if (phone && !PHONE_RE.test(phone)) return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'An account with this email already exists.' });
    const id = Number(db.prepare('INSERT INTO users (name, email, phone, password_hash) VALUES (?, ?, ?, ?)')
      .run(name, email, phone || null, hashPassword(password)).lastInsertRowid);
    // Link earlier guest orders placed with the same email.
    db.prepare('UPDATE orders SET user_id = ? WHERE user_id IS NULL AND email = ?').run(id, email);
    if (req.body.newsletter) db.prepare('INSERT OR IGNORE INTO newsletter (email) VALUES (?)').run(email);
    setSession(res, id);
    res.status(201).json(db.prepare('SELECT id, name, email, phone, role FROM users WHERE id = ?').get(id));
  });

  r.post('/auth/login', authLimiter, (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(str(req.body.email, 120).toLowerCase());
    if (!user || !verifyPassword(String(req.body.password || ''), user.password_hash)) {
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }
    setSession(res, user.id);
    res.json({ id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role });
  });

  r.post('/auth/logout', (_req, res) => {
    clearSession(res);
    res.json({ ok: true });
  });

  r.get('/auth/me', (req, res) => res.json(req.user || null));

  r.put('/account', requireUser, (req, res) => {
    const name = str(req.body.name, 80);
    const phone = str(req.body.phone, 15).replace(/\D/g, '').slice(-10);
    if (!name) return res.status(400).json({ error: 'Please enter your name.' });
    if (phone && !PHONE_RE.test(phone)) return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
    db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(name, phone || null, req.user.id);
    res.json({ ...req.user, name, phone: phone || null });
  });

  r.put('/account/password', requireUser, (req, res) => {
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(String(req.body.current || ''), row.password_hash)) return res.status(400).json({ error: 'Current password is incorrect.' });
    if (String(req.body.password || '').length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(req.body.password), req.user.id);
    res.json({ ok: true });
  });

  // ---------- Addresses ----------
  r.get('/addresses', requireUser, (req, res) => {
    res.json(db.prepare('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id').all(req.user.id));
  });

  r.post('/addresses', requireUser, (req, res) => {
    const a = validateAddress(req.body);
    const makeDefault = req.body.is_default || !db.prepare('SELECT 1 FROM addresses WHERE user_id = ?').get(req.user.id);
    tx(db, () => {
      if (makeDefault) db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').run(req.user.id);
      db.prepare('INSERT INTO addresses (user_id, name, phone, line1, line2, city, state, pincode, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(req.user.id, a.name, a.phone, a.line1, a.line2, a.city, a.state, a.pincode, makeDefault ? 1 : 0);
    });
    res.status(201).json({ ok: true });
  });

  r.put('/addresses/:id', requireUser, (req, res) => {
    const a = validateAddress(req.body);
    const id = Number(req.params.id);
    tx(db, () => {
      if (req.body.is_default) db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').run(req.user.id);
      db.prepare(`UPDATE addresses SET name = ?, phone = ?, line1 = ?, line2 = ?, city = ?, state = ?, pincode = ?,
        is_default = CASE WHEN ? THEN 1 ELSE is_default END WHERE id = ? AND user_id = ?`)
        .run(a.name, a.phone, a.line1, a.line2, a.city, a.state, a.pincode, req.body.is_default ? 1 : 0, id, req.user.id);
    });
    res.json({ ok: true });
  });

  r.delete('/addresses/:id', requireUser, (req, res) => {
    db.prepare('DELETE FROM addresses WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
    res.json({ ok: true });
  });

  // ---------- Wishlist ----------
  r.get('/wishlist', requireUser, (req, res) => {
    const rows = db.prepare(`SELECT p.*, c.slug AS category_slug, c.name AS category_name FROM wishlist w
      JOIN products p ON p.id = w.product_id LEFT JOIN categories c ON c.id = p.category_id
      WHERE w.user_id = ? AND p.active = 1 ORDER BY w.created_at DESC`).all(req.user.id);
    res.json(rows.map(summary));
  });

  r.post('/wishlist/:productId', requireUser, (req, res) => {
    db.prepare('INSERT OR IGNORE INTO wishlist (user_id, product_id) SELECT ?, id FROM products WHERE id = ?').run(req.user.id, Number(req.params.productId));
    res.json({ ok: true });
  });

  r.delete('/wishlist/:productId', requireUser, (req, res) => {
    db.prepare('DELETE FROM wishlist WHERE user_id = ? AND product_id = ?').run(req.user.id, Number(req.params.productId));
    res.json({ ok: true });
  });

  // ---------- Newsletter & contact ----------
  r.post('/newsletter', formLimiter, (req, res) => {
    const email = str(req.body.email, 120).toLowerCase();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
    db.prepare('INSERT OR IGNORE INTO newsletter (email) VALUES (?)').run(email);
    res.json({ ok: true });
  });

  r.post('/contact', formLimiter, (req, res) => {
    const name = str(req.body.name, 80);
    const email = str(req.body.email, 120);
    const message = str(req.body.message, 3000);
    if (!name || !EMAIL_RE.test(email) || message.length < 5) {
      return res.status(400).json({ error: 'Please fill in your name, a valid email and your message.' });
    }
    db.prepare('INSERT INTO messages (name, email, phone, subject, message) VALUES (?, ?, ?, ?, ?)')
      .run(name, email, str(req.body.phone, 15) || null, str(req.body.subject, 120) || null, message);
    res.status(201).json({ ok: true });
  });

  return r;
};

module.exports.orderToken = orderToken;
module.exports.publicOrder = publicOrder;
module.exports.pushHistory = pushHistory;
module.exports.restock = restock;
module.exports.refreshRating = refreshRating;
module.exports.summary = summary;
