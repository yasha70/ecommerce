# OTP Verify — real-time mobile number verification service

A self-hosted alternative to MSG91's OTP widget: other websites use it to verify that a user
owns a mobile number. It has a REST API for backends, a drop-in JavaScript widget for web pages,
and pluggable SMS gateways. It has zero npm dependencies and needs Node.js 20.6+.

> **Note:** SMS delivery still goes through a telecom gateway (MSG91, Twilio or your own).
> In India, commercial SMS also needs DLT registration of your sender ID and template.
> In development the `console` provider prints OTPs to the server log instead of sending them.

## Quick start

```bash
cd otp-service
cp .env.example .env        # set SECRET and choose an SMS_PROVIDER
npm start                   # http://localhost:3000 — live demo + integration docs
npm test
```

## Onboarding a client website

```bash
npm run create-app -- "My Shop" https://myshop.com https://www.myshop.com
```

This prints:
- **Secret API key** `sk_…`: for server-to-server calls. It is shown once and only its hash is stored.
- **Widget key** `wk_…`: public, and only accepted from the listed origins.

### Widget integration

```html
<form action="/signup" method="post">
  <div data-otp-widget data-widget-key="wk_..."></div>
  <button>Sign up</button>
</form>
<script src="https://otp.yourdomain.com/widget.js" defer></script>
```

After a successful verification the widget adds a hidden `otp_token` input to the form and
dispatches an `otp:verified` event (`e.detail = { token, mobile }`). **Always** confirm the token
on your server; never trust the browser alone:

```bash
curl -X POST https://otp.yourdomain.com/api/v1/token/verify \
  -H "Authorization: Bearer sk_..." -H "content-type: application/json" \
  -d '{"token":"<otp_token>"}'
# {"verified":true,"mobile":"+919876543210","verified_at":"..."}
```

Tokens are HMAC-signed, tied to one app, expire after 10 minutes and can be used once.

### Pure API integration (your own UI)

| Endpoint | Body | Response |
|---|---|---|
| `POST /api/v1/otp/send` | `{ mobile }` | `{ request_id, mobile (masked), expires_in, resend_after }` |
| `POST /api/v1/otp/resend` | `{ request_id }` | same as send |
| `POST /api/v1/otp/verify` | `{ request_id, otp }` | `{ verified, mobile, token }` |
| `POST /api/v1/token/verify` | `{ token }` | `{ verified, mobile, verified_at }` |

Authenticate with `Authorization: Bearer sk_…` (or an `authkey: sk_…` header, as MSG91 uses).
The widget uses the same routes under `/api/v1/widget/*` with an `X-Widget-Key` header.

Errors return `{ error, message, ... }`:

| `error` | HTTP | Meaning |
|---|---|---|
| `invalid_mobile` | 400 | Number could not be parsed |
| `invalid_otp` | 400 | Wrong code (`attempts_left` included) |
| `otp_expired` | 410 | Code expired or burned after too many attempts |
| `resend_cooldown` / `too_many_otps` / `rate_limited` | 429 | Includes `retry_after` seconds |
| `delivery_failed` | 502 | The SMS gateway rejected the message |

## SMS providers

Set `SMS_PROVIDER` in `.env`:

- `console`: prints to the log (development).
- `msg91`: MSG91 Flow API. Needs `MSG91_AUTH_KEY` and a DLT-approved `MSG91_TEMPLATE_ID` whose text contains `##otp##`.
- `twilio`: needs `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM`.
- `webhook`: POSTs `{ to, message, otp }` to `SMS_WEBHOOK_URL` (your own gateway, an Android SMS-gateway app, etc).

To add another gateway, create `src/providers/<name>.js` exporting `send({ to, message, otp })`.

## Security measures

- OTPs are generated with `crypto.randomInt` and stored only as an HMAC. Comparisons are constant-time.
- Codes expire (default 5 min) and are burned after 5 wrong attempts.
- There is a resend cooldown (30 s), a per-number hourly cap (5), and a per-IP request limit (60/min) to limit SMS-pumping fraud.
- Numbers are masked in API responses and logs.
- Widget keys are locked to allowed origins, and secret keys are stored hashed.

## Production notes

- Set `NODE_ENV=production` and a strong `SECRET`. The server refuses to start without one, and the demo app is not created.
- Run it behind HTTPS (nginx or Caddy). Set `TRUST_PROXY=1` so per-IP limits use `X-Forwarded-For`.
- OTP state is kept in memory, so run one instance. To scale horizontally, move the maps in `src/otp.js` and `src/ratelimit.js` to Redis.
- Consider adding a CAPTCHA before `send` on public pages if you see SMS-pumping abuse.
