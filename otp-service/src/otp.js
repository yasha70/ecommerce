'use strict';

const crypto = require('node:crypto');
const { normalizeMobile, maskMobile } = require('./phone');

class OtpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const TOKEN_TTL = 600;

/**
 * Core verification engine. Two channels:
 *   - sms:         we text a one-time code and the user types it back
 *   - missed_call: the user rings the gateway phone from their number; the gateway app
 *                  cuts the call and reports the caller, which proves they hold that SIM
 * OTPs are never stored in plaintext (only an HMAC) and are compared in constant time.
 */
class OtpService {
  constructor({ config, store, provider, gateway, now = () => Date.now() }) {
    this.cfg = config.otp;
    this.secret = config.secret;
    this.defaultCountryCode = config.defaultCountryCode;
    this.smsTemplate = config.sms.template;
    this.store = store;
    this.provider = provider;
    this.gateway = gateway;
    this.now = now;
  }

  hash(requestId, otp) {
    return crypto.createHmac('sha256', this.secret).update(`${requestId}:${otp}`).digest('hex');
  }

  generateOtp() {
    return String(crypto.randomInt(0, 10 ** this.cfg.length)).padStart(this.cfg.length, '0');
  }

  renderMessage(otp, app) {
    return this.smsTemplate
      .replaceAll('{otp}', otp)
      .replaceAll('{app}', app.name)
      .replaceAll('{minutes}', String(Math.round(this.cfg.ttlSeconds / 60)));
  }

  recordTtl() { return this.cfg.ttlSeconds + TOKEN_TTL; }
  save(record) { return this.store.set(`req:${record.id}`, record, { ttl: this.recordTtl() }); }

  resendAfter(record) {
    const wait = record.lastSentAt + this.cfg.resendCooldownSeconds * 1000 - this.now();
    return Math.max(0, Math.ceil(wait / 1000));
  }

  async publicView(record) {
    const view = {
      request_id: record.id,
      channel: record.channel,
      mobile: maskMobile(record.mobile),
      expires_in: Math.max(0, Math.round((record.expiresAt - this.now()) / 1000)),
    };
    if (record.channel === 'sms') view.resend_after = this.resendAfter(record);
    else view.call_to = record.callTo;
    return view;
  }

  async countSend(app, mobile) {
    const n = await this.store.incr(`sends:${app.id}:${mobile}`, 3600);
    if (n > this.cfg.maxSendsPerHour) {
      const ttl = await this.store.ttl(`sends:${app.id}:${mobile}`);
      throw new OtpError(429, 'too_many_otps', 'Too many verification attempts for this number. Try again later.',
        { retry_after: Math.max(1, ttl) });
    }
  }

  async deliverSms(record, app) {
    await this.countSend(app, record.mobile);
    const otp = this.generateOtp();
    record.otpHash = this.hash(record.id, otp);
    record.expiresAt = this.now() + this.cfg.ttlSeconds * 1000;
    record.attempts = 0;
    record.lastSentAt = this.now();
    record.sends += 1;
    try {
      await this.provider.send({
        to: record.mobile, otp, message: this.renderMessage(otp, app), app, expiresAt: record.expiresAt,
      });
    } catch (err) {
      console.error(`[otp] delivery failed for ${maskMobile(record.mobile)}: ${err.message}`);
      throw new OtpError(502, 'delivery_failed', 'Could not send the SMS. Please try again.');
    }
  }

  /** Starts a verification of `mobile` for `app` over `channel`. */
  async send(app, mobileInput, channel) {
    channel = channel || app.channels[0];
    if (!app.channels.includes(channel)) {
      throw new OtpError(400, 'channel_not_allowed', `This website cannot use ${channel.replace('_', ' ')} verification.`);
    }
    const mobile = normalizeMobile(mobileInput, this.defaultCountryCode);
    if (!mobile) throw new OtpError(400, 'invalid_mobile', 'Enter a valid mobile number.');

    const coolKey = `cool:${app.id}:${channel}:${mobile}`;
    const coolTtl = await this.store.ttl(coolKey);
    if (coolTtl > 0) {
      throw new OtpError(429, 'resend_cooldown', 'Please wait before trying again.', { retry_after: coolTtl });
    }

    const record = {
      id: 'req_' + crypto.randomBytes(12).toString('hex'),
      appId: app.id,
      channel,
      mobile,
      otpHash: null,
      expiresAt: 0,
      attempts: 0,
      sends: 0,
      lastSentAt: 0,
      verified: false,
    };

    if (channel === 'missed_call') {
      const number = await this.gateway.missedCallNumber();
      if (!number) {
        throw new OtpError(503, 'missed_call_unavailable', 'Missed-call verification is offline right now. Please try SMS.');
      }
      await this.countSend(app, mobile);
      record.callTo = number;
      record.lastSentAt = this.now();
      record.expiresAt = this.now() + this.cfg.ttlSeconds * 1000;
      const waiting = (await this.store.get(`mc:${mobile}`)) || [];
      waiting.push(record.id);
      await this.store.set(`mc:${mobile}`, waiting.slice(-5), { ttl: this.cfg.ttlSeconds });
    } else {
      await this.deliverSms(record, app);
    }
    await this.save(record);
    await this.store.set(coolKey, record.id, { ttl: this.cfg.resendCooldownSeconds });
    return this.publicView(record);
  }

  async getRecord(app, requestId) {
    const record = typeof requestId === 'string' && /^req_[0-9a-f]{24}$/.test(requestId)
      ? await this.store.get(`req:${requestId}`) : null;
    if (!record || record.appId !== app.id) {
      throw new OtpError(404, 'request_not_found', 'Verification request not found or expired.');
    }
    return record;
  }

  async resend(app, requestId) {
    const record = await this.getRecord(app, requestId);
    if (record.channel !== 'sms') throw new OtpError(400, 'wrong_channel', 'Only SMS codes can be resent.');
    if (record.verified) throw new OtpError(409, 'already_verified', 'This number is already verified.');
    const wait = this.resendAfter(record);
    if (wait > 0) throw new OtpError(429, 'resend_cooldown', 'Please wait before requesting another OTP.', { retry_after: wait });
    await this.deliverSms(record, app);
    await this.save(record);
    return this.publicView(record);
  }

  /** Checks an SMS OTP. On success returns a signed, single-use verification token. */
  async verify(app, requestId, otpInput) {
    const record = await this.getRecord(app, requestId);
    if (record.channel !== 'sms') throw new OtpError(400, 'wrong_channel', 'This request is verified by missed call.');
    if (record.verified) throw new OtpError(409, 'already_verified', 'This number is already verified.');
    if (!record.otpHash || this.now() > record.expiresAt) {
      throw new OtpError(410, 'otp_expired', 'The OTP has expired. Request a new one.');
    }
    if (record.attempts >= this.cfg.maxAttempts) {
      throw new OtpError(429, 'too_many_attempts', 'Too many wrong attempts. Request a new OTP.');
    }
    const otp = String(otpInput ?? '').replace(/\s/g, '');
    record.attempts += 1;
    const given = Buffer.from(/^\d{1,12}$/.test(otp) ? this.hash(record.id, otp) : '0'.repeat(64));
    const ok = crypto.timingSafeEqual(given, Buffer.from(record.otpHash));
    if (!ok) {
      const left = this.cfg.maxAttempts - record.attempts;
      if (left <= 0) record.otpHash = null; // burn it
      await this.save(record);
      throw new OtpError(400, 'invalid_otp', left > 0
        ? `Incorrect OTP. ${left} attempt${left === 1 ? '' : 's'} left.`
        : 'Too many wrong attempts. Request a new OTP.', { attempts_left: Math.max(0, left) });
    }
    record.verified = true;
    record.otpHash = null;
    record.verifiedAt = this.now();
    record.token = this.issueToken(record);
    await this.save(record);
    return { verified: true, mobile: '+' + record.mobile, token: record.token };
  }

  /** Polled by the widget/API while waiting for a missed call. */
  async status(app, requestId) {
    const record = await this.getRecord(app, requestId);
    if (record.verified) return { verified: true, mobile: '+' + record.mobile, token: record.token };
    if (this.now() > record.expiresAt) throw new OtpError(410, 'otp_expired', 'Time ran out. Please start again.');
    return { verified: false, ...(await this.publicView(record)) };
  }

  /** Called by the gateway phone when someone rings it. Returns how many requests it verified. */
  async incomingCall(fromInput) {
    const mobile = normalizeMobile(fromInput, this.defaultCountryCode);
    if (!mobile) return 0;
    const ids = (await this.store.get(`mc:${mobile}`)) || [];
    // One call verifies only the newest waiting request, so a stranger who starts a request for
    // someone else's number cannot ride along on that person's own call.
    for (const id of ids.reverse()) {
      const record = await this.store.get(`req:${id}`);
      if (!record || record.verified || this.now() > record.expiresAt) continue;
      record.verified = true;
      record.verifiedAt = this.now();
      record.token = this.issueToken(record);
      await this.save(record);
      await this.store.del(`mc:${mobile}`);
      return 1;
    }
    return 0;
  }

  issueToken(record) {
    const payload = {
      jti: crypto.randomBytes(12).toString('hex'),
      app: record.appId,
      mobile: '+' + record.mobile,
      ch: record.channel,
      iat: Math.floor(this.now() / 1000),
      exp: Math.floor(this.now() / 1000) + TOKEN_TTL,
    };
    const body = b64url(JSON.stringify(payload));
    const sig = b64url(crypto.createHmac('sha256', this.secret).update(body).digest());
    return `${body}.${sig}`;
  }

  /**
   * Called by the client website's *backend* (with its secret key) to confirm a token from the
   * widget. Tokens are single-use and expire after 10 minutes.
   */
  async verifyToken(app, token) {
    const invalid = () => new OtpError(400, 'invalid_token', 'Verification token is invalid or expired.');
    if (typeof token !== 'string' || token.length > 1000 || !token.includes('.')) throw invalid();
    const [body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', this.secret).update(body).digest();
    const given = Buffer.from(sig || '', 'base64url');
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw invalid();
    let payload;
    try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { throw invalid(); }
    if (payload.app !== app.id || payload.exp * 1000 < this.now()) throw invalid();
    const fresh = await this.store.set(`jti:${payload.jti}`, 1, { ttl: TOKEN_TTL, nx: true });
    if (!fresh) throw new OtpError(409, 'token_used', 'Verification token has already been used.');
    return {
      verified: true,
      mobile: payload.mobile,
      channel: payload.ch,
      verified_at: new Date(payload.iat * 1000).toISOString(),
    };
  }
}

module.exports = { OtpService, OtpError };
