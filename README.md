# Silk & Stitch: Blouse E-commerce Store

A complete online store for selling designer blouses: storefront, customer accounts, checkout, order tracking and an admin panel.
It is built with **Node.js + Express** and the **built-in SQLite** (`node:sqlite`), so there is no database server to install and no native modules to compile.

## Quick start

```bash
npm install
npm start            # http://localhost:3000
```

On first run the database is created in `data/store.db` and seeded with 6 collections, 24 blouses, coupons, demo customers, reviews and sample orders.

| Login | Email | Password |
| --- | --- | --- |
| Admin (`/admin`) | `admin@silkandstitch.in` | `admin123` |
| Demo customer | `priya@example.com` | `password123` |

Other commands: `npm run dev` (auto-restart), `npm run seed` (wipe and re-seed the database), `npm test` (API test suite).

## Features

### Storefront
- Home page with hero, collections, bestsellers, new arrivals, promo banners, the custom-stitching steps and testimonials
- Shop page with filters for category, size in stock, price, fabric, occasion, work, sleeve, neckline, colour and rating, plus 6 sort orders and pagination
- Live search with suggestions (keyboard navigable)
- Product page: image gallery with hover zoom, per-size stock ("only 2 left"), size chart, **custom stitching with a measurement form** (+₹250), pincode delivery-date check, tabs (description, specifications, care, shipping), ratings breakdown and reviews, related products, WhatsApp share and copy link
- Quick view, wishlist (guest in the browser, synced to the account after login), compare up to 4 blouses, recently viewed

### Cart & checkout
- Slide-out cart drawer and full cart page with a free-shipping progress bar
- Coupons (percent or flat, minimum order, maximum discount, usage limit, expiry) and a list of available offers
- Guest or logged-in checkout, saved addresses, all Indian states
- **Cash on Delivery** (with a fee and an order cap) or **online payment** (UPI, card, netbanking) through a demo gateway
- Prices, stock and discounts are always recalculated on the server; stock is reserved in a transaction

### Orders
- Confirmation page, status timeline and history, tracking number
- Printable GST **tax invoice** (Print / Save as PDF)
- Customers can cancel before dispatch (stock is restored and prepaid orders are marked refund-initiated) and request returns within 7 days of delivery
- Order tracking by order number and email, and "Buy again"

### Customer account
Profile, order history, address book, saved measurements, password change and wishlist.

### Admin panel (`/admin`)
- Dashboard: revenue, orders, average order value, today's sales, a 30-day revenue chart, sales by category, top products, low-stock alerts and recent orders
- Orders: search and filter, update status, payment status and tracking, see custom measurements, invoice, WhatsApp the customer, **CSV export**
- Products: create and edit with **image upload**, stock per size, featured / new / custom-stitching flags, hide or delete
- Categories, coupons, customers (orders and lifetime spend), review moderation, contact messages and newsletter subscribers
- **Order Tools**: the existing size-wise order and profit calculator dashboard, available at `/admin/order-tools`

### Other
Responsive layout for mobile, tablet and desktop, WhatsApp chat button, newsletter signup, contact form, and pages for FAQ, size guide, shipping and returns, about, privacy and terms. Security measures include hashed passwords (scrypt), signed HttpOnly session cookies, login rate limiting, a CSRF origin check, parameterised SQL, output escaping and CSV-injection-safe exports.

## Configuration

Set these environment variables in production:

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port (default `3000`) |
| `SESSION_SECRET` | **Required in production.** Without it, logins reset on every restart |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Admin account created on first start. **Change the default password** |
| `DB_FILE` | SQLite file path (default `data/store.db`) |
| `UPLOAD_DIR` | Folder for uploaded product images (default `uploads/`) |
| `NODE_ENV=production` | Marks the session cookie as `Secure` (HTTPS only) |

Store name, contact details, GSTIN, fees, sizes and the return window are in `src/config.js`.

## Before going live

- **Payments:** the online payment step is a simulated gateway (`POST /api/orders/:num/pay` in `src/routes/store.js`). Replace it with Razorpay, Cashfree or Stripe, and verify the gateway's signature on the server before marking an order paid.
- **Emails/SMS:** order confirmations are not sent yet; hook a provider into order creation and status updates.
- **Content:** product images are generated SVG illustrations. Upload real photos from the admin panel. The home-page stats and testimonials are placeholders to replace with real ones.
- **Hosting:** run on any Node 22.13+ host with a persistent disk for `data/` and `uploads/` (or point `DB_FILE`/`UPLOAD_DIR` at a mounted volume).

## Project layout

```
server.js              entry point
src/app.js             Express app, static files, invoice and SPA routing
src/routes/store.js    public and customer API
src/routes/admin.js    admin API
src/pricing.js         cart pricing, coupons, stock checks
src/db.js  seed.js     schema and demo data
src/images.js          SVG blouse illustration generator
src/invoice.js         printable GST invoice
public/                storefront (index.html, css, js) and admin panel
test/api.test.js       end-to-end API tests
```
