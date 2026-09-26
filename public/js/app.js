// Storefront: a small dependency-free single-page app.
import { api, esc, inr, stars, discount, debounce, store, toast, $, $$, formData, dateFmt, statusLabel } from './util.js';

const app = $('#app');
const state = {
  config: null,
  user: null,
  categories: [],
  wishlist: new Set(store.get('wishlist', [])),
  cart: store.get('cart', []),
  coupon: store.get('coupon', ''),
  compare: store.get('compare', []),
  recent: store.get('recent', []),
};

/* ------------------------------------------------------------------ */
/* Cart, wishlist, compare, recently viewed                            */
/* ------------------------------------------------------------------ */

const cart = {
  save() {
    store.set('cart', state.cart);
    const n = state.cart.reduce((t, i) => t + i.qty, 0);
    for (const badge of [$('#cartCount'), $('#bottomCartCount')]) {
      badge.textContent = n;
      badge.hidden = n === 0;
    }
  },
  add(product, size, qty = 1, measurements = null) {
    const custom = size === 'Custom';
    const key = custom ? `${product.id}|Custom|${Date.now()}` : `${product.id}|${size}`;
    const existing = state.cart.find((i) => i.key === key);
    if (existing) existing.qty = Math.min(10, existing.qty + qty);
    else {
      state.cart.push({
        key, productId: product.id, slug: product.slug, name: product.name, image: product.images[0],
        price: product.price, mrp: product.mrp, size, qty, measurements,
        stitchingFee: custom ? state.config.customStitchingFee : 0,
      });
    }
    cart.save();
  },
  setQty(key, qty) {
    const item = state.cart.find((i) => i.key === key);
    if (!item) return;
    item.qty = Math.max(1, Math.min(10, qty));
    cart.save();
  },
  remove(key) {
    state.cart = state.cart.filter((i) => i.key !== key);
    cart.save();
  },
  clear() {
    state.cart = [];
    cart.save();
  },
  payload() {
    return state.cart.map(({ productId, size, qty, measurements }) => ({ productId, size, qty, measurements }));
  },
  total() {
    return state.cart.reduce((t, i) => t + (i.price + i.stitchingFee) * i.qty, 0);
  },
};

const wishlist = {
  has: (id) => state.wishlist.has(id),
  sync() {
    store.set('wishlist', [...state.wishlist]);
    const badge = $('#wishCount');
    badge.textContent = state.wishlist.size;
    badge.hidden = state.wishlist.size === 0;
  },
  async toggle(id) {
    const on = !state.wishlist.has(id);
    if (on) state.wishlist.add(id); else state.wishlist.delete(id);
    wishlist.sync();
    if (state.user) {
      try { await api(`/api/wishlist/${id}`, { method: on ? 'POST' : 'DELETE' }); } catch (e) { toast(e.message, true); }
    }
    toast(on ? 'Added to wishlist ♥' : 'Removed from wishlist');
    $$(`[data-wish="${id}"]`).forEach((b) => b.classList.toggle('on', on));
    return on;
  },
  // After login, merge guest wishlist into the account and load the saved one.
  async merge() {
    for (const id of state.wishlist) await api(`/api/wishlist/${id}`, { method: 'POST' }).catch(() => {});
    const saved = await api('/api/wishlist');
    state.wishlist = new Set(saved.map((p) => p.id));
    wishlist.sync();
  },
};

const compare = {
  toggle(p) {
    const i = state.compare.findIndex((c) => c.id === p.id);
    if (i >= 0) state.compare.splice(i, 1);
    else {
      if (state.compare.length >= 4) return toast('You can compare up to 4 blouses.', true);
      state.compare.push({ id: p.id, name: p.name, image: p.images[0] });
    }
    store.set('compare', state.compare);
    compare.render();
  },
  render() {
    const bar = $('#compareBar');
    bar.hidden = state.compare.length === 0;
    document.body.classList.toggle('has-compare', !bar.hidden);
    bar.innerHTML = `<div class="container"><b>Compare (${state.compare.length}/4)</b>
      ${state.compare.map((c) => `<img src="${esc(c.image)}" alt="${esc(c.name)}" title="${esc(c.name)}">`).join('')}
      <span style="margin-left:auto;display:flex;gap:8px"><button class="btn btn-sm btn-ghost" style="color:#fff" data-compare-clear>Clear</button>
      <a class="btn btn-sm btn-gold" href="/compare" data-link>Compare now</a></span></div>`;
    $$('[data-compare]').forEach((b) => b.classList.toggle('on', state.compare.some((c) => c.id === Number(b.dataset.compare))));
  },
};

function rememberViewed(id) {
  state.recent = [id, ...state.recent.filter((x) => x !== id)].slice(0, 12);
  store.set('recent', state.recent);
}

/* ------------------------------------------------------------------ */
/* Shared UI pieces                                                    */
/* ------------------------------------------------------------------ */

const HEART = '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.5-9.3C1 8 3.4 4.5 7 4.5c2 0 3.5 1.1 5 3 1.5-1.9 3-3 5-3 3.6 0 6 3.5 4.5 7.2C19.5 16.4 12 21 12 21z"/></svg>';

function productCard(p) {
  const off = discount(p.price, p.mrp);
  const badge = !p.inStock ? '<span class="tag tag-oos">Sold out</span>' : p.isNew ? '<span class="tag tag-new">New</span>' : '';
  return `<article class="p-card">
    <a href="/product/${esc(p.slug)}" data-link class="p-img" aria-label="${esc(p.name)}">
      <img src="${esc(p.images[0])}" alt="${esc(p.name)}" loading="lazy">
      ${p.images[1] ? `<img class="alt" src="${esc(p.images[1])}" alt="" loading="lazy">` : ''}
      ${p.ratingCount ? `<span class="p-rating">${p.rating} <i>★</i> <span>| ${p.ratingCount}</span></span>` : ''}
    </a>
    <div class="p-tags">${badge}</div>
    <button class="p-heart ${wishlist.has(p.id) ? 'on' : ''}" data-wish="${p.id}" aria-label="Add to wishlist" title="Wishlist">${HEART}</button>
    <div class="p-quick"><button class="btn btn-sm btn-block" data-quick="${esc(p.slug)}">Quick add</button></div>
    <a href="/product/${esc(p.slug)}" data-link class="p-body">
      <span class="p-name">${esc(p.name)}</span>
      <span class="price"><b>${inr(p.price)}</b>${p.mrp > p.price ? `<s>${inr(p.mrp)}</s><span class="off">${off}% OFF</span>` : ''}</span>
      ${p.variantCount > 1 ? `<span class="p-colours"><i style="background:#${esc(p.swatch || 'ccc')}"></i>+${p.variantCount - 1} more colour${p.variantCount > 2 ? 's' : ''}</span>` : ''}
    </a>
  </article>`;
}

function skeletonGrid(n = 8) {
  return `<div class="grid">${'<div class="skeleton sk-card"></div>'.repeat(n)}</div>`;
}

function emptyState(icon, title, text, cta = '<a class="btn" href="/shop" data-link>Start shopping</a>') {
  return `<div class="empty"><div class="big">${icon}</div><h2>${title}</h2><p class="muted">${text}</p>${cta}</div>`;
}

function setTitle(t) {
  document.title = t ? `${t} · ${state.config?.name || 'Zariya'}` : `${state.config?.name || 'Zariya'} · Designer Blouses Online`;
}

function crumbs(parts) {
  return `<nav class="crumbs" aria-label="Breadcrumb"><a href="/" data-link>Home</a>${parts.map(([label, href]) => ` / ${href ? `<a href="${href}" data-link>${esc(label)}</a>` : esc(label)}`).join('')}</nav>`;
}

function openModal(html) {
  $('#modalBody').innerHTML = html;
  $('#modal').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  $('#modal').hidden = true;
  $('#modalBody').innerHTML = '';
  document.body.style.overflow = '';
}

function openDrawer(id) {
  $(id).classList.add('open');
  $(id).setAttribute('aria-hidden', 'false');
  $('#overlay').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeDrawers() {
  $$('.drawer').forEach((d) => { d.classList.remove('open'); d.setAttribute('aria-hidden', 'true'); });
  $('.filters')?.classList.remove('open');
  $('#overlay').hidden = true;
  document.body.style.overflow = '';
}

function renderCartDrawer() {
  const body = $('#drawerBody');
  const foot = $('#drawerFoot');
  if (!state.cart.length) {
    body.innerHTML = emptyState('👜', 'Your bag is empty', 'Add a blouse you love and it will show up here.', '<a class="btn" href="/shop" data-link data-close>Browse blouses</a>');
    foot.innerHTML = '';
    return;
  }
  const total = cart.total();
  const gap = Math.max(0, state.config.freeShippingOver - total);
  body.innerHTML = `<div class="ship-progress" style="margin-top:12px">${gap ? `Add <b>${inr(gap)}</b> more for <b>FREE shipping</b>` : '🎉 You have unlocked <b>FREE shipping</b>'}
    <div class="progress"><i style="width:${Math.min(100, (total / state.config.freeShippingOver) * 100)}%"></i></div></div>
    ${state.cart.map((i) => `<div class="line">
      <a href="/product/${esc(i.slug)}" data-link><img src="${esc(i.image)}" alt=""></a>
      <div><a href="/product/${esc(i.slug)}" data-link><b>${esc(i.name)}</b></a>
        <div class="line-meta">Size: ${i.size === 'Custom' ? 'Custom stitched' : esc(i.size)}${i.stitchingFee ? ` (+${inr(i.stitchingFee)})` : ''}</div>
        <div class="line-actions"><div class="qty"><button data-qty="-1" data-key="${esc(i.key)}" aria-label="Decrease">−</button><input value="${i.qty}" readonly aria-label="Quantity"><button data-qty="1" data-key="${esc(i.key)}" aria-label="Increase">+</button></div>
        <button class="link" data-remove="${esc(i.key)}">Remove</button></div>
      </div>
      <b>${inr((i.price + i.stitchingFee) * i.qty)}</b></div>`).join('')}`;
  foot.innerHTML = `<div class="sum-row total" style="margin:0 0 12px;border:0;padding:0"><span>Subtotal</span><span>${inr(total)}</span></div>
    <p class="small muted" style="margin:0 0 12px">Shipping & coupons are applied at checkout.</p>
    <div class="row"><a class="btn btn-ghost" href="/cart" data-link>View bag</a><a class="btn" href="/checkout" data-link>Checkout</a></div>`;
}

async function quickView(slug) {
  openModal('<div class="spinner"></div>');
  try {
    const p = await api(`/api/products/${encodeURIComponent(slug)}`);
    const off = discount(p.price, p.mrp);
    $('#modalBody').innerHTML = `<div class="qv">
      <img src="${esc(p.images[0])}" alt="${esc(p.name)}">
      <div><div class="p-cat">${esc(p.category)}</div><h2>${esc(p.name)}</h2>
        ${p.ratingCount ? `<div class="rating-line"><span class="rating-chip">${p.rating} ★</span>${p.ratingCount} reviews</div>` : ''}
        <div class="pdp-price"><b>${inr(p.price)}</b>${p.mrp > p.price ? `<s>${inr(p.mrp)}</s><span class="off">${off}% OFF</span>` : ''}</div>
        <p class="muted small">${esc(p.description.split('. ')[0])}.</p>
        ${sizePicker(p)}
        <p class="error" id="qvErr"></p>
        <div class="buy-row"><button class="btn" id="qvAdd">Add to bag</button><a class="btn btn-ghost" href="/product/${esc(p.slug)}" data-link>Full details</a></div>
      </div></div>`;
    wireSizePicker($('#modalBody'), p);
    $('#qvAdd').onclick = () => {
      const size = $('#modalBody .size-btn.on')?.dataset.size;
      if (!size) { $('#qvErr').textContent = 'Please select a size.'; return; }
      if (size === 'Custom') { closeModal(); navigate(`/product/${p.slug}?custom=1`); return; }
      cart.add(p, size, 1);
      closeModal();
      toast(`Added to bag · <a href="/cart" data-link>View bag</a>`);
    };
  } catch (e) {
    $('#modalBody').innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}

function sizePicker(p) {
  return `<div class="opt-label"><span>Select size</span><a class="link small" href="/size-guide" data-link target="_blank">Size chart</a></div>
    <div class="sizes">${state.config.sizes.map((s) => {
      const n = p.stock[s] ?? 0;
      return `<button class="size-btn" data-size="${s}" ${n <= 0 ? 'disabled' : ''}>${s}${n > 0 && n <= 3 ? `<span class="left">${n} left</span>` : ''}</button>`;
    }).join('')}
    ${p.customStitching ? `<button class="size-btn" data-size="Custom">Custom fit ✂</button>` : ''}</div>`;
}

function wireSizePicker(root, _p, onChange) {
  $$('.size-btn', root).forEach((b) => b.addEventListener('click', () => {
    $$('.size-btn', root).forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    onChange?.(b.dataset.size);
  }));
}

/* ------------------------------------------------------------------ */
/* Pages                                                               */
/* ------------------------------------------------------------------ */

const ICON = {
  truck: '<svg viewBox="0 0 24 24"><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/></svg>',
  scissors: '<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/></svg>',
  returns: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  cash: '<svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3 4 6v6c0 5 3.4 8.3 8 9 4.6-.7 8-4 8-9V6l-8-3z"/><path d="m9 12 2 2 4-4"/></svg>',
  tag: '<svg viewBox="0 0 24 24"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>',
};

// Approximate swatch colours for the "Shop by colour" row; unknown names fall back to a neutral.
const COLOUR_HEX = {
  red: 'c21a1f', maroon: '7a1f2b', wine: '5a1a2a', pink: 'e8b4bc', 'rani pink': 'd6177a', green: '1f6b4f', 'bottle green': '1f5a32',
  gold: 'c9a36a', mustard: 'c9962b', black: '1d1d1d', ivory: 'efe4cf', beige: 'd8c3a5', blue: '1b5e7a', navy: '16244a', indigo: '23345c',
  purple: '8e6bb5', silver: 'a9adb3', rust: 'a6432f', white: 'ffffff',
};

const SLIDES = [
  { img: 'shimmer-stretch-bottle-green', slug: 'shimmer-jacquard-stretch-blouse-bottle-green', eyebrow: 'New arrival', title: 'The Shimmer<br>Stretch Edit', text: 'Ready-to-wear jacquard blouses that stretch to fit. No tailor, no waiting.', cta: 'Shop now', href: '/shop?category=readymade' },
  { img: 'shimmer-stretch-red', slug: 'shimmer-jacquard-stretch-blouse-red', eyebrow: 'Festive favourite', title: 'Red that<br>steals the show', text: 'A shimmering foil weave made for pujas, sangeets and every celebration.', cta: 'Shop red', href: '/product/shimmer-jacquard-stretch-blouse-red' },
  { img: 'shimmer-stretch-gold', slug: 'shimmer-jacquard-stretch-blouse-gold', eyebrow: 'Pairs with everything', title: 'Gold goes<br>with every saree', text: 'The one blouse your wardrobe is missing. Now at 50% off.', cta: 'Shop gold', href: '/product/shimmer-jacquard-stretch-blouse-gold' },
  { img: 'shimmer-stretch-rani-pink', slug: 'shimmer-jacquard-stretch-blouse-rani-pink', eyebrow: 'Just dropped', title: 'Rani Pink,<br>made to move', text: 'Soft stretch, princess seams and elbow sleeves for all-day comfort.', cta: 'Shop pink', href: '/product/shimmer-jacquard-stretch-blouse-rani-pink' },
];

let slideTimer = null;

function heroSlider() {
  return `<section class="slider" id="slider" aria-roledescription="carousel" aria-label="Featured">
    <div class="slides">${SLIDES.map((s, i) => `<div class="slide ${i ? '' : 'on'}" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${SLIDES.length}">
      <div class="container slide-inner">
        <div class="slide-copy"><div class="eyebrow">${s.eyebrow}</div><h1>${s.title}</h1><p>${s.text}</p>
          <div class="hero-ctas"><a class="btn" href="${s.href}" data-link>${s.cta}</a><a class="btn btn-ghost" href="/shop" data-link>All blouses</a></div></div>
        <a class="slide-img" href="/product/${s.slug}" data-link><img src="/images/products/${s.img}.webp" alt="" ${i ? 'loading="lazy"' : 'fetchpriority="high"'}></a>
      </div></div>`).join('')}</div>
    <button class="slide-arrow prev" aria-label="Previous slide">‹</button><button class="slide-arrow next" aria-label="Next slide">›</button>
    <div class="slide-dots">${SLIDES.map((_, i) => `<button class="${i ? '' : 'on'}" data-slide="${i}" aria-label="Go to slide ${i + 1}"></button>`).join('')}</div>
  </section>`;
}

function wireSlider() {
  const root = $('#slider');
  if (!root) return;
  const slides = $$('.slide', root);
  const dots = $$('.slide-dots button', root);
  let i = 0;
  const go = (n) => {
    i = (n + slides.length) % slides.length;
    slides.forEach((s, k) => s.classList.toggle('on', k === i));
    dots.forEach((d, k) => d.classList.toggle('on', k === i));
  };
  const restart = () => {
    clearInterval(slideTimer);
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) slideTimer = setInterval(() => { if (!document.getElementById('slider')) clearInterval(slideTimer); else go(i + 1); }, 5500);
  };
  $('.prev', root).onclick = () => { go(i - 1); restart(); };
  $('.next', root).onclick = () => { go(i + 1); restart(); };
  dots.forEach((d) => d.onclick = () => { go(Number(d.dataset.slide)); restart(); });
  let x0 = null;
  root.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  root.addEventListener('pointerup', (e) => {
    if (x0 !== null && Math.abs(e.clientX - x0) > 50) { go(i + (e.clientX < x0 ? 1 : -1)); restart(); }
    x0 = null;
  });
  restart();
}

function productTabs() {
  return `<section class="section"><div class="container">
    <div class="section-head center-head"><div><div class="eyebrow">Trending now</div><h2>Most loved blouses</h2></div></div>
    <div class="rail-tabs" role="tablist"><button class="on" data-rail="sort=popular">Bestsellers</button><button data-rail="new=1&sort=new">New arrivals</button><button data-rail="sale=1&sort=discount">On sale</button></div>
    <div id="rail">${skeletonGrid(8)}</div>
    <div class="center" style="margin-top:28px"><a class="btn btn-ghost" id="railAll" href="/shop?sort=popular" data-link>View all</a></div>
  </div></section>`;
}

async function loadRail(query) {
  $$('.rail-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.rail === query));
  $('#railAll').setAttribute('href', `/shop?${query}`);
  const { products } = await api(`/api/products?${query}&limit=8`);
  const el = $('#rail');
  if (el) el.innerHTML = `<div class="grid">${products.map(productCard).join('')}</div>`;
}

async function homePage() {
  setTitle('');
  const c = state.config;
  app.innerHTML = `${heroSlider()}
  <section class="usp"><div class="container usp-grid">
    <div class="usp-item"><span class="ic">${ICON.truck}</span><div><b>Free shipping</b><span>On orders over ${inr(c.freeShippingOver)}</span></div></div>
    <div class="usp-item"><span class="ic">${ICON.cash}</span><div><b>Cash on Delivery</b><span>Pay when it arrives</span></div></div>
    <div class="usp-item"><span class="ic">${ICON.returns}</span><div><b>${c.returnDays}-day easy returns</b><span>Hassle-free pickups</span></div></div>
    <div class="usp-item"><span class="ic">${ICON.shield}</span><div><b>Secure payments</b><span>UPI · Cards · Netbanking</span></div></div>
  </div></section>
  <section class="section"><div class="container">
    <div class="section-head center-head"><div><div class="eyebrow">Collections</div><h2>Shop by category</h2></div></div>
    <div class="cat-grid">${state.categories.map((cat) => `<a class="cat-tile" href="/shop?category=${esc(cat.slug)}" data-link>
      <div class="ring"><img src="${esc(cat.image || '')}" alt="" loading="lazy"></div><b>${esc(cat.name)}</b></a>`).join('')}</div>
  </div></section>
  ${productTabs()}
  <section class="section banner-wrap"><div class="container">
    <a class="banner" href="/shop?category=readymade" data-link>
      <img src="/images/products/shimmer-stretch-gold.webp" alt="" loading="lazy">
      <div class="banner-copy"><div class="eyebrow">Ready to wear</div><h2>No tailor. No waiting.<br>Just wear it.</h2>
        <p>Stretch jacquard blouses in sizes 32–44, from ${inr(499)}.</p><span class="btn">Shop the Stretch Edit</span></div>
    </a></div></section>
  <section class="section"><div class="container">
    <div class="section-head center-head"><div><div class="eyebrow">Find your match</div><h2>Shop by colour</h2></div></div>
    <div class="colour-row" id="colourRow"></div>
  </div></section>
  <section class="section" style="padding-top:0"><div class="container">
    <div class="section-head center-head"><div><div class="eyebrow">Budget friendly</div><h2>Shop by price</h2></div></div>
    <div class="price-tiles">
      ${[[499, 'Under'], [999, 'Under'], [1999, 'Under'], [2000, 'Premium']].map(([v, label]) => `<a class="price-tile" href="/shop?${label === 'Under' ? `maxPrice=${v}` : `minPrice=${v}`}&sort=price_asc" data-link>
        <span>${label === 'Under' ? 'Under' : 'Luxe'}</span><b>${label === 'Under' ? inr(v) : `${inr(v)}+`}</b><i>Shop now →</i></a>`).join('')}
    </div></div></section>
  <section class="section stitch-band"><div class="container">
    <div class="section-head center-head"><div><div class="eyebrow">Perfect fit, guaranteed</div><h2>Custom stitching in 4 steps</h2></div></div>
    <div class="stitch-grid">
      <div class="stitch-step"><h4>Pick your blouse</h4><p class="muted small">Choose any design marked “Custom fit” and select the Custom size.</p></div>
      <div class="stitch-step"><h4>Share measurements</h4><p class="muted small">Bust, waist, shoulder, lengths and armhole in inches. Our guide shows how.</p></div>
      <div class="stitch-step"><h4>We stitch it</h4><p class="muted small">Master tailors stitch your blouse in 5–7 days with extra margins for alterations.</p></div>
      <div class="stitch-step"><h4>Delivered to you</h4><p class="muted small">Free alterations if anything needs a tweak.</p></div>
    </div><div class="center" style="margin-top:24px"><a class="btn btn-ghost" href="/size-guide" data-link>How to measure</a></div></div></section>
  <section id="recentWrap"></section>`;

  wireSlider();
  $$('.rail-tabs button').forEach((b) => b.onclick = () => loadRail(b.dataset.rail));
  facetsCache ||= await api('/api/products/facets');
  const colours = facetsCache.color.slice(0, 10);
  const row = $('#colourRow');
  if (row) {
    row.innerHTML = colours.map(({ v }) => `<a class="colour-dot" href="/shop?color=${encodeURIComponent(v)}" data-link>
      <i style="background:#${COLOUR_HEX[v.toLowerCase()] || 'bbbbbb'}"></i><span>${esc(v)}</span></a>`).join('');
  }
  await loadRail('sort=popular');
  renderRecent($('#recentWrap'));
}

async function renderRecent(el, excludeId) {
  const ids = state.recent.filter((id) => id !== excludeId).slice(0, 4);
  if (!el || !ids.length) return;
  const { products } = await api(`/api/products?ids=${ids.join(',')}&limit=4`);
  if (!products.length) return;
  products.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  el.innerHTML = `<div class="container section" style="padding-top:0"><div class="section-head"><h2>Recently viewed</h2></div>
    <div class="grid">${products.map(productCard).join('')}</div></div>`;
}

const FILTER_KEYS = ['category', 'fabric', 'sleeve', 'neck', 'occasion', 'work', 'color', 'size'];
let facetsCache = null;

async function shopPage(params) {
  const q = Object.fromEntries(params);
  const cat = state.categories.find((c) => c.slug === q.category);
  const title = q.q ? `Results for “${q.q}”` : cat ? cat.name : q.new ? 'New Arrivals' : q.sale ? 'Sale' : q.featured ? 'Featured' : 'All Blouses';
  setTitle(title);
  app.innerHTML = `<section class="page-hero"><div class="container">${crumbs([['Shop', '/shop'], ...(cat || q.q || q.new || q.sale ? [[title]] : [])])}
    <h1>${esc(title)}</h1><p class="muted" style="margin:0">${esc(cat?.description || 'Silk, embroidered, bridal, cotton and readymade blouses, all in one place.')}</p></div></section>
    <div class="container shop-layout"><aside class="filters" id="filters"><div class="spinner"></div></aside>
    <div><div class="toolbar"><div><button class="btn btn-ghost btn-sm filter-toggle" id="filterToggle">☰ Filters</button> <span class="muted" id="resultCount"></span></div>
      <label class="small">Sort by <select id="sortSel">
        <option value="popular">Popularity</option><option value="new">Newest first</option><option value="price_asc">Price: low to high</option>
        <option value="price_desc">Price: high to low</option><option value="rating">Customer rating</option><option value="discount">Biggest discount</option>
      </select></label></div>
      <div class="active-filters" id="activeFilters"></div>
      <div id="results">${skeletonGrid(8)}</div></div></div>`;

  $('#sortSel').value = q.sort || 'popular';
  $('#sortSel').onchange = (e) => updateQuery({ sort: e.target.value, page: null });
  $('#filterToggle').onclick = () => { $('#filters').classList.add('open'); $('#overlay').hidden = false; };

  facetsCache ||= await api('/api/products/facets');
  renderFilters(facetsCache, q);

  const chips = [];
  for (const k of FILTER_KEYS) {
    for (const v of (q[k] || '').split(',').filter(Boolean)) {
      const label = k === 'category' ? state.categories.find((c) => c.slug === v)?.name || v : k === 'size' ? `Size ${v}` : v;
      chips.push(`<button class="chip on" data-unfilter="${k}" data-val="${esc(v)}">${esc(label)} ✕</button>`);
    }
  }
  if (q.minPrice || q.maxPrice) chips.push(`<button class="chip on" data-unfilter="price">${inr(q.minPrice || 0)} – ${q.maxPrice ? inr(q.maxPrice) : 'max'} ✕</button>`);
  if (q.rating) chips.push(`<button class="chip on" data-unfilter="rating">${q.rating}★ & up ✕</button>`);
  for (const flag of ['new', 'sale', 'featured', 'q']) if (q[flag]) chips.push(`<button class="chip on" data-unfilter="${flag}">${flag === 'q' ? `“${esc(q.q)}”` : flag} ✕</button>`);
  if (chips.length) chips.push('<button class="link small" data-clear-filters>Clear all</button>');
  $('#activeFilters').innerHTML = chips.join('');

  const data = await api(`/api/products?${new URLSearchParams({ ...q, limit: 12 })}`);
  $('#resultCount').textContent = `${data.total} ${data.total === 1 ? 'style' : 'styles'}`;
  if (!data.products.length) {
    $('#results').innerHTML = emptyState('🔍', 'No blouses match', 'Try removing a filter or searching for something else.', '<button class="btn" data-clear-filters>Clear filters</button>');
    return;
  }
  $('#results').innerHTML = `<div class="grid grid-3">${data.products.map(productCard).join('')}</div>
    ${data.pages > 1 ? `<div class="pager">${data.page > 1 ? `<button data-page="${data.page - 1}" aria-label="Previous">‹</button>` : ''}
      ${Array.from({ length: data.pages }, (_, i) => `<button data-page="${i + 1}" class="${i + 1 === data.page ? 'on' : ''}">${i + 1}</button>`).join('')}
      ${data.page < data.pages ? `<button data-page="${data.page + 1}" aria-label="Next">›</button>` : ''}</div>` : ''}`;
  $$('[data-page]').forEach((b) => b.onclick = () => { updateQuery({ page: b.dataset.page }); window.scrollTo(0, 0); });
}

function renderFilters(f, q) {
  const sel = (k) => (q[k] || '').split(',').filter(Boolean);
  const group = (key, label, items, open) => `<details class="filter-group" ${open || sel(key).length ? 'open' : ''}><summary>${label}</summary>
    <div class="filter-opts">${items.map(({ v, n, label: l }) => `<label class="check"><input type="checkbox" data-filter="${key}" value="${esc(v)}" ${sel(key).includes(String(v)) ? 'checked' : ''}>${esc(l || v)}${n != null ? `<span class="n">${n}</span>` : ''}</label>`).join('')}</div></details>`;
  $('#filters').innerHTML = `<div class="drawer-head filter-toggle" style="padding:0 0 10px"><h3>Filters</h3><button class="icon-btn" data-close-drawer>✕</button></div>
    ${group('category', 'Category', state.categories.map((c) => ({ v: c.slug, n: c.count, label: c.name })), true)}
    <details class="filter-group" open><summary>Size in stock</summary><div class="size-chips">${f.sizes.map((s) => `<button class="chip ${sel('size').includes(s) ? 'on' : ''}" data-size-chip="${s}">${s}</button>`).join('')}</div></details>
    <details class="filter-group" open><summary>Price</summary><form class="price-inputs" id="priceForm">
      <input type="number" name="minPrice" placeholder="Min ₹" value="${esc(q.minPrice || '')}" min="0" aria-label="Minimum price">–
      <input type="number" name="maxPrice" placeholder="Max ₹" value="${esc(q.maxPrice || '')}" min="0" aria-label="Maximum price"><button class="btn btn-sm">Go</button></form>
      <div class="size-chips">${[[0, 500], [500, 1000], [1000, 2000], [2000, '']].map(([a, b]) => `<button class="chip" data-price="${a}-${b}">${b ? `${inr(a)}–${inr(b)}` : `${inr(a)}+`}</button>`).join('')}</div></details>
    ${group('fabric', 'Fabric', f.fabric)}
    ${group('occasion', 'Occasion', f.occasion)}
    ${group('work', 'Work / Embellishment', f.work)}
    ${group('sleeve', 'Sleeve', f.sleeve)}
    ${group('neck', 'Neckline', f.neck)}
    ${group('color', 'Colour', f.color)}
    <details class="filter-group"><summary>Customer rating</summary><div class="filter-opts">${[4, 3].map((r) => `<label class="check"><input type="radio" name="rating" data-rating value="${r}" ${q.rating == r ? 'checked' : ''}>${r}★ & above</label>`).join('')}</div></details>`;

  $$('[data-filter]').forEach((cb) => cb.onchange = () => {
    const k = cb.dataset.filter;
    const vals = $$(`[data-filter="${k}"]:checked`).map((x) => x.value);
    updateQuery({ [k]: vals.join(',') || null, page: null });
  });
  $$('[data-size-chip]').forEach((b) => b.onclick = () => {
    const cur = new Set(sel('size'));
    cur.has(b.dataset.sizeChip) ? cur.delete(b.dataset.sizeChip) : cur.add(b.dataset.sizeChip);
    updateQuery({ size: [...cur].join(',') || null, page: null });
  });
  $$('[data-price]').forEach((b) => b.onclick = () => {
    const [a, c] = b.dataset.price.split('-');
    updateQuery({ minPrice: a || null, maxPrice: c || null, page: null });
  });
  $('#priceForm').onsubmit = (e) => {
    e.preventDefault();
    const d = formData(e.target);
    updateQuery({ minPrice: d.minPrice || null, maxPrice: d.maxPrice || null, page: null });
  };
  $$('[data-rating]').forEach((r) => r.onchange = () => updateQuery({ rating: r.value, page: null }));
}

function updateQuery(changes) {
  const params = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(changes)) {
    if (v == null || v === '') params.delete(k); else params.set(k, v);
  }
  navigate(`/shop${params.toString() ? `?${params}` : ''}`, { replace: true, keepScroll: true });
}

async function productPage(slug, params) {
  app.innerHTML = '<div class="spinner"></div>';
  let p;
  try {
    p = await api(`/api/products/${encodeURIComponent(slug)}`);
  } catch {
    setTitle('Not found');
    app.innerHTML = `<div class="container">${emptyState('🧵', 'Blouse not found', 'This product may have been removed or the link is incorrect.')}</div>`;
    return;
  }
  setTitle(p.name);
  rememberViewed(p.id);
  const off = discount(p.price, p.mrp);
  const measure = state.config.measurementFields;
  const labels = { bust: 'Bust', waist: 'Under-bust / Waist', shoulder: 'Shoulder', blouseLength: 'Blouse length', sleeveLength: 'Sleeve length', armhole: 'Armhole' };
  const savedM = store.get('measurements', {});

  app.innerHTML = `<div class="container">
  <div style="padding-top:20px">${crumbs([['Shop', '/shop'], [p.category, `/shop?category=${p.categorySlug}`], [p.name]])}</div>
  <div class="pdp">
    <div class="gallery ${p.images.length < 2 ? 'single' : ''}">
      <div class="thumbs" ${p.images.length < 2 ? 'hidden' : ''}>${p.images.map((src, i) => `<button class="${i ? '' : 'on'}" data-img="${esc(src)}" aria-label="Image ${i + 1}"><img src="${esc(src)}" alt=""></button>`).join('')}</div>
      <div class="main-img" id="mainImg"><img src="${esc(p.images[0])}" alt="${esc(p.name)}"></div>
    </div>
    <div class="pdp-info">
      <div class="p-cat">${esc(p.category)} ${p.isNew ? '<span class="pill pill-green">New</span>' : ''}</div>
      <h1>${esc(p.name)}</h1>
      ${p.ratingCount ? `<a href="#reviews" class="rating-line" id="toReviews"><span class="rating-chip">${p.rating} ★</span>${p.ratingCount} ratings & reviews</a>` : ''}
      <div class="pdp-price"><b>${inr(p.price)}</b>${p.mrp > p.price ? `<s>${inr(p.mrp)}</s><span class="off">${off}% OFF</span>` : ''}</div>
      <div class="muted small">Inclusive of all taxes · ${p.price >= state.config.freeShippingOver ? 'Free shipping' : `Free shipping over ${inr(state.config.freeShippingOver)}`}</div>
      ${p.variants.length > 1 ? `<div class="opt-label"><span>Colour: <b>${esc(p.color)}</b></span><span class="muted small">${p.variants.length} colours</span></div>
        <div class="swatches">${p.variants.map((v) => `<a href="/product/${esc(v.slug)}" data-link class="swatch ${v.slug === p.slug ? 'on' : ''} ${v.inStock ? '' : 'oos'}" title="${esc(v.color)}" aria-label="${esc(v.color)}">
          <img src="${esc(v.image)}" alt=""><span style="background:#${esc(v.swatch || 'ccc')}"></span></a>`).join('')}</div>` : ''}
      ${sizePicker(p)}
      <div class="custom-box" id="customBox" hidden>
        <b>✂ Custom stitching (+${inr(state.config.customStitchingFee)})</b>
        <p class="small muted" style="margin:4px 0 12px">Enter measurements in inches. Not sure how? <a class="link" href="/size-guide" data-link target="_blank">See how to measure</a>. Ships in 5–7 days.</p>
        <form id="measureForm"><div class="row-3">${measure.map((f) => `<div class="field"><label for="m-${f}">${labels[f]}</label><input id="m-${f}" name="${f}" type="number" step="0.5" min="1" max="80" required value="${esc(savedM[f] ?? '')}"></div>`).join('')}</div>
        <div class="field"><label for="m-notes">Style notes (optional)</label><input id="m-notes" name="notes" maxlength="300" placeholder="e.g. padded, back hooks, deeper back neck"></div></form>
      </div>
      <div class="opt-label"><span>Quantity</span></div>
      <div class="qty"><button id="qMinus" aria-label="Decrease">−</button><input id="qtyInput" type="number" value="1" min="1" max="10" aria-label="Quantity"><button id="qPlus" aria-label="Increase">+</button></div>
      <p class="error" id="pdpErr"></p>
      <div class="buy-row">
        <button class="btn" id="addBtn">Add to bag</button>
        <button class="btn btn-gold" id="buyBtn">Buy now</button>
        <button class="btn btn-ghost ${p.inWishlist || wishlist.has(p.id) ? 'on' : ''}" data-wish="${p.id}" style="flex:0" aria-label="Wishlist">${HEART}</button>
      </div>
      <div class="offers" id="offersBox" hidden><div class="offers-head">${ICON.tag}<b>Available offers</b></div><ul id="offersList"></ul></div>
      <div class="pincode"><b>Check delivery</b>
        <form id="pinForm"><input class="input" name="pin" inputmode="numeric" maxlength="6" placeholder="Enter your pincode" value="${esc(store.get('pincode', ''))}" aria-label="Pincode"><button class="btn btn-ghost btn-sm">Check</button></form>
        <div id="pinResult" class="small" style="margin-top:8px"></div></div>
      <div class="trust">
        <div>${ICON.cash}<b>Cash on Delivery</b></div>
        <div>${ICON.returns}<b>${state.config.returnDays}-day returns</b></div>
        <div>${ICON.truck}<b>Free shipping ${inr(state.config.freeShippingOver)}+</b></div>
      </div>
      <div class="accordions">
        <details open><summary>Product details</summary><div><p>${esc(p.description)}</p>
          <div class="specs">${[['Fabric', p.fabric], ['Work', p.work], ['Sleeve', p.sleeve], ['Neckline', p.neck], ['Occasion', p.occasion], ['Colour', p.color],
            ['Fit', p.customStitching ? 'Ready size or custom stitched' : 'Ready to wear, stretchable']]
            .map(([k, v]) => `<div><span>${k}</span>${esc(v || '—')}</div>`).join('')}</div></div></details>
        <details><summary>Size &amp; fit</summary><div><p>Sizes refer to your bust measurement in inches. ${p.customStitching ? 'Between sizes? Choose “Custom fit” and we will stitch it to your measurements.' : 'The stretch fabric gives a snug, comfortable fit; if you are between sizes, pick the larger one.'}</p>
          <a class="link" href="/size-guide" data-link>View size chart</a></div></details>
        <details><summary>Wash &amp; care</summary><div><ul><li>Hand wash cold or dry clean; do not bleach.</li><li>Dry in shade, inside out, to keep the shimmer and colour fresh.</li><li>Iron on reverse at low heat; avoid direct heat on embellishment.</li></ul></div></details>
        <details><summary>Shipping &amp; returns</summary><div><ul><li>Ready sizes dispatch within 24–48 hours${p.customStitching ? '; custom stitched in 5–7 days' : ''}.</li><li>Free shipping on orders over ${inr(state.config.freeShippingOver)}, otherwise ${inr(state.config.shippingFee)}.</li>
          <li>Cash on Delivery available (${inr(state.config.codFee)} handling fee).</li><li>${state.config.returnDays}-day easy returns on ready sizes.</li></ul></div></details>
      </div>
      <div class="share">Share: <button class="btn btn-ghost btn-sm" id="shareWa">WhatsApp</button><button class="btn btn-ghost btn-sm" id="copyLink">Copy link</button>
        <button class="btn btn-ghost btn-sm" data-compare="${p.id}" data-compare-json='${esc(JSON.stringify({ id: p.id, name: p.name, images: p.images }))}'>Compare</button></div>
    </div>
  </div>
  <div class="sticky-buy" id="stickyBuy"><div><b>${inr(p.price)}</b>${p.mrp > p.price ? ` <s>${inr(p.mrp)}</s>` : ''}<span class="small muted" id="stickySize">Select a size</span></div>
    <button class="btn" id="stickyAdd">Add to bag</button></div>
  <section id="reviews" class="section" style="padding-top:20px"><h2>Ratings &amp; Reviews</h2><div id="reviewsBody"></div></section>
  ${p.related.length ? `<section class="section" style="padding-top:0"><div class="section-head"><h2>You may also like</h2></div><div class="grid">${p.related.slice(0, 4).map(productCard).join('')}</div></section>` : ''}
  </div><div id="recentWrap"></div>`;

  // Gallery with thumbnail switching and hover zoom.
  const main = $('#mainImg');
  $$('.thumbs button').forEach((b) => b.onclick = () => {
    $$('.thumbs button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    $('img', main).src = b.dataset.img;
  });
  main.onmousemove = (e) => {
    const r = main.getBoundingClientRect();
    $('img', main).style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
  };
  main.onclick = () => main.classList.toggle('zoom');
  main.onmouseleave = () => main.classList.remove('zoom');

  let size = null;
  wireSizePicker(app, p, (s) => {
    size = s;
    $('#stickySize').textContent = s === 'Custom' ? 'Custom fit' : `Size ${s}`;
    $('#customBox').hidden = s !== 'Custom';
    $('#pdpErr').textContent = '';
  });
  if (params.get('custom') && p.customStitching) $('.size-btn[data-size="Custom"]')?.click();

  const qtyInput = $('#qtyInput');
  $('#qMinus').onclick = () => { qtyInput.value = Math.max(1, Number(qtyInput.value) - 1); };
  $('#qPlus').onclick = () => { qtyInput.value = Math.min(10, Number(qtyInput.value) + 1); };

  const addToCart = () => {
    if (!size) { $('#pdpErr').textContent = 'Please select a size.'; $('.sizes').scrollIntoView({ block: 'center', behavior: 'smooth' }); return false; }
    let measurements = null;
    if (size === 'Custom') {
      const form = $('#measureForm');
      if (!form.reportValidity()) return false;
      measurements = formData(form);
      const { notes, ...keep } = measurements;
      store.set('measurements', keep);
    } else {
      const inCart = state.cart.find((i) => i.key === `${p.id}|${size}`)?.qty || 0;
      if (Number(qtyInput.value) + inCart > p.stock[size]) { $('#pdpErr').textContent = `Only ${p.stock[size]} available in size ${size}.`; return false; }
    }
    cart.add(p, size, Math.max(1, Math.min(10, Number(qtyInput.value) || 1)), measurements);
    return true;
  };
  $('#addBtn').onclick = () => { if (addToCart()) { renderCartDrawer(); openDrawer('#cartDrawer'); } };
  $('#buyBtn').onclick = () => { if (addToCart()) navigate('/checkout'); };

  const checkPin = async (pin) => {
    const out = $('#pinResult');
    try {
      const r = await api(`/api/pincode/${encodeURIComponent(pin)}`);
      store.set('pincode', pin);
      out.innerHTML = `<span class="success">✓ Delivery to ${esc(r.region)} by <b>${dateFmt(r.eta, { weekday: 'short', day: 'numeric', month: 'short' })}</b></span>
        · ${r.cod ? 'COD available' : 'Prepaid only'}${size === 'Custom' ? ' · add 5–7 days for stitching' : ''}`;
    } catch (e) { out.innerHTML = `<span class="error">${esc(e.message)}</span>`; }
  };
  $('#pinForm').onsubmit = (e) => { e.preventDefault(); checkPin(e.target.pin.value.trim()); };
  if (store.get('pincode')) checkPin(store.get('pincode'));

  $('#shareWa').onclick = () => window.open(`https://wa.me/?text=${encodeURIComponent(`${p.name} – ${inr(p.price)} ${location.href}`)}`, '_blank', 'noopener');
  $('#copyLink').onclick = async () => {
    try { await navigator.clipboard.writeText(location.href); toast('Link copied'); } catch { toast('Could not copy link', true); }
  };

  $('#stickyAdd').onclick = () => $('#addBtn').click();
  // Show the sticky buy bar once the main buttons scroll out of view (mobile).
  const io = new IntersectionObserver(([e]) => $('#stickyBuy')?.classList.toggle('show', !e.isIntersecting && e.boundingClientRect.top < 0));
  io.observe($('.buy-row'));

  api('/api/coupons').then((coupons) => {
    if (!coupons.length || !$('#offersBox')) return;
    $('#offersList').innerHTML = coupons.map((c) => `<li><span>${esc(c.description || '')}</span> <button class="coupon-code" data-copy-code="${esc(c.code)}" title="Copy code">${esc(c.code)}</button></li>`).join('');
    $('#offersBox').hidden = false;
    $$('[data-copy-code]').forEach((btn) => btn.onclick = async () => {
      state.coupon = btn.dataset.copyCode;
      store.set('coupon', state.coupon);
      try { await navigator.clipboard.writeText(btn.dataset.copyCode); } catch { /* clipboard optional */ }
      toast(`Code ${esc(btn.dataset.copyCode)} will be applied at checkout`);
    });
  }).catch(() => {});

  renderReviews(p);
  renderRecent($('#recentWrap'), p.id);
}

function renderReviews(p) {
  const max = Math.max(1, ...p.breakdown.map((b) => b.count));
  $('#reviewsBody').innerHTML = `<div class="reviews-wrap">
    <div><div class="rating-big">${p.rating || '–'}<span style="font-size:24px">★</span></div><div class="muted small">${p.ratingCount} ratings</div>
      <div style="margin:14px 0">${p.breakdown.map((b) => `<div class="bar-row">${b.star}★<div class="bar"><i style="width:${(b.count / max) * 100}%"></i></div>${b.count}</div>`).join('')}</div>
      <div id="reviewFormWrap">${state.user ? `<button class="btn btn-outline btn-block" id="writeReview">${p.myReview ? 'Edit your review' : 'Write a review'}</button>`
        : `<a class="btn btn-outline btn-block" href="/login?next=${encodeURIComponent(location.pathname)}" data-link>Log in to review</a>`}</div></div>
    <div>${p.reviews.length ? p.reviews.map((r) => `<div class="review"><span class="rating-chip">${r.rating} ★</span> <b>${esc(r.title || '')}</b>
      <p style="margin:6px 0">${esc(r.body)}</p><div class="muted small">${esc(r.author)} · ${dateFmt(r.created_at)}${r.verified ? ' · <span class="success">✓ Verified buyer</span>' : ''}</div></div>`).join('')
      : '<p class="muted">No reviews yet. Be the first to share your thoughts!</p>'}</div></div>`;
  $('#writeReview')?.addEventListener('click', () => {
    $('#reviewFormWrap').innerHTML = `<form id="reviewForm" class="card" style="padding:16px">
      <div class="star-input">${[5, 4, 3, 2, 1].map((n) => `<input type="radio" name="rating" id="st${n}" value="${n}"><label for="st${n}" title="${n} stars">★</label>`).join('')}</div>
      <div class="field"><input name="title" placeholder="Title" maxlength="120" class="input"></div>
      <div class="field"><textarea name="body" rows="4" placeholder="How was the fit, fabric and finish?" required class="input"></textarea></div>
      <p class="error" id="revErr"></p><button class="btn btn-block">Submit review</button></form>`;
    $('#reviewForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api(`/api/products/${p.id}/reviews`, { method: 'POST', body: formData(e.target) });
        toast('Thanks for your review!');
        productPage(p.slug, new URLSearchParams());
      } catch (err) { $('#revErr').textContent = err.message; }
    };
  });
}

async function cartPage() {
  setTitle('Your Bag');
  if (!state.cart.length) {
    app.innerHTML = `<div class="container">${emptyState('👜', 'Your bag is empty', 'Looks like you have not added anything yet.')}</div>`;
    return;
  }
  app.innerHTML = '<div class="spinner"></div>';
  let q;
  let err = '';
  try {
    q = await api('/api/cart/quote', { method: 'POST', body: { items: cart.payload(), coupon: state.coupon } });
  } catch (e) { err = e.message; }
  const coupons = await api('/api/coupons').catch(() => []);

  app.innerHTML = `<div class="container"><div style="padding-top:24px">${crumbs([['Bag']])}<h1>Your Bag (${state.cart.reduce((t, i) => t + i.qty, 0)})</h1></div>
  <div class="cart-layout"><div>
    ${err ? `<div class="card" style="border-color:var(--red);margin-bottom:16px"><span class="error">⚠ ${esc(err)}</span> Please update your bag below.</div>` : ''}
    ${q?.freeShippingGap ? `<div class="ship-progress">Add <b>${inr(q.freeShippingGap)}</b> more to get <b>FREE shipping</b><div class="progress"><i style="width:${Math.min(100, 100 - (q.freeShippingGap / state.config.freeShippingOver) * 100)}%"></i></div></div>` : ''}
    ${state.cart.map((i) => `<div class="line"><a href="/product/${esc(i.slug)}" data-link><img src="${esc(i.image)}" alt=""></a>
      <div><a href="/product/${esc(i.slug)}" data-link><b>${esc(i.name)}</b></a>
        <div class="line-meta">Size: ${i.size === 'Custom' ? 'Custom stitched' : esc(i.size)} · ${inr(i.price)}${i.mrp > i.price ? ` <s>${inr(i.mrp)}</s>` : ''}</div>
        ${i.measurements ? `<div class="line-meta">Bust ${i.measurements.bust}″ · Waist ${i.measurements.waist}″ · Shoulder ${i.measurements.shoulder}″ · Length ${i.measurements.blouseLength}″ (+${inr(i.stitchingFee)} stitching)</div>` : ''}
        <div class="line-actions"><div class="qty"><button data-qty="-1" data-key="${esc(i.key)}" aria-label="Decrease">−</button><input value="${i.qty}" readonly aria-label="Quantity"><button data-qty="1" data-key="${esc(i.key)}" aria-label="Increase">+</button></div>
          <button class="link" data-remove="${esc(i.key)}">Remove</button><button class="link" data-save-later="${esc(i.key)}">Move to wishlist</button></div></div>
      <b>${inr((i.price + i.stitchingFee) * i.qty)}</b></div>`).join('')}
    <div style="margin-top:18px"><a class="link" href="/shop" data-link>← Continue shopping</a></div>
  </div>
  <aside class="summary card"><h3>Order summary</h3>
    <form class="coupon-form" id="couponForm"><input class="input" name="code" placeholder="Coupon code" value="${esc(state.coupon)}" aria-label="Coupon code"><button class="btn btn-ghost btn-sm">${state.coupon ? 'Update' : 'Apply'}</button></form>
    ${q?.coupon ? `<div class="success small">✓ ${esc(q.coupon.code)} applied: ${esc(q.coupon.description || '')} <button class="link small" id="rmCoupon">Remove</button></div>` : ''}
    ${q?.couponError ? `<div class="error">${esc(q.couponError)}</div>` : ''}
    ${!q?.coupon && coupons.length ? `<details style="margin:8px 0 12px"><summary class="small link">View available offers (${coupons.length})</summary><div class="coupon-list">
      ${coupons.map((c) => `<div class="coupon-opt"><span><code>${esc(c.code)}</code><br><span class="muted">${esc(c.description || '')}</span></span><button class="btn btn-sm btn-outline" data-apply-coupon="${esc(c.code)}">Apply</button></div>`).join('')}</div></details>` : ''}
    ${q ? summaryRows(q) : ''}
    <a class="btn btn-block" style="margin-top:16px" href="/checkout" data-link ${err ? 'aria-disabled="true" onclick="return false"' : ''}>Proceed to checkout</a>
    <p class="small muted center" style="margin:10px 0 0">🔒 Safe &amp; secure payments</p>
  </aside></div></div>`;

  $('#couponForm').onsubmit = (e) => {
    e.preventDefault();
    state.coupon = e.target.code.value.trim().toUpperCase();
    store.set('coupon', state.coupon);
    cartPage();
  };
  $('#rmCoupon')?.addEventListener('click', () => { state.coupon = ''; store.set('coupon', ''); cartPage(); });
  $$('[data-apply-coupon]').forEach((b) => b.onclick = () => { state.coupon = b.dataset.applyCoupon; store.set('coupon', state.coupon); cartPage(); });
  $$('[data-save-later]').forEach((b) => b.onclick = async () => {
    const item = state.cart.find((i) => i.key === b.dataset.saveLater);
    if (!wishlist.has(item.productId)) await wishlist.toggle(item.productId);
    cart.remove(item.key);
    cartPage();
  });
}

function summaryRows(q) {
  return `<div class="sum-row"><span>Subtotal (MRP ${inr(q.mrpTotal)})</span><span>${inr(q.subtotal)}</span></div>
    ${q.stitching ? `<div class="sum-row"><span>Custom stitching</span><span>${inr(q.stitching)}</span></div>` : ''}
    ${q.discount ? `<div class="sum-row success"><span>Coupon discount</span><span>−${inr(q.discount)}</span></div>` : ''}
    <div class="sum-row"><span>Shipping</span><span>${q.shipping ? inr(q.shipping) : '<span class="success">FREE</span>'}</span></div>
    ${q.codFee ? `<div class="sum-row"><span>COD handling</span><span>${inr(q.codFee)}</span></div>` : ''}
    <div class="sum-row total"><span>Total</span><span>${inr(q.total)}</span></div>
    ${q.savings > 0 ? `<div class="savings">You save ${inr(q.savings)} on this order 🎉</div>` : ''}`;
}

async function checkoutPage() {
  setTitle('Checkout');
  if (!state.cart.length) { navigate('/cart', { replace: true }); return; }
  app.innerHTML = '<div class="spinner"></div>';
  const addresses = state.user ? await api('/api/addresses').catch(() => []) : [];
  let payment = 'online';
  let selectedAddr = addresses.find((a) => a.is_default) || addresses[0] || null;

  app.innerHTML = `<div class="container"><div style="padding-top:24px">${crumbs([['Bag', '/cart'], ['Checkout']])}<h1>Checkout</h1>
    <div class="steps"><span>Bag</span>›<span class="on">Address &amp; Payment</span>›<span>Confirmation</span></div></div>
  <div class="cart-layout"><form id="checkoutForm" novalidate>
    <div class="card" style="margin-bottom:18px"><h3>1. Contact</h3>
      ${state.user ? `<p style="margin:0">Logged in as <b>${esc(state.user.name)}</b> (${esc(state.user.email)})</p>`
        : `<div class="field"><label for="co-email">Email for order updates</label><input id="co-email" name="email" type="email" required value="${esc(store.get('guestEmail', ''))}"></div>
           <p class="small muted" style="margin:0">Have an account? <a class="link" href="/login?next=/checkout" data-link>Log in</a> for faster checkout.</p>`}
    </div>
    <div class="card" style="margin-bottom:18px"><h3>2. Delivery address</h3>
      ${addresses.length ? `<div class="addr-list">${addresses.map((a) => `<label class="addr-opt ${selectedAddr?.id === a.id ? 'on' : ''}"><input type="radio" name="addrId" value="${a.id}" ${selectedAddr?.id === a.id ? 'checked' : ''}>
        <span><b>${esc(a.name)}</b> ${a.is_default ? '<span class="pill">Default</span>' : ''}<br>${esc(a.line1)}${a.line2 ? `, ${esc(a.line2)}` : ''}, ${esc(a.city)}, ${esc(a.state)} ${esc(a.pincode)}<br>📞 ${esc(a.phone)}</span></label>`).join('')}
        <label class="addr-opt ${selectedAddr ? '' : 'on'}"><input type="radio" name="addrId" value="new" ${selectedAddr ? '' : 'checked'}><span><b>+ Deliver to a new address</b></span></label></div>` : ''}
      <div id="newAddr" ${selectedAddr ? 'hidden' : ''}>${addressFields(state.user ? { name: state.user.name, phone: state.user.phone } : store.get('guestAddr', {}))}
        ${state.user ? '<label class="check"><input type="checkbox" name="saveAddress" checked> Save this address for next time</label>' : ''}</div>
    </div>
    <div class="card"><h3>3. Payment</h3><div id="payOpts"></div>
      <div class="field" style="margin-top:12px"><label for="co-notes">Order notes (optional)</label><textarea id="co-notes" name="notes" rows="2" maxlength="500" placeholder="Gift message, delivery instructions…"></textarea></div>
    </div>
  </form>
  <aside class="summary card"><h3>Order summary</h3><div class="mini-lines">${state.cart.map((i) => `<div class="mini-line"><img src="${esc(i.image)}" alt=""><div style="flex:1">${esc(i.name)}<div class="muted small">Size ${i.size === 'Custom' ? 'Custom' : esc(i.size)} × ${i.qty}</div></div><b>${inr((i.price + i.stitchingFee) * i.qty)}</b></div>`).join('')}</div>
    <div id="coSummary"></div><p class="error" id="coErr"></p>
    <button class="btn btn-block" id="placeBtn" form="checkoutForm">Place order</button>
    <p class="small muted center" style="margin:10px 0 0">By placing your order you agree to our <a class="link" href="/terms" data-link>terms</a>.</p></aside>
  </div></div>`;

  const refresh = async () => {
    try {
      const q = await api('/api/cart/quote', { method: 'POST', body: { items: cart.payload(), coupon: state.coupon, paymentMethod: payment } });
      $('#coSummary').innerHTML = `${q.coupon ? `<div class="success small">Coupon ${esc(q.coupon.code)} applied</div>` : ''}${summaryRows(q)}`;
      const pin = selectedAddr?.pincode || $('#checkoutForm [name=pincode]')?.value || '';
      const codOk = q.codAvailable && pin[0] !== '9';
      if (!codOk && payment === 'cod') { payment = 'online'; return refresh(); }
      $('#payOpts').innerHTML = `
        <label class="pay-opt ${payment === 'online' ? 'on' : ''}"><input type="radio" name="payment" value="online" ${payment === 'online' ? 'checked' : ''}>
          <span><b>UPI / Cards / Netbanking</b>${state.config.paymentProvider === 'demo' ? ' <span class="pill pill-gold">Demo mode</span>' : ''}<br><span class="small muted">GPay, PhonePe, Paytm, Visa, Mastercard, RuPay</span></span></label>
        <label class="pay-opt ${payment === 'cod' ? 'on' : ''} ${codOk ? '' : 'disabled'}"><input type="radio" name="payment" value="cod" ${payment === 'cod' ? 'checked' : ''} ${codOk ? '' : 'disabled'}>
          <span><b>Cash on Delivery</b><br><span class="small muted">${codOk ? `${inr(state.config.codFee)} handling fee applies` : `Not available for this order${q.codAvailable ? ' / pincode' : ` (orders above ${inr(state.config.codMaxOrder)})`}`}</span></span></label>`;
      $$('#payOpts [name=payment]').forEach((r) => r.onchange = () => { payment = r.value; refresh(); });
      $('#placeBtn').textContent = payment === 'cod' ? `Place order · ${inr(q.total)}` : `Pay ${inr(q.total)}`;
      $('#coErr').textContent = q.couponError ? `${q.couponError} (coupon will be removed)` : '';
      if (q.couponError) { state.coupon = ''; store.set('coupon', ''); }
    } catch (e) {
      $('#coErr').textContent = e.message;
      $('#placeBtn').disabled = true;
    }
  };
  refresh();

  $$('[name=addrId]').forEach((r) => r.onchange = () => {
    $$('.addr-opt').forEach((l) => l.classList.toggle('on', l.contains(r) && r.checked));
    selectedAddr = addresses.find((a) => String(a.id) === r.value) || null;
    $('#newAddr').hidden = !!selectedAddr;
    refresh();
  });
  $('#checkoutForm [name=pincode]')?.addEventListener('change', refresh);

  $('#checkoutForm').onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const d = formData(form);
    const needed = [...form.querySelectorAll('input[required]')].filter((i) => !i.closest('[hidden]'));
    for (const i of needed) if (!i.reportValidity()) return;
    const address = selectedAddr || { name: d.name, phone: d.phone, line1: d.line1, line2: d.line2, city: d.city, state: d.state, pincode: d.pincode };
    if (!state.user) { store.set('guestEmail', d.email); store.set('guestAddr', address); }
    const btn = $('#placeBtn');
    btn.disabled = true;
    btn.textContent = 'Placing order…';
    try {
      const order = await api('/api/orders', {
        method: 'POST',
        body: { items: cart.payload(), coupon: state.coupon, paymentMethod: payment, address, email: d.email, notes: d.notes, saveAddress: !!d.saveAddress },
      });
      cart.clear();
      state.coupon = '';
      store.set('coupon', '');
      const guestOrders = store.get('guestOrders', []);
      if (!state.user) store.set('guestOrders', [{ n: order.order_number, t: order.token }, ...guestOrders].slice(0, 20));
      navigate(payment === 'online' ? `/pay/${order.order_number}?t=${order.token}` : `/order/${order.order_number}?t=${order.token}&new=1`, { replace: true });
    } catch (err) {
      $('#coErr').textContent = err.message;
      btn.disabled = false;
      refresh();
    }
  };
}

const STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir',
  'Ladakh', 'Lakshadweep', 'Puducherry'];

function addressFields(a = {}) {
  return `<div class="row"><div class="field"><label>Full name</label><input name="name" required value="${esc(a.name || '')}" autocomplete="name"></div>
    <div class="field"><label>Mobile number</label><input name="phone" required pattern="[6-9][0-9]{9}" inputmode="numeric" maxlength="10" value="${esc(a.phone || '')}" autocomplete="tel-national" title="10-digit mobile number"></div></div>
    <div class="field"><label>Flat, house no., building, street</label><input name="line1" required value="${esc(a.line1 || '')}" autocomplete="address-line1"></div>
    <div class="field"><label>Area, landmark (optional)</label><input name="line2" value="${esc(a.line2 || '')}" autocomplete="address-line2"></div>
    <div class="row-3"><div class="field"><label>Pincode</label><input name="pincode" required pattern="[1-9][0-9]{5}" inputmode="numeric" maxlength="6" value="${esc(a.pincode || '')}" autocomplete="postal-code" title="6-digit pincode"></div>
    <div class="field"><label>City</label><input name="city" required value="${esc(a.city || '')}" autocomplete="address-level2"></div>
    <div class="field"><label>State</label><select name="state" required><option value="">Select</option>${STATES.map((s) => `<option ${a.state === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div></div>`;
}

async function payPage(num, params) {
  setTitle('Payment');
  const t = params.get('t') || '';
  let o;
  try { o = await api(`/api/orders/${encodeURIComponent(num)}?t=${encodeURIComponent(t)}`); } catch (e) {
    app.innerHTML = `<div class="container">${emptyState('⚠️', 'Order not found', esc(e.message))}</div>`; return;
  }
  if (o.payment_status === 'paid') { navigate(`/order/${num}?t=${t}&new=1`, { replace: true }); return; }
  const done = () => navigate(`/order/${num}?t=${t}&new=1`, { replace: true });
  let session;
  try {
    session = await api(`/api/orders/${encodeURIComponent(num)}/payment-session`, { method: 'POST', body: { token: t } });
  } catch (e) {
    app.innerHTML = `<div class="container">${emptyState('⚠️', 'Could not start payment', esc(e.message), `<button class="btn" onclick="location.reload()">Try again</button>`)}</div>`;
    return;
  }
  if (session.paid) { done(); return; }
  if (session.provider === 'razorpay') { razorpayCheckout(num, t, o, session, done); return; }

  let method = 'upi';
  app.innerHTML = `<div class="container gateway"><div class="demo-note">🧪 <b>Demo payment mode</b>: no real money is charged. Real payments switch on once gateway keys are added.</div>
    <div class="gateway-head"><b>🔒 Secure Checkout</b><span>${inr(o.total)}</span></div>
    <div class="card"><p class="small muted" style="margin-top:0">Paying ${esc(state.config.name)} for order #${esc(o.order_number)}</p>
      <div class="tabs" style="margin-top:0"><button type="button" class="on" data-m="upi">UPI</button><button type="button" data-m="card">Card</button><button type="button" data-m="nb">Netbanking</button></div>
      <div id="payBody" style="padding-top:16px"></div>
      <p class="error" id="payErr"></p>
      <button class="btn btn-block" id="payNow" style="background:#1f3b63;border-color:#1f3b63">Pay ${inr(o.total)}</button>
      <button class="link small" id="payFail" style="display:block;margin:12px auto 0">Simulate a failed payment</button>
      <p class="small muted center">Any details work here: this simulates the gateway.</p></div></div>`;
  const bodies = {
    upi: `<div class="upi-apps"><button type="button" class="on">GPay</button><button type="button">PhonePe</button><button type="button">Paytm</button></div>
      <div class="field"><label>Or enter UPI ID</label><input class="input" placeholder="yourname@upi"></div>`,
    card: `<div class="field"><label>Card number</label><input class="input" inputmode="numeric" placeholder="4111 1111 1111 1111" maxlength="19"></div>
      <div class="row"><div class="field"><label>Expiry</label><input class="input" placeholder="MM/YY" maxlength="5"></div><div class="field"><label>CVV</label><input class="input" type="password" maxlength="4" placeholder="•••"></div></div>`,
    nb: `<div class="field"><label>Select your bank</label><select class="input"><option>State Bank of India</option><option>HDFC Bank</option><option>ICICI Bank</option><option>Axis Bank</option><option>Kotak Mahindra Bank</option></select></div>`,
  };
  const show = (m) => {
    method = m;
    $$('.gateway .tabs button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
    $('#payBody').innerHTML = bodies[m];
    $$('.upi-apps button').forEach((b) => b.onclick = () => { $$('.upi-apps button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); });
  };
  $$('.gateway .tabs button').forEach((b) => b.onclick = () => show(b.dataset.m));
  show('upi');
  const pay = async (success) => {
    $('#payNow').disabled = true;
    $('#payNow').textContent = 'Processing…';
    await new Promise((r) => setTimeout(r, 900));
    try {
      const r = await api(`/api/orders/${encodeURIComponent(num)}/pay`, { method: 'POST', body: { token: t, success, method } });
      if (r.payment_status === 'paid') done();
      else {
        $('#payErr').textContent = 'Payment failed. No money was deducted. Please try again.';
        $('#payNow').disabled = false;
        $('#payNow').textContent = `Retry payment · ${inr(o.total)}`;
      }
    } catch (e) { $('#payErr').textContent = e.message; $('#payNow').disabled = false; }
  };
  $('#payNow').onclick = () => pay(true);
  $('#payFail').onclick = () => pay(false);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the payment window. Check your connection and try again.'));
    document.head.appendChild(s);
  });
}

// Razorpay Standard Checkout; the server verifies the returned signature before marking the order paid.
async function razorpayCheckout(num, t, o, session, done) {
  app.innerHTML = `<div class="container gateway"><div class="card center"><h2>Complete your payment</h2>
    <p class="muted">Order #${esc(o.order_number)} · <b>${inr(o.total)}</b></p><p class="error" id="payErr"></p>
    <button class="btn btn-block" id="payNow">Pay ${inr(o.total)}</button>
    <p class="small muted">🔒 Payments are processed securely by Razorpay (UPI, cards, netbanking, wallets).</p></div></div>`;
  const open = async () => {
    try {
      await loadScript('https://checkout.razorpay.com/v1/checkout.js');
      const rz = new window.Razorpay({
        ...session.checkout,
        handler: async (resp) => {
          try {
            await api(`/api/orders/${encodeURIComponent(num)}/pay`, { method: 'POST', body: { token: t, ...resp } });
            done();
          } catch (e) { $('#payErr').textContent = e.message; }
        },
        modal: { ondismiss: () => { $('#payErr').textContent = 'Payment was not completed. You can try again.'; } },
      });
      rz.on('payment.failed', (r) => { $('#payErr').textContent = r.error?.description || 'Payment failed. Please try again.'; });
      rz.open();
    } catch (e) { $('#payErr').textContent = e.message; }
  };
  $('#payNow').onclick = open;
  open();
}

const TIMELINE = ['placed', 'confirmed', 'packed', 'shipped', 'out_for_delivery', 'delivered'];

function orderTimeline(o) {
  if (['cancelled', 'return_requested', 'returned'].includes(o.status)) {
    return `<div class="card" style="margin:20px 0"><span class="pill ${o.status === 'cancelled' ? 'pill-red' : 'pill-gold'}">${statusLabel(o.status)}</span></div>`;
  }
  const idx = TIMELINE.indexOf(o.status);
  return `<div class="timeline"><div class="tl-fill" style="width:calc(${(idx / (TIMELINE.length - 1)) * 100}% - 28px)"></div>
    ${TIMELINE.map((s, i) => `<div class="tl-step ${i <= idx ? 'done' : ''}"><i>${i <= idx ? '✓' : i + 1}</i><span>${statusLabel(s)}</span></div>`).join('')}</div>`;
}

function orderDetail(o, fresh) {
  const a = o.address;
  const tokenQ = `t=${encodeURIComponent(o.token)}`;
  return `${fresh ? `<div class="card center" style="margin:24px 0"><div class="confetti">🎉</div><h1>Thank you, ${esc(a.name.split(' ')[0])}!</h1>
      <p class="muted">Your order <b>#${esc(o.order_number)}</b> has been placed. A confirmation has been sent to ${esc(o.email)}.</p>
      ${o.payment_method === 'online' && o.payment_status !== 'paid' ? `<a class="btn" href="/pay/${esc(o.order_number)}?${tokenQ}" data-link>Complete payment</a>` : ''}</div>` : ''}
    <div class="order-card-head"><div><h2 style="margin:0">Order #${esc(o.order_number)}</h2><span class="muted small">Placed on ${dateFmt(o.created_at, { dateStyle: 'long' })}</span></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn btn-ghost btn-sm" href="/invoice/${esc(o.order_number)}?${tokenQ}" target="_blank" rel="noopener">🧾 Invoice</a>
      ${o.canCancel ? '<button class="btn btn-ghost btn-sm" id="cancelOrder">Cancel order</button>' : ''}
      ${o.canReturn ? '<button class="btn btn-ghost btn-sm" id="returnOrder">Request return</button>' : ''}
      <button class="btn btn-ghost btn-sm" id="reorder">Buy again</button></div></div>
    ${orderTimeline(o)}
    ${o.tracking_number ? `<p>🚚 Tracking number: <b>${esc(o.tracking_number)}</b></p>` : ''}
    <div class="cart-layout" style="padding-top:0"><div class="card">${o.items.map((i) => `<div class="mini-line"><img src="${esc(i.image || '')}" alt="">
        <div style="flex:1"><b>${esc(i.name)}</b><div class="muted small">Size ${esc(i.size)} × ${i.qty}${i.measurements ? ` · Bust ${i.measurements.bust}″, Waist ${i.measurements.waist}″, Shoulder ${i.measurements.shoulder}″` : ''}</div></div>
        <b>${inr((i.price + i.stitching_fee) * i.qty)}</b></div>`).join('')}
      <h3 style="margin-top:22px">Status history</h3><ul class="history">${o.history.slice().reverse().map((h) => `<li><b>${statusLabel(h.status)}</b> <span class="muted small">· ${dateFmt(h.at, { dateStyle: 'medium', timeStyle: 'short' })}</span>${h.note ? `<br><span class="small">${esc(h.note)}</span>` : ''}</li>`).join('')}</ul></div>
    <aside class="card"><h3>Delivery to</h3><p style="margin-top:0">${esc(a.name)}<br>${esc(a.line1)}${a.line2 ? `, ${esc(a.line2)}` : ''}<br>${esc(a.city)}, ${esc(a.state)} ${esc(a.pincode)}<br>📞 ${esc(a.phone)}</p>
      <h3>Payment</h3><p style="margin-top:0">${o.payment_method === 'cod' ? 'Cash on Delivery' : 'Online'} · <span class="pill ${o.payment_status === 'paid' ? 'pill-green' : 'pill-gold'}">${statusLabel(o.payment_status)}</span></p>
      ${summaryRows({ ...o, mrpTotal: o.subtotal, codFee: o.cod_fee, savings: 0 })}</aside></div>`;
}

function wireOrderActions(o, reload) {
  const body = { token: o.token };
  $('#cancelOrder')?.addEventListener('click', async () => {
    const reason = prompt('Reason for cancellation (optional):', '');
    if (reason === null) return;
    try { await api(`/api/orders/${o.order_number}/cancel`, { method: 'POST', body: { ...body, reason } }); toast('Order cancelled'); reload(); } catch (e) { toast(e.message, true); }
  });
  $('#returnOrder')?.addEventListener('click', async () => {
    const reason = prompt('Why are you returning this order? (e.g. size issue, damaged)');
    if (!reason) return;
    try { await api(`/api/orders/${o.order_number}/return`, { method: 'POST', body: { ...body, reason } }); toast('Return requested. We will schedule a pickup.'); reload(); } catch (e) { toast(e.message, true); }
  });
  $('#reorder')?.addEventListener('click', async () => {
    let added = 0;
    for (const i of o.items) {
      if (!i.product_id) continue;
      state.cart.push({ key: i.size === 'Custom' ? `${i.product_id}|Custom|${Date.now()}${added}` : `${i.product_id}|${i.size}`, productId: i.product_id, slug: '', name: i.name, image: i.image,
        price: i.price, mrp: i.price, size: i.size, qty: i.qty, measurements: i.measurements, stitchingFee: i.stitching_fee });
      added++;
    }
    // Deduplicate ready-size lines.
    const merged = new Map();
    for (const it of state.cart) merged.has(it.key) ? (merged.get(it.key).qty += it.qty) : merged.set(it.key, it);
    state.cart = [...merged.values()];
    cart.save();
    toast(`${added} item(s) added to bag`);
    navigate('/cart');
  });
}

async function orderPage(num, params) {
  setTitle(`Order ${num}`);
  app.innerHTML = '<div class="spinner"></div>';
  const t = params.get('t') || '';
  try {
    const o = await api(`/api/orders/${encodeURIComponent(num)}${t ? `?t=${encodeURIComponent(t)}` : ''}`);
    app.innerHTML = `<div class="container" style="padding:24px 0 60px">${crumbs([['Orders', state.user ? '/account/orders' : '/track'], [`#${num}`]])}${orderDetail(o, params.get('new'))}</div>`;
    wireOrderActions(o, () => orderPage(num, new URLSearchParams({ t: o.token })));
  } catch (e) {
    app.innerHTML = `<div class="container">${emptyState('📦', 'Order not found', esc(e.message), '<a class="btn" href="/track" data-link>Track an order</a>')}</div>`;
  }
}

function trackPage(params) {
  setTitle('Track Order');
  app.innerHTML = `<div class="container auth-box"><div class="card"><h1>Track your order</h1><p class="muted">Enter your order number and the email used at checkout.</p>
    <form id="trackForm"><div class="field"><label>Order number</label><input name="order" required placeholder="e.g. SS10030142" value="${esc(params.get('order') || '')}"></div>
    <div class="field"><label>Email</label><input name="email" type="email" required value="${esc(state.user?.email || store.get('guestEmail', ''))}"></div>
    <p class="error" id="trackErr"></p><button class="btn btn-block">Track order</button></form>
    ${store.get('guestOrders', []).length ? `<h3 style="margin-top:24px">Recent orders on this device</h3>${store.get('guestOrders', []).map((g) => `<a class="link" style="display:block;margin:6px 0" href="/order/${esc(g.n)}?t=${esc(g.t)}" data-link>#${esc(g.n)}</a>`).join('')}` : ''}
    </div></div>`;
  $('#trackForm').onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    try {
      const o = await api(`/api/track?${new URLSearchParams(d)}`);
      navigate(`/order/${o.order_number}?t=${o.token}`);
    } catch (err) { $('#trackErr').textContent = err.message; }
  };
}

function authPage(mode, params) {
  const next = params.get('next') || '/account';
  if (state.user) { navigate(next, { replace: true }); return; }
  const login = mode === 'login';
  setTitle(login ? 'Log in' : 'Create account');
  app.innerHTML = `<div class="container auth-box"><div class="card">
    <h1>${login ? 'Welcome back' : 'Create your account'}</h1>
    <p class="muted">${login ? 'Log in to track orders, save addresses and your wishlist.' : 'Save your measurements, addresses and wishlist, and check out faster.'}</p>
    <form id="authForm">
      ${login ? '' : '<div class="field"><label>Full name</label><input name="name" required autocomplete="name"></div>'}
      <div class="field"><label>Email</label><input name="email" type="email" required autocomplete="email"></div>
      ${login ? '' : '<div class="field"><label>Mobile (optional)</label><input name="phone" inputmode="numeric" maxlength="10" autocomplete="tel-national"></div>'}
      <div class="field"><label>Password</label><input name="password" type="password" required minlength="${login ? 1 : 8}" autocomplete="${login ? 'current-password' : 'new-password'}">
        ${login ? '' : '<span class="small muted">At least 8 characters</span>'}</div>
      ${login ? '' : '<label class="check" style="margin-bottom:14px"><input type="checkbox" name="newsletter" checked> Send me offers and new arrivals</label>'}
      <p class="error" id="authErr"></p>
      <button class="btn btn-block">${login ? 'Log in' : 'Create account'}</button>
    </form>
    <p class="center small" style="margin-top:18px">${login ? `New here? <a class="link" href="/register?next=${encodeURIComponent(next)}" data-link>Create an account</a>`
      : `Already have an account? <a class="link" href="/login?next=${encodeURIComponent(next)}" data-link>Log in</a>`}</p>
    ${login ? '<p class="center small muted">Demo customer: priya@example.com / password123</p>' : ''}
  </div></div>`;
  $('#authForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('button', e.target);
    btn.disabled = true;
    try {
      state.user = await api(`/api/auth/${login ? 'login' : 'register'}`, { method: 'POST', body: formData(e.target) });
      await wishlist.merge();
      updateHeader();
      toast(`Welcome${login ? ' back' : ''}, ${esc(state.user.name.split(' ')[0])}!`);
      navigate(state.user.role === 'admin' && next === '/account' ? '/admin' : next, { replace: true });
    } catch (err) {
      $('#authErr').textContent = err.message;
      btn.disabled = false;
    }
  };
}

async function accountPage(tab = 'profile') {
  if (!state.user) { navigate(`/login?next=${encodeURIComponent(location.pathname)}`, { replace: true }); return; }
  setTitle('My Account');
  const nav = [['profile', 'Profile'], ['orders', 'My orders'], ['addresses', 'Addresses'], ['measurements', 'Saved measurements'], ['password', 'Change password']];
  app.innerHTML = `<div class="container"><div style="padding-top:24px">${crumbs([['My account']])}<h1>Hello, ${esc(state.user.name.split(' ')[0])}</h1></div>
    <div class="account-layout"><nav class="acc-nav">${nav.map(([k, l]) => `<a href="/account/${k}" data-link class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}
      <a href="/wishlist" data-link>Wishlist</a>${state.user.role === 'admin' ? '<a href="/admin">Admin panel ↗</a>' : ''}<button id="logoutBtn">Log out</button></nav>
    <div id="accBody"><div class="spinner"></div></div></div></div>`;
  $('#logoutBtn').onclick = logout;
  const body = $('#accBody');

  if (tab === 'profile') {
    body.innerHTML = `<div class="card"><h3>Profile</h3><form id="profileForm"><div class="row"><div class="field"><label>Name</label><input name="name" required value="${esc(state.user.name)}"></div>
      <div class="field"><label>Mobile</label><input name="phone" inputmode="numeric" maxlength="10" value="${esc(state.user.phone || '')}"></div></div>
      <div class="field"><label>Email</label><input value="${esc(state.user.email)}" disabled></div><p class="error" id="pfErr"></p><button class="btn">Save changes</button></form></div>`;
    $('#profileForm').onsubmit = async (e) => {
      e.preventDefault();
      try { state.user = await api('/api/account', { method: 'PUT', body: formData(e.target) }); toast('Profile updated'); } catch (err) { $('#pfErr').textContent = err.message; }
    };
  } else if (tab === 'orders') {
    const orders = await api('/api/orders');
    body.innerHTML = orders.length ? orders.map((o) => `<div class="order-card"><div class="order-card-head"><div><b>#${esc(o.order_number)}</b> <span class="muted small">· ${dateFmt(o.created_at)}</span></div>
      <span class="pill ${o.status === 'delivered' ? 'pill-green' : o.status === 'cancelled' ? 'pill-red' : 'pill-gold'}">${statusLabel(o.status)}</span></div>
      <div class="order-card-head" style="margin:0"><div class="thumbs-row">${o.items.slice(0, 4).map((i) => `<img src="${esc(i.image || '')}" alt="${esc(i.name)}" title="${esc(i.name)}">`).join('')}</div>
      <div style="text-align:right"><b>${inr(o.total)}</b><br><a class="link small" href="/order/${esc(o.order_number)}" data-link>View details →</a></div></div></div>`).join('')
      : emptyState('📦', 'No orders yet', 'When you place an order it will appear here.');
  } else if (tab === 'addresses') {
    const list = await api('/api/addresses');
    body.innerHTML = `<div class="addr-list">${list.map((a) => `<div class="addr-opt" style="cursor:default"><span style="flex:1"><b>${esc(a.name)}</b> ${a.is_default ? '<span class="pill">Default</span>' : ''}<br>
      ${esc(a.line1)}${a.line2 ? `, ${esc(a.line2)}` : ''}, ${esc(a.city)}, ${esc(a.state)} ${esc(a.pincode)}<br>📞 ${esc(a.phone)}</span>
      <span style="display:flex;flex-direction:column;gap:6px">${a.is_default ? '' : `<button class="link small" data-default="${a.id}">Make default</button>`}<button class="link small" data-del-addr="${a.id}">Delete</button></span></div>`).join('')}</div>
      <div class="card"><h3>Add a new address</h3><form id="addrForm">${addressFields()}<label class="check" style="margin-bottom:14px"><input type="checkbox" name="is_default"> Make this my default address</label><p class="error" id="adErr"></p><button class="btn">Save address</button></form></div>`;
    $('#addrForm').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('/api/addresses', { method: 'POST', body: formData(e.target) }); toast('Address saved'); accountPage('addresses'); } catch (err) { $('#adErr').textContent = err.message; }
    };
    $$('[data-del-addr]').forEach((b) => b.onclick = async () => { if (confirm('Delete this address?')) { await api(`/api/addresses/${b.dataset.delAddr}`, { method: 'DELETE' }); accountPage('addresses'); } });
    $$('[data-default]').forEach((b) => b.onclick = async () => {
      const a = list.find((x) => String(x.id) === b.dataset.default);
      await api(`/api/addresses/${a.id}`, { method: 'PUT', body: { ...a, is_default: true } });
      accountPage('addresses');
    });
  } else if (tab === 'measurements') {
    const m = store.get('measurements', {});
    const fields = state.config.measurementFields;
    body.innerHTML = `<div class="card"><h3>Saved measurements</h3><p class="muted small">Used to pre-fill custom stitching orders on this device. All values in inches.</p>
      <form id="mForm"><div class="row-3">${fields.map((f) => `<div class="field"><label>${f.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}</label><input name="${f}" type="number" step="0.5" min="1" max="80" value="${esc(m[f] ?? '')}"></div>`).join('')}</div>
      <button class="btn">Save measurements</button> <a class="link small" href="/size-guide" data-link>How to measure</a></form></div>`;
    $('#mForm').onsubmit = (e) => { e.preventDefault(); store.set('measurements', formData(e.target)); toast('Measurements saved'); };
  } else if (tab === 'password') {
    body.innerHTML = `<div class="card"><h3>Change password</h3><form id="pwForm"><div class="field"><label>Current password</label><input name="current" type="password" required autocomplete="current-password"></div>
      <div class="field"><label>New password</label><input name="password" type="password" minlength="8" required autocomplete="new-password"></div><p class="error" id="pwErr"></p><button class="btn">Update password</button></form></div>`;
    $('#pwForm').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('/api/account/password', { method: 'PUT', body: formData(e.target) }); toast('Password updated'); e.target.reset(); } catch (err) { $('#pwErr').textContent = err.message; }
    };
  }
}

async function wishlistPage() {
  setTitle('Wishlist');
  app.innerHTML = `<div class="container"><div style="padding-top:24px">${crumbs([['Wishlist']])}<h1>My Wishlist</h1></div><div id="wl">${skeletonGrid(4)}</div></div>`;
  let products;
  if (state.user) products = await api('/api/wishlist');
  else {
    const ids = [...state.wishlist];
    products = ids.length ? (await api(`/api/products?ids=${ids.join(',')}&limit=60`)).products : [];
  }
  $('#wl').innerHTML = products.length
    ? `<div class="grid" style="padding-bottom:40px">${products.map(productCard).join('')}</div>${state.user ? '' : '<p class="muted center"><a class="link" href="/login?next=/wishlist" data-link>Log in</a> to save your wishlist across devices.</p>'}`
    : emptyState('♡', 'Your wishlist is empty', 'Tap the heart on any blouse to save it for later.');
}

async function comparePage() {
  setTitle('Compare');
  const ids = state.compare.map((c) => c.id);
  if (!ids.length) { app.innerHTML = `<div class="container">${emptyState('⚖️', 'Nothing to compare', 'Use the compare button on products to add up to 4 blouses.')}</div>`; return; }
  const details = await Promise.all(ids.map(async (id) => {
    const { products } = await api(`/api/products?ids=${id}`);
    return products[0] ? api(`/api/products/${products[0].slug}`) : null;
  }));
  const ps = details.filter(Boolean);
  const row = (label, fn) => `<tr><th>${label}</th>${ps.map((p) => `<td>${fn(p)}</td>`).join('')}</tr>`;
  app.innerHTML = `<div class="container" style="padding:24px 0 60px">${crumbs([['Compare']])}<h1>Compare blouses</h1><div style="overflow-x:auto"><table class="table compare-table">
    ${row('', (p) => `<a href="/product/${esc(p.slug)}" data-link><img src="${esc(p.images[0])}" alt=""><b>${esc(p.name)}</b></a>`)}
    ${row('Price', (p) => `<b>${inr(p.price)}</b> <s class="muted">${inr(p.mrp)}</s>`)}
    ${row('Rating', (p) => (p.ratingCount ? `${p.rating} ★ (${p.ratingCount})` : '—'))}
    ${row('Fabric', (p) => esc(p.fabric))}${row('Work', (p) => esc(p.work))}${row('Sleeve', (p) => esc(p.sleeve))}${row('Neckline', (p) => esc(p.neck))}
    ${row('Occasion', (p) => esc(p.occasion))}${row('Sizes in stock', (p) => esc(p.sizesInStock.join(', ') || '—'))}
    ${row('Custom stitching', (p) => (p.customStitching ? '✓ Available' : '—'))}
    ${row('', (p) => `<button class="btn btn-sm" data-quick="${esc(p.slug)}">Add to bag</button> <button class="link small" data-compare="${p.id}" data-compare-json='${esc(JSON.stringify({ id: p.id, name: p.name, images: p.images }))}'>Remove</button>`)}
  </table></div></div>`;
}

function contactPage() {
  setTitle('Contact');
  const c = state.config;
  app.innerHTML = `<div class="container"><div class="cart-layout"><div class="card"><h1>Contact us</h1><p class="muted">Questions about sizing, custom stitching or an order? We usually reply within a few hours.</p>
    <form id="contactForm"><div class="row"><div class="field"><label>Name</label><input name="name" required value="${esc(state.user?.name || '')}"></div>
    <div class="field"><label>Email</label><input name="email" type="email" required value="${esc(state.user?.email || '')}"></div></div>
    <div class="row"><div class="field"><label>Phone (optional)</label><input name="phone" inputmode="numeric"></div><div class="field"><label>Subject</label>
      <select name="subject"><option>Order enquiry</option><option>Custom stitching</option><option>Returns &amp; exchanges</option><option>Bulk / boutique order</option><option>Other</option></select></div></div>
    <div class="field"><label>Message</label><textarea name="message" rows="5" required minlength="5"></textarea></div><p class="error" id="ctErr"></p><button class="btn">Send message</button></form></div>
    <aside class="card"><h3>Reach us</h3><p>📧 <a class="link" href="mailto:${esc(c.email)}">${esc(c.email)}</a></p><p>📞 ${esc(c.phone)}</p>
    <p>💬 <a class="link" href="https://wa.me/${esc(c.whatsapp)}" target="_blank" rel="noopener">Chat on WhatsApp</a></p><p>📍 ${esc(c.address)}</p><p class="muted small">Mon–Sat, 10am–7pm IST</p></aside></div></div>`;
  $('#contactForm').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/contact', { method: 'POST', body: formData(e.target) }); e.target.innerHTML = '<p class="success" style="font-size:16px">✓ Thanks! We have received your message and will get back to you soon.</p>'; } catch (err) { $('#ctErr').textContent = err.message; }
  };
}

function staticPage(key) {
  const c = state.config;
  const sizeRows = [['32', 32, 26, 13.5], ['34', 34, 28, 14], ['36', 36, 30, 14.5], ['38', 38, 32, 15], ['40', 40, 34, 15.5], ['42', 42, 36, 16], ['44', 44, 38, 16.5]];
  const pages = {
    about: ['About us', `<p>${esc(c.name)} started in a small Bengaluru workshop with one idea: every saree deserves a blouse that fits. Today we work with weavers in Kanchipuram, Varanasi and Kutch, and a team of master tailors who stitch every custom order by hand.</p>
      <h2>What we believe in</h2><ul><li><b>Fit first:</b> every ready size has generous seam margins, and custom stitching is always an option.</li><li><b>Fair craft:</b> we pay our karigars fairly and credit their work.</li><li><b>Honest pricing:</b> prices include GST, with no hidden charges at checkout.</li></ul>`],
    faq: ['Frequently asked questions', `<div class="faq">${[
      ['How does custom stitching work?', `Choose "Custom fit" as the size, enter your measurements and we stitch your blouse in 5–7 days. It costs ${inr(c.customStitchingFee)} extra.`],
      ['Which size should I pick?', 'Check our <a class="link" href="/size-guide" data-link>size guide</a>. Your size is your bust measurement in inches. If you are between sizes, pick the larger one.'],
      ['Is Cash on Delivery available?', `Yes, for orders up to ${inr(c.codMaxOrder)}. A ${inr(c.codFee)} handling fee applies.`],
      ['How long does delivery take?', 'Ready sizes ship within 48 hours and arrive in 2–6 days depending on your pincode. Custom orders take an extra 5–7 days.'],
      ['Can I return or exchange?', `Ready-size blouses can be returned within ${c.returnDays} days of delivery. Custom-stitched blouses are made for you and cannot be returned, but alterations are free.`],
      ['How do I track my order?', 'Use <a class="link" href="/track" data-link>Track Order</a> with your order number and email, or see it under My Account.'],
      ['Do you take bulk or boutique orders?', 'Yes! Reach out through our <a class="link" href="/contact" data-link>contact page</a> for wholesale pricing.'],
    ].map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('')}</div>`],
    'size-guide': ['Size & measurement guide', `<p>All measurements are body measurements in inches. Ready sizes include a 1.5″ margin on side seams for alterations.</p>
      <table><thead><tr><th>Size</th><th>Bust</th><th>Waist (under-bust)</th><th>Shoulder</th></tr></thead><tbody>${sizeRows.map(([s, b, w, sh]) => `<tr><td><b>${s}</b></td><td>${b}″</td><td>${w}″</td><td>${sh}″</td></tr>`).join('')}</tbody></table>
      <h2>How to measure</h2><div class="measure-fig"><img src="/img/blouse.svg?c=efe4cf&a=7a1f2b&s=short&n=round&p=plain" alt="Blouse measurement illustration" style="border-radius:12px">
      <ol><li><b>Bust:</b> around the fullest part of your bust, keeping the tape level.</li><li><b>Under-bust / waist:</b> right below the bust line, where the blouse ends.</li>
      <li><b>Shoulder:</b> from one shoulder tip to the other across the back.</li><li><b>Blouse length:</b> from the shoulder (near neck) down to where the blouse should end.</li>
      <li><b>Sleeve length:</b> from the shoulder tip down to where the sleeve should end.</li><li><b>Armhole:</b> around the arm at the shoulder joint.</li></ol></div>
      <p class="muted">Tip: measure over a well-fitting bra and keep the tape snug but not tight. Unsure? Measure a blouse that fits you well and add 1″ to bust and waist.</p>`],
    'shipping-returns': ['Shipping & returns', `<h2>Shipping</h2><ul><li>Free shipping on orders over ${inr(c.freeShippingOver)}; otherwise ${inr(c.shippingFee)}.</li><li>Ready sizes dispatch within 24–48 hours. Custom-stitched orders dispatch in 5–7 days.</li>
      <li>Delivery takes 2–6 business days depending on your location. Check your pincode on any product page.</li><li>Cash on Delivery available up to ${inr(c.codMaxOrder)} (${inr(c.codFee)} fee).</li></ul>
      <h2>Returns</h2><ul><li>Request a return within ${c.returnDays} days of delivery from your order page.</li><li>Items must be unused, with tags intact.</li>
      <li>Refunds are processed within 5–7 business days of pickup, to the original payment method (or bank transfer for COD).</li><li>Custom-stitched blouses are non-returnable, but we offer free alterations.</li></ul>`],
    privacy: ['Privacy policy', `<p>We collect only what we need to fulfil your orders: your name, contact details, delivery address and, for custom orders, your measurements. We never sell your data.</p>
      <p>Payment details are handled by our payment partner and never stored on our servers. Cookies are used only to keep you logged in. Your cart and preferences are stored in your browser.</p>
      <p>To delete your account or data, email <a class="link" href="mailto:${esc(c.email)}">${esc(c.email)}</a>.</p>`],
    terms: ['Terms & conditions', `<p>By using ${esc(c.name)} you agree to these terms. Prices are in Indian Rupees and include GST. We reserve the right to cancel orders in case of pricing errors or stock issues, with a full refund.</p>
      <p>Product colours may vary slightly due to screen settings and the handcrafted nature of our products. Minor irregularities in handwork are a hallmark of craftsmanship, not a defect.</p>`],
  };
  const [title, html] = pages[key];
  setTitle(title);
  app.innerHTML = `<div class="container prose">${crumbs([[title]])}<h1>${title}</h1>${html}</div>`;
}

function notFound() {
  setTitle('Page not found');
  app.innerHTML = `<div class="container">${emptyState('🧵', 'Page not found', 'The page you are looking for does not exist.', '<a class="btn" href="/" data-link>Go home</a>')}</div>`;
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

const routes = [
  [/^\/$/, () => homePage()],
  [/^\/shop$/, (_m, p) => shopPage(p)],
  [/^\/category\/([\w-]+)$/, (m) => navigate(`/shop?category=${m[1]}`, { replace: true })],
  [/^\/product\/([\w-]+)$/, (m, p) => productPage(m[1], p)],
  [/^\/cart$/, () => cartPage()],
  [/^\/checkout$/, () => checkoutPage()],
  [/^\/pay\/(\w+)$/, (m, p) => payPage(m[1], p)],
  [/^\/order\/(\w+)$/, (m, p) => orderPage(m[1], p)],
  [/^\/track$/, (_m, p) => trackPage(p)],
  [/^\/login$/, (_m, p) => authPage('login', p)],
  [/^\/register$/, (_m, p) => authPage('register', p)],
  [/^\/account(?:\/(\w+))?$/, (m) => accountPage(m[1])],
  [/^\/wishlist$/, () => wishlistPage()],
  [/^\/compare$/, () => comparePage()],
  [/^\/contact$/, () => contactPage()],
  [/^\/(about|faq|size-guide|shipping-returns|privacy|terms)$/, (m) => staticPage(m[1])],
];

let renderSeq = 0;
async function router({ keepScroll } = {}) {
  closeDrawers();
  closeModal();
  $('#suggest').hidden = true;
  const seq = ++renderSeq;
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const params = new URLSearchParams(location.search);
  $$('.main-nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === path + location.search));
  $$('.bottom-nav a').forEach((a) => a.classList.toggle('on', a.dataset.nav === '/' ? path === '/' : path.startsWith(a.dataset.nav)));
  document.body.classList.toggle('on-product', path.startsWith('/product/'));
  if (!keepScroll) window.scrollTo(0, 0);
  const route = routes.find(([re]) => re.test(path));
  try {
    if (route) await route[1](path.match(route[0]), params);
    else notFound();
  } catch (e) {
    if (seq === renderSeq) app.innerHTML = `<div class="container">${emptyState('⚠️', 'Something went wrong', esc(e.message), '<button class="btn" onclick="location.reload()">Retry</button>')}</div>`;
  }
  compare.render();
}

function navigate(url, { replace = false, keepScroll = false } = {}) {
  history[replace ? 'replaceState' : 'pushState']({}, '', url);
  router({ keepScroll });
}

/* ------------------------------------------------------------------ */
/* Global events                                                       */
/* ------------------------------------------------------------------ */

async function logout() {
  await api('/api/auth/logout', { method: 'POST' });
  state.user = null;
  state.wishlist = new Set();
  wishlist.sync();
  updateHeader();
  toast('You have been logged out');
  navigate('/');
}

function updateHeader() {
  $('#accountLink').setAttribute('aria-label', state.user ? `Account (${state.user.name})` : 'Log in');
  $('#accountLink').title = state.user ? state.user.name : 'Log in';
  const cats = state.categories.map((c) => `<a href="/shop?category=${esc(c.slug)}" data-link>${esc(c.name)} <span class="muted small">${c.count}</span></a>`).join('');
  $('#navCategories').innerHTML = cats;
  $('#footerCategories').innerHTML = state.categories.map((c) => `<li><a href="/shop?category=${esc(c.slug)}" data-link>${esc(c.name)}</a></li>`).join('');
  $('#mobileLinks').innerHTML = `<a href="/shop" data-link>Shop all</a><a href="/shop?new=1" data-link>New arrivals</a>${cats}<a href="/shop?sale=1" data-link>Sale</a>
    <a href="/wishlist" data-link>Wishlist</a><a href="/track" data-link>Track order</a><a href="/size-guide" data-link>Size guide</a>
    ${state.user ? '<a href="/account" data-link>My account</a>' : '<a href="/login" data-link>Log in / Sign up</a>'}<a href="/contact" data-link>Contact</a>`;
}

function setupSearch() {
  const input = $('#searchInput');
  const box = $('#suggest');
  let hl = -1;
  const suggest = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { box.hidden = true; return; }
    const r = await api(`/api/search/suggest?q=${encodeURIComponent(q)}`);
    if (input.value.trim() !== q) return;
    hl = -1;
    box.innerHTML = (r.categories.length ? `<div class="sg-head">Collections</div>${r.categories.map((c) => `<a href="/shop?category=${esc(c.slug)}" data-link>${esc(c.name)}</a>`).join('')}` : '')
      + (r.products.length ? `<div class="sg-head">Products</div>${r.products.map((p) => `<a href="/product/${esc(p.slug)}" data-link><img src="${esc(p.image)}" alt=""><span style="flex:1">${esc(p.name)}</span><b>${inr(p.price)}</b></a>`).join('')}` : '')
      + `<a href="/shop?q=${encodeURIComponent(q)}" data-link><b>See all results for “${esc(q)}” →</b></a>`;
    box.hidden = false;
  }, 200);
  input.addEventListener('input', suggest);
  input.addEventListener('keydown', (e) => {
    const links = $$('a', box);
    if (box.hidden || !links.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      hl = (hl + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
      links.forEach((a, i) => a.classList.toggle('hl', i === hl));
    } else if (e.key === 'Enter' && hl >= 0) {
      e.preventDefault();
      links[hl].click();
    } else if (e.key === 'Escape') box.hidden = true;
  });
  $('#searchForm').onsubmit = (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q) { navigate(`/shop?q=${encodeURIComponent(q)}`); input.blur(); $('#searchBox').classList.remove('open'); }
  };
  document.addEventListener('click', (e) => { if (!$('#searchBox').contains(e.target)) box.hidden = true; });
  $('#searchToggle').onclick = () => { $('#searchBox').classList.toggle('open'); input.focus(); };
}

function setupGlobalEvents() {
  document.addEventListener('click', async (e) => {
    const t = e.target;
    const link = t.closest('a');
    if (link && !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !link.target && link.origin === location.origin
      && !/^\/(admin|invoice|uploads|api|img)/.test(link.pathname) && !link.hasAttribute('download')) {
      e.preventDefault();
      if (link.hash && link.pathname === location.pathname) { document.querySelector(link.hash)?.scrollIntoView({ behavior: 'smooth' }); return; }
      navigate(link.pathname + link.search);
      return;
    }
    const wish = t.closest('[data-wish]');
    if (wish) { e.preventDefault(); wishlist.toggle(Number(wish.dataset.wish)); return; }
    const quick = t.closest('[data-quick]');
    if (quick) { e.preventDefault(); quickView(quick.dataset.quick); return; }
    const cmp = t.closest('[data-compare]');
    if (cmp) {
      e.preventDefault();
      compare.toggle(JSON.parse(cmp.dataset.compareJson));
      if (location.pathname === '/compare') comparePage();
      return;
    }
    if (t.closest('[data-compare-clear]')) { state.compare = []; store.set('compare', []); compare.render(); return; }
    const qtyBtn = t.closest('[data-qty]');
    if (qtyBtn) {
      const item = state.cart.find((i) => i.key === qtyBtn.dataset.key);
      if (item) cart.setQty(item.key, item.qty + Number(qtyBtn.dataset.qty));
      renderCartDrawer();
      if (location.pathname === '/cart') cartPage();
      return;
    }
    const rm = t.closest('[data-remove]');
    if (rm) {
      cart.remove(rm.dataset.remove);
      renderCartDrawer();
      if (location.pathname === '/cart') cartPage();
      return;
    }
    const unf = t.closest('[data-unfilter]');
    if (unf) {
      const k = unf.dataset.unfilter;
      const params = new URLSearchParams(location.search);
      if (k === 'price') updateQuery({ minPrice: null, maxPrice: null, page: null });
      else if (unf.dataset.val) updateQuery({ [k]: (params.get(k) || '').split(',').filter((v) => v !== unf.dataset.val).join(',') || null, page: null });
      else updateQuery({ [k]: null, page: null });
      return;
    }
    if (t.closest('[data-clear-filters]')) { navigate('/shop', { replace: true, keepScroll: true }); return; }
    if (t.closest('[data-close-drawer]') || t.closest('[data-close]')) closeDrawers();
  });

  $('#cartBtn').onclick = () => { renderCartDrawer(); openDrawer('#cartDrawer'); };
  $('#bottomCart').onclick = () => { renderCartDrawer(); openDrawer('#cartDrawer'); };
  $('#menuToggle').onclick = () => openDrawer('#mobileNav');
  $('#overlay').onclick = closeDrawers;
  $('#modalClose').onclick = closeModal;
  $('#modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); closeDrawers(); } });
  window.addEventListener('popstate', () => router({ keepScroll: false }));
  window.addEventListener('scroll', () => { $('#toTop').hidden = window.scrollY < 600; }, { passive: true });
  $('#toTop').onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  // Keep cart in sync across tabs.
  window.addEventListener('storage', (e) => {
    if (e.key === 'ss_cart') { state.cart = store.get('cart', []); cart.save(); }
  });

  $('#newsletterForm').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/newsletter', { method: 'POST', body: formData(e.target) }); e.target.reset(); toast('You are subscribed! 💌'); } catch (err) { toast(err.message, true); }
  };
}

// Brand name, initials and tagline come from the server config so a rename is a one-line change.
function applyBrand(config) {
  const initials = config.name.split(/[\s&]+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
  $$('[data-store-name]').forEach((el) => { el.textContent = config.name; });
  $$('[data-store-initial]').forEach((el) => { el.textContent = initials; });
  $$('[data-store-tagline]').forEach((el) => { el.textContent = config.tagline; });
  if (config.paymentProvider === 'demo') {
    $('.announce-track').insertAdjacentHTML('afterbegin', '<span>🧪 Preview store: online payments are in demo mode</span>');
  }
}

async function init() {
  $('#year').textContent = new Date().getFullYear();
  const [config, user, categories] = await Promise.all([api('/api/config'), api('/api/auth/me'), api('/api/categories')]);
  Object.assign(state, { config, user, categories });
  applyBrand(config);
  $('#waFloat').href = `https://wa.me/${config.whatsapp}?text=${encodeURIComponent('Hi! I have a question about a blouse.')}`;
  $('#footerContact').innerHTML = `📞 ${esc(config.phone)}<br>📧 ${esc(config.email)}`;
  if (user) await wishlist.merge().catch(() => {});
  wishlist.sync();
  cart.save();
  updateHeader();
  setupSearch();
  setupGlobalEvents();
  await router({ keepScroll: false });
}

init().catch((e) => {
  app.innerHTML = `<div class="container">${emptyState('⚠️', 'Could not load the store', esc(e.message), '<button class="btn" onclick="location.reload()">Retry</button>')}</div>`;
});
