'use strict';

const int = (name, def) => {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) ? v : def;
};

const secret = process.env.SECRET || '';
if (!secret || secret === 'change-me-to-a-long-random-string') {
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') {
    throw new Error('SECRET must be set to a long random string in production');
  }
  console.warn('[config] WARNING: SECRET is not set; using an insecure development default.');
}

module.exports = {
  port: int('PORT', 3000),
  publicUrl: (process.env.PUBLIC_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '') ||
    `http://localhost:${int('PORT', 3000)}`).replace(/\/$/, ''),
  secret: secret || 'insecure-dev-secret',
  // Password for the /admin panel (create client apps, pair gateway phones).
  adminPassword: process.env.ADMIN_PASSWORD || '',
  defaultCountryCode: (process.env.DEFAULT_COUNTRY_CODE || '91').replace(/\D/g, ''),
  // On Vercel the platform sets x-forwarded-for itself, so it can be trusted there.
  trustProxy: process.env.TRUST_PROXY === '1' || !!process.env.VERCEL,

  otp: {
    length: Math.min(Math.max(int('OTP_LENGTH', 6), 4), 9),
    ttlSeconds: int('OTP_TTL_SECONDS', 300),
    maxAttempts: int('OTP_MAX_ATTEMPTS', 5),
    resendCooldownSeconds: int('OTP_RESEND_COOLDOWN_SECONDS', 30),
    maxSendsPerHour: int('OTP_MAX_SENDS_PER_HOUR', 5),
  },
  ipRequestsPerMinute: int('IP_REQUESTS_PER_MINUTE', 60),

  gateway: {
    // How often the gateway phone checks for SMS to send, in seconds.
    pollSeconds: Math.max(3, int('GATEWAY_POLL_SECONDS', 10)),
    // Optional: the number customers ring for missed-call verification. By default the
    // number typed into the gateway app is used.
    missedCallNumber: process.env.MISSED_CALL_NUMBER || '',
  },

  sms: {
    provider: (process.env.SMS_PROVIDER || 'phone').toLowerCase(),
    template: process.env.SMS_TEMPLATE ||
      '{otp} is your {app} verification code. It expires in {minutes} minutes. Do not share it with anyone.',
    msg91: { authKey: process.env.MSG91_AUTH_KEY, templateId: process.env.MSG91_TEMPLATE_ID },
    twilio: {
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      from: process.env.TWILIO_FROM,
    },
    webhook: { url: process.env.SMS_WEBHOOK_URL, token: process.env.SMS_WEBHOOK_TOKEN },
  },
};
