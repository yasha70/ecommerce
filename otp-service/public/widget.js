/*!
 * OTP Verify widget: verifies a mobile number by missed call or SMS OTP.
 *
 *   <script src="{{PUBLIC_URL}}/widget.js" defer></script>
 *   <div data-otp-widget data-widget-key="wk_..." data-input-name="otp_token"></div>
 *
 * Or programmatically:
 *   OTPWidget.mount(element, { widgetKey: 'wk_...', mobile: '98765...', onVerified: ({ token, mobile }) => {} });
 *
 * On success the widget fires an "otp:verified" event on the element and, when it sits inside a
 * <form>, writes the token into a hidden input (default name "otp_token").
 * Always confirm the token on your server via POST /api/v1/token/verify.
 */
(function () {
  'use strict';
  var API = '{{PUBLIC_URL}}/api/v1/widget/';

  var CSS = [
    ':host{all:initial;display:block;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1c1f24}',
    '.box{border:1px solid #d9dde3;border-radius:12px;padding:16px;background:#fff;max-width:380px;box-sizing:border-box}',
    'label{display:block;font-size:13px;font-weight:600;margin-bottom:6px}',
    '.row{display:flex;gap:8px}',
    'input{flex:1;min-width:0;font:inherit;font-size:16px;padding:10px 12px;border:1px solid #c5cbd3;border-radius:8px;outline:none;box-sizing:border-box}',
    'input:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.18)}',
    'input.code{letter-spacing:.35em;text-align:center;font-variant-numeric:tabular-nums}',
    'button,a.btn{font:inherit;font-size:14px;font-weight:600;padding:10px 14px;border:0;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer;white-space:nowrap;text-decoration:none;display:inline-block;text-align:center;box-sizing:border-box}',
    'button.alt{background:#eef2f7;color:#1c1f24}',
    'button:disabled{opacity:.55;cursor:default}',
    'button.link{background:none;color:#2563eb;padding:0;font-weight:500}',
    '.btns{display:grid;gap:8px;margin-top:10px}',
    '.call{margin:4px 0 10px;font-size:14px;line-height:1.5}',
    '.num{font-size:22px;font-weight:700;letter-spacing:.02em;font-variant-numeric:tabular-nums}',
    '.hint{font-size:12.5px;color:#5b6573;margin-top:8px;line-height:1.45}',
    '.wait{display:flex;align-items:center;gap:8px;font-size:13px;color:#5b6573;margin-top:10px}',
    '.spin{width:14px;height:14px;border:2px solid #c5cbd3;border-top-color:#2563eb;border-radius:50%;animation:s 1s linear infinite}',
    '@keyframes s{to{transform:rotate(360deg)}}',
    '.msg{font-size:13px;margin-top:10px;min-height:1em}',
    '.msg:empty{display:none}',
    '.err{color:#b42318}.ok{color:#067647;font-weight:600}',
    '.meta{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px;color:#5b6573;margin-top:10px}',
    '.done{display:flex;align-items:center;gap:10px;font-size:15px}',
    '.tick{width:28px;height:28px;border-radius:50%;background:#067647;color:#fff;display:grid;place-items:center;font-size:16px;flex:none}',
    '[hidden]{display:none!important}'
  ].join('');

  function post(key, action, body) {
    return fetch(API + action, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-widget-key': key },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) {
          var e = new Error(data.message || 'Request failed');
          e.data = data;
          throw e;
        }
        return data;
      });
    }, function () { throw new Error('Network error. Check your internet connection.'); });
  }

  function mount(el, opts) {
    opts = opts || {};
    var key = opts.widgetKey || el.getAttribute('data-widget-key');
    if (!key) throw new Error('OTPWidget: widgetKey is required');
    var inputName = opts.inputName || el.getAttribute('data-input-name') || 'otp_token';
    var root = el.attachShadow ? el.attachShadow({ mode: 'open' }) : el;

    root.innerHTML =
      '<style>' + CSS + '</style>' +
      '<div class="box">' +
      '  <div class="step-phone">' +
      '    <label for="m">Mobile number</label>' +
      '    <input id="m" type="tel" inputmode="tel" autocomplete="tel" placeholder="98765 43210">' +
      '    <div class="btns">' +
      '      <button class="by-call" hidden>Verify by missed call</button>' +
      '      <button class="by-sms" hidden>Get OTP by SMS</button>' +
      '    </div>' +
      '  </div>' +
      '  <div class="step-call" hidden>' +
      '    <div class="call">From <b class="from"></b>, give a missed call to</div>' +
      '    <div class="num"></div>' +
      '    <div class="btns"><a class="btn dial" href="#">Call now</a></div>' +
      '    <div class="hint">The call is cut automatically, so it costs nothing. Call from the same number you entered.</div>' +
      '    <div class="wait"><span class="spin"></span><span class="left">Waiting for your call…</span></div>' +
      '    <div class="meta"><button class="link change">Change number</button><button class="link switch-sms" hidden>Get OTP by SMS instead</button></div>' +
      '  </div>' +
      '  <div class="step-code" hidden>' +
      '    <label for="c">Enter the code sent to <span class="to"></span></label>' +
      '    <div class="row"><input id="c" class="code" inputmode="numeric" autocomplete="one-time-code" maxlength="9">' +
      '    <button class="verify">Verify</button></div>' +
      '    <div class="meta"><button class="link change">Change number</button><span class="resend-wrap"></span></div>' +
      '  </div>' +
      '  <div class="step-done done" hidden><span class="tick">&#10003;</span><span>Verified <b class="vnum"></b></span></div>' +
      '  <div class="msg" role="status" aria-live="polite"></div>' +
      '</div>';

    var $ = function (s) { return root.querySelector(s); };
    var $$ = function (s) { return root.querySelectorAll(s); };
    var state = { requestId: null, timer: null, poll: null, channels: ['missed_call', 'sms'], done: false };

    function msg(text, cls) { var m = $('.msg'); m.textContent = text || ''; m.className = 'msg ' + (cls || ''); }
    function show(step) {
      ['phone', 'call', 'code', 'done'].forEach(function (s) { $('.step-' + s).hidden = s !== step; });
    }
    function stop() { clearInterval(state.timer); clearTimeout(state.poll); state.poll = null; }
    function busy(btn, on, label) { btn.disabled = on; if (label) btn.textContent = label; }
    function mobile() { return $('#m').value.trim(); }

    function finish(data) {
      if (state.done) return;
      state.done = true;
      stop();
      $('.vnum').textContent = data.mobile;
      show('done'); msg('');
      var form = el.closest && el.closest('form');
      if (form) {
        var hidden = form.querySelector('input[name="' + inputName + '"]');
        if (!hidden) {
          hidden = document.createElement('input');
          hidden.type = 'hidden'; hidden.name = inputName;
          form.appendChild(hidden);
        }
        hidden.value = data.token;
      }
      var detail = { token: data.token, mobile: data.mobile };
      el.dispatchEvent(new CustomEvent('otp:verified', { detail: detail, bubbles: true }));
      if (typeof opts.onVerified === 'function') opts.onVerified(detail);
    }

    function applyConfig(cfg) {
      state.channels = cfg.channels;
      var call = cfg.channels.indexOf('missed_call') >= 0 && cfg.missed_call_online;
      var sms = cfg.channels.indexOf('sms') >= 0;
      $('.by-call').hidden = !call;
      $('.by-sms').hidden = !sms;
      $('.by-sms').className = call ? 'by-sms alt' : 'by-sms';
      $('.switch-sms').hidden = !sms;
      if (!call && !sms) msg('Mobile verification is offline right now. Please try again in a few minutes.', 'err');
    }

    // ---- missed call ----
    function startCall() {
      var btn = $('.by-call');
      if (!mobile()) return msg('Enter your mobile number.', 'err');
      busy(btn, true, 'Please wait…'); msg('');
      post(key, 'send', { mobile: mobile(), channel: 'missed_call' })
        .then(function (data) {
          state.requestId = data.request_id;
          $('.from').textContent = data.mobile;
          $('.num').textContent = data.call_to.replace(/^(\+91)(\d{5})(\d{5})$/, '$1 $2 $3');
          $('.dial').href = 'tel:' + data.call_to;
          show('call');
          countdown(data.expires_in);
          pollStatus();
        }, function (e) { msg(e.message, 'err'); })
        .then(function () { busy(btn, false, 'Verify by missed call'); });
    }

    function countdown(seconds) {
      clearInterval(state.timer);
      var end = Date.now() + seconds * 1000;
      function tick() {
        var s = Math.max(0, Math.round((end - Date.now()) / 1000));
        $('.left').textContent = 'Waiting for your call… ' + Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
        if (!s) { stop(); $('.left').textContent = 'Time ran out.'; msg('No call arrived in time. Tap Change number to try again.', 'err'); }
      }
      tick();
      state.timer = setInterval(tick, 1000);
    }

    function pollStatus() {
      state.poll = setTimeout(function () {
        post(key, 'status', { request_id: state.requestId }).then(function (data) {
          if (data.verified) return finish(data);
          if (state.poll) pollStatus();
        }, function (e) {
          if (e.data && e.data.error === 'otp_expired') { stop(); msg(e.message, 'err'); }
          else if (state.poll) pollStatus();
        });
      }, 2500);
    }

    // ---- SMS ----
    function startSms() {
      var btn = $('.by-sms');
      if (!mobile()) { show('phone'); return msg('Enter your mobile number.', 'err'); }
      stop();
      busy(btn, true, 'Sending…'); msg('');
      post(key, 'send', { mobile: mobile(), channel: 'sms' })
        .then(onSmsSent, function (e) { show('phone'); msg(e.message, 'err'); })
        .then(function () { busy(btn, false, 'Get OTP by SMS'); });
    }

    function onSmsSent(data) {
      state.requestId = data.request_id;
      $('.to').textContent = data.mobile;
      show('code');
      msg('OTP sent. It can take up to a minute to arrive.', 'ok');
      resendCountdown(data.resend_after);
      $('#c').value = '';
      $('#c').focus();
    }

    function resendCountdown(seconds) {
      clearInterval(state.timer);
      var wrap = $('.resend-wrap');
      function tick() {
        if (seconds > 0) { wrap.textContent = 'Resend in ' + seconds-- + 's'; return; }
        clearInterval(state.timer);
        wrap.innerHTML = '<button class="link resend">Resend OTP</button>';
        $('.resend').onclick = resend;
      }
      tick();
      state.timer = setInterval(tick, 1000);
    }

    function resend() {
      msg('Sending…');
      post(key, 'resend', { request_id: state.requestId })
        .then(onSmsSent, function (e) {
          msg(e.message, 'err');
          if (e.data && e.data.retry_after) resendCountdown(e.data.retry_after);
        });
    }

    function verify() {
      var btn = $('.verify');
      var code = $('#c').value.replace(/\s/g, '');
      if (!/^\d{4,9}$/.test(code)) return msg('Enter the OTP you received.', 'err');
      busy(btn, true, 'Verifying…'); msg('');
      post(key, 'verify', { request_id: state.requestId, otp: code })
        .then(finish, function (e) {
          msg(e.message, 'err');
          if (e.data && (e.data.error === 'otp_expired' || e.data.error === 'too_many_attempts')) resendCountdown(0);
        })
        .then(function () { busy(btn, false, 'Verify'); });
    }

    $('.by-call').onclick = startCall;
    $('.by-sms').onclick = startSms;
    $('.switch-sms').onclick = startSms;
    $('.verify').onclick = verify;
    Array.prototype.forEach.call($$('.change'), function (b) {
      b.onclick = function () { stop(); show('phone'); msg(''); $('#m').focus(); };
    });
    $('#m').onkeydown = function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      (!$('.by-call').hidden ? startCall : startSms)();
    };
    $('#c').onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); verify(); } };
    $('#c').oninput = function () { this.value = this.value.replace(/\D/g, ''); };
    if (opts.mobile) $('#m').value = opts.mobile;

    post(key, 'config').then(applyConfig, function (e) { msg(e.message, 'err'); });

    return {
      reset: function () { stop(); state.done = false; state.requestId = null; show('phone'); msg(''); },
      setMobile: function (m) { $('#m').value = m || ''; },
      destroy: function () { stop(); }
    };
  }

  function autoMount() {
    var nodes = document.querySelectorAll('[data-otp-widget]');
    for (var i = 0; i < nodes.length; i++) {
      if (!nodes[i].__otp) { nodes[i].__otp = true; mount(nodes[i]); }
    }
  }

  window.OTPWidget = { mount: mount };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoMount);
  else autoMount();
})();
