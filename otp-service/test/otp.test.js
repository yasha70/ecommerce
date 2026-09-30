'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMobile, maskMobile } = require('../src/phone');
const { OtpService } = require('../src/otp');
const { MemoryStore } = require('../src/store');
const { AppStore } = require('../src/apps');
const { Gateway } = require('../src/gateway');
const { createServer } = require('../src/server');

const baseConfig = {
  secret: 'test-secret',
  defaultCountryCode: '91',
  publicUrl: 'http://localhost',
  adminPassword: 'admin-pw',
  trustProxy: false,
  ipRequestsPerMinute: 1000,
  otp: { length: 6, ttlSeconds: 300, maxAttempts: 3, resendCooldownSeconds: 30, maxSendsPerHour: 3 },
  gateway: { pollSeconds: 10, missedCallNumber: '' },
  sms: { provider: 'phone', template: '{otp} is your {app} code' },
};

async function setup() {
  let clock = 1_000_000;
  const now = () => clock;
  const store = new MemoryStore(now);
  const gateway = new Gateway({ config: baseConfig, store, now });
  const sent = [];
  const provider = { send: async (m) => { sent.push(m); } };
  const otp = new OtpService({ config: baseConfig, store, provider, gateway, now });
  const app = { id: 'app_1', name: 'Shop', channels: ['missed_call', 'sms'] };
  return { otp, app, sent, store, gateway, advance: (ms) => { clock += ms; } };
}

test('normalizeMobile', () => {
  assert.equal(normalizeMobile('98765 43210', '91'), '919876543210');
  assert.equal(normalizeMobile('09876543210', '91'), '919876543210');
  assert.equal(normalizeMobile('+91 98765-43210', '91'), '919876543210');
  assert.equal(normalizeMobile('+1 (415) 555-0100', '91'), '14155550100');
  assert.equal(normalizeMobile('0014155550100', '91'), '14155550100');
  assert.equal(normalizeMobile('12345', '91'), null);
  assert.equal(normalizeMobile('+91 1234567890', '91'), null);
  assert.equal(normalizeMobile({}, '91'), null);
  assert.equal(maskMobile('919876543210'), '+91******3210');
});

test('SMS: send + verify issues a single-use token', async () => {
  const { otp, app, sent } = await setup();
  const r = await otp.send(app, '9876543210', 'sms');
  assert.equal(sent[0].to, '919876543210');
  assert.match(sent[0].otp, /^\d{6}$/);
  assert.equal(sent[0].message, `${sent[0].otp} is your Shop code`);
  assert.equal(r.mobile, '+91******3210');

  const v = await otp.verify(app, r.request_id, sent[0].otp);
  assert.equal(v.mobile, '+919876543210');
  const t = await otp.verifyToken(app, v.token);
  assert.equal(t.mobile, '+919876543210');
  assert.equal(t.channel, 'sms');
  await assert.rejects(otp.verifyToken(app, v.token), { code: 'token_used' });
  await assert.rejects(otp.verifyToken({ id: 'other' }, v.token), { code: 'invalid_token' });
  await assert.rejects(otp.verify(app, r.request_id, sent[0].otp), { code: 'already_verified' });
});

test('tampered token is rejected', async () => {
  const { otp, app, sent } = await setup();
  const r = await otp.send(app, '9876543210', 'sms');
  const { token } = await otp.verify(app, r.request_id, sent[0].otp);
  const [body, sig] = token.split('.');
  const payload = JSON.parse(Buffer.from(body, 'base64url'));
  payload.mobile = '+911111111111';
  const forged = Buffer.from(JSON.stringify(payload)).toString('base64url') + '.' + sig;
  await assert.rejects(otp.verifyToken(app, forged), { code: 'invalid_token' });
});

test('wrong OTP counts attempts and locks out; OTP expires', async () => {
  const { otp, app, sent, advance } = await setup();
  const r = await otp.send(app, '9876543210', 'sms');
  const wrong = sent[0].otp === '000000' ? '111111' : '000000';
  for (let i = 0; i < 3; i++) await assert.rejects(otp.verify(app, r.request_id, wrong), { code: 'invalid_otp' });
  await assert.rejects(otp.verify(app, r.request_id, sent[0].otp), { code: 'otp_expired' });

  advance(31_000);
  const r2 = await otp.send(app, '9876543211', 'sms');
  advance(301_000);
  await assert.rejects(otp.verify(app, r2.request_id, sent[1].otp), { code: 'otp_expired' });
});

test('resend cooldown and hourly cap', async () => {
  const { otp, app, advance } = await setup();
  const r = await otp.send(app, '9876543210', 'sms');
  await assert.rejects(otp.resend(app, r.request_id), { code: 'resend_cooldown' });
  await assert.rejects(otp.send(app, '9876543210', 'sms'), { code: 'resend_cooldown' });
  advance(31_000);
  await otp.resend(app, r.request_id);
  advance(31_000);
  await otp.resend(app, r.request_id);
  advance(31_000);
  await assert.rejects(otp.resend(app, r.request_id), { code: 'too_many_otps' });
});

test('channel restrictions and app isolation', async () => {
  const { otp, app } = await setup();
  await assert.rejects(otp.send({ ...app, channels: ['missed_call'] }, '9876543210', 'sms'), { code: 'channel_not_allowed' });
  const r = await otp.send(app, '9876543210', 'sms');
  await assert.rejects(otp.verify({ id: 'app_2', channels: ['sms'] }, r.request_id, '123456'), { code: 'request_not_found' });
});

test('missed call: offline gateway, then verified by an incoming call', async () => {
  const { otp, app, gateway } = await setup();
  await assert.rejects(otp.send(app, '9876543210', 'missed_call'), { code: 'missed_call_unavailable' });

  const { device } = await gateway.pair('Test phone');
  await gateway.poll(device, { number: '+91 99999 00000', calls: true, sms: false });
  const r = await otp.send(app, '9876543210', 'missed_call');
  assert.equal(r.call_to, '+919999900000');
  assert.equal((await otp.status(app, r.request_id)).verified, false);

  assert.equal(await otp.incomingCall('+911234567899'), 0); // someone else calling
  assert.equal(await otp.incomingCall('09876543210'), 1);
  const s = await otp.status(app, r.request_id);
  assert.equal(s.verified, true);
  assert.equal((await otp.verifyToken(app, s.token)).channel, 'missed_call');
  assert.equal(await otp.incomingCall('9876543210'), 0); // a second call does nothing
});

test('missed call only verifies the newest waiting request', async () => {
  const { otp, app, gateway } = await setup();
  const { device } = await gateway.pair();
  await gateway.poll(device, { number: '9999900000', calls: true });
  const other = { ...app, id: 'app_2' };
  const first = await otp.send(app, '9876543210', 'missed_call');
  const second = await otp.send(other, '9876543210', 'missed_call');
  assert.equal(await otp.incomingCall('9876543210'), 1);
  assert.equal((await otp.status(other, second.request_id)).verified, true);
  assert.equal((await otp.status(app, first.request_id)).verified, false);
});

test('phone gateway queues SMS for the paired phone', async () => {
  const { store, gateway } = await setup();
  const phone = require('../src/providers/phone')(gateway);
  await assert.rejects(phone.send({ to: '919876543210', message: 'hi', expiresAt: Date.now() + 1e6 }), /No gateway phone/);
  const { device, token } = await gateway.pair('p');
  assert.deepEqual(await gateway.auth(token), device);
  assert.equal(await gateway.auth('gw_' + '0'.repeat(48)), null);
  await gateway.poll(device, { sms: true });
  await phone.send({ to: '919876543210', message: 'hi', expiresAt: 2_000_000 });
  const out = await gateway.poll(device, { sms: true });
  assert.equal(out.messages.length, 1);
  assert.equal(out.messages[0].to, '+919876543210');
  assert.equal(await store.len('smsq'), 0);
});

test('HTTP API end to end: admin, widget, gateway, token check', async (t) => {
  const store = new MemoryStore();
  const server = createServer({ cfg: baseConfig, store });
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (p, body, headers = {}, method = 'POST') => fetch(base + p, {
    method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const admin = { authorization: 'Bearer admin-pw' };

  assert.equal((await call('/api/v1/admin/overview', null, { authorization: 'Bearer nope' }, 'GET')).status, 401);
  const created = await call('/api/v1/admin/apps', { name: 'Shop', allowed_origins: ['https://shop.example'], channels: ['missed_call', 'sms'] }, admin);
  assert.equal(created.status, 200);
  const { secret_key: secretKey, app } = created.body;
  const pair = await call('/api/v1/admin/devices/pair', { name: 'Phone' }, admin);
  const gw = { authorization: `Bearer ${pair.body.token}` };
  assert.equal((await call('/api/v1/gateway/poll', { number: '9999900000', calls: true, sms: true }, gw)).status, 200);

  assert.equal((await call('/api/v1/otp/send', { mobile: '9876543210' })).status, 401);
  const bad = await call('/api/v1/otp/send', { mobile: '123' }, { authorization: `Bearer ${secretKey}` });
  assert.equal(bad.body.error, 'invalid_mobile');

  const w = { 'x-widget-key': app.widgetKey, origin: 'https://shop.example' };
  assert.equal((await call('/api/v1/widget/send', { mobile: '9876543210' }, { ...w, origin: 'https://evil.example' })).status, 403);
  const cfgRes = await call('/api/v1/widget/config', {}, w);
  assert.equal(cfgRes.body.missed_call_online, true);

  // missed call
  const s = await call('/api/v1/widget/send', { mobile: '9876543210', channel: 'missed_call' }, w);
  assert.equal(s.body.call_to, '+919999900000');
  const rang = await call('/api/v1/gateway/call', { from: '+919876543210' }, gw);
  assert.equal(rang.body.verified, true);
  const st = await call('/api/v1/widget/status', { request_id: s.body.request_id }, w);
  assert.equal(st.body.verified, true);

  // sms through the phone gateway
  const s2 = await call('/api/v1/widget/send', { mobile: '9876543211', channel: 'sms' }, w);
  assert.equal(s2.status, 200);
  const polled = await call('/api/v1/gateway/poll', { sms: true, calls: true, number: '9999900000' }, gw);
  const code = polled.body.messages[0].message.match(/^\d{6}/)[0];
  const v = await call('/api/v1/widget/verify', { request_id: s2.body.request_id, otp: code }, w);
  assert.equal(v.status, 200);

  const confirm = await call('/api/v1/token/verify', { token: st.body.token }, { authorization: `Bearer ${secretKey}` });
  assert.equal(confirm.body.mobile, '+919876543210');
  const overview = await call('/api/v1/admin/overview', null, admin, 'GET');
  assert.equal(overview.body.stats.calls_verified, 1);
  assert.ok(!('secretKeyHash' in overview.body.apps[0]));
});

test('static apps from settings work with their keys and cannot be deleted', async () => {
  const { sha256 } = require('../src/apps');
  const store = new MemoryStore();
  const sk = 'sk_' + 'a'.repeat(48);
  const apps = new AppStore(store, [{ id: 'app_fixed', name: 'Fixed', secretKeyHash: sha256(sk), widgetKey: 'wk_' + 'b'.repeat(24), allowedOrigins: ['https://x.example/'] }]);
  assert.equal((await apps.bySecretKey(sk)).id, 'app_fixed');
  assert.equal((await apps.byWidgetKey('wk_' + 'b'.repeat(24))).allowedOrigins[0], 'https://x.example');
  assert.equal(await apps.remove('app_fixed'), false);
  assert.equal((await apps.list()).length, 1);
});
