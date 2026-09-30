'use strict';

/** Sends SMS through your own Android gateway phone (see src/gateway.js and android-gateway/). */
module.exports = (gateway) => ({
  name: 'phone',
  send: ({ to, message, expiresAt }) => gateway.enqueueSms({ to, message, expiresAt }),
});
