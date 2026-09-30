'use strict';

const crypto = require('node:crypto');
const { normalizeMobile, maskMobile } = require('./phone');
const { RateLimiter } = require('./ratelimit');

class OtpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/**
 * Core OTP engine. OTPs are never stored in plaintext: only an HMAC of
 * (requestId, otp) is kept, and comparisons are constant-time.
 *
 * State lives in memory, so run a single instance (or swap the Maps for Redis).
 */
class OtpService {
  constructor({ config, provider, now = () => Date.now() }) {
    this.cfg = config.otp;
    this.secret = config.secret;
    this.defaultCountryCode = config.defaultCountryCode;
    this.smsTemplate = config.sms.template;
    this.provider = provider;
    this.now = now;
    this.requests = new Map();      // requestId -> record
    this.usedTokens = new Map();    // token id -> expiry (single-use tokens)
    this.perMobile = new RateLimiter({ limit: this.cfg.maxSendsPerHour, windowMs: 3600_000 });
  }

  hash(requestId, otp) {
    return crypto.createHmac('sha256', this.secret).update(`${requestId}:${otp}`).digest();
  }

  generateOtp() {
    const max = 10 ** this.cfg.length;
    return String(crypto.randomInt(0, max)).padStart(this.cfg.length, '0');
  }

  renderMessage(otp, app) {
    return this.smsTemplate
      .replaceAll('{otp}', otp)
      .replaceAll('{app}', app.name)
      .replaceAll('{minutes}', String(Math.round(this.cfg.ttlSeconds / 60)));
  }

  async deliver(record, app) {
    const limit = this.perMobile.hit(`${app.id}:${record.mobile}`, this.now());
    if (!limit.ok) {
      throw new OtpError(429, 'too_many_otps', 'Too many OTPs sent to this number. Try again later.',
        { retry_after: limit.retryAfter });
    }
    const otp = this.generateOtp();
    record.otpHash = this.hash(record.id, otp);
    record.expiresAt = this.now() + this.cfg.ttlSeconds * 1000;
    record.attempts = 0;
    record.lastSentAt = this.now();
    record.sends += 1;
    try {
      await this.provider.send({ to: record.mobile, otp, message: this.renderMessage(otp, app), app });
    } catch (err) {
      console.error(`[otp] delivery failed for ${maskMobile(record.mobile)}: ${err.message}`);
      record.otpHash = null;
      throw new OtpError(502, 'delivery_failed', 'Could not send the SMS. Please try again.');
    }
  }

  publicView(record) {
    return {
      request_id: record.id,
      mobile: maskMobile(record.mobile),
      expires_in: Math.max(0, Math.round((record.expiresAt - this.now()) / 1000)),
      resend_after: this.resendAfter(record),
    };
  }

  resendAfter(record) {
    const wait = record.lastSentAt + this.cfg.resendCooldownSeconds * 1000 - this.now();
    return Math.max(0, Math.ceil(wait / 1000));
  }

  /** Sends a fresh OTP to `mobile` on behalf of `app`. */
  async send(app, mobileInput) {
    const mobile = normalizeMobile(mobileInput, this.defaultCountryCode);
    if (!mobile) throw new OtpError(400, 'invalid_mobile', 'Enter a valid mobile number.');

    // Enforce the resend cooldown even when a brand new request is started.
    for (const r of this.requests.values()) {
      if (r.appId === app.id && r.mobile === mobile && !r.verified && this.resendAfter(r) > 0) {
        throw new OtpError(429, 'resend_cooldown', 'Please wait before requesting another OTP.',
          { retry_after: this.resendAfter(r) });
      }
    }

    const record = {
      id: 'req_' + crypto.randomBytes(12).toString('hex'),
      appId: app.id,
      mobile,
      otpHash: null,
      expiresAt: 0,
      attempts: 0,
      sends: 0,
      lastSentAt: 0,
      verified: false,
    };
    await this.deliver(record, app);
    this.requests.set(record.id, record);
    return this.publicView(record);
  }

  getRecord(app, requestId) {
    const record = this.requests.get(requestId);
    if (!record || record.appId !== app.id) {
      throw new OtpError(404, 'request_not_found', 'Verification request not found or expired.');
    }
    return record;
  }

  async resend(app, requestId) {
    const record = this.getRecord(app, requestId);
    if (record.verified) throw new OtpError(409, 'already_verified', 'This number is already verified.');
    const wait = this.resendAfter(record);
    if (wait > 0) {
      throw new OtpError(429, 'resend_cooldown', 'Please wait before requesting another OTP.',
        { retry_after: wait });
    }
    await this.deliver(record, app);
    return this.publicView(record);
  }

  /** Checks an OTP. On success returns a signed, single-use verification token. */
  verify(app, requestId, otpInput) {
    const record = this.getRecord(app, requestId);
    if (record.verified) throw new OtpError(409, 'already_verified', 'This number is already verified.');
    if (!record.otpHash || this.now() > record.expiresAt) {
      throw new OtpError(410, 'otp_expired', 'The OTP has expired. Request a new one.');
    }
    if (record.attempts >= this.cfg.maxAttempts) {
      throw new OtpError(429, 'too_many_attempts', 'Too many wrong attempts. Request a new OTP.');
    }
    const otp = String(otpInput ?? '').replace(/\s/g, '');
    record.attempts += 1;
    const ok = /^\d+$/.test(otp) && crypto.timingSafeEqual(this.hash(record.id, otp), record.otpHash);
    if (!ok) {
      const left = this.cfg.maxAttempts - record.attempts;
      if (left <= 0) record.otpHash = null; // burn it
      throw new OtpError(400, 'invalid_otp', left > 0
        ? `Incorrect OTP. ${left} attempt${left === 1 ? '' : 's'} left.`
        : 'Too many wrong attempts. Request a new OTP.', { attempts_left: Math.max(0, left) });
    }
    record.verified = true;
    record.otpHash = null;
    return {
      verified: true,
      mobile: '+' + record.mobile,
      token: this.issueToken(app, record),
    };
  }

  issueToken(app, record) {
    const payload = {
      jti: crypto.randomBytes(12).toString('hex'),
      app: app.id,
      mobile: '+' + record.mobile,
      rid: record.id,
      iat: Math.floor(this.now() / 1000),
      exp: Math.floor(this.now() / 1000) + 600,
    };
    const body = b64url(JSON.stringify(payload));
    const sig = b64url(crypto.createHmac('sha256', this.secret).update(body).digest());
    return `${body}.${sig}`;
  }

  /**
   * Called by the client website's *backend* (with its secret key) to confirm a token
   * produced by the browser widget. Tokens are single-use and expire after 10 minutes.
   */
  verifyToken(app, token) {
    const invalid = () => new OtpError(400, 'invalid_token', 'Verification token is invalid or expired.');
    if (typeof token !== 'string' || !token.includes('.')) throw invalid();
    const [body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', this.secret).update(body).digest();
    const given = Buffer.from(sig || '', 'base64url');
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw invalid();
    let payload;
    try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { throw invalid(); }
    if (payload.app !== app.id || payload.exp * 1000 < this.now()) throw invalid();
    if (this.usedTokens.has(payload.jti)) {
      throw new OtpError(409, 'token_used', 'Verification token has already been used.');
    }
    this.usedTokens.set(payload.jti, payload.exp * 1000);
    return { verified: true, mobile: payload.mobile, verified_at: new Date(payload.iat * 1000).toISOString() };
  }

  /** Drops expired state; call periodically. */
  sweep() {
    const now = this.now();
    const keepFor = Math.max(this.cfg.ttlSeconds, this.cfg.resendCooldownSeconds) * 1000 + 600_000;
    for (const [id, r] of this.requests) if (now - r.lastSentAt > keepFor) this.requests.delete(id);
    for (const [jti, exp] of this.usedTokens) if (exp < now) this.usedTokens.delete(jti);
    this.perMobile.sweep(now);
  }
}

module.exports = { OtpService, OtpError };
