// Accounts and logins, in an SQLite database of their own (Node's built-in node:sqlite), kept
// whether or not matches are recorded.
//
//   users     one row per account: the username (as typed at signup; unique ignoring case) and
//             the password's scrypt hash with its salt
//   sessions  one row per login: a random token (the browser's cookie) and when it expires
//
// A username is 1 to 20 letters and digits; a password is anything but empty.

import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY,
  username   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  salt       TEXT NOT NULL,     -- hex
  hash       TEXT NOT NULL,     -- hex: scrypt(password, salt)
  created_at INTEGER NOT NULL   -- ms since the epoch
);
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,  -- hex, the cookie's value
  user_id    INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL   -- ms since the epoch
);
`;

export const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // a login lasts 30 days
export const USERNAME = /^[A-Za-z0-9]{1,20}$/;
const KEY_LENGTH = 64;

const hashPassword = (password, salt) => crypto.scryptSync(password, salt, KEY_LENGTH).toString('hex');

export function openUsers(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  const q = {
    insert: db.prepare('INSERT INTO users (username, salt, hash, created_at) VALUES (?, ?, ?, ?)'),
    byName: db.prepare('SELECT id, username, salt, hash FROM users WHERE username = ?'),
    session: db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)'),
    lookup: db.prepare(`SELECT users.id, users.username FROM sessions JOIN users ON users.id = sessions.user_id
                        WHERE sessions.token = ? AND sessions.expires_at > ?`),
    logout: db.prepare('DELETE FROM sessions WHERE token = ?'),
    expired: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  };
  q.expired.run(Date.now());
  const newSession = (userId) => {
    const token = crypto.randomBytes(32).toString('hex');
    q.session.run(token, userId, Date.now() + SESSION_MS);
    return token;
  };
  return {
    db,
    // A new account, logged in: { user: { id, username }, token }, or { error } with a code
    // (error.<code> in i18n.js): badUsername, emptyPassword or usernameTaken.
    signup(username, password) {
      if (typeof username !== 'string' || !USERNAME.test(username)) return { error: 'badUsername' };
      if (typeof password !== 'string' || !password) return { error: 'emptyPassword' };
      if (q.byName.get(username)) return { error: 'usernameTaken' };
      const salt = crypto.randomBytes(16).toString('hex');
      try {
        const { lastInsertRowid } = q.insert.run(username, salt, hashPassword(password, salt), Date.now());
        const id = Number(lastInsertRowid);
        return { user: { id, username }, token: newSession(id) };
      } catch (err) {
        if (String(err.message).includes('UNIQUE')) return { error: 'usernameTaken' }; // signed up meanwhile
        throw err;
      }
    },
    // Logging in: { user, token }, or { error: 'badLogin' } (no such user, or the wrong password).
    login(username, password) {
      const row = typeof username === 'string' && typeof password === 'string' ? q.byName.get(username) : null;
      if (!row) return { error: 'badLogin' };
      const given = Buffer.from(hashPassword(password, row.salt), 'hex');
      if (!crypto.timingSafeEqual(given, Buffer.from(row.hash, 'hex'))) return { error: 'badLogin' };
      return { user: { id: row.id, username: row.username }, token: newSession(row.id) };
    },
    // The account a session token belongs to ({ id, username }), or null if none or expired.
    user(token) {
      if (typeof token !== 'string' || !token) return null;
      const row = q.lookup.get(token, Date.now());
      return row ? { id: row.id, username: row.username } : null;
    },
    logout(token) {
      if (typeof token === 'string') q.logout.run(token);
    },
    close() {
      db.close();
    },
  };
}
