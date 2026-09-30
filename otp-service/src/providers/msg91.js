'use strict';

/**
 * MSG91 Flow API. Create a DLT-approved template in MSG91 whose text contains ##otp##
 * and set MSG91_TEMPLATE_ID / MSG91_AUTH_KEY.
 */
module.exports = ({ authKey, templateId }) => {
  if (!authKey || !templateId) throw new Error('MSG91_AUTH_KEY and MSG91_TEMPLATE_ID are required');
  return {
    name: 'msg91',
    async send({ to, otp }) {
      const res = await fetch('https://control.msg91.com/api/v5/flow', {
        method: 'POST',
        headers: { authkey: authKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ template_id: templateId, short_url: '0', recipients: [{ mobiles: to, otp }] }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.type === 'error') {
        throw new Error(`MSG91 error ${res.status}: ${body.message || JSON.stringify(body)}`);
      }
      return { id: body.message };
    },
  };
};
