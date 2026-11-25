'use strict';
/* Test de bout en bout de l'API /api/room (serveur local, stockage mémoire),
   puis de l'adaptateur Upstash avec un faux serveur REST. */
process.env.PORT = process.env.PORT || '3917';
delete process.env.VERCEL;
delete process.env.KV_REST_API_URL;
delete process.env.UPSTASH_REDIS_REST_URL;

const assert = require('assert');
const crypto = require('crypto');
const { server } = require('../local-server');
const { UpstashStore, CAS_SCRIPT, createStore } = require('../src/store');
const Rooms = require('../public/js/foo/rooms.js');

const BASE = `http://localhost:${process.env.PORT}/api/room`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name) {
  const secret = crypto.randomBytes(16).toString('hex');
  const c = {
    name,
    secret,
    state: null,
    version: 0,
    async post(action, data = {}) {
      const r = await fetch(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-OneFOO-Key': secret },
        body: JSON.stringify({ action, name, avatar: '🦁', code: c.state && c.state.code, ...data }),
      });
      const j = await r.json();
      if (j.state) c.apply(j.state);
      return j;
    },
    async poll() {
      const r = await fetch(`${BASE}?code=${c.state.code}&v=${c.version}`, { headers: { 'X-OneFOO-Key': secret } });
      const j = await r.json();
      if (j.state) c.apply(j.state);
      return j;
    },
    apply(s) {
      if (c.state && s.code === c.state.code && s.version < c.version) return;
      c.state = s;
      c.version = s.version;
    },
  };
  return c;
}

async function autoMove(c) {
  const g = c.state.game;
  if (!g || g.status !== 'playing' || g.turnPlayerId !== c.state.me) return;
  if (g.playable.length) {
    const card = g.hand.find((x) => x.id === g.playable[0]);
    const r = await c.post('play', { cardId: card.id, color: card.color === 'wild' ? 'red' : undefined });
    assert.ok(r.ok, 'play: ' + r.error);
  } else if (!g.hasDrawn) assert.ok((await c.post('draw')).ok);
  else assert.ok((await c.post('pass')).ok);
}

(async () => {
  // ---------- 1. Identité
  const bad = await (await fetch(BASE, { method: 'POST', headers: { 'X-OneFOO-Key': 'nope' }, body: '{}' })).json();
  assert.ok(!bad.ok && /Identifiant/.test(bad.error), 'clé invalide refusée');

  // ---------- 2. Salon entre amis
  const host = client('Hôte');
  const friend = client('Ami');
  const created = await host.post('create');
  assert.ok(created.ok && /^[A-Z0-9]{5}$/.test(created.state.code), 'création');
  const code = created.state.code;
  assert.match(host.state.me, /^p[0-9a-f]{16}$/, 'identifiant public dérivé');

  const wrong = await friend.post('join', { code: 'ZZZZZ' });
  assert.ok(!wrong.ok && /Aucune partie/.test(wrong.error), 'code invalide refusé');
  const joined = await friend.post('join', { code: code.toLowerCase() });
  assert.ok(joined.ok, 'rejoindre (insensible à la casse)');
  assert.strictEqual(joined.state.players.length, 2);

  // le poll ne renvoie rien de neuf si la version n'a pas changé
  await host.poll();
  const same = await host.poll();
  assert.ok(same.same, 'poll sans changement = réponse légère');

  assert.ok(!(await friend.post('start')).ok, "seul l'hôte lance");
  assert.ok((await host.post('addBot')).ok);
  assert.ok((await host.post('start')).ok);
  await friend.poll();
  assert.strictEqual(friend.state.status, 'playing');
  assert.ok(friend.state.game.players.every((p) => p.hand === undefined), 'mains adverses cachées');
  assert.strictEqual(friend.state.game.hand.length, 7);

  // impossible de jouer à la place d'un autre (identité dérivée de la clé secrète)
  const notTurn = host.state.game.turnPlayerId === host.state.me ? friend : host;
  const cheat = await notTurn.post('play', { cardId: notTurn.state.game.hand[0].id });
  assert.ok(!cheat.ok, 'jouer hors tour refusé');

  const late = client('Retard');
  const lateJoin = await late.post('join', { code });
  assert.ok(!lateJoin.ok && /en cours/.test(lateJoin.error), 'pas de join pendant une manche');

  // partie complète : chaque client rafraîchit et joue quand c'est son tour (le bot avance avec les rafraîchissements)
  const t0 = Date.now();
  while (host.state.status === 'playing') {
    for (const c of [host, friend]) {
      await c.poll();
      await autoMove(c);
    }
    await sleep(150);
    if (Date.now() - t0 > 120000) throw new Error('partie trop longue');
  }
  await friend.poll();
  const ended = host.state;
  assert.strictEqual(ended.status, 'ended');
  assert.strictEqual(ended.players.reduce((n, p) => n + p.wins, 0), 1, 'score du salon');
  console.log(`✔ API amis : manche terminée en ${((Date.now() - t0) / 1000).toFixed(1)} s, gagnant = ${ended.game.players.find((p) => p.id === ended.game.winnerId).name}`);

  // ---------- 3. Revanche, réaction, départ
  assert.ok((await host.post('start')).ok, 'revanche');
  assert.ok((await friend.post('emote', { emoji: '🔥' })).ok);
  await host.poll();
  assert.ok(host.state.emotes.some((e) => e.emoji === '🔥' && e.playerId === friend.state.me), 'réaction reçue');
  assert.ok((await friend.post('leave')).ok);
  await host.poll();
  assert.ok(host.state.game.players.find((p) => p.id === friend.state.me).isBot, 'remplacé par un bot');
  const gone = await friend.poll();
  assert.ok(gone.gone, "l'ami parti n'a plus accès au salon");
  assert.ok((await host.post('leave')).ok);
  const after = await late.post('join', { code });
  assert.ok(!after.ok, 'salon supprimé quand il est vide');
  console.log('✔ API : revanche, réactions, départ, suppression du salon');

  // ---------- 4. Adaptateur Upstash (faux serveur REST)
  const db = new Map();
  const calls = [];
  const fakeFetch = async (url, opts) => {
    assert.strictEqual(url, 'https://fake.upstash.io');
    assert.strictEqual(opts.headers.Authorization, 'Bearer tok');
    const args = JSON.parse(opts.body);
    calls.push(args[0]);
    let result;
    if (args[0] === 'HMGET') {
      const e = db.get(args[1]);
      result = [e ? e.v : null, e ? e.d : null];
    } else if (args[0] === 'EVAL') {
      assert.strictEqual(args[1], CAS_SCRIPT);
      const [, , , key, expected, version, data] = args;
      const cur = db.has(key) ? db.get(key).v : '0';
      if (cur !== expected) result = 0;
      else {
        db.set(key, { v: version, d: data });
        result = 1;
      }
    } else if (args[0] === 'DEL') result = db.delete(args[1]) ? 1 : 0;
    return { ok: true, json: async () => ({ result }) };
  };
  const st = new UpstashStore('https://fake.upstash.io/', 'tok', fakeFetch);
  const r = Rooms.newRoom('UPSTH', 'friends', { id: 'pA', name: 'A' }, Date.now());
  Rooms.addBot(r);
  Rooms.startGame(r, Date.now());
  r.version = 1;
  assert.strictEqual(await st.save(r, 0), true);
  assert.strictEqual(await st.save(r, 0), false, 'compare-and-set : conflit détecté');
  const loaded = await st.load('UPSTH');
  assert.strictEqual(loaded.version, 1);
  assert.strictEqual(typeof loaded.game.play, 'function', 'partie reconstruite');
  assert.deepStrictEqual(loaded.game.viewFor('pA').hand, r.game.viewFor('pA').hand);
  await st.remove('UPSTH');
  assert.strictEqual(await st.load('UPSTH'), null);
  assert.deepStrictEqual([...new Set(calls)].sort(), ['DEL', 'EVAL', 'HMGET']);
  assert.ok(createStore({ KV_REST_API_URL: 'https://x', KV_REST_API_TOKEN: 't' }) instanceof UpstashStore, 'variables Vercel KV reconnues');
  assert.strictEqual(createStore({ VERCEL: '1' }), null, 'sur Vercel sans base : mode amis désactivé');
  console.log('✔ adaptateur Upstash Redis');

  console.log('✔ api tests OK');
  server.close();
  process.exit(0);
})().catch((err) => {
  console.error('✘', err);
  process.exit(1);
});
