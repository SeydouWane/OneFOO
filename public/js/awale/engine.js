/**
 * Awalé (règle "abapa") — fichier partagé navigateur + serveur : règles + IA du système.
 *  - 2 rangées de 6 cases, 4 graines par case (48 graines). Chacun possède la rangée de son côté.
 *  - On prend toutes les graines d'une de ses cases et on les sème une à une dans les cases suivantes,
 *    dans le sens inverse des aiguilles d'une montre (en sautant la case de départ si on fait le tour).
 *  - Si la dernière graine tombe chez l'adversaire et y fait 2 ou 3 graines, on les capture, ainsi que
 *    les cases précédentes de l'adversaire à 2 ou 3 graines (à la suite).
 *  - Interdit d'affamer : une prise qui ôterait toutes ses graines à l'adversaire ne capture rien.
 *  - Si l'adversaire n'a plus de graines, on doit jouer un coup qui lui en donne. Si c'est impossible,
 *    la partie s'arrête et on garde les graines de son côté.
 *  - Le premier qui capture 25 graines gagne (24 partout = match nul).
 * Cases : 0-5 = rangée du joueur 0 (de gauche à droite pour lui), 6-11 = rangée du joueur 1.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../core/rooms-core.js'), require('../core/duel-rooms.js'));
  else root.AwaleEngine = factory(root.RoomsCore, root.DuelRooms);
})(typeof self !== 'undefined' ? self : this, function (Core, Duel) {
  'use strict';
  const { GameError } = Core;
  const WIN = 25;
  const NO_CAPTURE_LIMIT = 100; // coups sans prise : on arrête (chacun garde ses graines)
  const randomId = () => Math.random().toString(36).slice(2, 12);
  const sideOf = (pit) => (pit < 6 ? 0 : 1);
  const rowOf = (side) => (side === 0 ? [0, 1, 2, 3, 4, 5] : [6, 7, 8, 9, 10, 11]);
  const seedsOn = (pits, side) => rowOf(side).reduce((s, i) => s + pits[i], 0);

  /** Joue la case `pit` pour `side` sur une copie : semis, prises, règle de la famine. */
  function simulate(pits, pit, side) {
    const p = pits.slice();
    let n = p[pit];
    p[pit] = 0;
    let i = pit;
    const touched = [];
    while (n > 0) {
      i = (i + 1) % 12;
      if (i === pit) continue;
      p[i]++;
      n--;
      touched.push(i);
    }
    let captured = [];
    let j = i;
    while (sideOf(j) !== side && (p[j] === 2 || p[j] === 3)) {
      captured.push(j);
      j--;
      if (j < 0 || sideOf(j) === side) break;
    }
    let gain = captured.reduce((s, k) => s + p[k], 0);
    let grandSlam = false;
    if (captured.length && gain === seedsOn(p, 1 - side)) {
      grandSlam = true; // prise interdite : elle affamerait l'adversaire
      captured = [];
      gain = 0;
    }
    for (const k of captured) p[k] = 0;
    return { pits: p, last: i, touched, captured, gain, grandSlam };
  }

  /** Coups autorisés pour `side` (règle : nourrir l'adversaire s'il n'a plus de graines). */
  function legalFor(pits, side) {
    const own = rowOf(side).filter((i) => pits[i] > 0);
    if (seedsOn(pits, 1 - side) > 0) return own;
    return own.filter((i) => seedsOn(simulate(pits, i, side).pits, 1 - side) > 0);
  }

  class AwaleGame {
    constructor(players, opts = {}) {
      if (players.length !== 2) throw new GameError("L'awalé se joue à 2.");
      const starter = opts.starter === 1 ? 1 : 0;
      this.id = randomId();
      // le joueur 0 de la partie (côté 0) est celui qui commence
      const ordered = starter === 1 ? [players[1], players[0]] : [players[0], players[1]];
      this.players = ordered.map((p, side) => ({ id: p.id, name: p.name, avatar: p.avatar || '🙂', isBot: !!p.isBot, side, mark: side === 0 ? 'X' : 'O' }));
      this.pits = new Array(12).fill(4);
      this.stores = [0, 0];
      this.turn = 0;
      this.turnSeq = 0;
      this.sinceCapture = 0;
      this.moves = 0;
      this.last = null; // { pit, touched, captured }
      this.status = 'playing';
      this.winnerId = null;
      this.isDraw = false;
      this.endReason = null;
      this.events = [];
      this.eventSeq = 0;
      this.log({ type: 'start', playerId: this.players[0].id });
    }
    toJSON() {
      return Object.assign({}, this);
    }
    static fromJSON(d) {
      return Object.assign(Object.create(AwaleGame.prototype), d);
    }
    current() {
      return this.players[this.turn];
    }
    player(id) {
      return this.players.find((p) => p.id === id) || null;
    }
    log(e) {
      e.seq = ++this.eventSeq;
      this.events.push(e);
      if (this.events.length > 30) this.events.shift();
    }
    checkEnd() {
      return this.status !== 'playing';
    }
    legalMoves() {
      return this.status === 'playing' ? legalFor(this.pits, this.turn) : [];
    }

    finish(reason) {
      this.status = 'ended';
      this.endReason = reason;
      const [a, b] = this.stores;
      if (a === b) this.isDraw = true;
      else this.winnerId = this.players[a > b ? 0 : 1].id;
      this.log(this.isDraw ? { type: 'draw', reason } : { type: 'win', playerId: this.winnerId, reason });
    }

    play(playerId, pit) {
      if (this.status !== 'playing') throw new GameError('La partie est terminée.');
      if (this.current().id !== playerId) throw new GameError("Ce n'est pas votre tour.");
      pit = Number(pit);
      const side = this.turn;
      if (!Number.isInteger(pit) || sideOf(pit) !== side) throw new GameError('Choisissez une case de votre côté.');
      if (!this.pits[pit]) throw new GameError('Cette case est vide.');
      if (!legalFor(this.pits, side).includes(pit)) throw new GameError("Votre adversaire n'a plus de graines : vous devez lui en donner.");
      const seeds = this.pits[pit];
      const r = simulate(this.pits, pit, side);
      this.pits = r.pits;
      this.moves++;
      this.last = { pit, touched: r.touched, captured: r.captured };
      this.log({ type: 'sow', playerId, pit, seeds });
      if (r.gain) {
        this.stores[side] += r.gain;
        this.sinceCapture = 0;
        this.log({ type: 'capture', playerId, count: r.gain, pits: r.captured, target: this.players[1 - side].id });
      } else {
        this.sinceCapture++;
        if (r.grandSlam) this.log({ type: 'grandslam', playerId });
      }
      if (this.stores[side] >= WIN) return this.finish('score'), { ok: true };

      this.turn = 1 - side;
      this.turnSeq++;
      // Le joueur suivant peut-il jouer ?
      if (!legalFor(this.pits, this.turn).length) {
        const next = this.turn;
        if (seedsOn(this.pits, next) > 0) {
          // il ne peut pas nourrir l'adversaire : il garde ses graines
          this.stores[next] += seedsOn(this.pits, next);
        } else {
          this.stores[1 - next] += seedsOn(this.pits, 1 - next);
        }
        this.pits = new Array(12).fill(0);
        return this.finish('famine'), { ok: true };
      }
      if (this.sinceCapture >= NO_CAPTURE_LIMIT) {
        this.stores[0] += seedsOn(this.pits, 0);
        this.stores[1] += seedsOn(this.pits, 1);
        this.pits = new Array(12).fill(0);
        return this.finish('limit'), { ok: true };
      }
      return { ok: true };
    }

    viewFor(viewerId) {
      const me = this.player(viewerId);
      return {
        id: this.id,
        status: this.status,
        pits: this.pits.slice(),
        stores: this.stores.slice(),
        players: this.players.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, isBot: p.isBot, side: p.side, mark: p.mark, captured: this.stores[p.side] })),
        turnPlayerId: this.status === 'playing' ? this.current().id : null,
        turnSeq: this.turnSeq,
        winnerId: this.winnerId,
        isDraw: this.isDraw,
        endReason: this.endReason,
        mySide: me ? me.side : 0,
        legal: this.legalMoves(),
        last: this.last,
        events: this.events.slice(-15),
      };
    }
  }

  // ------------------------------------------------------------------ IA
  function profile(level) {
    const lv = Core.clampLevel(level);
    const i = Math.min(lv, 11) - 1;
    return {
      level: lv,
      depth: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11][i],
      mistake: [0.4, 0.25, 0.15, 0.1, 0.06, 0.04, 0.02, 0.01, 0.01, 0, 0][i],
      botStarts: lv >= 7,
      title: Core.levelTitle(lv),
      thinkMs: [500, 950],
      timeMs: 700,
    };
  }

  function chooseMove(game, botId, prof, rng = Math.random) {
    const side = game.player(botId).side;
    const legal = legalFor(game.pits, side);
    if (rng() < prof.mistake) return legal[Math.floor(rng() * legal.length)];
    const search = {
      moves: (s) => (s.over ? [] : legalFor(s.pits, s.toMove)),
      apply(s, pit) {
        const r = simulate(s.pits, pit, s.toMove);
        const stores = s.stores.slice();
        stores[s.toMove] += r.gain;
        const since = r.gain ? 0 : s.since + 1;
        const next = { pits: r.pits, stores, toMove: 1 - s.toMove, since, over: false };
        if (stores[s.toMove] >= WIN) next.over = true;
        else if (!legalFor(next.pits, next.toMove).length || since >= NO_CAPTURE_LIMIT) {
          next.stores = stores.slice();
          if (since >= NO_CAPTURE_LIMIT) {
            next.stores[0] += seedsOn(next.pits, 0);
            next.stores[1] += seedsOn(next.pits, 1);
          } else if (seedsOn(next.pits, next.toMove) > 0) next.stores[next.toMove] += seedsOn(next.pits, next.toMove);
          else next.stores[1 - next.toMove] += seedsOn(next.pits, 1 - next.toMove);
          next.over = true;
        }
        return next;
      },
      terminal(s) {
        if (!s.over) return null;
        const d = s.stores[s.toMove] - s.stores[1 - s.toMove];
        return d > 0 ? 10000 : d < 0 ? -10000 : 0;
      },
      evaluate(s) {
        const me = s.toMove;
        return (s.stores[me] - s.stores[1 - me]) * 10 + (seedsOn(s.pits, me) - seedsOn(s.pits, 1 - me)) * 0.3;
      },
      order: (s, moves) => moves.slice().sort((a, b) => simulate(s.pits, b, s.toMove).gain - simulate(s.pits, a, s.toMove).gain),
    };
    const state = { pits: game.pits.slice(), stores: game.stores.slice(), toMove: side, since: game.sinceCapture, over: false };
    return Duel.searchBest(search, state, prof.depth, prof.timeMs || 700);
  }

  return { AwaleGame, profile, chooseMove, simulate, legalFor, seedsOn, WIN };
});
