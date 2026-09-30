'use strict';

// Vercel entry point: every path is rewritten here (see vercel.json).
const { createHandler } = require('../src/app');

module.exports = createHandler();
