'use strict';

// Registers a client website and prints its keys.
// Usage: npm run create-app -- "My Shop" https://myshop.com https://www.myshop.com
const config = require('../src/config');
const { AppStore } = require('../src/apps');

const [name, ...origins] = process.argv.slice(2);
if (!name) {
  console.error('Usage: npm run create-app -- "<app name>" [allowed-origin ...]');
  process.exit(1);
}

const { app, secretKey } = new AppStore(config.dataFile).create({ name, allowedOrigins: origins });
console.log(`
App created: ${app.name} (${app.id})

  Secret API key  : ${secretKey}
      -> server-side only. Shown once; store it in your backend's environment.
  Widget key      : ${app.widgetKey}
      -> safe to put in your web page.
  Allowed origins : ${app.allowedOrigins.join(', ') || '(none - widget disabled until you add one)'}
`);
