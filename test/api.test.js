'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

process.env.UPLOAD_DIR = path.join(os.tmpdir(), `ss-uploads-${process.pid}`);
const { open } = require('../src/db');
const { seed } = require('../src/seed');
const { createApp } = require('../src/app');
const config = require('../src/config');

let server;
let base;
let db;

// Minimal cookie-aware client.
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
}

const MEASUREMENTS = { bust: 34, waist: 30, shoulder: 14, blouseLength: 15, sleeveLength: 10, armhole: 16 };
const ADDRESS = { name: 'Test User', phone: '9876543210', line1: '1 Test Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' };

function inStockSize(productId) {
  const stock = JSON.parse(db.prepare('SELECT stock FROM products WHERE id = ?').get(productId).stock);
  return Object.keys(stock).find((s) => stock[s] > 1);
}

before(async () => {
  db = open(':memory:');
  seed(db);
  server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('catalog lists, filters, sorts and searches products', async () => {
  const api = client();
  const all = await api('GET', '/api/products?limit=60');
  assert.equal(all.status, 200);
  assert.equal(all.data.total, 24);

  const silk = await api('GET', '/api/products?category=silk&sort=price_asc');
  assert.ok(silk.data.products.length > 0);
  assert.ok(silk.data.products.every((p) => p.categorySlug === 'silk'));
  const prices = silk.data.products.map((p) => p.price);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));

  const search = await api('GET', '/api/products?q=mirror');
  assert.ok(search.data.products.some((p) => /mirror/i.test(p.name)));

  const suggest = await api('GET', '/api/search/suggest?q=bridal');
  assert.ok(suggest.data.products.length > 0);

  const detail = await api('GET', `/api/products/${all.data.products[0].slug}`);
  assert.equal(detail.status, 200);
  assert.ok(Array.isArray(detail.data.reviews));
  assert.ok(detail.data.related.length > 0);
});

test('quote prices from the database, applies coupons and custom stitching', async () => {
  const api = client();
  const p = db.prepare("SELECT id, price FROM products WHERE custom_stitching = 1 AND price >= 1999 LIMIT 1").get();
  const q = await api('POST', '/api/cart/quote', {
    items: [{ productId: p.id, size: 'Custom', qty: 1, measurements: MEASUREMENTS, price: 1 }],
    coupon: 'FESTIVE20',
  });
  assert.equal(q.status, 200);
  assert.equal(q.data.subtotal, p.price);
  assert.equal(q.data.stitching, config.store.customStitchingFee);
  assert.equal(q.data.discount, Math.min(800, Math.round(p.price * 0.2)));
  assert.equal(q.data.total, p.price - q.data.discount + q.data.stitching + q.data.shipping);

  const bad = await api('POST', '/api/cart/quote', { items: [{ productId: p.id, size: 'Custom', qty: 1, measurements: { bust: 34 } }] });
  assert.equal(bad.status, 400);

  const coupon = await api('POST', '/api/cart/quote', { items: [{ productId: p.id, size: 'Custom', qty: 1, measurements: MEASUREMENTS }], coupon: 'NOPE' });
  assert.equal(coupon.data.couponError, 'Invalid coupon code.');
});

test('guest checkout decrements stock, pays online, and can be cancelled with restock', async () => {
  const api = client();
  const pid = 2;
  const size = inStockSize(pid);
  const before = JSON.parse(db.prepare('SELECT stock FROM products WHERE id = ?').get(pid).stock)[size];

  const order = await api('POST', '/api/orders', {
    items: [{ productId: pid, size, qty: 2 }], paymentMethod: 'online', address: ADDRESS, email: 'guest@example.com',
  });
  assert.equal(order.status, 201, JSON.stringify(order.data));
  assert.equal(order.data.status, 'placed');
  const after1 = JSON.parse(db.prepare('SELECT stock FROM products WHERE id = ?').get(pid).stock)[size];
  assert.equal(after1, before - 2);

  // Order is private without the token.
  const hidden = await client()('GET', `/api/orders/${order.data.order_number}`);
  assert.equal(hidden.status, 404);

  const paid = await api('POST', `/api/orders/${order.data.order_number}/pay`, { token: order.data.token });
  assert.equal(paid.data.payment_status, 'paid');
  assert.equal(paid.data.status, 'confirmed');

  const tracked = await api('GET', `/api/track?order=${order.data.order_number}&email=guest@example.com`);
  assert.equal(tracked.status, 200);

  const cancelled = await api('POST', `/api/orders/${order.data.order_number}/cancel`, { token: order.data.token });
  assert.equal(cancelled.data.status, 'cancelled');
  assert.equal(cancelled.data.payment_status, 'refund_initiated');
  const after2 = JSON.parse(db.prepare('SELECT stock FROM products WHERE id = ?').get(pid).stock)[size];
  assert.equal(after2, before);

  const invoice = await api('GET', `/invoice/${order.data.order_number}?t=${order.data.token}`);
  assert.equal(invoice.status, 200);
  assert.match(invoice.data, /Tax Invoice/);
});

test('rejects overselling and invalid addresses', async () => {
  const api = client();
  const p = db.prepare('SELECT id, stock FROM products LIMIT 1').get();
  const stock = JSON.parse(p.stock);
  const size = Object.keys(stock).find((s) => stock[s] > 0);
  const over = await api('POST', '/api/cart/quote', { items: [{ productId: p.id, size, qty: 10 }, { productId: p.id, size, qty: 10 }] });
  assert.equal(over.status, 400);

  const badAddr = await api('POST', '/api/orders', {
    items: [{ productId: p.id, size, qty: 1 }], paymentMethod: 'cod', address: { ...ADDRESS, pincode: '12' }, email: 'a@b.co',
  });
  assert.equal(badAddr.status, 400);
});

test('accounts: register, login, wishlist, addresses, reviews', async () => {
  const api = client();
  const reg = await api('POST', '/api/auth/register', { name: 'New Shopper', email: 'new@example.com', password: 'longpassword' });
  assert.equal(reg.status, 201);
  const dupe = await client()('POST', '/api/auth/register', { name: 'X', email: 'NEW@example.com', password: 'longpassword' });
  assert.equal(dupe.status, 409);

  assert.equal((await api('GET', '/api/auth/me')).data.email, 'new@example.com');
  await api('POST', '/api/wishlist/3');
  assert.deepEqual((await api('GET', '/api/wishlist')).data.map((p) => p.id), [3]);

  assert.equal((await api('POST', '/api/addresses', ADDRESS)).status, 201);
  assert.equal((await api('GET', '/api/addresses')).data[0].is_default, 1);

  const review = await api('POST', '/api/products/3/reviews', { rating: 5, title: 'Great', body: 'Lovely blouse, fits well.' });
  assert.equal(review.status, 200);

  await api('POST', '/api/auth/logout');
  const bad = await api('POST', '/api/auth/login', { email: 'new@example.com', password: 'wrong' });
  assert.equal(bad.status, 401);
  const good = await api('POST', '/api/auth/login', { email: 'new@example.com', password: 'longpassword' });
  assert.equal(good.status, 200);
});

test('admin routes require an admin and manage orders, products and coupons', async () => {
  const anon = client();
  assert.equal((await anon('GET', '/api/admin/stats')).status, 401);

  const customer = client();
  await customer('POST', '/api/auth/login', { email: 'priya@example.com', password: 'password123' });
  assert.equal((await customer('GET', '/api/admin/stats')).status, 403);

  const admin = client();
  const login = await admin('POST', '/api/auth/login', { email: config.adminEmail, password: config.adminPassword });
  assert.equal(login.data.role, 'admin');

  const stats = await admin('GET', '/api/admin/stats');
  assert.equal(stats.status, 200);
  assert.ok(stats.data.totals.orders > 0);

  const created = await admin('POST', '/api/admin/products', {
    name: 'Test Blouse', price: 999, mrp: 1299, category_id: 1, stock: { 36: 4 }, images: ['/img/blouse.svg?c=000000', 'javascript:alert(1)'],
  });
  assert.equal(created.status, 201);
  const prod = await anon('GET', `/api/products/${created.data.slug}`);
  assert.equal(prod.data.stock['36'], 4);
  assert.deepEqual(prod.data.images, ['/img/blouse.svg?c=000000']);

  assert.equal((await admin('POST', '/api/admin/coupons', { code: 'test50', type: 'flat', value: 50 })).status, 201);
  const q = await anon('POST', '/api/cart/quote', { items: [{ productId: created.data.id, size: '36', qty: 1 }], coupon: 'TEST50' });
  assert.equal(q.data.discount, 50);

  const orders = await admin('GET', '/api/admin/orders');
  const target = orders.data.find((o) => o.status === 'shipped');
  const upd = await admin('PUT', `/api/admin/orders/${target.order_number}`, { status: 'delivered', tracking_number: 'AWB123' });
  assert.equal(upd.data.status, 'delivered');
  assert.equal(upd.data.tracking_number, 'AWB123');
  assert.equal(upd.data.payment_status, target.payment_method === 'cod' ? 'paid' : target.payment_status);

  const csv = await admin('GET', '/api/admin/orders.csv');
  assert.match(csv.data, /^"Order","Date"/);
});

test('blocks cross-site POSTs', async () => {
  const res = await fetch(`${base}/api/newsletter`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: JSON.stringify({ email: 'x@y.z' }),
  });
  assert.equal(res.status, 403);
});
