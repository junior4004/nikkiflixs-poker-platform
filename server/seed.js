'use strict';
// Seed script: creates the admin account.
// Run: node seed.js <admin-username> <admin-password>

const bcrypt = require('bcryptjs');
const { stmts, db } = require('./db');

(async () => {
  const username = (process.argv[2] || 'admin').toLowerCase();
  const password = process.argv[3] || 'changeme123';

  if (stmts.getByUsername.get(username)) {
    console.log(`User "${username}" already exists.`);
    process.exit(0);
  }
  const hash = await bcrypt.hash(password, 10);
  const info = stmts.createPlayer.run(username, hash, 'Admin', 0);
  db.prepare('UPDATE players SET is_admin = 1 WHERE id = ?').run(info.lastInsertRowid);
  console.log(`Admin "${username}" created. Change the password after first login.`);
  process.exit(0);
})();
