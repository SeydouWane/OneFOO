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

// 5a) Poser plusieurs cartes du même chiffre en une fois
{
  const g = new FooGame(players(3));
  g.turn = 0;
  g.currentColor = 'red';
  g.discard.push({ id: 'top', color: 'red', value: '5' });
  const p0 = g.players[0];
  p0.hand = [
    { id: 'r7', color: 'red', value: '7' },
    { id: 'b7', color: 'blue', value: '7' },
    { id: 'g7', color: 'green', value: '7' },
    { id: 'y3', color: 'yellow', value: '3' },
  ];
  assert.ok(g.canSayFoo('p0'), 'FOO possible : poser les trois 7 laisserait 1 carte');
  const g0 = new FooGame(players(2));
  g0.turn = 0;
  g0.currentColor = 'red';
  g0.discard.push({ id: 't0', color: 'red', value: '5' });
  g0.players[0].hand = [
    { id: 'x1', color: 'red', value: '7' },
    { id: 'x2', color: 'blue', value: '2' },
    { id: 'x3', color: 'green', value: '3' },
  ];
  assert.ok(!g0.canSayFoo('p0'), 'FOO impossible : il resterait plus d’une carte');
  assert.throws(() => g.play('p0', ['r7', 'y3']), /même chiffre/, 'chiffres différents refusés');
  assert.throws(() => g.play('p0', ['b7', 'r7']), /ne peut pas être jouée/, 'la première carte doit être jouable');
  assert.throws(() => g.play('p0', ['r7', 'r7']), GameError, 'doublon refusé');
  g.play('p0', ['r7', 'g7', 'b7']);
  assert.strictEqual(g.currentColor, 'blue', 'la dernière carte donne la couleur');
  assert.deepStrictEqual(p0.hand.map((c) => c.id), ['y3']);
  assert.strictEqual(g.top().id, 'b7');
  assert.strictEqual(g.vulnerable, 'p0', 'FOO oublié après une série');
  const evt = g.events[g.events.length - 1];
  assert.strictEqual(evt.cards.length, 3);

  // FOO! annoncé avant une série qui laisse une seule carte
  const g2 = new FooGame(players(2));
  g2.turn = 0;
  g2.currentColor = 'green';
  g2.discard.push({ id: 'top2', color: 'green', value: '1' });
  g2.players[0].hand = [
    { id: 'a', color: 'green', value: '4' },
    { id: 'b', color: 'red', value: '4' },
    { id: 'c', color: 'blue', value: '9' },
  ];
  assert.ok(g2.canSayFoo('p0'));
  assert.ok(g2.viewFor('p0').canFoo);
  g2.sayFoo('p0');
  g2.play('p0', ['a', 'b']);
  assert.strictEqual(g2.vulnerable, null, 'protégé par FOO!');
  assert.strictEqual(g2.currentColor, 'red');
  // un +2 ne peut pas être accompagné
  g2.players[1].hand.push({ id: 'd1', color: 'red', value: 'draw2' }, { id: 'd2', color: 'blue', value: 'draw2' });
  assert.throws(() => g2.play('p1', ['d1', 'd2']), /même chiffre/);
}

// 5c) Quand un joueur termine, les autres continuent jusqu'à la fin (classement complet)
const humansN = (n) => Array.from({ length: n }, (_, i) => ({ id: 'h' + i, name: 'H' + i, isBot: false }));
{
  const g = new FooGame(humansN(3));
  g.turn = 0;
  g.direction = 1;
  g.currentColor = 'red';
  g.discard.push({ id: 'tt', color: 'red', value: '4' });
  g.players[0].hand = [{ id: 'last', color: 'red', value: 'draw2' }];
  g.players[0].saidFoo = true;
  const h1 = g.players[1].hand.length;
  g.play('h0', 'last');
  assert.strictEqual(g.status, 'playing', 'la partie continue après le 1er');
  assert.deepStrictEqual(g.finished, ['h0']);
  assert.strictEqual(g.players[1].hand.length, h1 + 2, "l'effet de la dernière carte s'applique");
  assert.strictEqual(g.current().id, 'h2', 'le joueur suivant encore en jeu prend la main');
  assert.strictEqual(g.viewFor('h1').players[0].rank, 1);
  // le joueur qui a fini n'est plus jamais appelé à jouer
  g.currentColor = 'blue';
  g.discard.push({ id: 'tb', color: 'blue', value: '1' });
  g.players[2].hand.push({ id: 'skp', color: 'blue', value: 'skip' });
  g.play('h2', 'skp');
  assert.strictEqual(g.current().id, 'h2', 'à 2 joueurs restants, Passe fait rejouer (le fini est ignoré)');
  // le 2e termine -> il n'en reste qu'un : fin, classement complet
  g.players[2].hand = [{ id: 'fin', color: 'blue', value: '7' }];
  g.play('h2', 'fin');
  assert.strictEqual(g.status, 'ended');
  assert.deepStrictEqual(g.ranking, ['h0', 'h2', 'h1']);
  assert.strictEqual(g.winnerId, 'h0');
  const win = g.events[g.events.length - 1];
  assert.ok(win.type === 'win' && win.loserId === 'h1' && win.continued);
}
{
  // Plus aucun humain en jeu : on s'arrête et on classe les bots selon leurs cartes
  const g = new FooGame([
    { id: 'me', name: 'Moi', isBot: false },
    { id: 'b1', name: 'B1', isBot: true },
    { id: 'b2', name: 'B2', isBot: true },
  ]);
  g.turn = 0;
  g.currentColor = 'green';
  g.discard.push({ id: 'tg', color: 'green', value: '2' });
  g.players[0].hand = [{ id: 'x', color: 'green', value: '5' }];
  g.players[1].hand = g.players[1].hand.slice(0, 5);
  g.players[2].hand = g.players[2].hand.slice(0, 3);
  g.play('me', 'x');
  assert.strictEqual(g.status, 'ended', 'que des bots restants : fin immédiate');
  assert.deepStrictEqual(g.ranking, ['me', 'b2', 'b1']);
  assert.ok(!g.events[g.events.length - 1].continued);
}
{
  // Partie complète à 4 humains (jouée par l'IA) : tout le monde est classé
  for (let k = 0; k < 200; k++) {
    const g = new FooGame(humansN(4));
    let turns = 0;
    while (g.status === 'playing') {
      bot.playTurn(g, g.current().id, bot.profile(5));
      assert.ok(!g.isDone(g.status === 'playing' ? g.current().id : 'none'), 'un joueur fini ne joue plus');
      assert.strictEqual(g.totalCards(), DECK_SIZE);
      if (++turns > 6000) throw new Error('partie infinie (classement)');
    }
    assert.strictEqual(g.ranking.length, 4);
    assert.strictEqual(new Set(g.ranking).size, 4);
    assert.strictEqual(g.finished.length, 3, 'trois joueurs finissent, le dernier reste');
  }
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
