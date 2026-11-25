'use strict';
/**
 * Espace admin — route /api/admin (page : /admin).
 * Identifiants dans les variables d'environnement (jamais dans le code) :
 *   ADMIN_EMAIL, ADMIN_PASSWORD_HASH (format scrypt$sel$hash, voir account.hashPassword).
 *
 *  POST { action:'login', email, password }  -> { token }  (session admin de 30 jours)
 *  GET  ?view=overview | players | export      (en-tête X-Admin-Token)
 *  POST { action:'resetPassword', uid }        -> { password } mot de passe provisoire à transmettre au joueur
 */
const crypto = require('crypto');
const Countries = require('../public/js/core/countries.js');
const { GameError } = require('../public/js/core/rooms-core.js');
const { getStore } = require('./db');
const { send, query, readBody, clientIp, wrap } = require('./http');
const Account = require('./account');

const { K, KINDS, sha, today } = Account;
const ADMIN_TTL = 30 * 24 * 3600;
const fail = (msg, status) => Object.assign(new GameError(msg), status ? { status } : {});
const adminKey = (token) => `onefoo:admin:${sha(token)}`;

const configured = () => !!(process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD_HASH);

async function login(st, body, ip) {
  if (!configured()) throw fail('Espace admin non configuré sur ce serveur.');
  const failKey = `onefoo:adminfail:${sha(ip).slice(0, 16)}`;
  if (Number((await st.redis('GET', failKey)) || 0) >= 5) throw fail('Trop d’essais. Réessayez dans 15 minutes.', 429);
  const okEmail = String(body.email || '').trim().toLowerCase() === String(process.env.ADMIN_EMAIL).trim().toLowerCase();
  const okPw = Account.checkPassword(body.password, process.env.ADMIN_PASSWORD_HASH);
  if (!okEmail || !okPw) {
    await st.pipeline([['INCRBY', failKey, 1], ['EXPIRE', failKey, 900]]);
    throw fail('Identifiants incorrects.', 401);
  }
  const token = crypto.randomBytes(24).toString('hex');
  await st.redis('SET', adminKey(token), '1', 'EX', ADMIN_TTL);
  return { ok: true, token };
}

async function requireAdmin(st, req) {
  const token = String(req.headers['x-admin-token'] || '');
  if (!/^[a-f0-9]{48}$/.test(token) || !(await st.redis('GET', adminKey(token)))) throw fail('Session admin expirée : reconnectez-vous.', 401);
}

/** Tous les comptes (du plus récent au plus ancien). */
async function allUsers(st) {
  const ids = (await st.redis('ZREVRANGE', K.users, 0, -1)) || [];
  const users = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const raws = await st.redis('MGET', ...chunk.map((id) => K.user(id)));
    raws.forEach((r) => r && users.push(Account.ensureStats(JSON.parse(r))));
  }
  return users;
}

async function overview(st) {
  const users = await allUsers(st);
  const now = Date.now();
  const countKeys = ['all', 'anonymous', ...KINDS].map((k) => K.count('games:' + k));
  const counts = await st.redis('MGET', ...countKeys);
  const games = Object.fromEntries(['all', 'anonymous', ...KINDS].map((k, i) => [k, Number(counts[i] || 0)]));
  const days = [];
  for (let i = 13; i >= 0; i--) days.push(today(now - i * 86400000));
  const dayVals = await st.redis('MGET', ...days.flatMap((d) => ['games', 'signups', 'active'].map((n) => K.day(d, n))));
  const daily = days.map((d, i) => ({ day: d, games: Number(dayVals[i * 3] || 0), signups: Number(dayVals[i * 3 + 1] || 0), active: Number(dayVals[i * 3 + 2] || 0) }));
  const countries = {};
  const sex = { M: 0, F: 0 };
  const perGame = Object.fromEntries(KINDS.map((k) => [k, { players: 0, games: 0, points: 0 }]));
  let active7 = 0;
  for (const u of users) {
    countries[u.country] = (countries[u.country] || 0) + 1;
    if (sex[u.sex] !== undefined) sex[u.sex]++;
    if (now - (u.lastSeen || 0) < 7 * 86400000) active7++;
    for (const k of KINDS) {
      const s = u.stats[k];
      if (s.games) perGame[k].players++;
      perGame[k].games += s.games;
      perGame[k].points += s.points;
    }
  }
  const byCountry = Object.entries(countries)
    .map(([code, n]) => ({ code, name: (Countries.BY_CODE[code] || {}).name || code, flag: Countries.flag(code), players: n }))
    .sort((a, b) => b.players - a.players);
  const top = [...users]
    .sort((a, b) => (b.points || 0) - (a.points || 0))
    .slice(0, 10)
    .map((u) => ({ name: u.name, avatar: u.avatar, country: u.country, flag: Countries.flag(u.country), points: u.points || 0, games: u.games || 0 }));
  const topByGame = Object.fromEntries(
    KINDS.map((k) => [
      k,
      [...users]
        .filter((u) => u.stats[k].games)
        .sort((a, b) => b.stats[k].points - a.stats[k].points)
        .slice(0, 5)
        .map((u) => ({ name: u.name, flag: Countries.flag(u.country), points: u.stats[k].points, wins: u.stats[k].wins, level: u.stats[k].level })),
    ])
  );
  return { ok: true, totals: { players: users.length, active7, games }, perGame, byCountry, sex, daily, top, topByGame };
}

function playerRow(u) {
  return {
    id: u.id,
    name: u.name,
    avatar: u.avatar,
    phone: u.phone,
    country: u.country,
    countryName: (Countries.BY_CODE[u.country] || {}).name || u.country,
    flag: Countries.flag(u.country),
    sex: u.sex,
    createdAt: u.createdAt,
    lastSeen: u.lastSeen,
    points: u.points || 0,
    games: u.games || 0,
    stats: Object.fromEntries(KINDS.map((k) => [k, { games: u.stats[k].games, wins: u.stats[k].wins, points: u.stats[k].points, level: u.stats[k].level }])),
  };
}

function toCsv(rows) {
  const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const head = ['pseudo', 'telephone', 'pays', 'sexe', 'inscription', 'derniere_visite', 'points', 'parties', ...KINDS.flatMap((k) => [`${k}_parties`, `${k}_victoires`, `${k}_points`, `${k}_niveau`])];
  const lines = rows.map((r) =>
    [r.name, r.phone, r.countryName, r.sex === 'F' ? 'Femme' : 'Homme', new Date(r.createdAt).toISOString(), new Date(r.lastSeen).toISOString(), r.points, r.games, ...KINDS.flatMap((k) => [r.stats[k].games, r.stats[k].wins, r.stats[k].points, r.stats[k].level])]
      .map(esc)
      .join(',')
  );
  return '﻿' + [head.join(','), ...lines].join('\n');
}

const handler = wrap(async (req, res) => {
  const st = getStore();
  if (!st) return send(res, 503, { ok: false, error: 'Base de données non connectée.' });
  if (req.method === 'POST') {
    const body = (await readBody(req)) || {};
    if (body.action === 'login') return send(res, 200, await login(st, body, clientIp(req)));
    await requireAdmin(st, req);
    if (body.action === 'resetPassword') {
      const u = await Account.loadUser(st, String(body.uid || ''));
      if (!u) throw fail('Joueur introuvable.');
      const temp = crypto.randomBytes(4).toString('hex'); // 8 caractères
      u.pw = Account.hashPassword(temp);
      await st.pipeline([['SET', K.user(u.id), JSON.stringify(u)], ['DEL', K.fail(u.phone)]]);
      return send(res, 200, { ok: true, password: temp });
    }
    if (body.action === 'logout') {
      await st.redis('DEL', adminKey(String(req.headers['x-admin-token'] || '')));
      return send(res, 200, { ok: true });
    }
    throw fail('Action inconnue.');
  }
  await requireAdmin(st, req);
  const q = query(req);
  if (q.view === 'overview') return send(res, 200, await overview(st));
  if (q.view === 'players' || q.view === 'export') {
    const rows = (await allUsers(st)).map(playerRow);
    if (q.view === 'export') {
      res.setHeader('Content-Disposition', `attachment; filename="onefoo-joueurs-${today()}.csv"`);
      return send(res, 200, toCsv(rows), 'text/csv; charset=utf-8');
    }
    return send(res, 200, { ok: true, players: rows });
  }
  throw fail('Vue inconnue.');
});

module.exports = handler;
