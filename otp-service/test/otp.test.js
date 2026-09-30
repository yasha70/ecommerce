'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeMobile, maskMobile } = require('../src/phone');
const { OtpService } = require('../src/otp');
const { AppStore } = require('../src/apps');
const { createServer } = require('../src/server');

const baseConfig = {
  secret: 'test-secret',
  defaultCountryCode: '91',
  publicUrl: 'http://localhost',
  ipRequestsPerMinute: 1000,
  otp: { length: 6, ttlSeconds: 300, maxAttempts: 3, resendCooldownSeconds: 30, maxSendsPerHour: 3 },
  sms: { provider: 'console', template: '{otp} is your {app} code' },
};

function setup() {
  const sent = [];
  let clock = 1_000_000;
  const provider = { send: async (m) => { sent.push(m); } };
  const otp = new OtpService({ config: baseConfig, provider, now: () => clock });
  const app = { id: 'app_1', name: 'Shop' };
  return { otp, app, sent, advance: (ms) => { clock += ms; } };
}

test('normalizeMobile', () => {
  assert.equal(normalizeMobile('98765 43210', '91'), '919876543210');
  assert.equal(normalizeMobile('09876543210', '91'), '919876543210');
  assert.equal(normalizeMobile('+91 98765-43210', '91'), '919876543210');
  assert.equal(normalizeMobile('+1 (415) 555-0100', '91'), '14155550100');
  assert.equal(normalizeMobile('0014155550100', '91'), '14155550100');
  assert.equal(normalizeMobile('12345', '91'), null);
  assert.equal(normalizeMobile('+91 1234567890', '91'), null); // Indian mobiles start 6-9
  assert.equal(normalizeMobile({}, '91'), null);
  assert.equal(maskMobile('919876543210'), '+91******3210');
});

test('send + verify issues a single-use token', async () => {
  const { otp, app, sent } = setup();
  const r = await otp.send(app, '9876543210');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, '919876543210');
  assert.match(sent[0].otp, /^\d{6}$/);
  assert.equal(sent[0].message, `${sent[0].otp} is your Shop code`);
  assert.equal(r.mobile, '+91******3210');

  const v = otp.verify(app, r.request_id, sent[0].otp);
  assert.equal(v.verified, true);
  assert.equal(v.mobile, '+919876543210');

  const t = otp.verifyToken(app, v.token);
  assert.equal(t.mobile, '+919876543210');
  assert.throws(() => otp.verifyToken(app, v.token), { code: 'token_used' });
  assert.throws(() => otp.verifyToken({ id: 'other' }, v.token), { code: 'invalid_token' });
  assert.throws(() => otp.verify(app, r.request_id, sent[0].otp), { code: 'already_verified' });
});

test('tampered token is rejected', async () => {
  const { otp, app, sent } = setup();
  const r = await otp.send(app, '9876543210');
  const { token } = otp.verify(app, r.request_id, sent[0].otp);
  const [body, sig] = token.split('.');
  const payload = JSON.parse(Buffer.from(body, 'base64url'));
  payload.mobile = '+911111111111';
  const forged = Buffer.from(JSON.stringify(payload)).toString('base64url') + '.' + sig;
  assert.throws(() => otp.verifyToken(app, forged), { code: 'invalid_token' });
});

test('wrong OTP counts attempts and locks out', async () => {
  const { otp, app, sent } = setup();
  const r = await otp.send(app, '9876543210');
  const wrong = sent[0].otp === '000000' ? '111111' : '000000';
  assert.throws(() => otp.verify(app, r.request_id, wrong), { code: 'invalid_otp' });
  assert.throws(() => otp.verify(app, r.request_id, wrong), { code: 'invalid_otp' });
  assert.throws(() => otp.verify(app, r.request_id, wrong), { code: 'invalid_otp' });
  // Even the right code no longer works once attempts are exhausted.
  assert.throws(() => otp.verify(app, r.request_id, sent[0].otp), { code: 'otp_expired' });
});

test('OTP expires', async () => {
  const { otp, app, sent, advance } = setup();
  const r = await otp.send(app, '9876543210');
  advance(301_000);
  assert.throws(() => otp.verify(app, r.request_id, sent[0].otp), { code: 'otp_expired' });
});

test('resend cooldown, new OTP invalidates old, hourly cap', async () => {
  const { otp, app, sent, advance } = setup();
  const r = await otp.send(app, '9876543210');
  await assert.rejects(otp.resend(app, r.request_id), { code: 'resend_cooldown' });
  await assert.rejects(otp.send(app, '9876543210'), { code: 'resend_cooldown' });
  advance(31_000);
  await otp.resend(app, r.request_id);
  assert.notEqual(sent[1].otp, undefined);
  if (sent[0].otp !== sent[1].otp) {
    assert.throws(() => otp.verify(app, r.request_id, sent[0].otp), { code: 'invalid_otp' });
  }
  advance(31_000);
  await otp.resend(app, r.request_id);
  advance(31_000);
  await assert.rejects(otp.resend(app, r.request_id), { code: 'too_many_otps' });
});

test('requests are isolated per app', async () => {
  const { otp, app } = setup();
  const r = await otp.send(app, '9876543210');
  assert.throws(() => otp.verify({ id: 'app_2', name: 'x' }, r.request_id, '123456'),
    { code: 'request_not_found' });
});

test('HTTP API: auth, widget origin check, full flow', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'otp-'));
  const apps = new AppStore(path.join(dir, 'apps.json'));
  const { app, secretKey } = apps.create({ name: 'Shop', allowedOrigins: ['https://shop.example'] });
  const sent = [];
  const otp = new OtpService({ config: baseConfig, provider: { send: async (m) => { sent.push(m); } } });
  const server = createServer({ cfg: baseConfig, apps, otp });
  await new Promise((r) => server.listen(0, r));
  t.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (p, body, headers) => fetch(base + p, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

  assert.equal((await call('/api/v1/otp/send', { mobile: '9876543210' })).status, 401);
  assert.equal((await call('/api/v1/otp/send', { mobile: '9876543210' },
    { authorization: 'Bearer sk_nope' })).status, 401);

  const bad = await call('/api/v1/otp/send', { mobile: '123' }, { authorization: `Bearer ${secretKey}` });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'invalid_mobile');

  // Widget key from a non-allowed origin is refused.
  const evil = await call('/api/v1/widget/send', { mobile: '9876543210' },
    { 'x-widget-key': app.widgetKey, origin: 'https://evil.example' });
  assert.equal(evil.status, 403);

  const s = await call('/api/v1/widget/send', { mobile: '9876543210' },
    { 'x-widget-key': app.widgetKey, origin: 'https://shop.example' });
  assert.equal(s.status, 200);
  const v = await call('/api/v1/widget/verify', { request_id: s.body.request_id, otp: sent[0].otp },
    { 'x-widget-key': app.widgetKey, origin: 'https://shop.example' });
  assert.equal(v.status, 200);

  const confirm = await call('/api/v1/token/verify', { token: v.body.token },
    { authorization: `Bearer ${secretKey}` });
  assert.equal(confirm.status, 200);
  assert.equal(confirm.body.mobile, '+919876543210');
});
