// Run with: node test-users.js
// Accounts and logins (users.js), in a throwaway database.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openUsers } from './users.js';
import { check, done } from './test-helpers.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'riichi-users-'));
const users = openUsers(path.join(dir, 'users.db'));

// Usernames: 1 to 20 letters and digits.
for (const bad of ['', 'two words', 'neal!', 'né', 'a'.repeat(21), null, 42]) {
  check(`username ${JSON.stringify(bad)} refused`, users.signup(bad, 'pw').error === 'badUsername');
}
check('empty password refused', users.signup('Neal', '').error === 'emptyPassword');
check('missing password refused', users.signup('Neal', undefined).error === 'emptyPassword');

// Signing up logs in.
const neal = users.signup('Neal', 'hunter2');
check('signup works', neal.user?.username === 'Neal' && typeof neal.token === 'string');
check('signup token logs in', users.user(neal.token)?.id === neal.user.id);
check('20 characters is fine', !users.signup('a'.repeat(20), 'x').error);
check('a one-character password is fine', !users.signup('b', ' ').error);

// Usernames are unique ignoring case.
check('same username taken', users.signup('Neal', 'other').error === 'usernameTaken');
check('other case taken', users.signup('nEAL', 'other').error === 'usernameTaken');

// Logging in: any case of the username, the exact password; shown as signed up.
const again = users.login('neal', 'hunter2');
check('login works, any case', again.user?.id === neal.user.id && again.user.username === 'Neal');
check('new token per login', again.token !== neal.token && users.user(again.token)?.id === neal.user.id);
check('wrong password refused', users.login('Neal', 'hunter3').error === 'badLogin');
check('unknown user refused', users.login('nobody', 'hunter2').error === 'badLogin');
check('bad input refused', users.login(null, {}).error === 'badLogin');
check('passwords stored hashed', !JSON.stringify(users.db.prepare('SELECT * FROM users').all()).includes('hunter2'));

// Sessions.
check('unknown token', users.user('nope') === null && users.user(null) === null);
users.logout(neal.token);
check('logout ends that login', users.user(neal.token) === null);
check('other logins stay', users.user(again.token)?.id === neal.user.id);
users.db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(Date.now() - 1, again.token);
check('expired login refused', users.user(again.token) === null);

// Kept across restarts.
const kept = users.login('Neal', 'hunter2').token;
users.close();
const reopened = openUsers(path.join(dir, 'users.db'));
check('login survives a restart', reopened.user(kept)?.username === 'Neal');
reopened.close();
fs.rmSync(dir, { recursive: true, force: true });

done();
