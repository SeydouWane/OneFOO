'use strict';
const assert = require('assert');
const { MorpionGame, profile, chooseMove } = require('../public/js/morpion/engine.js');
const Rooms = require('../public/js/morpion/rooms.js');
const { GameError } = require('../public/js/core/rooms-core.js');

const two = () => [
  { id: 'a', name: 'A' },
  { id: 'b', name: 'B' },
];
const roundtrip = (room) => Rooms.parse(JSON.parse(JSON.stringify(room)));

// 1) Règles : alignements, match nul, coups interdits
{
  const g = new MorpionGame(two(), { size: 3 });
  assert.strictEqual(g.current().id, 'a');
  assert.strictEqual(g.players[0].mark, 'X');
  assert.throws(() => g.play('b', 0), GameError, 'pas son tour');
  g.play('a', 0);
  assert.throws(() => g.play('b', 0), /déjà prise/);
  assert.throws(() => g.play('b', 9), /invalide/);
  g.play('b', 3);
  g.play('a', 4);
  g.play('b', 5);
  g.play('a', 8); // diagonale 0-4-8
  assert.strictEqual(g.status, 'ended');
  assert.strictEqual(g.winnerId, 'a');
  assert.deepStrictEqual(g.winLine, [0, 4, 8]);

  const d = new MorpionGame(two(), { size: 3 });
  for (const [p, c] of [['a', 0], ['b', 1], ['a', 2], ['b', 4], ['a', 3], ['b', 5], ['a', 7], ['b', 6], ['a', 8]]) d.play(p, c);
  assert.ok(d.isDraw && d.status === 'ended' && !d.winnerId, 'match nul');

  const big = new MorpionGame(two(), { size: 9 });
  assert.strictEqual(big.align, 5);
  const seq = [['a', 40], ['b', 0], ['a', 41], ['b', 1], ['a', 42], ['b', 2], ['a', 43]];
  for (const [p, c] of seq) big.play(p, c);
  assert.ok(big.events.some((e) => e.type === 'threat' && e.playerId === 'a'), 'menace détectée (4 alignés)');
  big.play('b', 44); // bloque
  assert.ok(big.events.some((e) => e.type === 'block' && e.playerId === 'b'), 'blocage détecté');
  big.play('a', 39);
  assert.strictEqual(big.winnerId, 'a', '5 alignés sur 9×9');

  const copy = MorpionGame.fromJSON(JSON.parse(JSON.stringify(g)));
  assert.deepStrictEqual(copy.viewFor('a'), g.viewFor('a'), 'sauvegarde / restauration');
}

// 2) IA : en 3×3, le système parfait ne perd jamais
function duel(size, profA, profB, n, randomA = false) {
  const res = { a: 0, b: 0, draw: 0 };
  for (let k = 0; k < n; k++) {
    const g = new MorpionGame(
      [
        { id: 'a', name: 'A', isBot: true },
        { id: 'b', name: 'B', isBot: true },
      ],
      { size, starter: k % 2 }
    );
    while (g.status === 'playing') {
      const cur = g.current();
      if (cur.id === 'a' && randomA) {
        const empties = g.board.map((c, i) => (c === null ? i : -1)).filter((i) => i >= 0);
        g.play('a', empties[Math.floor(Math.random() * empties.length)]);
      } else g.play(cur.id, chooseMove(g, cur.id, cur.id === 'a' ? profA : profB));
    }
    if (g.isDraw) res.draw++;
    else res[g.winnerId]++;
  }
  return res;
}
const perfect3 = { ...profile(1), mistake: 0 };
const r1 = duel(3, perfect3, perfect3, 20);
assert.strictEqual(r1.draw, 20, 'parfait contre parfait = toujours nul');
const r2 = duel(3, perfect3, perfect3, 200, true);
assert.strictEqual(r2.b, r2.b + 0);
assert.strictEqual(r2.a, 0, "le hasard ne bat jamais l'IA parfaite");
const lv1 = profile(1);
const r3 = duel(3, perfect3, lv1, 200, true);
assert.ok(r3.a > 0, 'le niveau 1 est battable');
console.log(`✔ IA 3×3 : parfaite invaincue ; niveau 1 battu ${r3.a}/200 fois par des coups au hasard`);

for (const lv of [5, 9]) {
  const strong = { ...profile(lv), mistake: 0 };
  const r = duel(strong.size, strong, strong, 30, true);
  assert.ok(r.b >= 28, `IA ${strong.size}×${strong.size} écrase le hasard (${r.b}/30)`);
  console.log(`✔ IA ${strong.size}×${strong.size} (aligner ${strong.align}) bat le hasard ${r.b}/30`);
}
{
  // L'IA bloque une victoire immédiate et saisit la sienne
  const g = new MorpionGame(two(), { size: 6 });
  for (const [p, c] of [['a', 0], ['b', 35], ['a', 1], ['b', 34], ['a', 2]]) g.play(p, c);
  assert.strictEqual(chooseMove(g, 'b', { ...profile(8), mistake: 0 }), 3, 'bloque 3 alignés (aligner 4)');
  g.play('b', 33);
  assert.strictEqual(chooseMove(g, 'a', { ...profile(8), mistake: 0 }), 3, 'saisit la victoire');
}

// 3) Salons : solo (la grille grandit avec le niveau)
for (const [lv, size] of [[1, 3], [5, 6], [9, 9]]) {
  const r = Rooms.newSoloRoom('SOLO-m', { id: 'local', name: 'Ibou' }, 1000, lv);
  assert.strictEqual(r.players.length, 2);
  Rooms.startGame(r, 1000);
  assert.strictEqual(r.game.size, size, `niveau ${lv} -> ${size}×${size}`);
  assert.strictEqual(r.game.current().id, 'local', 'contre le système, vous commencez');
}
{
  let t = 5_000_000;
  let r = Rooms.newSoloRoom('SOLO-m2', { id: 'local', name: 'Ibou' }, t, 6);
  Rooms.startGame(r, t);
  Rooms.advance(r, t);
  assert.strictEqual(r.says.length, 1, 'le système parle dès le début');
  let n = 0;
  while (Rooms.status(r) === 'playing' && n++ < 500) {
    t += 300;
    const g = r.game;
    if (g.current().id === 'local') {
      const empties = g.board.map((c, i) => (c === null ? i : -1)).filter((i) => i >= 0);
      Rooms.act(r, 'local', 'move', { cell: empties[Math.floor(Math.random() * empties.length)] }, t);
    }
    Rooms.advance(r, t);
    r = roundtrip(r);
  }
  assert.strictEqual(Rooms.status(r), 'ended');
  const last = r.says[r.says.length - 1];
  console.log(`✔ salon solo 6×6 terminé (${r.game.isDraw ? 'nul' : r.game.winnerId === 'local' ? 'joueur' : 'système'}) : « ${last.text} »`);
}

// 4) Salons : entre amis (2 max, options de l'hôte, alternance de qui commence)
{
  const t = 9000;
  const r = Rooms.newRoom('MORPI', 'friends', { id: 'pA', name: 'Ibou' }, t, { size: 6 });
  assert.strictEqual(r.options.size, 6);
  Rooms.join(r, { id: 'pB', name: 'Awa' }, t);
  assert.throws(() => Rooms.join(r, { id: 'pC', name: 'C' }, t), /complet/);
  assert.throws(() => Rooms.act(r, 'pB', 'options', { size: 9 }, t), /hôte/);
  Rooms.act(r, 'pA', 'options', { size: 9 }, t);
  assert.throws(() => Rooms.act(r, 'pA', 'options', { size: 7 }, t), /inconnue/);
  Rooms.act(r, 'pA', 'start', {}, t);
  assert.strictEqual(r.game.size, 9);
  assert.strictEqual(r.game.current().id, 'pA', "l'hôte commence la 1re manche");
  // fin rapide : B abandonne -> remplacé par un bot, la partie continue
  r.game.status = 'ended';
  r.game.winnerId = 'pA';
  Rooms.advance(r, t);
  assert.strictEqual(r.scores.pA, 1);
  Rooms.act(r, 'pA', 'start', {}, t);
  assert.strictEqual(r.game.current().id, 'pB', 'on alterne qui commence');
  assert.strictEqual(r.game.player('pB').mark, 'X');
  assert.strictEqual(Rooms.view(r, 'pA', t).kind, 'morpion');
  console.log('✔ salon amis : 2 joueurs max, grille choisie par l’hôte, alternance');
}

console.log('✔ morpion tests OK');
