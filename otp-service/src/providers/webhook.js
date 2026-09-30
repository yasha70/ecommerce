'use strict';

/** Forwards the SMS to any HTTP endpoint (your own gateway, an Android SMS app, etc). */
module.exports = ({ url, token }) => {
  if (!url) throw new Error('SMS_WEBHOOK_URL is required');
  return {
    name: 'webhook',
    async send({ to, message, otp }) {
      const headers = { 'content-type': 'application/json' };
      if (token) headers.authorization = `Bearer ${token}`;
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ to: '+' + to, message, otp }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`SMS webhook returned ${res.status}`);
      return {};
    },
  };
};
