'use strict';

// Local/self-hosted server. On Vercel, api/index.js serves the same handler.
const http = require('node:http');
const config = require('./config');
const { createHandler } = require('./app');

function createServer(opts) {
  return http.createServer(createHandler(opts));
}

if (require.main === module) {
  createServer().listen(config.port, () => {
    console.log(`OTP service listening on ${config.publicUrl} (SMS provider: ${config.sms.provider})`);
  });
}

module.exports = { createServer };
