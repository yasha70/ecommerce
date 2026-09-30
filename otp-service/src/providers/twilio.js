'use strict';

module.exports = ({ accountSid, authToken, from }) => {
  if (!accountSid || !authToken || !from) {
    throw new Error('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM are required');
  }
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  return {
    name: 'twilio',
    async send({ to, message }) {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: 'POST',
        headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: '+' + to, From: from, Body: message }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Twilio error ${res.status}: ${body.message || 'unknown'}`);
      return { id: body.sid };
    },
  };
};
