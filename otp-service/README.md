# OTP Verify — mobile number verification on your own phone

A self-hosted alternative to MSG91 / Twilio Verify. Websites use it to check that a user owns
a mobile number, by **missed call** (free) or **SMS OTP**. The texts and calls go through **your own
Android phone and SIM** running the OTP Gateway app, so there is no SMS company in between.

- Live service: https://otp-verify-plum.vercel.app (demo page and docs), admin panel at `/admin`
- Gateway app: https://otp-verify-plum.vercel.app/gateway.apk
- Used by Pakka Bill for sign-up and "Forgot password"

## How it works

```
Website page ──widget.js──▶ OTP Verify (Vercel + Redis) ◀──polls / reports calls── Android gateway phone
Website server ──token check (secret key)──▶ OTP Verify
```

**Missed call:** the user types their number, then rings the gateway phone from it. Android asks the
gateway app (the phone's "caller ID & spam" app) about the incoming call. The app asks the server,
and if that number is waiting to be verified, the call is cut at once. An unanswered call costs the
caller nothing. Any other call rings normally, so the SIM still works as an ordinary phone.

**SMS OTP:** the server queues the message. The gateway app picks it up (it checks every
`GATEWAY_POLL_SECONDS`, 10 by default) and sends it from its SIM.

When verification succeeds, the widget gives the page a signed, single-use token. The website's
server confirms it with `POST /api/v1/token/verify` and its secret key.

## Setting up the gateway phone

1. Use an Android 10+ phone with a SIM that stays on, charged and online.
2. In `/admin`, tap **Pair a phone**. This shows the server address and a pairing code.
3. Install `gateway.apk` on the phone (allow "install unknown apps"), paste both values, type the
   phone's own number and tap **Start**.
4. Work through the checklist in the app:
   - allow SMS
   - set it as the **caller ID & spam app** (needed to cut verification calls)
   - allow notifications
   - turn off battery restrictions
5. The admin panel shows the phone as **Online**.

SMS limits: Indian operators usually cap personal SIMs at about 100 SMS a day. Heavy commercial
sending from a personal SIM can get it blocked under TRAI rules. Missed-call verification has no
such limit, so the widget offers it first.

## Adding a website

In `/admin` → **Add a website**, enter its name and address (e.g. `https://myshop.com`). You get:
- a **secret key** `sk_…` for its server, shown once
- a **widget key** `wk_…` for its pages, which works only from the listed addresses

Websites can also be fixed in the `STATIC_APPS` setting (JSON; see `src/apps.js`). Pakka Bill is set
up that way.

```html
<form action="/signup" method="post">
  <div data-otp-widget data-widget-key="wk_..." data-accent="#6c4dff"></div>
  <button>Sign up</button>
</form>
<script src="https://otp-verify-plum.vercel.app/widget.js" defer></script>
```

The widget adds a hidden `otp_token` field and fires `otp:verified`. Confirm the token on your server:

```bash
curl -X POST https://otp-verify-plum.vercel.app/api/v1/token/verify \
  -H "Authorization: Bearer sk_..." -H "content-type: application/json" -d '{"token":"..."}'
# {"verified":true,"mobile":"+919876543210","channel":"missed_call","verified_at":"..."}
```

## API

Server calls use `Authorization: Bearer sk_…`. The widget uses the same actions under
`/api/v1/widget/*`, with `X-Widget-Key` and an allowed `Origin`.

| Endpoint | Body | Response |
|---|---|---|
| `POST /api/v1/otp/config` | – | `{ channels, missed_call_online }` |
| `POST /api/v1/otp/send` | `{ mobile, channel: "missed_call" \| "sms" }` | `{ request_id, channel, mobile (masked), expires_in, call_to \| resend_after }` |
| `POST /api/v1/otp/status` | `{ request_id }` | `{ verified: false, … }` or `{ verified: true, mobile, token }` |
| `POST /api/v1/otp/resend` | `{ request_id }` (SMS) | same as send |
| `POST /api/v1/otp/verify` | `{ request_id, otp }` (SMS) | `{ verified, mobile, token }` |
| `POST /api/v1/token/verify` | `{ token }` | `{ verified, mobile, channel, verified_at }` |
| `GET /health` | – | `{ ok, store, missed_call_online, sms_online }` |

Errors come back as `{ error, message }`. Codes: `invalid_mobile`, `invalid_otp` (with
`attempts_left`), `otp_expired`, `resend_cooldown` / `too_many_otps` / `rate_limited` (with
`retry_after`), `missed_call_unavailable`, `delivery_failed`.

## Running and deploying

```bash
npm test          # unit + HTTP tests (in-memory store)
npm start         # local server on :3000; see .env.example
```

On Vercel, `api/index.js` serves everything. Connect a **Redis (Upstash) store** to the project
(Storage → Connect). All keys are prefixed `otp:`, so it can share a database with another app.
Settings: `SECRET`, `ADMIN_PASSWORD`, optional `STATIC_APPS`, `GATEWAY_POLL_SECONDS`,
`MISSED_CALL_NUMBER`.

The gateway app lives in `android-gateway/`. `.github/workflows/otp-gateway.yml` builds it and
publishes it as the `otp-gateway-latest` release. It is signed with a debug key, so installing a
newer build may mean uninstalling the old one and pairing again.

## Security

- OTPs are stored only as an HMAC and compared in constant time.
- Codes expire after 5 minutes and are burned after 5 wrong tries.
- Limits: a cooldown between sends, a per-number hourly cap, and a per-IP limit.
- A missed call verifies only the newest waiting request for that number.
- Caller ID can in principle be spoofed. For high-value actions, prefer SMS OTP.
- Secret keys and pairing codes are stored hashed. Widget keys are locked to their websites.
