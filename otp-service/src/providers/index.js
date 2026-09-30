'use strict';

/**
 * SMS senders. Each exposes: send({ to, message, otp, app, expiresAt }) -> Promise<{ id? }>
 * `to` is E.164 digits without "+". Throw on failure.
 * The default, "phone", uses your own Android phone; the others are optional paid gateways.
 */
function createProvider(sms, gateway) {
  switch (sms.provider) {
    case 'phone': return require('./phone')(gateway);
    case 'console': return require('./console')();
    case 'msg91': return require('./msg91')(sms.msg91);
    case 'twilio': return require('./twilio')(sms.twilio);
    case 'webhook': return require('./webhook')(sms.webhook);
    default: throw new Error(`Unknown SMS_PROVIDER "${sms.provider}"`);
  }
}

module.exports = { createProvider };
