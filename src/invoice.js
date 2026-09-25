'use strict';
const config = require('./config');
const { orderToken, publicOrder } = require('./routes/store');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

// GST on apparel: 5% up to ₹1000 per piece, 12% above. Prices are GST-inclusive.
function gstRate(unitPrice) {
  return unitPrice > 1000 ? 12 : 5;
}

function renderInvoice(db, orderNumber, user, token) {
  const row = db.prepare('SELECT * FROM orders WHERE order_number = ?').get(orderNumber);
  if (!row) return null;
  const allowed = (user && (user.id === row.user_id || user.role === 'admin')) || token === orderToken(row.order_number);
  if (!allowed) return null;
  const o = publicOrder(db, row);
  const s = config.store;
  const a = o.address;

  const rows = o.items.map((i, n) => {
    const unit = i.price + i.stitching_fee;
    const rate = gstRate(unit);
    const gross = unit * i.qty;
    const taxable = gross / (1 + rate / 100);
    return `<tr><td>${n + 1}</td><td>${esc(i.name)}<div class="muted">Size: ${esc(i.size)}${i.stitching_fee ? ' (custom stitched)' : ''} · HSN 6206</div></td>
      <td class="r">${i.qty}</td><td class="r">${inr(unit)}</td><td class="r">${inr(taxable.toFixed(2))}</td>
      <td class="r">${rate}%<div class="muted">${inr((gross - taxable).toFixed(2))}</div></td><td class="r">${inr(gross)}</td></tr>`;
  }).join('');

  const line = (label, v, neg) => (v ? `<tr><td>${label}</td><td class="r">${neg ? '−' : ''}${inr(v)}</td></tr>` : '');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Invoice ${esc(o.order_number)} · ${esc(s.name)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{font-family:Inter,-apple-system,Segoe UI,sans-serif;color:#222;margin:0;background:#f4f1ea}
.page{max-width:800px;margin:24px auto;background:#fff;padding:40px;border-radius:8px}
h1{font-family:Georgia,serif;color:#7a1f2b;margin:0}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{padding:8px;border-bottom:1px solid #eee;text-align:left;vertical-align:top}
th{background:#faf6ef}.r{text-align:right}.muted{color:#888;font-size:12px}
.grid{display:flex;justify-content:space-between;gap:24px;margin:24px 0;flex-wrap:wrap}
.totals{width:320px;margin-left:auto;margin-top:16px}.totals tr:last-child td{font-weight:700;font-size:16px;border-top:2px solid #222}
.btn{background:#7a1f2b;color:#fff;border:0;padding:10px 18px;border-radius:6px;cursor:pointer;font-size:14px}
@media print{body{background:#fff}.page{margin:0;padding:0}.noprint{display:none}}
</style></head><body><div class="page">
<div class="noprint" style="text-align:right;margin-bottom:16px"><button class="btn" onclick="print()">Print / Save as PDF</button></div>
<div class="grid" style="margin-top:0"><div><h1>${esc(s.name)}</h1><div class="muted">${esc(s.address)}<br>GSTIN: ${esc(s.gstin)} · ${esc(s.email)}</div></div>
<div class="r"><h2 style="margin:0">Tax Invoice</h2><div>#${esc(o.order_number)}</div><div class="muted">${esc(new Date(o.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('en-IN', { dateStyle: 'long' }))}</div></div></div>
<div class="grid"><div><strong>Bill / Ship to</strong><br>${esc(a.name)}<br>${esc(a.line1)}${a.line2 ? `<br>${esc(a.line2)}` : ''}<br>${esc(a.city)}, ${esc(a.state)} ${esc(a.pincode)}<br>Phone: ${esc(a.phone)}<br>${esc(o.email)}</div>
<div class="r"><strong>Payment</strong><br>${o.payment_method === 'cod' ? 'Cash on Delivery' : 'Online'}<br>Status: ${esc(o.payment_status.replace(/_/g, ' '))}${o.payment_ref ? `<br><span class="muted">${esc(o.payment_ref)}</span>` : ''}</div></div>
<table><thead><tr><th>#</th><th>Item</th><th class="r">Qty</th><th class="r">Unit</th><th class="r">Taxable</th><th class="r">GST</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<table class="totals"><tbody>${line('Subtotal', o.subtotal)}${line('Custom stitching', o.stitching)}${line(`Discount${o.coupon_code ? ` (${esc(o.coupon_code)})` : ''}`, o.discount, true)}
<tr><td>Shipping</td><td class="r">${o.shipping ? inr(o.shipping) : 'FREE'}</td></tr>${line('COD charges', o.cod_fee)}<tr><td>Total</td><td class="r">${inr(o.total)}</td></tr></tbody></table>
<p class="muted" style="margin-top:32px">All prices are inclusive of GST. This is a computer-generated invoice and does not require a signature. Returns accepted within ${s.returnDays} days of delivery (custom-stitched items excluded).</p>
</div></body></html>`;
}

module.exports = { renderInvoice };
