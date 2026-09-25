'use strict';
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');

module.exports = {
  port: Number(process.env.PORT) || 3000,
  // Vercel functions can only write to /tmp, which is wiped when an instance is recycled.
  dbFile: process.env.DB_FILE || (process.env.VERCEL ? '/tmp/store.db' : path.join(root, 'data', 'store.db')),
  uploadDir: process.env.UPLOAD_DIR || (process.env.VERCEL ? '/tmp/uploads' : path.join(root, 'uploads')),
  publicDir: path.join(root, 'public'),
  // Without SESSION_SECRET, sessions are invalidated on every restart.
  sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  sessionDays: 30,
  adminEmail: process.env.ADMIN_EMAIL || 'admin@zariya.in',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  store: {
    // Change the brand here (or set STORE_NAME); the site, admin and invoices all read it.
    name: process.env.STORE_NAME || 'Zariya',
    tagline: process.env.STORE_TAGLINE || 'Designer Blouses',
    email: process.env.STORE_EMAIL || 'hello@zariya.in',
    phone: '+91 98765 43210',
    whatsapp: '919876543210',
    address: '12 Weavers Lane, Jayanagar, Bengaluru, Karnataka 560041',
    gstin: '29ABCDE1234F1Z5',
    currency: 'INR',
    freeShippingOver: 999,
    shippingFee: 79,
    codFee: 49,
    codMaxOrder: 10000,
    customStitchingFee: 250,
    returnDays: 7,
    sizes: ['32', '34', '36', '38', '40', '42', '44'],
  },
};
