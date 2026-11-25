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
const { getStore, setStore } = require('./db');
const Account = require('./account');

const SECRET_RE = /^[a-f0-9]{24,64}$/i;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PRESENCE_MS = 15000; // on note la présence d'un joueur au plus toutes les 15 s

/** Une manche vient de se terminer : à enregistrer une seule fois (points des joueurs connectés, statistiques). */
function markRecord(r) {
  const g = r.game;
  if (!g || g.status === 'playing' || r.recordedGameId === g.id) return false;
  r.recordedGameId = g.id;
  return true;
}
async function recordIfNeeded(st, room, out) {
  if (!out || !out.record) return;
  try {
    await Account.recordRoomGame(st, room);
  } catch (err) {
    console.error('[classement]', err); // ne jamais bloquer la partie pour une statistique
  }
}

const publicId = (secret) => 'p' + crypto.createHash('sha256').update('onefoo:' + secret.toLowerCase()).digest('hex').slice(0, 16);
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Serveurs pour établir l'audio entre téléphones. STUN suffit quand un des deux téléphones est sur un Wi-Fi
 * « ouvert » ; entre deux téléphones en données mobiles (NAT des opérateurs), il faut un relais TURN.
 * Relais possibles (variables d'environnement, le premier configuré est utilisé) :
 *  - Cloudflare Realtime TURN : CF_TURN_KEY_ID + CF_TURN_API_TOKEN (identifiants temporaires générés ici)
 *  - Metered / Open Relay     : METERED_TURN_URL (adresse « …/api/v1/turn/credentials?apiKey=… »)
 *  - serveur fixe             : TURN_URLS + TURN_USERNAME + TURN_CREDENTIAL
 */
const STUN = { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] };
const iceCache = { list: null, until: 0, pending: null };

/** Retire les adresses inutilisables par un navigateur (port 53 : bloqué, fait attendre pour rien). */
function cleanIce(servers) {
  return (Array.isArray(servers) ? servers : [servers])
    .filter((s) => s && s.urls)
    .map((s) => ({ ...s, urls: [].concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)) }))
    .filter((s) => s.urls.length);
}

async function fetchTurn(env, fetchImpl) {
  if (env.CF_TURN_KEY_ID && env.CF_TURN_API_TOKEN) {
    const r = await fetchImpl(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.CF_TURN_KEY_ID)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CF_TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 86400 }),
    });
    if (!r.ok) throw new Error('Cloudflare TURN ' + r.status);
    return cleanIce((await r.json()).iceServers);
  }
  if (env.METERED_TURN_URL) {
    const r = await fetchImpl(env.METERED_TURN_URL);
    if (!r.ok) throw new Error('Metered TURN ' + r.status);
    return cleanIce(await r.json());
  }
  if (env.TURN_URLS && env.TURN_USERNAME && env.TURN_CREDENTIAL) {
    return [{ urls: env.TURN_URLS.split(',').map((s) => s.trim()).filter(Boolean), username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL }];
  }
  return [];
}

/** Liste STUN + relais, gardée 12 h en mémoire (les identifiants Cloudflare valent 24 h). */
async function iceServers(env = process.env, fetchImpl = globalThis.fetch, now = Date.now()) {
  if (iceCache.list && now < iceCache.until) return iceCache.list;
  if (!iceCache.pending) {
    iceCache.pending = fetchTurn(env, fetchImpl)
      .then((turn) => {
        iceCache.list = [STUN, ...turn];
        iceCache.until = now + (turn.length ? 12 * 3600e3 : 60e3);
        return iceCache.list;
      })
      .catch((err) => {
        console.error('[ice]', err.message);
        iceCache.until = 0;
        return [STUN];
      })
      .finally(() => (iceCache.pending = null));
  }
  return iceCache.pending;
}
iceServers.reset = () => Object.assign(iceCache, { list: null, until: 0, pending: null });

// ------------------------------------------------------------------ relais audio Cloudflare Realtime (SFU)
/**
 * Chaque téléphone ouvre UNE connexion vers Cloudflare (le plus proche), y publie sa voix et reçoit celle des autres.
 * Marche sur tous les réseaux (4G comprise) et chacun n'envoie sa voix qu'une fois.
 * Variables : CF_REALTIME_APP_ID + CF_REALTIME_APP_TOKEN (le jeton reste ici, jamais envoyé aux téléphones).
 * Le client ne manipule que SA session (gardée côté serveur) et ne reçoit que les pistes des joueurs de son salon.
 */
const SFU_BASE = 'https://rtc.live.cloudflare.com/v1/apps/';
const sfuSessionKey = (code, pid) => `onefoo:sfu:${code}:${pid}`;
const TRACK_RE = /^[a-z0-9]{4,24}$/i;
const sfuState = { fetch: (...a) => globalThis.fetch(...a) };
const sfuConfig = (env = process.env) =>
  env.CF_REALTIME_APP_ID && env.CF_REALTIME_APP_TOKEN ? { app: env.CF_REALTIME_APP_ID, token: env.CF_REALTIME_APP_TOKEN } : null;

async function sfuRequest(cfg, method, path, body) {
  const r = await sfuState.fetch(SFU_BASE + encodeURIComponent(cfg.app) + path, {
    method,
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await r.json();
  } catch {}
  const trackErr = Array.isArray(data.tracks) && data.tracks.find((t) => t.errorCode && t.errorCode !== 'close_track_error');
  if (!r.ok || data.errorCode || trackErr) {
    const e = trackErr || data;
    console.error('[sfu]', method, path.replace(/sessions\/[^/]+/, 'sessions/…'), r.status, e.errorCode, e.errorDescription);
    throw new GameError('Liaison audio momentanément impossible, nouvel essai…');
  }
  return data;
}

const sdpOk = (s) => typeof s === 'string' && s.length > 10 && s.length <= 30000;

async function sfu(st, code, pid, body) {
  const cfg = sfuConfig();
  if (!cfg) throw new GameError('Relais audio non configuré.');
  const room = await st.load(code);
  if (!room || !room.players.some((p) => p.id === pid && !p.isBot)) throw new GameError('Vous n’êtes pas dans ce salon.');
  const op = String(body.op || '');
  if (op === 'session') {
    const { sessionId } = await sfuRequest(cfg, 'POST', '/sessions/new');
    await st.redis('SET', sfuSessionKey(code, pid), sessionId, 'EX', 6 * 3600);
    return { ok: true };
  }
  const session = await st.redis('GET', sfuSessionKey(code, pid));
  if (!session) throw new GameError('Session audio expirée, nouvel essai…');
  const sp = '/sessions/' + encodeURIComponent(session);
  if (op === 'push') {
    if (!sdpOk(body.sdp) || !/^\d{1,4}$/.test(String(body.mid)) || !TRACK_RE.test(String(body.track))) throw new GameError('Requête audio invalide.');
    const r = await sfuRequest(cfg, 'POST', sp + '/tracks/new', {
      sessionDescription: { type: 'offer', sdp: body.sdp },
      tracks: [{ location: 'local', mid: String(body.mid), trackName: String(body.track) }],
    });
    return { ok: true, sdp: r.sessionDescription && r.sessionDescription.sdp };
  }
  if (op === 'pull') {
    const from = String(body.from || '');
    const pub = from !== pid && room.voice && room.voice[from] && room.voiceTracks && room.voiceTracks[from];
    if (!pub) throw new GameError('Ce joueur n’a pas de micro allumé.');
    const r = await sfuRequest(cfg, 'POST', sp + '/tracks/new', { tracks: [{ location: 'remote', sessionId: pub.s, trackName: pub.t }] });
    const t = (r.tracks || [])[0] || {};
    return {
      ok: true,
      track: pub.t,
      mid: t.mid,
      renegotiate: !!r.requiresImmediateRenegotiation,
      sdp: r.sessionDescription && r.sessionDescription.sdp,
      type: r.sessionDescription && r.sessionDescription.type,
    };
  }
  if (op === 'answer') {
    if (!sdpOk(body.sdp)) throw new GameError('Requête audio invalide.');
    await sfuRequest(cfg, 'PUT', sp + '/renegotiate', { sessionDescription: { type: 'answer', sdp: body.sdp } });
    return { ok: true };
  }
  if (op === 'close') {
    const mids = (Array.isArray(body.mids) ? body.mids : []).map(String).filter((m) => /^\d{1,4}$/.test(m)).slice(0, 16);
    if (mids.length) await sfuRequest(cfg, 'PUT', sp + '/tracks/close', { tracks: mids.map((mid) => ({ mid })), force: true });
    return { ok: true };
  }
  throw new GameError('Opération audio inconnue.');
}

/** Micro allumé avec une piste publiée : la session vient du serveur, jamais du client. */
async function voiceBody(st, code, pid, body) {
  const out = { ...body, sfu: null };
  if (body.on && body.track && TRACK_RE.test(String(body.track)) && sfuConfig()) {
    const session = await st.redis('GET', sfuSessionKey(code, pid));
    if (session) out.sfu = { s: session, t: String(body.track) };
  }
  return out;
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
  const { room, out } = await mutate(
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
      const record = markRecord(r);
      return changed || record ? { record } : { noWrite: true };
    },
    loaded
  );
  await recordIfNeeded(st, room, out);
  if (room.version === v) return { ok: true, same: true, serverNow: now };
  return { ok: true, state: roomsFor(room).view(room, pid, now) };
}

async function action(st, pid, body, now, user) {
  const a = String(body.action || '');
  // Joueur connecté à un compte : son pseudo et son avatar ; ses résultats compteront au classement
  const who = user ? { id: pid, name: user.name, avatar: user.avatar, uid: user.id } : { id: pid, name: body.name, avatar: body.avatar };

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
  if (a === 'sfu') return sfu(st, code, pid, body);
  if (a === 'voice') body = await voiceBody(st, code, pid, body);

  if (a === 'join') {
    const { room } = await mutate(st, code, (r) => {
      roomsFor(r).join(r, who, now);
      roomsFor(r).advance(r, now);
    });
    return { ok: true, state: roomsFor(room).view(room, pid, now) };
  }

  if (a === 'leave') {
    try {
      const { room, out } = await mutate(st, code, (r) => {
        const empty = roomsFor(r).leave(r, pid);
        if (!empty) roomsFor(r).advance(r, now);
        return { empty, record: !empty && markRecord(r) };
      });
      await recordIfNeeded(st, room, out);
      if (out.empty) await st.remove(code);
    } catch (err) {
      if (!(err instanceof GameError)) throw err; // salon déjà disparu : rien à faire
    }
    return { ok: true };
  }

  const { room, out } = await mutate(st, code, (r) => {
    const res = roomsFor(r).act(r, pid, a, body, now);
    roomsFor(r).advance(r, now);
    return { res, record: markRecord(r) };
  });
  await recordIfNeeded(st, room, out);
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
      if (q.ice) {
        const sfuOn = !!sfuConfig();
        const list = await iceServers();
        return send(200, { ok: true, sfu: sfuOn, iceServers: sfuOn ? [{ urls: ['stun:stun.cloudflare.com:3478'] }, ...list] : list });
      }
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
      const user = req.headers['x-onefoo-session'] ? await Account.userFromRequest(st, req) : null;
      return send(200, await action(st, pid, body || {}, now, user));
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
module.exports.sfuState = sfuState; // tests : remplacer sfuState.fetch
