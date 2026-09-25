'use strict';
// Payment providers.
//
// "demo"     – default. A simulated gateway page; no money moves. Good for trying the full order flow.
// "razorpay" – switches on automatically when RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are set.
//              Uses Razorpay Standard Checkout: the server creates a Razorpay order, the browser opens
//              Razorpay's checkout, and the server verifies the payment signature before marking the order paid.
//              Set RAZORPAY_WEBHOOK_SECRET too so payments are confirmed even if the shopper closes the tab.
const crypto = require('node:crypto');

class PaymentError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function providerName() {
  return process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET ? 'razorpay' : 'demo';
}

function hmac(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const demo = {
  name: 'demo',
  async createSession() {
    return { provider: 'demo' };
  },
  verify(_order, body) {
    if (body.success === false) return { ok: false };
    return { ok: true, ref: `demo_${crypto.randomBytes(8).toString('hex')}` };
  },
};

const razorpay = {
  name: 'razorpay',
  async createSession(order, store) {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const auth = Buffer.from(`${keyId}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: order.total * 100, // paise
        currency: 'INR',
        receipt: order.order_number,
        notes: { order_number: order.order_number },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.id) {
      console.error('Razorpay order creation failed', res.status, data);
      throw new PaymentError('Could not start the payment. Please try again.', 502);
    }
    const address = JSON.parse(order.address);
    return {
      provider: 'razorpay',
      gatewayOrderId: data.id,
      checkout: {
        key: keyId,
        amount: data.amount,
        currency: data.currency,
        order_id: data.id,
        name: store.name,
        description: `Order #${order.order_number}`,
        prefill: { name: address.name, email: order.email, contact: address.phone },
        theme: { color: '#7a1f2b' },
      },
    };
  },
  verify(order, body) {
    const { razorpay_order_id: rzOrder, razorpay_payment_id: rzPayment, razorpay_signature: sig } = body;
    if (!rzOrder || !rzPayment || !sig) throw new PaymentError('Payment details are missing.');
    if (rzOrder !== order.gateway_order_id) throw new PaymentError('Payment does not match this order.');
    const expected = hmac(process.env.RAZORPAY_KEY_SECRET, `${rzOrder}|${rzPayment}`);
    if (!safeEqual(expected, sig)) throw new PaymentError('Payment verification failed.');
    return { ok: true, ref: rzPayment };
  },
  // Verifies a webhook call; returns { orderNumber, ref } for captured payments, else null.
  parseWebhook(rawBody, signature) {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) throw new PaymentError('Webhook secret not configured.', 503);
    if (!safeEqual(hmac(secret, rawBody), signature)) throw new PaymentError('Invalid webhook signature.', 401);
    const event = JSON.parse(rawBody);
    const payment = event?.payload?.payment?.entity;
    if (!['payment.captured', 'order.paid'].includes(event.event) || !payment) return null;
    return { orderNumber: payment.notes?.order_number, gatewayOrderId: payment.order_id, ref: payment.id };
  },
};

function provider() {
  return providerName() === 'razorpay' ? razorpay : demo;
}

module.exports = { provider, providerName, PaymentError, razorpay, hmac };
