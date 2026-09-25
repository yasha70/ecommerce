'use strict';
const config = require('./config');

const CUSTOM = 'Custom';
const MEASUREMENT_FIELDS = ['bust', 'waist', 'shoulder', 'blouseLength', 'sleeveLength', 'armhole'];
const MAX_QTY = 10;

class QuoteError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function parseProduct(row) {
  if (!row) return row;
  return { ...row, stock: JSON.parse(row.stock), images: JSON.parse(row.images) };
}

function cleanMeasurements(m) {
  const out = {};
  for (const f of MEASUREMENT_FIELDS) {
    const v = Number(m?.[f]);
    if (!Number.isFinite(v) || v <= 0 || v > 80) throw new QuoteError(`Please enter a valid ${f.replace(/([A-Z])/g, ' $1').toLowerCase()} measurement (in inches).`);
    out[f] = Math.round(v * 10) / 10;
  }
  if (m?.notes) out.notes = String(m.notes).slice(0, 300);
  return out;
}

function findCoupon(db, code) {
  if (!code) return null;
  return db.prepare('SELECT * FROM coupons WHERE code = ?').get(String(code).trim()) || null;
}

function couponDiscount(coupon, subtotal) {
  if (!coupon.active) throw new QuoteError('This coupon is no longer active.');
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) throw new QuoteError('This coupon has expired.');
  if (coupon.usage_limit != null && coupon.used_count >= coupon.usage_limit) throw new QuoteError('This coupon has reached its usage limit.');
  if (subtotal < coupon.min_order) throw new QuoteError(`Add items worth ₹${coupon.min_order - subtotal} more to use ${coupon.code}.`);
  let d = coupon.type === 'percent' ? Math.round((subtotal * coupon.value) / 100) : coupon.value;
  if (coupon.max_discount != null) d = Math.min(d, coupon.max_discount);
  return Math.min(d, subtotal);
}

/**
 * Prices a cart from the database (never trusting client prices).
 * items: [{ productId, size, qty, measurements? }]
 * Returns line items plus totals; throws QuoteError for invalid carts.
 */
function quote(db, { items, coupon: couponCode, paymentMethod } = {}) {
  if (!Array.isArray(items) || items.length === 0) throw new QuoteError('Your cart is empty.');
  if (items.length > 50) throw new QuoteError('Too many items in cart.');
  const getProduct = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1');
  const s = config.store;

  const lines = [];
  const warnings = [];
  const reserved = {};
  for (const raw of items) {
    const p = parseProduct(getProduct.get(Number(raw.productId)));
    if (!p) { warnings.push('An item in your cart is no longer available and was removed.'); continue; }
    const size = String(raw.size || '');
    const qty = Math.max(1, Math.min(MAX_QTY, Math.floor(Number(raw.qty) || 1)));
    let stitchingFee = 0;
    let measurements = null;
    if (size === CUSTOM) {
      if (!p.custom_stitching) throw new QuoteError(`${p.name} is not available with custom stitching.`);
      measurements = cleanMeasurements(raw.measurements);
      stitchingFee = s.customStitchingFee;
    } else {
      if (!(size in p.stock)) throw new QuoteError(`Please choose a valid size for ${p.name}.`);
      const key = `${p.id}:${size}`;
      const available = p.stock[size] - (reserved[key] || 0);
      if (available <= 0) throw new QuoteError(`${p.name} (size ${size}) is out of stock.`);
      if (qty > available) throw new QuoteError(`Only ${available} left of ${p.name} in size ${size}.`);
      reserved[key] = (reserved[key] || 0) + qty;
    }
    lines.push({
      productId: p.id, slug: p.slug, name: p.name, image: p.images[0], size, qty,
      price: p.price, mrp: p.mrp, stitchingFee, measurements,
      lineTotal: (p.price + stitchingFee) * qty,
    });
  }
  if (lines.length === 0) throw new QuoteError('Your cart is empty.');

  const subtotal = lines.reduce((t, l) => t + l.price * l.qty, 0);
  const stitching = lines.reduce((t, l) => t + l.stitchingFee * l.qty, 0);
  const mrpTotal = lines.reduce((t, l) => t + l.mrp * l.qty, 0);

  let discount = 0;
  let coupon = null;
  let couponError = null;
  if (couponCode) {
    const c = findCoupon(db, couponCode);
    try {
      if (!c) throw new QuoteError('Invalid coupon code.');
      discount = couponDiscount(c, subtotal);
      coupon = { code: c.code, description: c.description };
    } catch (err) {
      if (!(err instanceof QuoteError)) throw err;
      couponError = err.message;
    }
  }

  const afterDiscount = subtotal - discount;
  const shipping = afterDiscount >= s.freeShippingOver ? 0 : s.shippingFee;
  const codFee = paymentMethod === 'cod' ? s.codFee : 0;
  const total = afterDiscount + stitching + shipping + codFee;
  const codAvailable = total <= s.codMaxOrder;

  return {
    lines, warnings, subtotal, mrpTotal, savings: mrpTotal - subtotal + discount,
    stitching, discount, coupon, couponError, shipping, codFee, total, codAvailable,
    freeShippingGap: Math.max(0, s.freeShippingOver - afterDiscount),
  };
}

module.exports = { quote, QuoteError, parseProduct, CUSTOM, MEASUREMENT_FIELDS };
