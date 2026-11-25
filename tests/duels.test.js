'use strict';
/* Aligne 4, Awalé, Dames : règles, IA, salons. */
const assert = require('assert');
const A4 = require('../public/js/aligne4/engine.js');
const AW = require('../public/js/awale/engine.js');
const DM = require('../public/js/dames/engine.js');
const { GameError } = require('../public/js/core/rooms-core.js');
const ROOMS = {
  aligne4: require('../public/js/aligne4/rooms.js'),
  awale: require('../public/js/awale/rooms.js'),
  dames: require('../public/js/dames/rooms.js'),
};
const two = (bots = false) => [
  { id: 'a', name: 'A', isBot: bots },
  { id: 'b', name: 'B', isBot: bots },
];
const randomMove = (g) => {
  const m = g.legalMoves();
  return m[Math.floor(Math.random() * m.length)];
};

/** Partie IA (a) contre hasard (b) ; renvoie {a, b, draw, maxMs}. */
function vsRandom(Game, chooseMove, prof, n, opts = {}) {
  const res = { a: 0, b: 0, draw: 0, maxMs: 0 };
  for (let k = 0; k < n; k++) {
    const g = new Game(two(true), Object.assign({ starter: k % 2 }, opts));
    let plies = 0;
    while (g.status === 'playing' && plies++ < 600) {
      const cur = g.current();
      if (cur.id === 'a') {
        const t = Date.now();
        g.play('a', chooseMove(g, 'a', prof));
        res.maxMs = Math.max(res.maxMs, Date.now() - t);
      } else g.play('b', randomMove(g));
    }
    if (g.isDraw || g.status === 'playing') res.draw++;
    else res[g.winnerId]++;
  }
  return res;
}

// ======================================================================= ALIGNE 4
{
  const g = new A4.Aligne4Game(two());
  g.play('a', 3);
  assert.strictEqual(g.board[5 * 7 + 3], 'X', 'le jeton tombe tout en bas');
  g.play('b', 3);
  assert.strictEqual(g.board[4 * 7 + 3], 'O', 'empilement');
  assert.throws(() => g.play('b', 2), GameError, 'pas son tour');
  for (const [p, c] of [['a', 0], ['b', 3], ['a', 0], ['b', 3], ['a', 0], ['b', 3]]) g.play(p, c);
  assert.strictEqual(g.winnerId, 'b', '4 à la suite en colonne');
  assert.deepStrictEqual(g.winLine.length, 4);

  const h = new A4.Aligne4Game(two());
  for (const [p, c] of [['a', 0], ['b', 0], ['a', 1], ['b', 1], ['a', 2], ['b', 2]]) h.play(p, c);
  assert.ok(h.events.some((e) => e.type === 'threat' && e.playerId === 'a'), 'menace détectée');
  h.play('a', 3);
  assert.strictEqual(h.winnerId, 'a', '4 à la suite en ligne');

  const full = new A4.Aligne4Game(two());
  for (let i = 0; i < 6; i++) full.play(i % 2 ? 'b' : 'a', 6);
  assert.throws(() => full.play('a', 6), /pleine/);

  const strong = A4.profile(9);
  const r = vsRandom(A4.Aligne4Game, A4.chooseMove, strong, 12);
  assert.ok(r.a >= 11, `Aligne 4 : l'IA forte écrase le hasard (${r.a}/12)`);
  assert.ok(r.maxMs < 1500, `IA rapide (${r.maxMs} ms max)`);
  // gagne / bloque immédiatement
  const t = new A4.Aligne4Game(two());
  for (const [p, c] of [['a', 0], ['b', 6], ['a', 1], ['b', 6], ['a', 2]]) t.play(p, c);
  assert.strictEqual(A4.chooseMove(t, 'b', { ...strong, mistake: 0 }), 3, 'bloque 3 alignés');
  console.log(`✔ Aligne 4 : règles ; IA forte bat le hasard ${r.a}/12 (coup le plus long ${r.maxMs} ms)`);
}

// ======================================================================= AWALÉ
{
  const g = new AW.AwaleGame(two());
  const total = (x) => x.pits.reduce((s, n) => s + n, 0) + x.stores[0] + x.stores[1];
  assert.strictEqual(total(g), 48);
  g.play('a', 2);
  assert.deepStrictEqual(g.pits.slice(0, 7), [4, 4, 0, 5, 5, 5, 5], 'semis vers la droite puis chez l’adversaire');
  assert.throws(() => g.play('b', 2), /votre côté/);

  // capture en chaîne : la dernière graine fait 2 ou 3 chez l'adversaire, et les cases précédentes aussi
  let r = AW.simulate([0, 0, 0, 0, 0, 3, 1, 2, 1, 4, 4, 4], 5, 0);
  assert.deepStrictEqual(r.captured.sort(), [6, 7, 8], 'prise en chaîne (2, 3, 2)');
  assert.strictEqual(r.gain, 7);
  // famine interdite : prendre toutes les graines adverses ne capture rien
  r = AW.simulate([0, 0, 0, 0, 0, 2, 1, 1, 0, 0, 0, 0], 5, 0);
  assert.ok(r.grandSlam && r.gain === 0, 'pas le droit d’affamer');
  // 12 graines ou plus : on saute la case de départ
  r = AW.simulate([12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0, 0);
  assert.strictEqual(r.pits[0], 0, 'case de départ sautée');
  // nourrir : l'adversaire n'a plus rien -> seuls les coups qui lui donnent des graines sont permis
  assert.deepStrictEqual(AW.legalFor([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0], 0), [5], 'obligation de nourrir');

  // parties au hasard : conservation des graines, fin garantie
  for (let k = 0; k < 150; k++) {
    const p = new AW.AwaleGame(two(true), { starter: k % 2 });
    let n = 0;
    while (p.status === 'playing' && n++ < 2000) {
      p.play(p.current().id, randomMove(p));
      assert.strictEqual(total(p), 48, 'conservation des graines');
    }
    assert.strictEqual(p.status, 'ended');
    assert.ok(p.isDraw || p.winnerId);
  }
  const res = vsRandom(AW.AwaleGame, AW.chooseMove, AW.profile(8), 10);
  assert.ok(res.a >= 9, `Awalé : l'IA forte écrase le hasard (${res.a}/10)`);
  assert.ok(res.maxMs < 1500, `IA rapide (${res.maxMs} ms max)`);
  console.log(`✔ Awalé : règles abapa ; IA forte bat le hasard ${res.a}/10 (coup le plus long ${res.maxMs} ms)`);
}

// ======================================================================= DAMES
{
  const g = new DM.DamesGame(two());
  assert.strictEqual(g.board.filter((p) => p === 'w').length, 20);
  assert.strictEqual(g.board.filter((p) => p === 'b').length, 20);
  assert.strictEqual(g.legalMoves().length, 9, 'les blancs ont 9 premiers coups possibles');
  assert.strictEqual(g.current().id, 'a', 'les blancs commencent');

  const empty = () => new Array(100).fill(null);
  const sq = (r, c) => r * 10 + c;
  // prise obligatoire
  let b = empty();
  b[sq(6, 1)] = 'w';
  b[sq(5, 2)] = 'b';
  b[sq(9, 8)] = 'w';
  let moves = DM.legalMoves(b, 0);
  assert.ok(moves.every((m) => m.captures.length === 1), 'prise obligatoire');
  // prise arrière d'un pion
  b = empty();
  b[sq(4, 4)] = 'w';
  b[sq(5, 5)] = 'b';
  moves = DM.legalMoves(b, 0);
  assert.deepStrictEqual(moves.map((m) => m.to), [sq(6, 6)], 'un pion prend aussi en arrière');
  // règle de la majorité : la rafle de 2 est obligatoire face à une prise de 1
  b = empty();
  b[sq(8, 1)] = 'w';
  b[sq(7, 2)] = 'b';
  b[sq(5, 2)] = 'b'; // rafle (8,1) -> (6,3) -> (4,1) : 2 pièces
  b[sq(8, 7)] = 'w';
  b[sq(7, 6)] = 'b'; // prise simple (8,7) -> (6,5) : 1 pièce
  moves = DM.legalMoves(b, 0);
  assert.ok(moves.length && moves.every((m) => m.captures.length === 2 && m.from === sq(8, 1)), 'prise maximale obligatoire');
  // dame volante : déplacement et prise à distance
  b = empty();
  b[sq(9, 0)] = 'W';
  b[sq(5, 4)] = 'b';
  moves = DM.legalMoves(b, 0);
  assert.ok(moves.length >= 1 && moves.every((m) => m.captures[0] === sq(5, 4)), 'la dame prend à distance');
  assert.deepStrictEqual(moves.map((m) => m.to).sort((x, y) => x - y), [sq(0, 9), sq(1, 8), sq(2, 7), sq(3, 6), sq(4, 5)].sort((x, y) => x - y), 'et atterrit où elle veut derrière');
  // promotion seulement en fin de coup
  b = empty();
  b[sq(2, 1)] = 'w';
  b[sq(1, 2)] = 'b';
  b[sq(1, 4)] = 'b';
  moves = DM.legalMoves(b, 0);
  const m = moves.find((x) => x.captures.length === 2);
  assert.ok(m && m.to === sq(2, 5), 'rafle qui passe par la dernière rangée');
  assert.strictEqual(DM.applyMove(b, m).board[m.to], 'w', 'pas de promotion si la rafle continue');
  b = empty();
  b[sq(1, 2)] = 'w';
  assert.strictEqual(DM.applyMove(b, DM.legalMoves(b, 0)[0]).board.find((p) => p), 'W', 'promotion en fin de coup');
  // pas deux fois la même pièce
  b = empty();
  b[sq(5, 0)] = 'W';
  b[sq(3, 2)] = 'b';
  moves = DM.legalMoves(b, 0);
  assert.ok(moves.every((x) => new Set(x.captures).size === x.captures.length));

  // jouer via la partie : un coup interdit est refusé, la prise obligatoire est annoncée
  const gg = new DM.DamesGame(two());
  assert.throws(() => gg.play('a', { from: sq(6, 1), to: sq(4, 3) }), GameError);
  const first = gg.legalMoves()[0];
  gg.play('a', { from: first.from, to: first.to });
  assert.strictEqual(gg.current().id, 'b');

  const res = vsRandom(DM.DamesGame, DM.chooseMove, DM.profile(7), 6);
  assert.ok(res.a >= 5, `Dames : l'IA forte écrase le hasard (${res.a}/6)`);
  assert.ok(res.maxMs < 2500, `IA assez rapide (${res.maxMs} ms max)`);
  console.log(`✔ Dames : règles internationales ; IA forte bat le hasard ${res.a}/6 (coup le plus long ${res.maxMs} ms)`);
}

// ======================================================================= SALONS
for (const kind of Object.keys(ROOMS)) {
  const R = ROOMS[kind];
  let t = 1_000_000;
  let room = R.newSoloRoom('SOLO-' + kind, { id: 'local', name: 'Ibou' }, t, 2);
  R.startGame(room, t);
  R.advance(room, t);
  assert.strictEqual(room.says.length, 1, `${kind} : le système parle dès le début`);
  let n = 0;
  while (R.status(room) === 'playing' && n++ < 1500) {
    t += 400;
    const g = room.game;
    if (g.current().id === 'local') R.act(room, 'local', 'move', { move: randomMove(g) }, t);
    R.advance(room, t);
    room = R.parse(JSON.parse(JSON.stringify(room)));
  }
  assert.strictEqual(R.status(room), 'ended', `${kind} : partie solo terminée`);
  assert.strictEqual(R.view(room, 'local', t).kind, kind);

  const f = R.newRoom('FRIEN', 'friends', { id: 'pA', name: 'Ibou' }, t);
  R.join(f, { id: 'pB', name: 'Awa' }, t);
  assert.throws(() => R.join(f, { id: 'pC', name: 'C' }, t), /complet/);
  R.act(f, 'pA', 'start', {}, t);
  assert.strictEqual(f.game.current().id, 'pA', "l'hôte commence");
  console.log(`✔ salons ${kind} : solo jusqu'à la fin (${room.game.isDraw ? 'nul' : room.game.winnerId === 'local' ? 'joueur' : 'système'}), « ${room.says[room.says.length - 1].text} »`);
}

console.log('✔ duels tests OK');
