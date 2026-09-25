'use strict';
const config = require('./src/config');
const { open } = require('./src/db');
const { seed } = require('./src/seed');
const { createApp } = require('./src/app');

const db = open();
seed(db);

createApp(db).listen(config.port, () => {
  console.log(`${config.store.name} running at http://localhost:${config.port}`);
  console.log(`Admin panel: http://localhost:${config.port}/admin  (${config.adminEmail})`);
  if (!process.env.SESSION_SECRET) console.warn('SESSION_SECRET is not set: logins will reset whenever the server restarts.');
  if (!process.env.ADMIN_PASSWORD) console.warn('ADMIN_PASSWORD is not set: using the default admin password. Change it before going live.');
});
