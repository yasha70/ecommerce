'use strict';
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');

module.exports = {
  port: Number(process.env.PORT) || 3000,
  dbFile: process.env.DB_FILE || path.join(root, 'data', 'store.db'),
  uploadDir: process.env.UPLOAD_DIR || path.join(root, 'uploads'),
  publicDir: path.join(root, 'public'),
  // Without SESSION_SECRET, sessions are invalidated on every restart.
  sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  sessionDays: 30,
  adminEmail: process.env.ADMIN_EMAIL || 'admin@silkandstitch.in',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  store: {
    name: 'Silk & Stitch',
    tagline: 'Designer blouses, stitched to fit',
    email: 'hello@silkandstitch.in',
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
