'use strict';
/* Test de bout en bout : vrai serveur + vrais clients Socket.io. */
process.env.PORT = process.env.PORT || '3917';
process.env.ONEFOO_BOT_SPEED = '0.01';

const assert = require('assert');
const { io: connect } = require('socket.io-client');
const { server, rooms } = require('../server');

const URL = `http://localhost:${process.env.PORT}`;
let idSeq = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name, playerId = `test${Date.now().toString(36)}${idSeq++}x`) {
  const sock = connect(URL, { transports: ['websocket'], forceNew: true });
  const c = {
    sock,
    playerId,
    name,
    state: null,
    autoplay: false,
    acting: false,
    emit(ev, data = {}) {
      return new Promise((resolve) => sock.emit(ev, data, resolve));
    },
    waitFor(pred, ms = 20000) {
      return new Promise((resolve, reject) => {
        if (c.state && pred(c.state)) return resolve(c.state);
        const t = setTimeout(() => {
          sock.off('room:state', h);
          reject(new Error(`${name}: timeout (status=${c.state && c.state.status})`));
        }, ms);
        const h = (s) => {
          if (pred(s)) {
            clearTimeout(t);
            sock.off('room:state', h);
            resolve(s);
          }
        };
        sock.on('room:state', h);
      });
    },
  };
  sock.on('room:state', (s) => {
    c.state = s;
    if (c.autoplay) autoPlay(c);
  });
  return new Promise((resolve) =>
    sock.on('connect', async () => {
      const r = await c.emit('hello', { playerId, name, avatar: '🦁' });
      assert.ok(r.ok, 'hello');
      resolve(c);
    })
  );
}

async function autoPlay(c) {
  const g = c.state && c.state.game;
  if (!g || g.status !== 'playing' || c.acting) return;
  if (g.vulnerable && g.vulnerable !== c.playerId) {
    c.acting = true;
    await c.emit('game:catch', { targetId: g.vulnerable });
    c.acting = false;
    return;
  }
  if (g.turnPlayerId !== c.playerId) return;
  c.acting = true;
  try {
    const me = g.players.find((p) => p.id === c.playerId);
    if (g.playable.length) {
      if (me.cardCount === 2 && Math.random() < 0.7) await c.emit('game:foo');
      const card = g.hand.find((h) => h.id === g.playable[0]);
      const r = await c.emit('game:play', { cardId: card.id, color: card.color === 'wild' ? 'blue' : undefined });
      assert.ok(r.ok, 'play: ' + r.error);
    } else if (!g.hasDrawn) {
      const r = await c.emit('game:draw');
      assert.ok(r.ok, 'draw: ' + r.error);
    } else {
      const r = await c.emit('game:pass');
      assert.ok(r.ok, 'pass: ' + r.error);
    }
  } finally {
    c.acting = false;
  }
  // c'est peut-être encore notre tour (carte piochée jouable, Inverse à 2...)
  setImmediate(() => c.autoplay && autoPlay(c));
}

(async () => {
  // ---------- 1. Solo contre le système
  {
    const a = await client('Alice');
    const r = await a.emit('solo:start', { level: 7 });
    assert.ok(r.ok && r.code, 'solo:start');
    const s = await a.waitFor((s) => s.game);
    assert.strictEqual(s.mode, 'solo');
    assert.strictEqual(s.players.length, 4, 'niveau 7 = 3 IA');
    assert.strictEqual(s.game.hand.length, 7);
    assert.ok(s.game.players.every((p) => p.hand === undefined), 'les mains adverses sont cachées');
    a.autoplay = true;
    autoPlay(a);
    const end = await a.waitFor((s) => s.status === 'ended', 60000);
    console.log(`✔ solo : partie terminée, gagnant = ${end.game.players.find((p) => p.id === end.game.winnerId).name}`);
    await a.emit('room:leave');
    a.sock.close();
  }

  // ---------- 2. Entre amis
  const host = await client('Hôte');
  const friend = await client('Ami');
  const created = await host.emit('room:create');
  assert.ok(created.ok);
  const code = created.code;
  assert.match(code, /^[A-Z0-9]{5}$/);

  const bad = await friend.emit('room:join', { code: 'ZZZZZ' });
  assert.ok(!bad.ok && /Aucune partie/.test(bad.error), 'code invalide refusé');

  const joined = await friend.emit('room:join', { code: code.toLowerCase() });
  assert.ok(joined.ok, 'rejoindre (insensible à la casse)');
  await host.waitFor((s) => s.players.length === 2);

  const notHost = await friend.emit('room:start');
  assert.ok(!notHost.ok, "seul l'hôte lance");
  assert.ok((await host.emit('room:addBot')).ok);
  await host.waitFor((s) => s.players.length === 3);
  assert.ok((await host.emit('room:start')).ok);
  await friend.waitFor((s) => s.status === 'playing');

  const late = await client('Retardataire');
  const lateJoin = await late.emit('room:join', { code });
  assert.ok(!lateJoin.ok && /en cours/.test(lateJoin.error), 'pas de join pendant une manche');

  // tricher : jouer hors de son tour
  const g0 = host.state.game;
  const notTurn = g0.turnPlayerId === host.playerId ? friend : host;
  const cheat = await notTurn.emit('game:play', { cardId: notTurn.state.game.hand[0].id });
  assert.ok(!cheat.ok, 'jouer hors tour refusé');

  host.autoplay = friend.autoplay = true;
  autoPlay(host);
  autoPlay(friend);
  const ended = await host.waitFor((s) => s.status === 'ended', 90000);
  const winsTotal = ended.players.reduce((n, p) => n + p.wins, 0);
  assert.strictEqual(winsTotal, 1, 'score de salon incrémenté');
  console.log(`✔ amis : manche terminée, gagnant = ${ended.game.players.find((p) => p.id === ended.game.winnerId).name}`);

  // ---------- 3. Revanche + reconnexion + départ en cours de partie
  assert.ok((await host.emit('room:start')).ok, 'revanche');
  await friend.waitFor((s) => s.status === 'playing' && s.game.id !== ended.game.id);
  host.autoplay = friend.autoplay = false;

  friend.sock.close();
  await host.waitFor((s) => s.players.some((p) => p.id === friend.playerId && !p.connected));
  const friend2 = await client('Ami', friend.playerId);
  const back = await friend2.waitFor((s) => s.status === 'playing');
  assert.strictEqual(back.code, code, 'reconnexion : retour dans le même salon');
  console.log('✔ reconnexion : le joueur retrouve sa partie');

  await friend2.emit('room:leave');
  const after = await host.waitFor((s) => s.game.players.find((p) => p.id === friend.playerId).isBot);
  assert.ok(after.notices.some((n) => /remplacé par un bot/.test(n.text)));
  host.autoplay = true;
  autoPlay(host);
  await host.waitFor((s) => s.status === 'ended', 90000);
  const final = host.state;
  assert.ok(!final.players.some((p) => p.id === friend.playerId), 'le joueur parti quitte le salon en fin de manche');
  console.log('✔ départ en cours de partie : remplacé par un bot, la manche continue');

  // ---------- 4. Nettoyage
  await host.emit('room:leave');
  await sleep(50);
  assert.strictEqual(rooms.rooms.size, 0, 'tous les salons supprimés');
  for (const c of [host, friend2, late]) c.sock.close();
  console.log('✔ online tests OK');
  server.close();
  process.exit(0);
})().catch((err) => {
  console.error('✘', err);
  process.exit(1);
});
