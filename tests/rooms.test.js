'use strict';
/* Salons sans minuteur : on simule le temps (horloge factice) et on sérialise le salon
   entre chaque étape, exactement comme le serveur (Redis) et le navigateur (localStorage). */
const assert = require('assert');
const Rooms = require('../public/js/foo/rooms.js');
const { GameError, DECK_SIZE } = require('../public/js/foo/engine.js');

const roundtrip = (room) => Rooms.parse(JSON.stringify(room));
const A = { id: 'pA', name: 'Awa', avatar: '🦁' };
const B = { id: 'pB', name: 'Bob', avatar: '🐼' };

function humanMove(room, pid, now) {
  const g = room.game;
  if (!g || g.status !== 'playing' || g.current().id !== pid) return false;
  const v = g.viewFor(pid);
  if (v.playable.length) {
    const card = v.hand.find((c) => c.id === v.playable[0]);
    Rooms.act(room, pid, 'play', { cardId: card.id, color: card.color === 'wild' ? 'green' : undefined }, now);
  } else if (!v.hasDrawn) Rooms.act(room, pid, 'draw', {}, now);
  else Rooms.act(room, pid, 'pass', {}, now);
  return true;
}

// 1) Salon entre amis : création, rejoindre, droits de l'hôte
let now = 1_000_000;
let room = Rooms.newRoom('ABCDE', 'friends', A, now);
Rooms.join(room, B, now);
assert.strictEqual(room.players.length, 2);
assert.throws(() => Rooms.act(room, 'pB', 'start', {}, now), GameError, "seul l'hôte lance");
assert.throws(() => Rooms.act(room, 'pZ', 'draw', {}, now), GameError, 'un inconnu ne peut pas jouer');
Rooms.act(room, 'pA', 'addBot', {}, now);
Rooms.act(room, 'pA', 'start', {}, now);
assert.strictEqual(Rooms.status(room), 'playing');
assert.throws(() => Rooms.join(room, { id: 'pC', name: 'C' }, now), /en cours/);
room = roundtrip(room);

// 2) Partie complète : humains + bot, le temps avance par pas de 400 ms
let steps = 0;
let sawBotMove = false;
while (Rooms.status(room) === 'playing') {
  now += 400;
  for (const pid of ['pA', 'pB']) {
    Rooms.touch(room, pid, now);
    if (humanMove(room, pid, now)) break;
  }
  const before = room.game.eventSeq;
  Rooms.advance(room, now);
  if (room.game.eventSeq !== before) sawBotMove = true;
  assert.strictEqual(room.game.totalCards(), DECK_SIZE);
  room = roundtrip(room);
  if (++steps > 5000) throw new Error('partie infinie');
}
assert.ok(sawBotMove, 'le bot a joué grâce à advance()');
assert.strictEqual(Object.values(room.scores).reduce((a, b) => a + b, 0), 1, 'score du salon');
console.log(`✔ salon amis : partie terminée en ${steps} pas, gagnant = ${room.game.player(room.game.winnerId).name}`);

// 3) Temps écoulé : un joueur inactif voit son tour joué automatiquement après 30 s
Rooms.act(room, 'pA', 'start', {}, now);
Rooms.advance(room, now);
let guard = 0;
while (room.game.current().isBot && guard++ < 50) {
  now += 2000;
  Rooms.touch(room, 'pA', now);
  Rooms.touch(room, 'pB', now);
  Rooms.advance(room, now);
}
const idle = room.game.current().id;
const seq = room.game.turnSeq;
assert.ok(room.turnDeadline && room.turnDeadline - now <= Rooms.TURN_MS, 'échéance affichée');
now += 10000;
Rooms.touch(room, 'pA', now);
Rooms.touch(room, 'pB', now);
Rooms.advance(room, now);
assert.strictEqual(room.game.turnSeq, seq, 'pas encore écoulé');
now += Rooms.TURN_MS;
Rooms.touch(room, 'pA', now);
Rooms.touch(room, 'pB', now);
Rooms.advance(room, now);
assert.ok(room.game.turnSeq !== seq || room.game.current().id !== idle, 'tour joué automatiquement');
assert.ok(room.notices.some((n) => /Temps écoulé/.test(n.text)));
console.log('✔ temps écoulé : le tour passe automatiquement');

// 4) Oubli de FOO! : un bot attrape (niveau élevé), avec délai
{
  let t = 5_000_000;
  const r = Rooms.newRoom('SOLO-x', 'solo', { id: 'local', name: 'Moi' }, t, { level: 15 });
  Rooms.addBot(r);
  Rooms.startGame(r, t);
  const g = r.game;
  g.turn = g.players.findIndex((p) => p.id === 'local');
  g.currentColor = 'red';
  g.discard.push({ id: 'zz', color: 'red', value: '5' });
  g.players.find((p) => p.id === 'local').hand = [
    { id: 'm1', color: 'red', value: '3' },
    { id: 'm2', color: 'blue', value: '9' },
  ];
  Rooms.act(r, 'local', 'play', { cardId: 'm1' }, t);
  Rooms.advance(r, t, () => 0); // rng = 0 -> le bot décide d'attraper
  assert.ok(r.plannedCatch, 'attrape planifiée');
  Rooms.advance(r, t + 200, () => 0.99);
  assert.strictEqual(g.player('local').hand.length, 1, "pas d'attrape immédiate");
  Rooms.advance(r, r.plannedCatch.at, () => 0.99);
  assert.strictEqual(g.player('local').hand.length, 3, 'attrapé : +2 cartes');
  console.log('✔ oubli de FOO! : le système attrape après un délai');
}

// 5) Départ en cours de partie : remplacé par un bot ; fin de manche : retiré du salon
{
  let t = 9_000_000;
  let r = Rooms.newRoom('QWERT', 'friends', A, t);
  Rooms.join(r, B, t);
  Rooms.act(r, 'pA', 'start', {}, t);
  assert.strictEqual(Rooms.leave(r, 'pA'), false);
  assert.strictEqual(r.hostId, 'pB', "l'hôte change");
  assert.ok(r.game.player('pA').isBot);
  let n = 0;
  while (Rooms.status(r) === 'playing' && n++ < 4000) {
    t += 500;
    Rooms.touch(r, 'pB', t);
    humanMove(r, 'pB', t);
    Rooms.advance(r, t);
    r = roundtrip(r);
  }
  assert.strictEqual(Rooms.status(r), 'ended');
  assert.ok(!r.players.some((p) => p.id === 'pA'), 'retiré du salon');
  assert.strictEqual(Rooms.leave(r, 'pB'), true, 'salon vide -> à supprimer');
  console.log('✔ départ : remplacé par un bot puis retiré');
}

// 6) Salon : un absent est retiré après 90 s hors partie
{
  let t = 1_000;
  const r = Rooms.newRoom('ZZZZZ', 'friends', A, t);
  Rooms.join(r, B, t);
  t += 95_000;
  Rooms.touch(r, 'pB', t);
  Rooms.advance(r, t);
  assert.deepStrictEqual(r.players.map((p) => p.id), ['pB']);
  assert.strictEqual(r.hostId, 'pB');
  console.log('✔ salon : les absents sont retirés, l’hôte est transmis');
}

// 7) Le système est taquin : il parle au début, pendant la partie et à la fin
{
  let t = 50_000_000;
  let r = Rooms.newRoom('SOLO-t', 'solo', { id: 'local', name: 'Ibou' }, t, { level: 7 });
  for (let i = 0; i < 3; i++) Rooms.addBot(r);
  Rooms.startGame(r, t);
  Rooms.advance(r, t);
  assert.strictEqual(r.says.length, 1, 'une réplique dès le début');
  assert.ok(r.game.player(r.says[0].playerId).isBot, 'c’est un bot qui parle');
  console.log(`   « ${r.says[0].text} »`);
  let lines = 0;
  let lastSay = r.says[0].at;
  let minGap = Infinity;
  let n = 0;
  while (Rooms.status(r) === 'playing' && n++ < 3000) {
    t += 400;
    humanMove(r, 'local', t);
    const before = r.saySeq;
    Rooms.advance(r, t);
    if (r.saySeq !== before) {
      lines++;
      const s = r.says[r.says.length - 1];
      if (!/gagn|Revanche|chance|Je te gagne|Trop facile|on rejoue/i.test(s.text)) minGap = Math.min(minGap, s.at - lastSay);
      lastSay = s.at;
    }
    r = roundtrip(r);
  }
  const last = r.says[r.says.length - 1];
  assert.ok(lines >= 2, 'le système parle pendant la partie');
  assert.ok(last.at === r.updatedAt || lines > 0);
  const winner = r.game.player(r.game.winnerId);
  console.log(`   fin (${winner.isBot ? 'le système gagne' : 'le joueur gagne'}) : « ${last.text} »`);
  assert.ok(r.says.every((s) => !/\{\w+\}/.test(s.text)), 'pas de modèle non rempli');
  console.log(`✔ système taquin : ${lines + 1} répliques sur la partie`);
}

// 8) Poser plusieurs cartes via le salon + micro
{
  const t = 70_000_000;
  const r = Rooms.newRoom('MULTI', 'friends', A, t);
  Rooms.join(r, B, t);
  Rooms.act(r, 'pA', 'start', {}, t);
  const g = r.game;
  g.turn = g.players.findIndex((p) => p.id === 'pA');
  g.currentColor = 'red';
  g.discard.push({ id: 'zz9', color: 'red', value: '9' });
  g.player('pA').hand = [
    { id: 'q1', color: 'red', value: '2' },
    { id: 'q2', color: 'green', value: '2' },
    { id: 'q3', color: 'blue', value: '5' },
  ];
  Rooms.act(r, 'pA', 'play', { cardIds: ['q1', 'q2'] }, t);
  assert.strictEqual(g.currentColor, 'green');
  assert.strictEqual(g.player('pA').hand.length, 1);

  Rooms.act(r, 'pB', 'voice', { on: true }, t);
  assert.ok(Rooms.view(r, 'pA', t).players.find((p) => p.id === 'pB').mic, 'micro visible des autres');
  Rooms.act(r, 'pB', 'voice', { on: false }, t);
  assert.ok(!Rooms.view(r, 'pA', t).players.find((p) => p.id === 'pB').mic);
  console.log('✔ salon : poser plusieurs cartes, état du micro');
}

console.log('✔ rooms tests OK');
