'use strict';
/**
 * Comptes joueurs (facultatifs), sessions longues, points et classements — route /api/account.
 *
 *  POST { action:'register', name, avatar, country, phone, sex, password, consent, levels } -> { token, user }
 *  POST { action:'login', country, phone, password }                                    -> { token, user }
 *  POST { action:'logout' } | { action:'profile', name, avatar }
 *  POST { action:'result', kind, gameId, outcome, opponents }  (partie contre le système, jouée dans le navigateur)
 *  GET  ?me=1                          -> { user }   (renouvelle la session)
 *  GET  ?lb=all|foo|morpion|…&country=SN -> classement
 *
 * Données (Redis) : onefoo:user:<id> (JSON), onefoo:phone:<+221…> -> id, onefoo:sess:<sha256(jeton)> -> id,
 * onefoo:users (ordre d'inscription), onefoo:lb:<jeu>[:<pays>] (points), compteurs onefoo:count:* et onefoo:day:*.
 * Les mots de passe sont hachés (scrypt) ; le numéro et le sexe ne sont jamais publiés dans les classements.
 */
const crypto = require('crypto');
const Countries = require('../public/js/core/countries.js');
const { GameError, sanitizeName, AVATARS } = require('../public/js/core/rooms-core.js');
const { getStore } = require('./db');
const { send, query, readBody, wrap } = require('./http');

const KINDS = ['foo', 'morpion', 'aligne4', 'awale', 'dames'];
const BOARDS = ['all', ...KINDS];
const SESSION_TTL = 400 * 24 * 3600; // ~13 mois, renouvelé à chaque visite : on ne se reconnecte pas
const DAY_TTL = 120 * 24 * 3600;
const K = {
  user: (uid) => `onefoo:user:${uid}`,
  phone: (p) => `onefoo:phone:${p}`,
  sess: (h) => `onefoo:sess:${h}`,
  users: 'onefoo:users',
  lb: (board, country) => `onefoo:lb:${board}${country ? ':' + country : ''}`,
  res: (who, gid) => `onefoo:res:${who}:${gid}`,
  rl: (who) => `onefoo:rl:${who}`,
  fail: (p) => `onefoo:loginfail:${p}`,
  count: (name) => `onefoo:count:${name}`,
  day: (d, name) => `onefoo:day:${d}:${name}`,
  seen: (d, uid) => `onefoo:seen:${d}:${uid}`,
};
const today = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const fail = (msg, status) => Object.assign(new GameError(msg), status ? { status } : {});

// ------------------------------------------------------------------ mots de passe (scrypt, sel aléatoire)
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function checkPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(String(pw || ''), Buffer.from(saltHex, 'hex'), 32, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === hash.length && crypto.timingSafeEqual(expected, hash);
}

// ------------------------------------------------------------------ joueurs
const emptyGameStats = () => ({ games: 0, wins: 0, losses: 0, draws: 0, level: 1, best: 1, points: 0 });
function ensureStats(u) {
  u.stats = u.stats || {};
  for (const k of KINDS) u.stats[k] = Object.assign(emptyGameStats(), u.stats[k] || {});
  return u;
}
function publicUser(u) {
  ensureStats(u);
  return {
    id: u.id,
    name: u.name,
    avatar: u.avatar,
    country: u.country,
    sex: u.sex,
    phone: u.phone,
    createdAt: u.createdAt,
    points: u.points || 0,
    games: u.games || 0,
    stats: u.stats,
  };
}
async function loadUser(st, uid) {
  const raw = uid && (await st.redis('GET', K.user(uid)));
  return raw ? ensureStats(JSON.parse(raw)) : null;
}
const saveCmd = (u) => ['SET', K.user(u.id), JSON.stringify(u)];

// ------------------------------------------------------------------ sessions
const TOKEN_RE = /^[a-f0-9]{48}$/;
async function newSession(st, uid) {
  const token = crypto.randomBytes(24).toString('hex');
  await st.redis('SET', K.sess(sha(token)), uid, 'EX', SESSION_TTL);
  return token;
}
const sessionToken = (req) => String(req.headers['x-onefoo-session'] || '');

/** Joueur connecté (ou null). `touch` renouvelle la session et compte la visite du jour. */
async function userFromToken(st, token, touch = false) {
  if (!TOKEN_RE.test(token || '')) return null;
  const key = K.sess(sha(token));
  const uid = await st.redis('GET', key);
  if (!uid) return null;
  const u = await loadUser(st, uid);
  if (!u) return null;
  if (touch) {
    const now = Date.now();
    const d = today(now);
    const [, firstToday] = await st.pipeline([['EXPIRE', key, SESSION_TTL], ['SET', K.seen(d, uid), '1', 'EX', 2 * 86400, 'NX']]);
    if (firstToday) {
      u.lastSeen = now;
      await st.pipeline([saveCmd(u), ['INCRBY', K.day(d, 'active'), 1], ['EXPIRE', K.day(d, 'active'), DAY_TTL]]);
    }
  }
  return u;
}
const userFromRequest = (st, req) => userFromToken(st, sessionToken(req));

// ------------------------------------------------------------------ points
/**
 * Contre le système : une victoire rapporte plus quand son niveau est élevé.
 * Entre amis : victoire 15 pts (+5 par adversaire supplémentaire), nul 5, participation 2.
 */
function pointsFor(mode, outcome, level, opponents) {
  if (mode === 'solo') return outcome === 'win' ? 10 + 2 * level : outcome === 'draw' ? 3 + Math.floor(level / 2) : 0;
  return outcome === 'win' ? 15 + 5 * Math.max(0, opponents - 1) : outcome === 'draw' ? 5 : 2;
}

async function applyResult(st, u, kind, { mode, outcome, level, opponents }) {
  ensureStats(u);
  const s = u.stats[kind];
  const pts = pointsFor(mode, outcome, level, opponents);
  s.games++;
  if (outcome === 'win') s.wins++;
  else if (outcome === 'draw') s.draws++;
  else s.losses++;
  s.points += pts;
  u.points = (u.points || 0) + pts;
  u.games = (u.games || 0) + 1;
  if (mode === 'solo' && outcome === 'win') {
    s.level = Math.min(99, s.level + 1);
    s.best = Math.max(s.best, s.level);
  }
  u.lastSeen = Date.now();
  const cmds = [saveCmd(u)];
  for (const board of [kind, 'all']) {
    cmds.push(['ZINCRBY', K.lb(board), pts, u.id], ['ZINCRBY', K.lb(board, u.country), pts, u.id]);
  }
  await st.pipeline(cmds);
  return pts;
}

async function countGame(st, kind, anonymous) {
  const d = today();
  const cmds = [
    ['INCRBY', K.count('games:' + kind), 1],
    ['INCRBY', K.count('games:all'), 1],
    ['INCRBY', K.day(d, 'games'), 1],
    ['EXPIRE', K.day(d, 'games'), DAY_TTL],
  ];
  if (anonymous) cmds.push(['INCRBY', K.count('games:anonymous'), 1]);
  await st.pipeline(cmds);
}

/** Fin d'une partie entre amis (le serveur est l'arbitre) : points pour chaque joueur connecté à un compte. */
async function recordRoomGame(st, room) {
  const g = room.game;
  if (!g) return;
  const kind = room.kind || 'foo';
  const withAccount = room.players.filter((p) => !p.isBot && p.uid && g.players.some((x) => x.id === p.id));
  await countGame(st, kind, !withAccount.length);
  for (const p of withAccount) {
    const outcome = g.isDraw ? 'draw' : g.winnerId === p.id ? 'win' : 'loss';
    const u = await loadUser(st, p.uid);
    if (u) await applyResult(st, u, kind, { mode: 'friends', outcome, level: 0, opponents: g.players.length - 1 });
  }
}

/** Partie contre le système (jouée dans le navigateur) : le niveau retenu est celui connu du serveur. */
async function reportSolo(st, u, deviceKey, body) {
  const kind = KINDS.includes(body.kind) ? body.kind : null;
  const outcome = ['win', 'loss', 'draw'].includes(body.outcome) ? body.outcome : null;
  const gid = String(body.gameId || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40);
  if (!kind || !outcome || !gid) throw fail('Résultat invalide.');
  const who = u ? u.id : 'd' + sha(deviceKey || 'anonyme').slice(0, 16);
  const [fresh, notTooFast] = await st.pipeline([
    ['SET', K.res(who, gid), '1', 'EX', 7 * 86400, 'NX'],
    ['SET', K.rl(who), '1', 'EX', 5, 'NX'],
  ]);
  if (!fresh) return { ok: true, duplicate: true, user: u ? publicUser(u) : null };
  if (!notTooFast) throw fail('Résultats trop rapprochés.');
  await countGame(st, kind, !u);
  if (!u) return { ok: true };
  const level = u.stats[kind].level || 1;
  const opponents = Math.max(1, Math.min(5, Number(body.opponents) || 1));
  const points = await applyResult(st, u, kind, { mode: 'solo', outcome, level, opponents });
  return { ok: true, points, user: publicUser(u) };
}

// ------------------------------------------------------------------ inscription / connexion
function readPhone(body) {
  if (!Countries.BY_CODE[body.country]) throw fail('Choisissez votre pays.');
  const ph = Countries.normalizePhone(body.country, body.phone);
  if (!ph.ok) throw fail(ph.error);
  return ph.e164;
}

async function register(st, body, now) {
  const name = sanitizeName(body.name);
  const country = body.country;
  const phone = readPhone(body);
  if (!['M', 'F'].includes(body.sex)) throw fail('Indiquez votre sexe.');
  const pw = String(body.password || '');
  if (pw.length < 6) throw fail('Mot de passe : 6 caractères minimum.');
  if (pw.length > 100) throw fail('Mot de passe trop long.');
  if (!body.consent) throw fail('Merci d’accepter l’utilisation de vos informations pour les classements.');
  const uid = 'u' + crypto.randomBytes(8).toString('hex');
  const claimed = await st.redis('SET', K.phone(phone), uid, 'NX');
  if (!claimed) throw fail('Ce numéro a déjà un compte : connectez-vous avec votre mot de passe.');
  const u = ensureStats({
    id: uid,
    name,
    avatar: AVATARS.includes(body.avatar) ? body.avatar : '😎',
    country,
    phone,
    sex: body.sex,
    pw: hashPassword(pw),
    createdAt: now,
    lastSeen: now,
    points: 0,
    games: 0,
    stats: {},
  });
  // On reprend la progression déjà faite sur cet appareil (niveaux du système)
  const levels = body.levels && typeof body.levels === 'object' ? body.levels : {};
  for (const k of KINDS) {
    const lv = Number(levels[k]);
    if (Number.isInteger(lv) && lv >= 1 && lv <= 30) u.stats[k].level = u.stats[k].best = lv;
  }
  const d = today(now);
  await st.pipeline([
    saveCmd(u),
    ['ZADD', K.users, now, uid],
    ['ZINCRBY', K.lb('all'), 0, uid],
    ['ZINCRBY', K.lb('all', country), 0, uid],
    ['INCRBY', K.day(d, 'signups'), 1],
    ['EXPIRE', K.day(d, 'signups'), DAY_TTL],
    ['SET', K.seen(d, uid), '1', 'EX', 2 * 86400],
    ['INCRBY', K.day(d, 'active'), 1],
    ['EXPIRE', K.day(d, 'active'), DAY_TTL],
  ]);
  return { ok: true, token: await newSession(st, uid), user: publicUser(u) };
}

async function login(st, body) {
  const phone = readPhone(body);
  const fails = Number((await st.redis('GET', K.fail(phone))) || 0);
  if (fails >= 8) throw fail('Trop d’essais. Réessayez dans 15 minutes.');
  const uid = await st.redis('GET', K.phone(phone));
  const u = await loadUser(st, uid);
  if (!u || !checkPassword(body.password, u.pw)) {
    await st.pipeline([['INCRBY', K.fail(phone), 1], ['EXPIRE', K.fail(phone), 900]]);
    throw fail('Numéro ou mot de passe incorrect.');
  }
  await st.redis('DEL', K.fail(phone));
  return { ok: true, token: await newSession(st, u.id), user: publicUser(u) };
}

// ------------------------------------------------------------------ classements
async function leaderboard(st, board, country, limit, me) {
  const key = K.lb(board, country || null);
  const flat = (await st.redis('ZREVRANGE', key, 0, limit - 1, 'WITHSCORES')) || [];
  const pairs = [];
  for (let i = 0; i < flat.length; i += 2) pairs.push([flat[i], Number(flat[i + 1])]);
  const raws = pairs.length ? await st.redis('MGET', ...pairs.map(([id]) => K.user(id))) : [];
  const entries = [];
  pairs.forEach(([id, points], i) => {
    if (!raws[i]) return;
    const u = ensureStats(JSON.parse(raws[i]));
    const s = board === 'all' ? { wins: KINDS.reduce((n, k) => n + u.stats[k].wins, 0), games: u.games || 0, best: null } : u.stats[board];
    entries.push({ rank: entries.length + 1, name: u.name, avatar: u.avatar, country: u.country, points, wins: s.wins, games: s.games, best: s.best, isMe: !!me && me.id === id });
  });
  let mine = null;
  if (me) {
    const [rank, score] = await st.pipeline([['ZREVRANK', key, me.id], ['ZSCORE', key, me.id]]);
    if (rank !== null && rank !== undefined) mine = { rank: Number(rank) + 1, points: Number(score || 0) };
  }
  const total = Number(await st.redis('ZCARD', key)) || 0;
  return { ok: true, board, country: country || null, total, entries, me: mine };
}

// ------------------------------------------------------------------ route /api/account
const handler = wrap(async (req, res) => {
  const st = getStore();
  if (!st) return send(res, 503, { ok: false, error: 'Les comptes ne sont pas encore activés (base de données manquante).' });
  const now = Date.now();
  if (req.method === 'GET') {
    const q = query(req);
    if (q.me) {
      const u = await userFromToken(st, sessionToken(req), true);
      return send(res, 200, { ok: true, user: u ? publicUser(u) : null });
    }
    if (q.lb) {
      const board = BOARDS.includes(q.lb) ? q.lb : 'all';
      const country = Countries.BY_CODE[q.country] ? q.country : null;
      const limit = Math.max(5, Math.min(100, Number(q.limit) || 50));
      const me = await userFromRequest(st, req);
      return send(res, 200, await leaderboard(st, board, country, limit, me));
    }
    return send(res, 400, { ok: false, error: 'Requête inconnue.' });
  }
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Méthode non autorisée.' });
  const body = (await readBody(req)) || {};
  switch (body.action) {
    case 'register':
      return send(res, 200, await register(st, body, now));
    case 'login':
      return send(res, 200, await login(st, body));
    case 'logout': {
      const token = sessionToken(req);
      if (TOKEN_RE.test(token)) await st.redis('DEL', K.sess(sha(token)));
      return send(res, 200, { ok: true });
    }
    case 'profile': {
      const u = await userFromRequest(st, req);
      if (!u) throw fail('Connectez-vous d’abord.', 401);
      u.name = sanitizeName(body.name);
      if (AVATARS.includes(body.avatar)) u.avatar = body.avatar;
      await st.pipeline([saveCmd(u)]);
      return send(res, 200, { ok: true, user: publicUser(u) });
    }
    case 'result': {
      const u = await userFromRequest(st, req);
      return send(res, 200, await reportSolo(st, u, String(req.headers['x-onefoo-key'] || ''), body));
    }
    default:
      throw fail('Action inconnue.');
  }
});

module.exports = handler;
Object.assign(module.exports, {
  KINDS,
  K,
  hashPassword,
  checkPassword,
  loadUser,
  publicUser,
  ensureStats,
  userFromRequest,
  recordRoomGame,
  pointsFor,
  today,
  sha,
});
