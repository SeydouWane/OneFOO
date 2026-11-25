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
const { UpstashStore, CAS_SCRIPT, SIG_PUSH_SCRIPT, SIG_TAKE_SCRIPT, createStore } = require('../src/store');
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

  // ---------- 2b. Micro : état partagé + relais de mise en relation audio
  const ice = await (await fetch(`${BASE}?ice=1`, { headers: { 'X-OneFOO-Key': host.secret } })).json();
  assert.ok(ice.ok && ice.iceServers[0].urls[0].startsWith('stun:'), 'serveurs STUN fournis');
  assert.ok((await host.post('voice', { on: true })).ok);
  await friend.poll();
  assert.ok(friend.state.players.find((p) => p.id === host.state.me).mic, "l'ami voit le micro de l'hôte");
  const sent = await host.post('signal', { to: friend.state.me, data: { type: 'offer', sdp: 'v=0 fake', session: 's1' } });
  assert.ok(sent.ok, 'signal envoyé');
  assert.ok(!(await host.post('signal', { to: 'p0000000000000000', data: { type: 'offer', sdp: 'x' } })).ok, 'destinataire inconnu refusé');
  assert.ok(!(await host.post('signal', { to: friend.state.me, data: { type: 'evil' } })).ok, 'type de signal refusé');
  const got = await (await fetch(`${BASE}?code=${code}&v=0&sig=1`, { headers: { 'X-OneFOO-Key': friend.secret } })).json();
  assert.deepStrictEqual(got.signals, [{ from: host.state.me, type: 'offer', sdp: 'v=0 fake', session: 's1' }], 'signal reçu');
  const again = await (await fetch(`${BASE}?code=${code}&v=0&sig=1`, { headers: { 'X-OneFOO-Key': friend.secret } })).json();
  assert.ok(!again.signals, 'un signal n’est livré qu’une fois');
  assert.ok((await host.post('voice', { on: false })).ok);
  console.log('✔ API micro : état partagé, relais audio');

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

  // ---------- 3b. Morpion entre amis via l'API
  {
    const a = client('Ibou');
    const b = client('Awa');
    const c = await a.post('create', { game: 'morpion' });
    assert.ok(c.ok && c.state.kind === 'morpion' && c.state.maxPlayers === 2, 'salon de morpion créé');
    assert.ok((await b.post('join', { code: c.state.code })).ok);
    assert.ok(!(await client('C').post('join', { code: c.state.code })).ok, 'morpion : 2 joueurs max');
    assert.ok((await a.post('options', { size: 6 })).ok, 'grille choisie par l’hôte');
    assert.ok((await a.post('start')).ok);
    await b.poll();
    assert.strictEqual(b.state.game.size, 6);
    let turns = 0;
    while (a.state.status === 'playing' && turns++ < 80) {
      for (const p of [a, b]) {
        await p.poll();
        const g = p.state.game;
        if (g.status === 'playing' && g.turnPlayerId === p.state.me) {
          const free = g.board.map((x, i) => (x === null ? i : -1)).filter((i) => i >= 0);
          const r = await p.post('move', { cell: free[Math.floor(Math.random() * free.length)] });
          assert.ok(r.ok, 'move: ' + r.error);
        }
      }
    }
    await a.poll();
    assert.strictEqual(a.state.status, 'ended', 'partie de morpion terminée');
    const occupied = await a.post('move', { cell: 0 });
    assert.ok(!occupied.ok, 'plus de coups après la fin');
    await a.post('leave');
    await b.post('leave');
    console.log(`✔ API morpion : partie 6×6 terminée (${a.state.game.isDraw ? 'nul' : 'gagnant : ' + a.state.game.players.find((p) => p.id === a.state.game.winnerId).name})`);
  }

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
    } else if (args[0] === 'EVAL' && args[1] === SIG_PUSH_SCRIPT) {
      const list = db.get(args[3]) || [];
      list.push(args[4]);
      db.set(args[3], list);
      result = 1;
    } else if (args[0] === 'EVAL' && args[1] === SIG_TAKE_SCRIPT) {
      result = db.get(args[3]) || [];
      db.delete(args[3]);
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
  await st.pushSignal('UPSTH', 'pB', { from: 'pA', type: 'offer', sdp: 'x', session: '1' });
  await st.pushSignal('UPSTH', 'pB', { from: 'pA', type: 'bye', sdp: null, session: '1' });
  assert.deepStrictEqual((await st.takeSignals('UPSTH', 'pB')).map((s) => s.type), ['offer', 'bye'], 'file de signaux Upstash');
  assert.deepStrictEqual(await st.takeSignals('UPSTH', 'pB'), []);
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
