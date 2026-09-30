'use strict';

/**
 * SMS gateways. Each provider exposes: send({ to, message, otp, app }) -> Promise<{ id? }>
 * `to` is E.164 digits without "+". Throw on failure.
 */
function createProvider(sms) {
  switch (sms.provider) {
    case 'console': return require('./console')();
    case 'msg91': return require('./msg91')(sms.msg91);
    case 'twilio': return require('./twilio')(sms.twilio);
    case 'webhook': return require('./webhook')(sms.webhook);
    default: throw new Error(`Unknown SMS_PROVIDER "${sms.provider}"`);
  }
}

module.exports = { createProvider };
