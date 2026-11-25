'use strict';
/**
 * API du mode "entre amis" : une seule route /api/room.
 *  - GET  /api/room?code=ABCDE&v=12  -> état du salon (ou { same: true } si rien n'a changé depuis la version v)
 *  - POST /api/room { action, code?, ... } -> create | join | leave | start | addBot | removeBot | lobby
 *                                             | profile | emote | play | draw | pass | foo | catch (FOO!)
 *                                             | options | move (Morpion) ; create { game: 'foo' | 'morpion' }
 *                                             | voice (micro on/off) | signal (mise en relation audio)
 *  - GET  /api/room?ice=1                    -> serveurs STUN/TURN pour l'audio entre téléphones
 *  - GET  /api/room?...&sig=1                -> en plus, les messages audio en attente pour ce joueur
 * Le client s'identifie avec une clé secrète (en-tête X-OneFOO-Key) ; l'identifiant public visible
 * des autres joueurs en est dérivé (hachage). Un joueur ne peut donc pas agir à la place d'un autre.
 */
const crypto = require('crypto');
const { GameError } = require('../public/js/core/rooms-core.js');
const { GAMES, roomsFor } = require('./games');
const { createStore } = require('./store');

const SECRET_RE = /^[a-f0-9]{24,64}$/i;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PRESENCE_MS = 15000; // on note la présence d'un joueur au plus toutes les 15 s

let store; // créé à la première requête (réutilisé tant que l'instance vit)
const getStore = () => (store === undefined ? (store = createStore()) : store);
const setStore = (s) => (store = s); // tests

const publicId = (secret) => 'p' + crypto.createHash('sha256').update('onefoo:' + secret.toLowerCase()).digest('hex').slice(0, 16);
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Serveurs pour établir l'audio entre téléphones. STUN suffit le plus souvent ; un serveur TURN
 * (variables TURN_URLS, TURN_USERNAME, TURN_CREDENTIAL) aide quand un réseau mobile bloque la connexion directe.
 */
function iceServers(env = process.env) {
  const list = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (env.TURN_URLS && env.TURN_USERNAME && env.TURN_CREDENTIAL) {
    list.push({
      urls: env.TURN_URLS.split(',').map((s) => s.trim()).filter(Boolean),
      username: env.TURN_USERNAME,
      credential: env.TURN_CREDENTIAL,
    });
  }
  return list;
}

async function signal(st, code, pid, body) {
  const room = await st.load(code);
  if (!room) throw new GameError('Aucune partie avec ce code.');
  const me = room.players.find((p) => p.id === pid && !p.isBot);
  const to = room.players.find((p) => p.id === body.to && !p.isBot);
  if (!me || !to || to.id === pid) throw new GameError('Destinataire invalide.');
  const d = body.data || {};
  const okType = ['offer', 'answer', 'bye'].includes(d.type);
  const okSdp = d.sdp == null || (typeof d.sdp === 'string' && d.sdp.length <= 20000);
  if (!okType || !okSdp || String(d.session || '').length > 40) throw new GameError('Signal invalide.');
  await st.pushSignal(code, to.id, { from: pid, type: d.type, sdp: d.sdp || null, session: String(d.session || '') });
  return { ok: true };
}

function newCode() {
  const bytes = crypto.randomBytes(5);
  let code = '';
  for (let i = 0; i < 5; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code;
}

/**
 * Lit le salon, applique `fn`, puis écrit avec compare-and-set (recommence en cas de conflit).
 * `fn` peut renvoyer { noWrite: true } pour ne rien écrire.
 */
async function mutate(st, code, fn, preloaded = null) {
  let room = preloaded;
  for (let attempt = 0; attempt < 6; attempt++) {
    if (!room) room = await st.load(code);
    if (!room) throw new GameError('Aucune partie avec ce code.');
    const prev = room.version;
    const out = fn(room) || {};
    if (out.noWrite) return { room, out };
    room.version = prev + 1;
    if (await st.save(room, prev)) return { room, out };
    room = null;
    await sleep(15 + Math.random() * 60);
  }
  throw new GameError('Le serveur est très sollicité, réessayez.');
}

async function poll(st, code, pid, v, now) {
  const loaded = await st.load(code);
  const me = loaded && loaded.players.find((p) => p.id === pid);
  if (!loaded || !me || me.isBot) return { ok: true, gone: true };
  const { room } = await mutate(
    st,
    code,
    (r) => {
      let changed = false;
      const p = r.players.find((x) => x.id === pid);
      if (p && now - (p.lastSeen || 0) > PRESENCE_MS) {
        roomsFor(r).touch(r, pid, now);
        changed = true;
      }
      if (roomsFor(r).advance(r, now)) changed = true;
      return changed ? null : { noWrite: true };
    },
    loaded
  );
  if (room.version === v) return { ok: true, same: true, serverNow: now };
  return { ok: true, state: roomsFor(room).view(room, pid, now) };
}

async function action(st, pid, body, now) {
  const a = String(body.action || '');
  const who = { id: pid, name: body.name, avatar: body.avatar };

  if (a === 'create') {
    for (let i = 0; i < 8; i++) {
      const kind = GAMES[body.game] ? body.game : 'foo';
      const room = roomsFor(kind).newRoom(newCode(), 'friends', who, now, { size: body.size });
      room.version = 1;
      if (await st.save(room, 0)) return { ok: true, state: roomsFor(room).view(room, pid, now) };
    }
    throw new GameError('Impossible de créer le salon, réessayez.');
  }

  const code = normCode(body.code);
  if (!code) throw new GameError('Code de partie manquant.');

  if (a === 'signal') return signal(st, code, pid, body);

  if (a === 'join') {
    const { room } = await mutate(st, code, (r) => {
      roomsFor(r).join(r, who, now);
      roomsFor(r).advance(r, now);
    });
    return { ok: true, state: roomsFor(room).view(room, pid, now) };
  }

  if (a === 'leave') {
    try {
      const { out } = await mutate(st, code, (r) => {
        const empty = roomsFor(r).leave(r, pid);
        if (!empty) roomsFor(r).advance(r, now);
        return { empty };
      });
      if (out.empty) await st.remove(code);
    } catch (err) {
      if (!(err instanceof GameError)) throw err; // salon déjà disparu : rien à faire
    }
    return { ok: true };
  }

  const { room, out } = await mutate(st, code, (r) => {
    const res = roomsFor(r).act(r, pid, a, body, now);
    roomsFor(r).advance(r, now);
    return { res };
  });
  return { ok: true, ...(out.res || {}), state: roomsFor(room).view(room, pid, now) };
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 32768) throw new GameError('Requête trop volumineuse.');
  }
  return raw ? JSON.parse(raw) : {};
}

async function handler(req, res) {
  const send = (statusCode, obj) => {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(obj));
  };
  try {
    const st = getStore();
    if (!st) {
      return send(503, {
        ok: false,
        error: "Le mode entre amis n'est pas encore activé : la base de données (Upstash Redis) n'est pas connectée au projet Vercel.",
      });
    }
    const secret = String(req.headers['x-onefoo-key'] || '');
    if (!SECRET_RE.test(secret)) throw new GameError('Identifiant invalide, rechargez la page.');
    const pid = publicId(secret);
    const now = Date.now();

    if (req.method === 'GET') {
      const q = req.query || Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
      if (q.ice) return send(200, { ok: true, iceServers: iceServers() });
      const code = normCode(q.code);
      const out = await poll(st, code, pid, Number(q.v) || 0, now);
      if (q.sig === '1' && out.ok && !out.gone) {
        const signals = await st.takeSignals(code, pid);
        if (signals.length) out.signals = signals;
      }
      return send(200, out);
    }
    if (req.method === 'POST') {
      let body;
      try {
        body = await readBody(req);
      } catch (err) {
        if (err instanceof GameError) throw err;
        throw new GameError('Requête invalide.');
      }
      return send(200, await action(st, pid, body || {}, now));
    }
    send(405, { ok: false, error: 'Méthode non autorisée.' });
  } catch (err) {
    if (err instanceof GameError) return send(200, { ok: false, error: err.message });
    console.error('[api]', err);
    send(500, { ok: false, error: 'Erreur serveur, réessayez.' });
  }
}

module.exports = handler;
module.exports.publicId = publicId;
module.exports.setStore = setStore;
module.exports.iceServers = iceServers;
