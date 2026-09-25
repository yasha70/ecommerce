// Admin panel: dashboard, orders, catalog, coupons, customers, reviews and messages.
import { api, esc, inr, $, $$, formData, toast, dateFmt, statusLabel, debounce } from '/js/util.js';

const root = $('#root');
const ORDER_STATUSES = ['placed', 'confirmed', 'packed', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'return_requested', 'returned'];
const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refund_initiated', 'refunded'];
let config;
const initials = (name) => name.split(/[\s&]+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
let user;

const pillFor = (s) => (['delivered', 'paid', 'returned', 'refunded'].includes(s) ? 'pill-green'
  : ['cancelled', 'failed'].includes(s) ? 'pill-red' : 'pill-gold');

function openModal(html) {
  $('#modalBody').innerHTML = html;
  $('#modal').hidden = false;
}
function closeModal() {
  $('#modal').hidden = true;
}
$('#modalClose').onclick = closeModal;
$('#modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

function loginScreen(msg = '') {
  root.innerHTML = `<div class="login-wrap"><div class="card" style="width:min(400px,100%)">
    <div class="logo" style="margin-bottom:20px"><span class="logo-mark">${esc(initials(config.name))}</span><span class="logo-text">Admin<small>${esc(config.name)}</small></span></div>
    <form id="loginForm"><div class="field"><label>Email</label><input name="email" type="email" required autocomplete="username"></div>
    <div class="field"><label>Password</label><input name="password" type="password" required autocomplete="current-password"></div>
    <p class="error" id="err">${esc(msg)}</p><button class="btn btn-block">Log in</button></form>
    <p class="small muted center"><a class="link" href="/">← Back to store</a></p></div></div>`;
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const u = await api('/api/auth/login', { method: 'POST', body: formData(e.target) });
      if (u.role !== 'admin') { await api('/api/auth/logout', { method: 'POST' }); throw new Error('This account does not have admin access.'); }
      user = u;
      shell();
    } catch (err) { $('#err').textContent = err.message; }
  };
}

const SECTIONS = [
  ['dashboard', '📊 Dashboard'], ['orders', '📦 Orders'], ['products', '👚 Products'], ['categories', '🗂 Categories'],
  ['coupons', '🏷 Coupons'], ['customers', '👥 Customers'], ['reviews', '⭐ Reviews'], ['messages', '✉️ Messages'], ['subscribers', '💌 Subscribers'],
];

function shell() {
  root.innerHTML = `<div class="admin"><nav class="side">
    <a href="/" class="logo" style="display:flex"><span class="logo-mark">${esc(initials(config.name))}</span><span class="logo-text" style="color:#fff">Admin<small>${esc(config.name)}</small></span></a>
    ${SECTIONS.map(([k, l]) => `<a href="#${k}" data-sec="${k}">${l}<span class="badge" id="badge-${k}" hidden></span></a>`).join('')}
    <hr><div class="small" style="padding:6px 12px;color:#cdbfb5">Payments: <b style="color:${config.paymentProvider === 'demo' ? 'var(--gold-light)' : '#8fd19e'}">${config.paymentProvider === 'demo' ? 'Demo mode' : 'Razorpay live'}</b></div>
    <a href="/admin/order-tools" target="_blank" rel="noopener">🧮 Order Tools ↗</a><a href="/" target="_blank" rel="noopener">🛍 View store ↗</a><a href="#" id="logout">↩ Log out</a></nav>
    <main class="content" id="content"></main></div>`;
  $('#logout').onclick = async (e) => { e.preventDefault(); await api('/api/auth/logout', { method: 'POST' }); loginScreen(); };
  window.onhashchange = route;
  route();
}

function route() {
  const sec = (location.hash.slice(1) || 'dashboard').split('/')[0];
  $$('.side a[data-sec]').forEach((a) => a.classList.toggle('on', a.dataset.sec === sec));
  const views = { dashboard, orders, products, categories, coupons, customers, reviews, messages, subscribers };
  const content = $('#content');
  content.innerHTML = '<div class="spinner"></div>';
  (views[sec] || dashboard)(content).catch((e) => {
    if (e.status === 401 || e.status === 403) loginScreen(e.message);
    else content.innerHTML = `<p class="error">${esc(e.message)}</p>`;
  });
}

function header(title, actions = '') {
  return `<div class="top"><h1>${title}</h1><div style="display:flex;gap:8px;flex-wrap:wrap">${actions}</div></div>`;
}

/* ---------------- Dashboard ---------------- */
async function dashboard(el) {
  const s = await api('/api/admin/stats');
  const badge = (k, n) => { const b = $(`#badge-${k}`); if (b) { b.textContent = n; b.hidden = !n; } };
  badge('orders', s.pending);
  badge('messages', s.unreadMessages);

  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const hit = s.daily.find((x) => x.day === d);
    days.push({ d, revenue: hit?.revenue || 0, orders: hit?.orders || 0 });
  }
  const maxRev = Math.max(1, ...days.map((d) => d.revenue));
  const maxCat = Math.max(1, ...s.byCategory.map((c) => c.revenue));

  el.innerHTML = `${header('Dashboard', '<a class="btn btn-sm" href="#products/new">+ Add product</a>')}
  <div class="kpis">
    <div class="kpi"><span>Total revenue</span><b>${inr(s.totals.revenue)}</b></div>
    <div class="kpi"><span>Orders</span><b>${s.totals.orders}</b></div>
    <div class="kpi"><span>Avg. order value</span><b>${inr(Math.round(s.totals.aov))}</b></div>
    <div class="kpi"><span>Today</span><b>${inr(s.today.revenue)}</b><small class="muted">${s.today.orders} orders</small></div>
    <div class="kpi"><span>To fulfil</span><b>${s.pending}</b></div>
    <div class="kpi"><span>Return requests</span><b>${s.returns}</b></div>
    <div class="kpi"><span>Customers</span><b>${s.customers}</b></div>
  </div>
  <div class="two"><div class="card"><h3>Revenue · last 30 days</h3>
      <div class="chart">${days.map((d) => `<div style="height:${(d.revenue / maxRev) * 100}%" data-tip="${d.d}: ${inr(d.revenue)} · ${d.orders} orders"></div>`).join('')}</div>
      <div class="muted small" style="display:flex;justify-content:space-between"><span>${days[0].d}</span><span>${days[29].d}</span></div></div>
    <div class="card"><h3>Sales by category</h3>${s.byCategory.map((c) => `<div class="hbar"><span style="width:130px">${esc(c.name)}</span><div class="bar"><i style="width:${(c.revenue / maxCat) * 100}%"></i></div><b>${inr(c.revenue)}</b></div>`).join('') || '<p class="muted">No sales yet.</p>'}
      <h3 style="margin-top:20px">Orders by status</h3><div style="display:flex;flex-wrap:wrap;gap:6px">${s.byStatus.map((b) => `<a href="#orders" data-status="${b.status}" class="pill ${pillFor(b.status)}">${statusLabel(b.status)}: ${b.n}</a>`).join('')}</div></div></div>
  <div class="two"><div class="card"><h3>Recent orders</h3><div class="table-wrap" style="border:0"><table class="table"><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th>Payment</th></tr></thead><tbody>
      ${s.recent.map((o) => `<tr style="cursor:pointer" data-order="${esc(o.order_number)}"><td><b>#${esc(o.order_number)}</b><br><span class="muted small">${dateFmt(o.created_at)}</span></td><td>${esc(o.name)}</td><td>${inr(o.total)}</td>
        <td><span class="pill ${pillFor(o.status)}">${statusLabel(o.status)}</span></td><td><span class="pill ${pillFor(o.payment_status)}">${statusLabel(o.payment_status)}</span></td></tr>`).join('')}</tbody></table></div></div>
    <div class="card"><h3>Top products</h3>${s.topProducts.map((p, i) => `<div class="hbar"><b>${i + 1}.</b><span style="flex:1;white-space:normal">${esc(p.name)}</span><span class="muted">${p.units} sold</span></div>`).join('') || '<p class="muted">No sales yet.</p>'}
      <h3 style="margin-top:20px">⚠ Low stock</h3>${s.lowStock.length ? s.lowStock.map((p) => `<div class="small" style="margin:6px 0"><a class="link" href="#products/${p.id}">${esc(p.name)}</a><br><span class="muted">${p.sizes.join(' · ')}</span></div>`).join('') : '<p class="muted">All sizes well stocked.</p>'}</div></div>`;
  $$('[data-order]', el).forEach((r) => r.onclick = () => orderModal(r.dataset.order));
  $$('[data-status]', el).forEach((a) => a.onclick = () => { sessionStorage.setItem('adm_status', a.dataset.status); });
}

/* ---------------- Orders ---------------- */
async function orders(el) {
  let status = sessionStorage.getItem('adm_status') || '';
  sessionStorage.removeItem('adm_status');
  el.innerHTML = `${header('Orders', '<a class="btn btn-sm btn-ghost" id="exportCsv" href="/api/admin/orders.csv" download>⬇ Export CSV</a>')}
    <div class="filters-row"><input class="input" id="oq" placeholder="Search order #, name, email, phone" style="min-width:260px">
      <select class="input" id="ostatus"><option value="">All statuses</option>${ORDER_STATUSES.map((s) => `<option value="${s}">${statusLabel(s)}</option>`).join('')}</select>
      <select class="input" id="opay"><option value="">All payments</option>${PAYMENT_STATUSES.map((s) => `<option value="${s}">${statusLabel(s)}</option>`).join('')}</select></div>
    <div class="table-wrap" id="otable"><div class="spinner"></div></div>`;
  $('#ostatus').value = status;
  const load = async () => {
    const params = new URLSearchParams({ q: $('#oq').value, status: $('#ostatus').value, payment: $('#opay').value });
    $('#exportCsv').href = `/api/admin/orders.csv?${params}`;
    const list = await api(`/api/admin/orders?${params}`);
    $('#otable').innerHTML = list.length ? `<table class="table"><thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>City</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th></tr></thead><tbody>
      ${list.map((o) => `<tr style="cursor:pointer" data-order="${esc(o.order_number)}"><td><b>#${esc(o.order_number)}</b></td><td>${dateFmt(o.created_at, { dateStyle: 'medium', timeStyle: 'short' })}</td>
        <td>${esc(o.name)}<br><span class="muted small">${esc(o.email)}</span></td><td>${esc(o.address.city)}</td><td>${o.units}</td><td><b>${inr(o.total)}</b></td>
        <td>${o.payment_method === 'cod' ? 'COD' : 'Online'}<br><span class="pill ${pillFor(o.payment_status)}">${statusLabel(o.payment_status)}</span></td>
        <td><span class="pill ${pillFor(o.status)}">${statusLabel(o.status)}</span></td></tr>`).join('')}</tbody></table>` : '<p class="muted" style="padding:20px">No orders found.</p>';
    $$('[data-order]').forEach((r) => r.onclick = () => orderModal(r.dataset.order, load));
  };
  $('#oq').oninput = debounce(load, 250);
  $('#ostatus').onchange = load;
  $('#opay').onchange = load;
  await load();
}

async function orderModal(num, onSave) {
  openModal('<div class="spinner"></div>');
  const o = await api(`/api/admin/orders/${encodeURIComponent(num)}`);
  const a = o.address;
  $('#modalBody').innerHTML = `<h2>Order #${esc(o.order_number)}</h2><p class="muted">${dateFmt(o.created_at, { dateStyle: 'long', timeStyle: 'short' })} · ${o.payment_method === 'cod' ? 'Cash on Delivery' : 'Online payment'}${o.payment_ref ? ` · ${esc(o.payment_ref)}` : ''}</p>
    <div class="two" style="grid-template-columns:1.3fr 1fr"><div>
      ${o.items.map((i) => `<div class="mini-line"><img src="${esc(i.image || '')}" alt=""><div style="flex:1"><b>${esc(i.name)}</b><div class="small muted">Size ${esc(i.size)} × ${i.qty} · ${inr(i.price)}${i.stitching_fee ? ` + ${inr(i.stitching_fee)} stitching` : ''}</div>
        ${i.measurements ? `<div class="small" style="background:#fffaf0;padding:6px 8px;border-radius:6px;margin-top:4px">✂ ${Object.entries(i.measurements).map(([k, v]) => `${esc(k)}: <b>${esc(v)}</b>`).join(' · ')}</div>` : ''}</div></div>`).join('')}
      <div class="card" style="margin-top:12px;padding:14px">
        <div class="sum-row"><span>Subtotal</span><span>${inr(o.subtotal)}</span></div>${o.stitching ? `<div class="sum-row"><span>Stitching</span><span>${inr(o.stitching)}</span></div>` : ''}
        ${o.discount ? `<div class="sum-row"><span>Discount (${esc(o.coupon_code)})</span><span>−${inr(o.discount)}</span></div>` : ''}<div class="sum-row"><span>Shipping</span><span>${inr(o.shipping)}</span></div>
        ${o.cod_fee ? `<div class="sum-row"><span>COD fee</span><span>${inr(o.cod_fee)}</span></div>` : ''}<div class="sum-row total"><span>Total</span><span>${inr(o.total)}</span></div></div>
      <h3 style="margin-top:16px">History</h3><ul class="history">${o.history.slice().reverse().map((h) => `<li><b>${statusLabel(h.status)}</b> <span class="muted small">${dateFmt(h.at, { dateStyle: 'medium', timeStyle: 'short' })}</span>${h.note ? `<br><span class="small">${esc(h.note)}</span>` : ''}</li>`).join('')}</ul>
    </div><div>
      <div class="card" style="padding:14px;margin-bottom:12px"><b>Ship to</b><br>${esc(a.name)}<br>${esc(a.line1)}${a.line2 ? `, ${esc(a.line2)}` : ''}<br>${esc(a.city)}, ${esc(a.state)} ${esc(a.pincode)}<br>📞 <a class="link" href="tel:${esc(a.phone)}">${esc(a.phone)}</a><br>📧 ${esc(o.email)}
        ${o.notes ? `<p class="small" style="margin-bottom:0"><b>Notes:</b> ${esc(o.notes)}</p>` : ''}</div>
      <form id="orderForm"><div class="field"><label>Order status</label><select name="status">${ORDER_STATUSES.map((s) => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${statusLabel(s)}</option>`).join('')}</select></div>
        <div class="field"><label>Payment status</label><select name="payment_status">${PAYMENT_STATUSES.map((s) => `<option value="${s}" ${s === o.payment_status ? 'selected' : ''}>${statusLabel(s)}</option>`).join('')}</select></div>
        <div class="field"><label>Tracking number</label><input name="tracking_number" value="${esc(o.tracking_number || '')}" placeholder="e.g. Delhivery AWB"></div>
        <div class="field"><label>Note for customer timeline (optional)</label><input name="note" placeholder="e.g. Shipped via BlueDart"></div>
        <p class="error" id="oErr"></p><button class="btn btn-block">Save changes</button></form>
      <div style="display:flex;gap:8px;margin-top:10px"><a class="btn btn-ghost btn-sm" style="flex:1" href="/invoice/${esc(o.order_number)}" target="_blank" rel="noopener">🧾 Invoice</a>
        <a class="btn btn-ghost btn-sm" style="flex:1" href="https://wa.me/91${esc(a.phone)}?text=${encodeURIComponent(`Hi ${a.name}, update on your ${config.name} order #${o.order_number}: `)}" target="_blank" rel="noopener">💬 WhatsApp</a></div>
    </div></div>`;
  $('#orderForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api(`/api/admin/orders/${encodeURIComponent(num)}`, { method: 'PUT', body: formData(e.target) });
      toast('Order updated');
      closeModal();
      (onSave || route)();
    } catch (err) { $('#oErr').textContent = err.message; }
  };
}

/* ---------------- Products ---------------- */
async function products(el) {
  const [, id] = location.hash.slice(1).split('/');
  const cats = await api('/api/admin/categories');
  if (id) return productForm(el, id === 'new' ? null : Number(id), cats);
  el.innerHTML = `${header('Products', '<a class="btn btn-sm" href="#products/new">+ Add product</a>')}
    <div class="filters-row"><input class="input" id="pq" placeholder="Search products" style="min-width:260px"></div><div class="table-wrap" id="ptable"></div>`;
  const load = async () => {
    const list = await api(`/api/admin/products?q=${encodeURIComponent($('#pq').value)}`);
    $('#ptable').innerHTML = `<table class="table"><thead><tr><th></th><th>Name</th><th>Category</th><th>Price</th><th>Stock</th><th>Sold</th><th>Rating</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((p) => {
        const total = Object.values(p.stock).reduce((a, b) => a + b, 0);
        const out = Object.values(p.stock).filter((n) => n === 0).length;
        return `<tr><td><img src="${esc(p.images[0] || '')}" alt=""></td><td><b>${esc(p.name)}</b><br><span class="muted small">/${esc(p.slug)}</span></td><td>${esc(p.category_name || '—')}</td>
        <td>${inr(p.price)}<br><s class="muted small">${inr(p.mrp)}</s></td><td>${total}${out ? `<br><span class="error small">${out} size(s) out</span>` : ''}</td><td>${p.sold_count}</td><td>${p.rating_count ? `${p.rating_avg}★ (${p.rating_count})` : '—'}</td>
        <td>${p.active ? '<span class="pill pill-green">Active</span>' : '<span class="pill">Hidden</span>'} ${p.featured ? '<span class="pill pill-gold">Featured</span>' : ''}</td>
        <td><a class="btn btn-sm btn-ghost" href="#products/${p.id}">Edit</a> <button class="btn btn-sm btn-ghost" data-del="${p.id}">Delete</button></td></tr>`;
      }).join('')}</tbody></table>`;
    $$('[data-del]').forEach((b) => b.onclick = async () => {
      if (!confirm('Delete this product? Products with past orders are hidden instead of deleted.')) return;
      const r = await api(`/api/admin/products/${b.dataset.del}`, { method: 'DELETE' });
      toast(r.archived ? 'Product hidden (it has past orders)' : 'Product deleted');
      load();
    });
  };
  $('#pq').oninput = debounce(load, 250);
  await load();
}

async function productForm(el, id, cats) {
  const p = id ? (await api('/api/admin/products')).find((x) => x.id === id) : {
    stock: Object.fromEntries(config.sizes.map((s) => [s, 5])), images: [], active: 1, custom_stitching: 1,
  };
  if (!p) { el.innerHTML = '<p class="error">Product not found.</p>'; return; }
  let images = [...p.images];
  const opt = (list, v) => list.map((x) => `<option ${x === v ? 'selected' : ''}>${x}</option>`).join('');
  el.innerHTML = `${header(id ? 'Edit product' : 'New product', `<a class="btn btn-sm btn-ghost" href="#products">← Back</a>${id ? `<a class="btn btn-sm btn-ghost" href="/product/${esc(p.slug)}" target="_blank">View in store ↗</a>` : ''}`)}
  <form id="pForm" class="two" style="align-items:start"><div class="card">
    <div class="field"><label>Name</label><input name="name" required value="${esc(p.name || '')}"></div>
    <div class="field"><label>Description</label><textarea name="description" rows="5">${esc(p.description || '')}</textarea></div>
    <div class="row"><div class="field"><label>Price (₹)</label><input name="price" type="number" min="1" required value="${esc(p.price || '')}"></div>
      <div class="field"><label>MRP (₹)</label><input name="mrp" type="number" min="1" required value="${esc(p.mrp || '')}"></div></div>
    <div class="row"><div class="field"><label>Category</label><select name="category_id">${cats.map((c) => `<option value="${c.id}" ${c.id === p.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Fabric</label><input name="fabric" value="${esc(p.fabric || '')}" list="fabrics"></div></div>
    <div class="row-3"><div class="field"><label>Sleeve</label><select name="sleeve">${opt(['Sleeveless', 'Cap Sleeve', 'Short Sleeve', 'Elbow Sleeve', 'Full Sleeve', 'Puff Sleeve'], p.sleeve)}</select></div>
      <div class="field"><label>Neckline</label><select name="neck">${opt(['Round Neck', 'V Neck', 'Boat Neck', 'Sweetheart Neck', 'High Neck', 'Square Neck'], p.neck)}</select></div>
      <div class="field"><label>Occasion</label><select name="occasion">${opt(['Festive', 'Wedding', 'Party', 'Office', 'Casual'], p.occasion)}</select></div></div>
    <div class="row"><div class="field"><label>Work / embellishment</label><input name="work" value="${esc(p.work || '')}"></div><div class="field"><label>Colour name</label><input name="color" value="${esc(p.color || '')}"></div></div>
    <div class="row"><div class="field"><label>Colour swatch</label><input type="color" name="swatch" value="#${esc(p.swatch || 'cccccc')}"></div>
      <div class="field"><label>Style code (links colour variants)</label><input name="style_code" value="${esc(p.style_code || '')}" placeholder="e.g. shimmer-stretch"><span class="small muted">Give every colour of the same design the same code to show colour swatches.</span></div></div>
    <div class="field"><label>Search tags</label><input name="tags" value="${esc(p.tags || '')}" placeholder="silk zari maroon wedding"></div>
    <h3>Stock by size</h3><div class="stock-grid">${config.sizes.map((s) => `<div class="field"><label>${s}</label><input type="number" min="0" name="stock_${s}" value="${p.stock[s] ?? 0}"></div>`).join('')}</div>
  </div><div>
    <div class="card" style="margin-bottom:16px"><h3>Images</h3><div class="img-list" id="imgList"></div>
      <label class="btn btn-ghost btn-sm" style="cursor:pointer">⬆ Upload images<input type="file" accept="image/*" multiple id="imgUpload" hidden></label>
      <div class="field" style="margin-top:10px"><label>…or add image URL</label><div style="display:flex;gap:6px"><input id="imgUrl" placeholder="https://… or /img/blouse.svg?c=…"><button type="button" class="btn btn-sm btn-ghost" id="addUrl">Add</button></div></div>
      <p class="small muted">The first image is the main photo. PNG/JPG/WEBP up to 5 MB.</p></div>
    <div class="card"><h3>Visibility</h3>
      <label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Visible in store</label>
      <label class="check"><input type="checkbox" name="featured" ${p.featured ? 'checked' : ''}> Featured</label>
      <label class="check"><input type="checkbox" name="is_new" ${p.is_new ? 'checked' : ''}> Mark as new arrival</label>
      <label class="check"><input type="checkbox" name="custom_stitching" ${p.custom_stitching ? 'checked' : ''}> Offer custom stitching</label>
      <p class="error" id="pErr"></p><button class="btn btn-block" style="margin-top:14px">${id ? 'Save product' : 'Create product'}</button></div>
  </div></form>`;

  const drawImages = () => {
    $('#imgList').innerHTML = images.map((src, i) => `<div><img src="${esc(src)}" alt=""><button type="button" data-rm="${i}" aria-label="Remove">✕</button></div>`).join('') || '<p class="muted small">No images yet.</p>';
    $$('[data-rm]').forEach((b) => b.onclick = () => { images.splice(Number(b.dataset.rm), 1); drawImages(); });
  };
  drawImages();
  $('#addUrl').onclick = () => { const v = $('#imgUrl').value.trim(); if (v) { images.push(v); $('#imgUrl').value = ''; drawImages(); } };
  $('#imgUpload').onchange = async (e) => {
    for (const file of e.target.files) {
      const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
      try { images.push((await api('/api/admin/upload', { method: 'POST', body: { dataUrl } })).url); } catch (err) { toast(err.message, true); }
    }
    drawImages();
    e.target.value = '';
  };
  $('#pForm').onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    const stock = Object.fromEntries(config.sizes.map((s) => [s, Number(d[`stock_${s}`]) || 0]));
    const body = { ...d, stock, images };
    try {
      await api(id ? `/api/admin/products/${id}` : '/api/admin/products', { method: id ? 'PUT' : 'POST', body });
      toast(id ? 'Product saved' : 'Product created');
      location.hash = 'products';
    } catch (err) { $('#pErr').textContent = err.message; }
  };
}

/* ---------------- Categories ---------------- */
async function categories(el) {
  const list = await api('/api/admin/categories');
  el.innerHTML = `${header('Categories')}<div class="two" style="align-items:start"><div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Slug</th><th>Products</th><th></th></tr></thead><tbody>
    ${list.map((c) => `<tr><td><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#${esc(c.color)}"></span> <b>${esc(c.name)}</b><br><span class="muted small" style="white-space:normal">${esc(c.description || '')}</span></td>
      <td>${esc(c.slug)}</td><td>${c.count}</td><td><button class="btn btn-sm btn-ghost" data-edit="${c.id}">Edit</button> <button class="btn btn-sm btn-ghost" data-del="${c.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>
    <form class="card" id="cForm"><h3 id="cTitle">Add category</h3><input type="hidden" name="id"><div class="field"><label>Name</label><input name="name" required></div>
      <div class="field"><label>Description</label><textarea name="description" rows="3"></textarea></div><div class="field"><label>Accent colour</label><input type="color" name="color" value="#7a1f2b"></div>
      <p class="error" id="cErr"></p><button class="btn btn-block">Save category</button></form></div>`;
  const form = $('#cForm');
  $$('[data-edit]').forEach((b) => b.onclick = () => {
    const c = list.find((x) => String(x.id) === b.dataset.edit);
    form.id.value = c.id; form.name.value = c.name; form.description.value = c.description || ''; form.color.value = `#${c.color}`;
    $('#cTitle').textContent = `Edit ${c.name}`;
  });
  $$('[data-del]').forEach((b) => b.onclick = async () => {
    if (!confirm('Delete this category?')) return;
    try { await api(`/api/admin/categories/${b.dataset.del}`, { method: 'DELETE' }); route(); } catch (err) { toast(err.message, true); }
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(form);
    d.color = d.color.replace('#', '');
    try {
      await api(d.id ? `/api/admin/categories/${d.id}` : '/api/admin/categories', { method: d.id ? 'PUT' : 'POST', body: d });
      toast('Category saved');
      route();
    } catch (err) { $('#cErr').textContent = err.message; }
  };
}

/* ---------------- Coupons ---------------- */
async function coupons(el) {
  const list = await api('/api/admin/coupons');
  el.innerHTML = `${header('Coupons')}<div class="two" style="align-items:start"><div class="table-wrap"><table class="table"><thead><tr><th>Code</th><th>Discount</th><th>Min order</th><th>Used</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map((c) => `<tr><td><b>${esc(c.code)}</b><br><span class="muted small">${esc(c.description || '')}</span></td><td>${c.type === 'percent' ? `${c.value}%${c.max_discount ? ` (max ${inr(c.max_discount)})` : ''}` : inr(c.value)}</td>
      <td>${inr(c.min_order)}</td><td>${c.used_count}${c.usage_limit ? ` / ${c.usage_limit}` : ''}</td><td>${c.expires_at ? esc(c.expires_at) : '—'}</td>
      <td>${c.active ? '<span class="pill pill-green">Active</span>' : '<span class="pill">Paused</span>'}</td>
      <td><button class="btn btn-sm btn-ghost" data-edit="${esc(c.code)}">Edit</button> <button class="btn btn-sm btn-ghost" data-del="${esc(c.code)}">Delete</button></td></tr>`).join('')}</tbody></table></div>
    <form class="card" id="cpForm"><h3>Create / update coupon</h3><div class="field"><label>Code</label><input name="code" required style="text-transform:uppercase"></div>
      <div class="field"><label>Description</label><input name="description" placeholder="Shown to customers"></div>
      <div class="row"><div class="field"><label>Type</label><select name="type"><option value="percent">Percent</option><option value="flat">Flat ₹</option></select></div><div class="field"><label>Value</label><input name="value" type="number" min="1" required></div></div>
      <div class="row"><div class="field"><label>Min order ₹</label><input name="min_order" type="number" min="0" value="0"></div><div class="field"><label>Max discount ₹</label><input name="max_discount" type="number" min="0"></div></div>
      <div class="row"><div class="field"><label>Usage limit</label><input name="usage_limit" type="number" min="1"></div><div class="field"><label>Expires on</label><input name="expires_at" type="date"></div></div>
      <label class="check"><input type="checkbox" name="active" checked> Active</label><p class="error" id="cpErr"></p><button class="btn btn-block" style="margin-top:10px">Save coupon</button></form></div>`;
  const form = $('#cpForm');
  $$('[data-edit]').forEach((b) => b.onclick = () => {
    const c = list.find((x) => x.code === b.dataset.edit);
    for (const k of ['code', 'description', 'type', 'value', 'min_order', 'max_discount', 'usage_limit']) form[k].value = c[k] ?? '';
    form.expires_at.value = c.expires_at ? c.expires_at.slice(0, 10) : '';
    form.active.checked = !!c.active;
  });
  $$('[data-del]').forEach((b) => b.onclick = async () => { if (confirm(`Delete coupon ${b.dataset.del}?`)) { await api(`/api/admin/coupons/${encodeURIComponent(b.dataset.del)}`, { method: 'DELETE' }); route(); } });
  form.onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/admin/coupons', { method: 'POST', body: formData(form) }); toast('Coupon saved'); route(); } catch (err) { $('#cpErr').textContent = err.message; }
  };
}

/* ---------------- Customers ---------------- */
async function customers(el) {
  el.innerHTML = `${header('Customers')}<div class="filters-row"><input class="input" id="cq" placeholder="Search name or email" style="min-width:260px"></div><div class="table-wrap" id="ctable"></div>`;
  const load = async () => {
    const list = await api(`/api/admin/customers?q=${encodeURIComponent($('#cq').value)}`);
    $('#ctable').innerHTML = `<table class="table"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Joined</th><th>Orders</th><th>Total spent</th></tr></thead><tbody>
      ${list.map((c) => `<tr><td><b>${esc(c.name)}</b> ${c.role === 'admin' ? '<span class="pill pill-gold">Admin</span>' : ''}</td><td>${esc(c.email)}</td><td>${esc(c.phone || '—')}</td>
        <td>${dateFmt(c.created_at)}</td><td>${c.orders}</td><td><b>${inr(c.spent)}</b></td></tr>`).join('')}</tbody></table>`;
  };
  $('#cq').oninput = debounce(load, 250);
  await load();
}

/* ---------------- Reviews ---------------- */
async function reviews(el) {
  const list = await api('/api/admin/reviews');
  el.innerHTML = `${header('Reviews')}<div class="table-wrap"><table class="table"><thead><tr><th>Product</th><th>Rating</th><th>Review</th><th>Author</th><th>Date</th><th></th></tr></thead><tbody>
    ${list.map((r) => `<tr><td><a class="link" href="/product/${esc(r.slug)}" target="_blank">${esc(r.product)}</a></td><td>${r.rating}★</td>
      <td style="white-space:normal;min-width:260px"><b>${esc(r.title || '')}</b><br>${esc(r.body || '')}</td><td>${esc(r.author)}${r.verified ? '<br><span class="success small">Verified</span>' : ''}</td><td>${dateFmt(r.created_at)}</td>
      <td><button class="btn btn-sm btn-ghost" data-toggle="${r.id}" data-approved="${r.approved}">${r.approved ? 'Hide' : 'Approve'}</button> <button class="btn btn-sm btn-ghost" data-del="${r.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>`;
  $$('[data-toggle]').forEach((b) => b.onclick = async () => { await api(`/api/admin/reviews/${b.dataset.toggle}`, { method: 'PUT', body: { approved: b.dataset.approved !== '1' } }); route(); });
  $$('[data-del]').forEach((b) => b.onclick = async () => { if (confirm('Delete this review?')) { await api(`/api/admin/reviews/${b.dataset.del}`, { method: 'DELETE' }); route(); } });
}

/* ---------------- Messages & subscribers ---------------- */
async function messages(el) {
  const list = await api('/api/admin/messages');
  el.innerHTML = `${header('Messages')}${list.length ? list.map((m) => `<div class="card" style="margin-bottom:12px;${m.handled ? 'opacity:.6' : ''}">
    <div class="order-card-head"><div><b>${esc(m.subject || 'Message')}</b> · ${esc(m.name)} <span class="muted small">&lt;${esc(m.email)}&gt; ${m.phone ? `· ${esc(m.phone)}` : ''} · ${dateFmt(m.created_at, { dateStyle: 'medium', timeStyle: 'short' })}</span></div>
    <div><a class="btn btn-sm btn-ghost" href="mailto:${esc(m.email)}?subject=${encodeURIComponent(`Re: ${m.subject || 'Your message'}`)}">Reply</a> <button class="btn btn-sm btn-ghost" data-handled="${m.id}" data-v="${m.handled ? 0 : 1}">${m.handled ? 'Mark open' : 'Mark handled'}</button></div></div>
    <p style="margin:0;white-space:pre-wrap">${esc(m.message)}</p></div>`).join('') : '<p class="muted">No messages yet.</p>'}`;
  $$('[data-handled]').forEach((b) => b.onclick = async () => { await api(`/api/admin/messages/${b.dataset.handled}`, { method: 'PUT', body: { handled: b.dataset.v === '1' } }); route(); });
}

async function subscribers(el) {
  const list = await api('/api/admin/newsletter');
  el.innerHTML = `${header(`Subscribers (${list.length})`, '<button class="btn btn-sm btn-ghost" id="copyEmails">Copy all emails</button>')}
    <div class="table-wrap"><table class="table"><thead><tr><th>Email</th><th>Subscribed</th></tr></thead><tbody>${list.map((s) => `<tr><td>${esc(s.email)}</td><td>${dateFmt(s.created_at)}</td></tr>`).join('')}</tbody></table></div>`;
  $('#copyEmails').onclick = async () => {
    try { await navigator.clipboard.writeText(list.map((s) => s.email).join(', ')); toast('Emails copied'); } catch { toast('Could not copy', true); }
  };
}

(async () => {
  config = await api('/api/config');
  document.title = `Admin · ${config.name}`;
  user = await api('/api/auth/me');
  if (!user || user.role !== 'admin') loginScreen(user ? 'This account does not have admin access.' : '');
  else shell();
})();
