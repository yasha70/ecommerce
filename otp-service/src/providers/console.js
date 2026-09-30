'use strict';

/** Development provider: prints the SMS to the server log instead of sending it. */
module.exports = () => ({
  name: 'console',
  async send({ to, message }) {
    console.log(`[sms:console] to=+${to} message="${message}"`);
    return { id: 'console-' + Date.now() };
  },
});
