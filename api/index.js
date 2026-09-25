'use strict';
// Vercel serverless entry point: every API, image and invoice request is routed here (see vercel.json).
// Static files in public/ are served directly by Vercel's CDN.
const { open } = require('../src/db');
const { seed } = require('../src/seed');
const { createApp } = require('../src/app');

const db = open();
seed(db);

module.exports = createApp(db);
