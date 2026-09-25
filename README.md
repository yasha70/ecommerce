# Zariya: Blouse E-commerce Store

> **Renaming the store:** change `name` in `src/config.js` (or set the `STORE_NAME` environment variable). The header, footer, page titles, admin panel and invoices all pick it up.

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
| Admin (`/admin`) | `admin@zariya.in` | `admin123` locally, or the `ADMIN_PASSWORD` you set |
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

## Catalogue & colour variants

Product photos live in `public/images/products/` (or upload them from the admin panel). Products that share a **style code** are shown as one design with colour swatches. For example, the Shimmer Jacquard Stretch Blouse ships in Bottle Green, Gold, Red and Rani Pink. To add a colour, create a product with the same style code and pick a swatch colour.

The other blouses use generated illustrations as placeholders. Replace their images, or hide them from Admin → Products.

## Payments

`src/payments.js` supports two providers:

| Mode | When | What happens |
| --- | --- | --- |
| **Demo** (default) | No Razorpay keys set | A simulated gateway page (UPI / card / netbanking). No money moves. The store shows a "demo mode" notice. |
| **Razorpay** | `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` set | Real Razorpay Checkout. The server creates a Razorpay order and verifies the payment signature before marking the order paid. |

To go live with Razorpay:
1. Create an account at razorpay.com and complete KYC.
2. Copy the Key ID and Key Secret (start with test keys `rzp_test_…`) into the environment variables above.
3. In the Razorpay Dashboard → Webhooks, add `https://<your-domain>/api/payments/razorpay/webhook` for the `payment.captured` event, and set its secret as `RAZORPAY_WEBHOOK_SECRET`. This confirms payments even if the shopper closes the tab.
4. Redeploy. The admin sidebar will show "Razorpay live".

Refunds for cancelled prepaid orders are marked `refund_initiated`; issue them from the Razorpay dashboard.

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
| `STORE_NAME`, `STORE_TAGLINE`, `STORE_EMAIL` | Branding without editing code |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Turn on real payments |

Store name, contact details, GSTIN, fees, sizes and the return window are in `src/config.js`.

## Before going live

- **Payments:** add your Razorpay keys (see [Payments](#payments)).
- **Emails/SMS:** order confirmations are not sent yet; hook a provider into order creation and status updates.
- **Content:** replace the illustrated placeholder products with real photos, check prices and descriptions, and delete the sample reviews, customers and orders.
- **Hosting:** see below.

## Hosting

**Vercel (current preview hosting).** `vercel.json` + `api/index.js` run the app as a serverless function and serve `public/` from the CDN. Set `SESSION_SECRET` and `ADMIN_PASSWORD` in the project's environment variables.
Important: Vercel functions have no permanent disk. The database lives in `/tmp` and **resets to the sample data whenever an instance restarts**, and each instance has its own copy. Orders, new products and uploads made on Vercel are therefore temporary. That is fine for a demo, but not for real sales.

**For real sales**, either:
- run `npm start` on a host with a persistent disk (Render, Railway, Fly.io or a VPS) with `DB_FILE`/`UPLOAD_DIR` on that disk, or
- keep Vercel and move the database to a hosted one (e.g. Turso/libSQL or Postgres) and images to Vercel Blob.

## Project layout

```
server.js              entry point
src/app.js             Express app, static files, invoice and SPA routing
src/routes/store.js    public and customer API
src/routes/admin.js    admin API
src/pricing.js         cart pricing, coupons, stock checks
src/payments.js        demo + Razorpay payment providers
api/index.js, vercel.json  Vercel deployment
src/db.js  seed.js     schema and demo data
src/images.js          SVG blouse illustration generator
src/invoice.js         printable GST invoice
public/                storefront (index.html, css, js) and admin panel
test/api.test.js       end-to-end API tests
```
