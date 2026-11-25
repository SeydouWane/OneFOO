'use strict';
const assert = require('assert');
const { FooGame, DECK_SIZE, GameError } = require('../public/js/foo/engine.js');
const bot = require('../public/js/foo/bot.js');

function players(n) {
  return Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i, isBot: true }));
}

// 1) Règles de base
{
  const g = new FooGame(players(3));
  assert.strictEqual(g.totalCards(), DECK_SIZE);
  for (const p of g.players) assert.strictEqual(p.hand.length, 7);
  assert.ok(/^\d$/.test(g.top().value), 'la première carte est un chiffre');
  const notMe = g.players[g.nextIndex()].id;
  assert.throws(() => g.draw(notMe), GameError);
  assert.throws(() => g.sayFoo(g.current().id), GameError, 'FOO interdit avec 7 cartes');
}

// 2) Effets des cartes spéciales
{
  const g = new FooGame(players(3));
  g.turn = 0;
  g.direction = 1;
  const p0 = g.players[0];
  g.currentColor = 'red';
  g.discard.push({ id: 'x1', color: 'red', value: '5' });
  p0.hand.push({ id: 't-d2', color: 'red', value: 'draw2' });
  const before = g.players[1].hand.length;
  g.play('p0', 't-d2');
  assert.strictEqual(g.players[1].hand.length, before + 2, '+2 fait piocher le suivant');
  assert.strictEqual(g.turn, 2, '+2 fait sauter le tour');

  const p2 = g.players[2];
  p2.hand.push({ id: 't-rev', color: 'red', value: 'reverse' });
  g.play('p2', 't-rev');
  assert.strictEqual(g.direction, -1);
  assert.strictEqual(g.turn, 1, 'inverse : sens contraire');

  const p1 = g.players[1];
  p1.hand.push({ id: 't-w4', color: 'wild', value: 'wild4' });
  assert.throws(() => g.play('p1', 't-w4'), GameError, 'joker sans couleur refusé');
  const b0 = g.players[0].hand.length;
  g.play('p1', 't-w4', 'blue');
  assert.strictEqual(g.currentColor, 'blue');
  assert.strictEqual(g.players[0].hand.length, b0 + 4);
  assert.strictEqual(g.turn, 2);
}

// 3) Inverse à 2 joueurs = rejouer
{
  const g = new FooGame(players(2));
  g.turn = 0;
  g.currentColor = 'green';
  g.discard.push({ id: 'x2', color: 'green', value: '1' });
  g.players[0].hand.push({ id: 't-rev2', color: 'green', value: 'reverse' });
  g.play('p0', 't-rev2');
  assert.strictEqual(g.turn, 0);
}

// 4) FOO! et "attraper"
{
  const g = new FooGame(players(3));
  g.turn = 0;
  g.currentColor = 'yellow';
  g.discard.push({ id: 'x3', color: 'yellow', value: '2' });
  const p0 = g.players[0];
  p0.hand = [
    { id: 'a', color: 'yellow', value: '3' },
    { id: 'b', color: 'blue', value: '9' },
  ];
  g.play('p0', 'a');
  assert.strictEqual(g.vulnerable, 'p0', 'oubli de FOO -> vulnérable');
  g.catchFoo('p2', 'p0');
  assert.strictEqual(p0.hand.length, 3, 'attrapé : +2');
  assert.strictEqual(g.vulnerable, null);
  assert.throws(() => g.catchFoo('p2', 'p0'), GameError);

  // avec FOO annoncé -> pas vulnérable
  const g2 = new FooGame(players(2));
  g2.turn = 0;
  g2.currentColor = 'red';
  g2.discard.push({ id: 'y', color: 'red', value: '2' });
  g2.players[0].hand = [
    { id: 'a', color: 'red', value: '3' },
    { id: 'b', color: 'blue', value: '9' },
  ];
  g2.sayFoo('p0');
  g2.play('p0', 'a');
  assert.strictEqual(g2.vulnerable, null);
}

// 5) Pioche : carte jouable -> on peut la poser ou passer
{
  const g = new FooGame(players(2));
  g.turn = 0;
  g.currentColor = 'red';
  g.discard.push({ id: 'z', color: 'red', value: '4' });
  g.players[0].hand = [{ id: 'k', color: 'blue', value: '7' }, { id: 'k2', color: 'blue', value: '8' }];
  g.drawPile.push({ id: 'drawme', color: 'red', value: '1' });
  const r = g.draw('p0');
  assert.ok(r.playable);
  assert.deepStrictEqual(g.playableIds('p0'), ['drawme']);
  assert.throws(() => g.draw('p0'), GameError, 'une seule pioche');
  g.pass('p0');
  assert.strictEqual(g.turn, 1);
}

// 5b) Sauvegarde / restauration JSON (Redis, localStorage) en pleine partie
{
  const g = new FooGame(players(3));
  for (let i = 0; i < 10 && g.status === 'playing'; i++) bot.playTurn(g, g.current().id, bot.profile(5));
  const copy = FooGame.fromJSON(JSON.parse(JSON.stringify(g)));
  assert.ok(!('rng' in JSON.parse(JSON.stringify(g))), 'rng non sérialisé');
  assert.deepStrictEqual(copy.viewFor('p0'), g.viewFor('p0'));
  assert.strictEqual(copy.totalCards(), DECK_SIZE);
  while (copy.status === 'playing') bot.playTurn(copy, copy.current().id, bot.profile(5));
  assert.ok(copy.winnerId, 'la partie restaurée se termine');
}

// 6) Simulation massive : invariants + fin de partie
function simulate(skills, rngSeedGames) {
  const wins = new Array(skills.length).fill(0);
  let maxTurns = 0;
  for (let k = 0; k < rngSeedGames; k++) {
    const g = new FooGame(players(skills.length));
    const profs = skills.map((s) => ({ ...bot.profile(1 + s * 12) }));
    let turns = 0;
    while (g.status === 'playing') {
      const cur = g.current();
      const i = g.players.indexOf(cur);
      bot.playTurn(g, cur.id, profs[i]);
      assert.strictEqual(g.totalCards(), DECK_SIZE, 'conservation des cartes');
      if (++turns > 5000) throw new Error('partie infinie');
    }
    maxTurns = Math.max(maxTurns, turns);
    wins[g.players.findIndex((p) => p.id === g.winnerId)]++;
  }
  return { wins, maxTurns };
}

for (const n of [2, 3, 4, 6]) {
  const r = simulate(new Array(n).fill(0.5), 300);
  assert.strictEqual(r.wins.reduce((a, b) => a + b, 0), 300);
}

const duel = simulate([0, 1], 2000);
const strongRate = duel.wins[1] / 2000;
console.log(`IA niveau 13 vs niveau 1 : ${(strongRate * 100).toFixed(1)}% de victoires (max ${duel.maxTurns} coups)`);
assert.ok(strongRate > 0.55, "l'IA forte doit battre l'IA faible");

for (const lv of [1, 3, 6, 10, 15]) {
  const p = bot.profile(lv);
  console.log(`Niveau ${lv} (${p.title}) : ${p.opponents} IA, attrape ${(p.catchChance * 100) | 0}%, FOO ${(p.fooChance * 100) | 0}%`);
}

console.log('✔ engine tests OK');
