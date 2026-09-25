'use strict';
const fs = require('node:fs');
const { hashPassword } = require('./auth');
const { blouseImageSet } = require('./images');
const config = require('./config');
const { tx } = require('./db');

const CATEGORIES = [
  ['silk', 'Silk Blouses', 'Pure & art silk blouses with rich zari borders.', 'a6432f'],
  ['designer', 'Designer & Embroidered', 'Hand-embroidered, mirror & aari work statement pieces.', '6b2e5f'],
  ['cotton', 'Cotton & Daily Wear', 'Breathable cotton blouses for everyday comfort.', '3c5a44'],
  ['bridal', 'Bridal Collection', 'Heavy maggam & zardosi blouses for the big day.', 'b6862c'],
  ['party', 'Party Wear', 'Sequinned and velvet blouses that shine after dark.', '1f3b63'],
  ['readymade', 'Readymade Stretch', 'Ready-to-wear stretchable blouses that fit sizes 32–40.', 'c2577a'],
];

// [name, category, fabric, sleeve, neck, occasion, work, colorName, base, accent, pattern, price, mrp, flags]
const PRODUCTS = [
  ['Kanjivaram Zari Border Silk Blouse', 'silk', 'Pure Silk', 'elbow', 'round', 'Festive', 'Zari', 'Maroon', '7a1f2b', 'd9b35b', 'zari', 1899, 2799, 'featured'],
  ['Mustard Banarasi Brocade Blouse', 'silk', 'Banarasi Silk', 'short', 'boat', 'Wedding', 'Brocade', 'Mustard', 'c9962b', '7a1f2b', 'paisley', 1599, 2299, 'featured,new'],
  ['Emerald Raw Silk Princess-Cut Blouse', 'silk', 'Raw Silk', 'elbow', 'sweetheart', 'Festive', 'Piping', 'Green', '1f6b4f', 'e0c070', 'plain', 1299, 1899, ''],
  ['Peacock Blue Tussar Silk Blouse', 'silk', 'Tussar Silk', 'short', 'v', 'Party', 'Zari', 'Blue', '1b5e7a', 'e3c36e', 'stripes', 1449, 1999, 'new'],
  ['Rani Pink Art Silk Blouse', 'silk', 'Art Silk', 'cap', 'round', 'Festive', 'Plain', 'Pink', 'c2185b', 'f1d08a', 'plain', 699, 1099, ''],
  ['Mirror Work Navratri Blouse', 'designer', 'Cotton Silk', 'short', 'v', 'Festive', 'Mirror', 'Black', '222222', 'e04a3a', 'mirror', 1399, 1999, 'featured'],
  ['Aari Embroidered Lavender Blouse', 'designer', 'Georgette', 'elbow', 'high', 'Party', 'Aari', 'Purple', '8e6bb5', 'f5e1a4', 'floral', 1799, 2599, 'new'],
  ['Hand-Embroidered Floral Ivory Blouse', 'designer', 'Chanderi', 'puff', 'square', 'Wedding', 'Thread', 'Ivory', 'efe4cf', 'c2577a', 'floral', 1999, 2899, 'featured'],
  ['Kutch Work Boho Blouse', 'designer', 'Cotton', 'short', 'round', 'Casual', 'Kutch', 'Indigo', '2b3a67', 'e8a33d', 'mirror', 1099, 1599, ''],
  ['Wine Velvet Zardosi Blouse', 'designer', 'Velvet', 'long', 'boat', 'Wedding', 'Zardosi', 'Wine', '5a1a2a', 'd9b35b', 'zari', 2499, 3499, ''],
  ['Ajrakh Print Cotton Blouse', 'cotton', 'Cotton', 'elbow', 'round', 'Office', 'Block Print', 'Indigo', '23345c', 'b5452f', 'paisley', 549, 899, 'new'],
  ['Kalamkari Cotton Blouse', 'cotton', 'Cotton', 'short', 'v', 'Casual', 'Kalamkari', 'Rust', 'a6432f', '2b2b2b', 'paisley', 499, 799, 'featured'],
  ['Polka Dot Daily Wear Blouse', 'cotton', 'Cotton', 'short', 'round', 'Casual', 'Printed', 'Black', '1d1d1d', 'f4f1ea', 'dots', 399, 649, ''],
  ['Ikat Handloom Blouse', 'cotton', 'Handloom Cotton', 'elbow', 'boat', 'Office', 'Ikat', 'Red', 'b3261e', '1d1d1d', 'stripes', 649, 999, ''],
  ['Mint Linen Sleeveless Blouse', 'cotton', 'Linen', 'sleeveless', 'high', 'Casual', 'Plain', 'Green', '9ccfb5', 'ffffff', 'plain', 599, 899, 'new'],
  ['Heavy Maggam Bridal Blouse', 'bridal', 'Raw Silk', 'elbow', 'sweetheart', 'Wedding', 'Maggam', 'Red', 'a3121f', 'e6c15a', 'zari', 3999, 5499, 'featured'],
  ['Gold Tissue Bridal Blouse', 'bridal', 'Tissue Silk', 'long', 'boat', 'Wedding', 'Zardosi', 'Gold', 'c7a34b', '7a1f2b', 'zari', 3499, 4799, ''],
  ['Pearl Embellished Reception Blouse', 'bridal', 'Net', 'puff', 'sweetheart', 'Wedding', 'Pearl', 'Pink', 'e8b4bc', 'ffffff', 'dots', 2999, 4199, 'new'],
  ['Sequin Cocktail Blouse', 'party', 'Georgette', 'sleeveless', 'v', 'Party', 'Sequin', 'Silver', '8a8d93', 'ffffff', 'dots', 1299, 1899, 'featured'],
  ['Midnight Velvet Party Blouse', 'party', 'Velvet', 'long', 'square', 'Party', 'Plain', 'Navy', '16244a', 'c0c6d6', 'plain', 1199, 1699, ''],
  ['Metallic Halter-Style Blouse', 'party', 'Lycra', 'sleeveless', 'high', 'Party', 'Foil', 'Gold', 'b8923a', '2b2b2b', 'stripes', 999, 1499, 'new'],
  ['Black Stretch Readymade Blouse', 'readymade', 'Lycra Cotton', 'short', 'round', 'Casual', 'Plain', 'Black', '1b1b1b', '444444', 'plain', 349, 599, 'featured'],
  ['Beige Stretch Readymade Blouse', 'readymade', 'Lycra Cotton', 'elbow', 'round', 'Office', 'Plain', 'Beige', 'd8c3a5', 'a88c63', 'plain', 349, 599, ''],
  ['Red Stretch Readymade Blouse', 'readymade', 'Lycra Cotton', 'short', 'v', 'Festive', 'Plain', 'Red', 'c0272d', '7a1f2b', 'plain', 349, 599, ''],
];

const SLEEVE_LABEL = { sleeveless: 'Sleeveless', cap: 'Cap Sleeve', short: 'Short Sleeve', elbow: 'Elbow Sleeve', long: 'Full Sleeve', puff: 'Puff Sleeve' };
const NECK_LABEL = { round: 'Round Neck', v: 'V Neck', boat: 'Boat Neck', sweetheart: 'Sweetheart Neck', high: 'High Neck', square: 'Square Neck' };

const COUPONS = [
  ['WELCOME10', '10% off orders above ₹499 (max ₹300)', 'percent', 10, 499, 300, null],
  ['FESTIVE20', '20% off orders above ₹1,999 (max ₹800)', 'percent', 20, 1999, 800, null],
  ['FLAT150', '₹150 off orders above ₹999', 'flat', 150, 999, null, null],
];

const REVIEWS = [
  [5, 'Absolutely gorgeous', 'The fabric quality is excellent and the fit is perfect. Got so many compliments!'],
  [4, 'Beautiful work', 'Lovely embroidery, colour is slightly darker than the picture but still very pretty.'],
  [5, 'Perfect fit with custom stitching', 'I gave my measurements and it fits like it was made by my own tailor.'],
  [4, 'Great value', 'Good finishing, quick delivery. Will order again.'],
  [3, 'Nice but runs small', 'Pretty blouse but I would suggest ordering one size up.'],
];

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function seed(db, { demo = true } = {}) {
  const hasProducts = db.prepare('SELECT COUNT(*) AS n FROM products').get().n > 0;

  tx(db, () => {
    const admin = db.prepare('SELECT id FROM users WHERE email = ?').get(config.adminEmail);
    if (!admin) {
      db.prepare('INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)')
        .run('Store Admin', config.adminEmail, config.store.phone, hashPassword(config.adminPassword), 'admin');
    }
    if (hasProducts) return;

    const insCat = db.prepare('INSERT INTO categories (slug, name, description, color) VALUES (?, ?, ?, ?)');
    const catIds = {};
    for (const [slug, name, desc, color] of CATEGORIES) {
      catIds[slug] = Number(insCat.run(slug, name, desc, color).lastInsertRowid);
    }

    const insProd = db.prepare(`INSERT INTO products
      (slug, name, description, category_id, fabric, sleeve, neck, occasion, work, color, price, mrp, stock, images, tags, featured, is_new, custom_stitching, sold_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    PRODUCTS.forEach((p, i) => {
      const [name, cat, fabric, sleeve, neck, occasion, work, colorName, base, accent, pattern, price, mrp, flags] = p;
      const stock = {};
      config.store.sizes.forEach((s, j) => { stock[s] = (i * 7 + j * 3) % 11 === 0 ? 0 : 3 + ((i + j * 5) % 14); });
      const description = `A ${fabric.toLowerCase()} blouse in ${colorName.toLowerCase()} with ${work.toLowerCase()} detailing, `
        + `${SLEEVE_LABEL[sleeve].toLowerCase()} and a ${NECK_LABEL[neck].toLowerCase()}. `
        + `Fully lined with a soft cotton inner, back hooks and 1.5" margin at the side seams so it can be altered easily. `
        + `Pairs beautifully with ${cat === 'bridal' ? 'bridal silk and lehenga' : 'silk, georgette and cotton'} sarees.`;
      insProd.run(
        slugify(name), name, description, catIds[cat], fabric, SLEEVE_LABEL[sleeve], NECK_LABEL[neck], occasion, work, colorName,
        price, mrp, JSON.stringify(stock), JSON.stringify(blouseImageSet({ c: base, a: accent, s: sleeve, n: neck, p: pattern })),
        `${fabric} ${work} ${colorName} ${occasion}`.toLowerCase(),
        flags.includes('featured') ? 1 : 0, flags.includes('new') ? 1 : 0, cat === 'readymade' ? 0 : 1, (i * 37) % 120,
      );
    });

    const insCoupon = db.prepare('INSERT INTO coupons (code, description, type, value, min_order, max_discount, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const c of COUPONS) insCoupon.run(...c);

    if (!demo) return;

    // Demo customers + reviews so ratings and the admin dashboard aren't empty.
    const insUser = db.prepare('INSERT INTO users (name, email, phone, password_hash) VALUES (?, ?, ?, ?)');
    const customers = ['Priya Sharma', 'Ananya Iyer', 'Meera Nair', 'Kavya Reddy', 'Sneha Patil'].map((name, i) =>
      Number(insUser.run(name, `${slugify(name.split(' ')[0])}@example.com`, `98${String(10000000 + i * 1234567).slice(0, 8)}`, hashPassword('password123')).lastInsertRowid));

    const insReview = db.prepare('INSERT INTO reviews (product_id, user_id, rating, title, body, verified, created_at) VALUES (?, ?, ?, ?, ?, 1, datetime(\'now\', ?))');
    const products = db.prepare('SELECT id, name, price, images FROM products').all();
    products.forEach((p, i) => {
      const n = 1 + (i % 4);
      for (let k = 0; k < n; k++) {
        const [rating, title, body] = REVIEWS[(i + k) % REVIEWS.length];
        insReview.run(p.id, customers[(i + k) % customers.length], rating, title, body, `-${(i + k * 3) % 40} days`);
      }
    });
    db.exec(`UPDATE products SET
      rating_avg = COALESCE((SELECT ROUND(AVG(rating), 1) FROM reviews WHERE product_id = products.id AND approved = 1), 0),
      rating_count = (SELECT COUNT(*) FROM reviews WHERE product_id = products.id AND approved = 1)`);

    const insAddr = db.prepare('INSERT INTO addresses (user_id, name, phone, line1, city, state, pincode, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, 1)');
    customers.forEach((uid, i) => insAddr.run(uid, 'Home', '9876500000', `${10 + i} MG Road`, 'Bengaluru', 'Karnataka', `5600${10 + i}`));

    // Sample orders spread over the last few weeks.
    const statuses = ['delivered', 'delivered', 'shipped', 'confirmed', 'placed', 'delivered', 'cancelled'];
    const insOrder = db.prepare(`INSERT INTO orders (order_number, user_id, email, name, phone, address, subtotal, shipping, total, payment_method, payment_status, status, history, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))`);
    const insItem = db.prepare('INSERT INTO order_items (order_id, product_id, name, image, size, price, qty) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (let i = 0; i < 18; i++) {
      const uid = customers[i % customers.length];
      const u = db.prepare('SELECT name, email FROM users WHERE id = ?').get(uid);
      const p1 = products[(i * 5) % products.length];
      const p2 = products[(i * 3 + 2) % products.length];
      const items = i % 3 === 0 ? [[p1, 1], [p2, 1]] : [[p1, 1 + (i % 2)]];
      const subtotal = items.reduce((s, [p, q]) => s + p.price * q, 0);
      const shipping = subtotal >= config.store.freeShippingOver ? 0 : config.store.shippingFee;
      const status = statuses[i % statuses.length];
      const method = i % 2 ? 'cod' : 'online';
      const paid = method === 'online' || status === 'delivered' ? 'paid' : 'pending';
      const history = JSON.stringify([{ status: 'placed', at: new Date(Date.now() - (i * 2 + 1) * 86400000).toISOString() }]
        .concat(status !== 'placed' ? [{ status, at: new Date(Date.now() - i * 86400000).toISOString() }] : []));
      const orderId = Number(insOrder.run(
        `SS${String(100200 + i)}`, uid, u.email, u.name, '9876500000',
        JSON.stringify({ line1: '10 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560010' }),
        subtotal, shipping, subtotal + shipping, method, paid, status, history, `-${i * 2 + 1} days`,
      ).lastInsertRowid);
      for (const [p, q] of items) insItem.run(orderId, p.id, p.name, JSON.parse(p.images)[0], config.store.sizes[(i + 2) % 7], p.price, q);
    }
  });
}

if (require.main === module) {
  const reset = process.argv.includes('--reset');
  if (reset && fs.existsSync(config.dbFile)) {
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(config.dbFile + suffix, { force: true });
  }
  const db = require('./db').open();
  seed(db);
  console.log(`Seeded ${db.prepare('SELECT COUNT(*) AS n FROM products').get().n} products into ${config.dbFile}`);
}

module.exports = { seed, slugify };
