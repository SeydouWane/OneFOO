'use strict';
/* Comptes, sessions, points, classements et espace admin (serveur local, stockage mémoire). */
process.env.PORT = process.env.PORT || '3918';
delete process.env.VERCEL;
delete process.env.KV_REST_API_URL;
delete process.env.UPSTASH_REDIS_REST_URL;
const assert = require('assert');
const crypto = require('crypto');
const Account = require('../src/account');
// identifiants admin DE TEST (les vrais sont dans les variables d'environnement Vercel)
process.env.ADMIN_EMAIL = 'admin@test.sn';
process.env.ADMIN_PASSWORD_HASH = Account.hashPassword('motdepasse-test');
const { server } = require('../local-server');
const { UpstashStore } = require('../src/store');

const BASE = `http://localhost:${process.env.PORT}`;
const device = () => crypto.randomBytes(16).toString('hex');

async function call(path, { method = 'GET', body, session, key, admin } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-OneFOO-Key': key || device() };
  if (session) headers['X-OneFOO-Session'] = session;
  if (admin) headers['X-Admin-Token'] = admin;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const type = r.headers.get('content-type') || '';
  return type.includes('json') ? r.json() : r.text();
}
const post = (path, body, opts = {}) => call(path, { ...opts, method: 'POST', body });

(async () => {
  // ---------- inscription : vérifications
  const base = { action: 'register', name: 'Ibou', avatar: '🦁', country: 'SN', phone: '77 123 45 67', sex: 'M', password: 'secret12', consent: true };
  assert.match((await post('/api/account', { ...base, phone: '12345' })).error, /sénégalais invalide/);
  assert.match((await post('/api/account', { ...base, sex: '' })).error, /sexe/);
  assert.match((await post('/api/account', { ...base, password: '123' })).error, /6 caractères/);
  assert.match((await post('/api/account', { ...base, consent: false })).error, /accepter/);
  const reg = await post('/api/account', { ...base, levels: { morpion: 3 } });
  assert.ok(reg.ok && /^[a-f0-9]{48}$/.test(reg.token), 'inscription');
  assert.strictEqual(reg.user.phone, '+221771234567', 'numéro au format international');
  assert.strictEqual(reg.user.stats.morpion.level, 3, 'progression reprise de l’appareil');
  assert.match((await post('/api/account', { ...base, phone: '+221 77 123 45 67' })).error, /déjà un compte/, 'un numéro = un compte');

  // ---------- connexion
  assert.match((await post('/api/account', { action: 'login', country: 'SN', phone: '771234567', password: 'faux' })).error, /incorrect/);
  const log = await post('/api/account', { action: 'login', country: 'SN', phone: '771234567', password: 'secret12' });
  assert.ok(log.ok && log.token && log.token !== reg.token, 'connexion sur un autre appareil');
  const me = await call('/api/account?me=1', { session: log.token });
  assert.strictEqual(me.user.name, 'Ibou', 'session reconnue');
  assert.strictEqual((await call('/api/account?me=1', { session: 'f'.repeat(48) })).user, null);

  // ---------- résultat contre le système (niveau retenu = celui du serveur)
  const dev = device();
  const r1 = await post('/api/account', { action: 'result', kind: 'morpion', gameId: 'g1', outcome: 'win' }, { session: reg.token, key: dev });
  assert.strictEqual(r1.points, 16, 'victoire au niveau 3 : 10 + 2×3');
  assert.strictEqual(r1.user.stats.morpion.level, 4, 'le système monte de niveau');
  const dup = await post('/api/account', { action: 'result', kind: 'morpion', gameId: 'g1', outcome: 'win' }, { session: reg.token, key: dev });
  assert.ok(dup.duplicate, 'une partie ne compte qu’une fois');
  assert.match((await post('/api/account', { action: 'result', kind: 'morpion', gameId: 'g2', outcome: 'win' }, { session: reg.token, key: dev })).error, /rapprochés/);
  const anon = await post('/api/account', { action: 'result', kind: 'foo', gameId: 'a1', outcome: 'loss' });
  assert.ok(anon.ok && !anon.user, 'joueur anonyme : compté dans les statistiques seulement');

  // ---------- 2e joueur (Côte d'Ivoire) + partie de morpion entre amis via /api/room
  const reg2 = await post('/api/account', { ...base, name: 'Awa', country: 'CI', phone: '07 08 09 10 11', sex: 'F' });
  assert.ok(reg2.ok, 'inscription Côte d’Ivoire');
  assert.strictEqual(reg2.user.phone, '+2250708091011', 'Côte d’Ivoire : le 0 fait partie du numéro');
  const fr = require('../public/js/core/countries.js').normalizePhone('FR', '06 12 34 56 78');
  assert.strictEqual(fr.e164, '+33612345678', 'France : le 0 initial est retiré');
  const kA = device();
  const kB = device();
  const created = await post('/api/room', { action: 'create', game: 'morpion', name: 'x' }, { session: reg.token, key: kA });
  assert.strictEqual(created.state.players[0].name, 'Ibou', 'pseudo du compte utilisé dans le salon');
  const code = created.state.code;
  await post('/api/room', { action: 'join', code }, { session: reg2.token, key: kB });
  await post('/api/room', { action: 'start', code }, { session: reg.token, key: kA });
  // Ibou (✕) aligne en haut : 0, 1, 2 ; Awa joue 3, 4
  for (const [k, cell] of [[kA, 0], [kB, 3], [kA, 1], [kB, 4], [kA, 2]]) {
    const r = await post('/api/room', { action: 'move', code, move: cell }, { key: k, session: k === kA ? reg.token : reg2.token });
    assert.ok(r.ok, 'coup : ' + r.error);
  }
  const lbM = await call('/api/account?lb=morpion', { session: reg.token });
  assert.strictEqual(lbM.entries[0].name, 'Ibou');
  assert.strictEqual(lbM.entries[0].points, 16 + 15, 'victoire entre amis : +15');
  assert.strictEqual(lbM.entries[1].name, 'Awa');
  assert.strictEqual(lbM.entries[1].points, 2, 'participation : +2');
  assert.ok(lbM.entries[0].isMe && lbM.me.rank === 1, 'mon rang');
  assert.ok(!('phone' in lbM.entries[0]), 'le numéro n’apparaît jamais dans les classements');
  const lbCI = await call('/api/account?lb=all&country=CI');
  assert.deepStrictEqual(lbCI.entries.map((e) => e.name), ['Awa'], 'classement par pays');

  // ---------- profil
  const prof = await post('/api/account', { action: 'profile', name: 'Ibou10', avatar: '🐯' }, { session: reg.token });
  assert.strictEqual(prof.user.name, 'Ibou10');

  // ---------- admin
  assert.strictEqual((await post('/api/admin', { action: 'login', email: 'admin@test.sn', password: 'non' })).ok, false);
  const adm = await post('/api/admin', { action: 'login', email: ' ADMIN@test.sn ', password: 'motdepasse-test' });
  assert.ok(adm.ok && adm.token, 'connexion admin');
  assert.strictEqual((await call('/api/admin?view=overview')).ok, false, 'admin protégé');
  const ov = await call('/api/admin?view=overview', { admin: adm.token });
  assert.strictEqual(ov.totals.players, 2);
  assert.ok(ov.totals.games.all >= 3 && ov.totals.games.morpion >= 2 && ov.totals.games.anonymous >= 1, 'compteurs de parties');
  assert.deepStrictEqual(ov.sex, { M: 1, F: 1 });
  assert.deepStrictEqual(ov.byCountry.map((c) => c.code).sort(), ['CI', 'SN']);
  const pl = await call('/api/admin?view=players', { admin: adm.token });
  assert.ok(pl.players.some((p) => p.phone === '+221771234567' && p.name === 'Ibou10'), 'l’admin voit les numéros');
  const csv = await call('/api/admin?view=export', { admin: adm.token });
  assert.ok(csv.includes('+221771234567') && csv.split('\n').length === 3, 'export CSV');
  const reset = await post('/api/admin', { action: 'resetPassword', uid: reg.user.id }, { admin: adm.token });
  const relog = await post('/api/account', { action: 'login', country: 'SN', phone: '771234567', password: reset.password });
  assert.ok(relog.ok, 'mot de passe provisoire donné par l’admin');
  for (let i = 0; i < 5; i++) await post('/api/admin', { action: 'login', email: 'x', password: 'y' });
  assert.match((await post('/api/admin', { action: 'login', email: 'admin@test.sn', password: 'motdepasse-test' })).error, /Trop d’essais/, 'anti force brute');
  console.log('✔ comptes, sessions, points, classements, admin');

  // ---------- adaptateur Upstash : pipeline
  const calls = [];
  const fake = async (url, opts) => {
    calls.push(url);
    const cmds = JSON.parse(opts.body);
    return { ok: true, json: async () => cmds.map((c) => ({ result: c[0] === 'GET' ? 'v' : 'OK' })) };
  };
  const up = new UpstashStore('https://fake.upstash.io', 'tok', fake);
  assert.deepStrictEqual(await up.pipeline([['SET', 'a', 1], ['GET', 'a']]), ['OK', 'v']);
  assert.strictEqual(calls[0], 'https://fake.upstash.io/pipeline');
  console.log('✔ account tests OK');
  server.close();
  process.exit(0);
})().catch((e) => {
  console.error('✘', e);
  process.exit(1);
});
