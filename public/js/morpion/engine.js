/**
 * Morpion (fichier partagé navigateur + serveur) : règles + IA du système.
 *  - 2 joueurs : ✕ (commence) et ◯, chacun pose une marque à son tour.
 *  - Le premier qui aligne `align` marques (ligne, colonne ou diagonale) gagne ; grille pleine = match nul.
 *  - Variantes : 3×3 (aligner 3), 6×6 (aligner 4), 9×9 (aligner 5).
 * Contre le système, la grille grandit avec le niveau (3×3 → 6×6 → 9×9).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../core/rooms-core.js'));
  else root.MorpionEngine = factory(root.RoomsCore);
})(typeof self !== 'undefined' ? self : this, function (Core) {
  'use strict';
  const { GameError } = Core;

  const VARIANTS = {
    3: { size: 3, align: 3, label: '3×3 · aligner 3' },
    6: { size: 6, align: 4, label: '6×6 · aligner 4' },
    9: { size: 9, align: 5, label: '9×9 · aligner 5' },
  };
  const variant = (size) => VARIANTS[size] || VARIANTS[3];
  const DIRS = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];
  const randomId = (len = 10) => {
    let s = '';
    for (let i = 0; i < len; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)];
    return s;
  };

  // ------------------------------------------------------------------ outils de grille
  /** Cases d'un alignement gagnant passant par `cell` pour `mark` (ou null). */
  function winLine(board, size, align, cell, mark) {
    const r0 = Math.floor(cell / size);
    const c0 = cell % size;
    for (const [dr, dc] of DIRS) {
      const line = [cell];
      for (const s of [1, -1]) {
        let r = r0 + dr * s;
        let c = c0 + dc * s;
        while (r >= 0 && r < size && c >= 0 && c < size && board[r * size + c] === mark) {
          line.push(r * size + c);
          r += dr * s;
          c += dc * s;
        }
      }
      if (line.length >= align) return line.sort((a, b) => a - b);
    }
    return null;
  }

  /** Cases vides où `mark` gagnerait immédiatement. */
  function winningCells(board, size, align, mark) {
    const out = [];
    for (let i = 0; i < board.length; i++) {
      if (board[i] !== null) continue;
      board[i] = mark;
      if (winLine(board, size, align, i, mark)) out.push(i);
      board[i] = null;
    }
    return out;
  }

  // ------------------------------------------------------------------ partie
  class MorpionGame {
    /**
     * @param {{id,name,avatar?,isBot?}[]} players exactement 2
     * @param {{size?:number, starter?:0|1}} opts starter = indice du joueur qui a ✕ et commence
     */
    constructor(players, opts = {}) {
      if (players.length !== 2) throw new GameError('Le morpion se joue à 2.');
      const v = variant(opts.size);
      this.id = randomId();
      this.size = v.size;
      this.align = v.align;
      const starter = opts.starter === 1 ? 1 : 0;
      this.players = players.map((p, i) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar || '🙂',
        isBot: !!p.isBot,
        mark: i === starter ? 'X' : 'O',
      }));
      this.board = new Array(v.size * v.size).fill(null);
      this.turn = starter;
      this.turnSeq = 0;
      this.moves = 0;
      this.lastMove = null;
      this.status = 'playing';
      this.winnerId = null;
      this.winLine = null;
      this.isDraw = false;
      this.events = [];
      this.eventSeq = 0;
      this.log({ type: 'start', playerId: this.players[starter].id });
    }

    toJSON() {
      return Object.assign({}, this);
    }
    static fromJSON(data) {
      return Object.assign(Object.create(MorpionGame.prototype), data);
    }

    current() {
      return this.players[this.turn];
    }
    player(id) {
      return this.players.find((p) => p.id === id) || null;
    }
    opponentOf(id) {
      return this.players.find((p) => p.id !== id) || null;
    }
    log(evt) {
      evt.seq = ++this.eventSeq;
      this.events.push(evt);
      if (this.events.length > 30) this.events.shift();
    }
    /** Compatibilité avec le socle des salons (un joueur qui part est remplacé par un bot). */
    checkEnd() {
      return this.status !== 'playing';
    }
    legalMoves() {
      const out = [];
      for (let i = 0; i < this.board.length; i++) if (this.board[i] === null) out.push(i);
      return out;
    }

    play(playerId, cell) {
      if (this.status !== 'playing') throw new GameError('La partie est terminée.');
      if (this.current().id !== playerId) throw new GameError("Ce n'est pas votre tour.");
      cell = Number(cell);
      if (!Number.isInteger(cell) || cell < 0 || cell >= this.board.length) throw new GameError('Case invalide.');
      if (this.board[cell] !== null) throw new GameError('Cette case est déjà prise.');
      const me = this.current();
      const opp = this.opponentOf(playerId);
      const oppWinsBefore = winningCells(this.board, this.size, this.align, opp.mark);

      this.board[cell] = me.mark;
      this.moves++;
      this.lastMove = cell;
      this.log({ type: 'move', playerId, cell, mark: me.mark });

      const line = winLine(this.board, this.size, this.align, cell, me.mark);
      if (line) {
        this.status = 'ended';
        this.winnerId = playerId;
        this.winLine = line;
        this.log({ type: 'win', playerId, line });
        return { ok: true, won: true };
      }
      if (this.moves === this.board.length) {
        this.status = 'ended';
        this.isDraw = true;
        this.log({ type: 'draw' });
        return { ok: true, draw: true };
      }
      if (oppWinsBefore.includes(cell)) this.log({ type: 'block', playerId, target: opp.id });
      const threats = winningCells(this.board, this.size, this.align, me.mark).length;
      if (threats) this.log({ type: 'threat', playerId, count: threats, target: opp.id });

      this.turn = 1 - this.turn;
      this.turnSeq++;
      return { ok: true };
    }

    viewFor(viewerId) {
      const me = this.player(viewerId);
      return {
        id: this.id,
        status: this.status,
        size: this.size,
        align: this.align,
        board: this.board.slice(),
        players: this.players.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, isBot: p.isBot, mark: p.mark })),
        turnPlayerId: this.status === 'playing' ? this.current().id : null,
        turnSeq: this.turnSeq,
        winnerId: this.winnerId,
        winLine: this.winLine,
        isDraw: this.isDraw,
        lastMove: this.lastMove,
        myMark: me ? me.mark : null,
        events: this.events.slice(-15),
      };
    }
  }

  // ------------------------------------------------------------------ IA du système
  const TITLES = [[1, 'Débutant'], [2, 'Apprenti'], [4, 'Joueur'], [6, 'Confirmé'], [9, 'Expert'], [12, 'Maître'], [15, 'Légende']];
  const levelTitle = (lv) => TITLES.reduce((t, [min, name]) => (lv >= min ? name : t), TITLES[0][1]);

  /**
   * Le niveau fixe la grille, le taux d'erreurs du système, sa finesse (repérer les doubles menaces)
   * et qui commence (commencer est un gros avantage sur les grandes grilles).
   */
  function profile(level) {
    const lv = Core.clampLevel(level);
    let size;
    let mistake;
    let lookahead = false;
    let botStarts = false;
    if (lv <= 4) {
      size = 3;
      mistake = [0.55, 0.35, 0.2, 0.1][lv - 1];
    } else if (lv <= 8) {
      size = 6;
      mistake = [0.3, 0.2, 0.12, 0.06][lv - 5];
      lookahead = lv >= 7;
      botStarts = lv >= 7;
    } else {
      size = 9;
      mistake = Math.max(0.01, 0.2 - (lv - 9) * 0.03);
      lookahead = lv >= 11;
      botStarts = lv >= 12;
    }
    return { level: lv, size, align: variant(size).align, mistake, lookahead, botStarts, title: levelTitle(lv), thinkMs: [550, 1100] };
  }

  /** Minimax parfait pour la grille 3×3 (mémorisé). Score du point de vue de `me`. */
  function minimax(board, toPlay, me, opp, memo) {
    const key = board.map((c) => c || '.').join('') + toPlay;
    if (memo.has(key)) return memo.get(key);
    let best = toPlay === me ? -Infinity : Infinity;
    let any = false;
    for (let i = 0; i < 9; i++) {
      if (board[i] !== null) continue;
      any = true;
      board[i] = toPlay;
      let score;
      if (winLine(board, 3, 3, i, toPlay)) score = toPlay === me ? 10 - countMarks(board) * 0.01 : -10 + countMarks(board) * 0.01;
      else score = minimax(board, toPlay === me ? opp : me, me, opp, memo);
      board[i] = null;
      best = toPlay === me ? Math.max(best, score) : Math.min(best, score);
    }
    if (!any) best = 0;
    memo.set(key, best);
    return best;
  }
  const countMarks = (b) => b.reduce((n, c) => n + (c ? 1 : 0), 0);

  /** Valeur d'une case pour `mark` sur les grandes grilles : alignements possibles et extrémités libres. */
  function cellValue(board, size, align, cell, mark) {
    const r0 = Math.floor(cell / size);
    const c0 = cell % size;
    let total = 0;
    for (const [dr, dc] of DIRS) {
      let count = 1;
      let open = 0;
      let span = 1;
      for (const s of [1, -1]) {
        let r = r0 + dr * s;
        let c = c0 + dc * s;
        while (r >= 0 && r < size && c >= 0 && c < size && board[r * size + c] === mark) {
          count++;
          span++;
          r += dr * s;
          c += dc * s;
        }
        if (r >= 0 && r < size && c >= 0 && c < size && board[r * size + c] === null) {
          open++;
          // place disponible au-delà (pour savoir si l'alignement complet reste possible)
          let rr = r;
          let cc = c;
          while (span < align && rr >= 0 && rr < size && cc >= 0 && cc < size && board[rr * size + cc] !== otherMark(mark)) {
            span++;
            rr += dr * s;
            cc += dc * s;
          }
        }
      }
      if (count >= align) return 1e9;
      if (span < align) continue; // alignement impossible dans cette direction
      total += Math.pow(10, count) * (open === 2 ? 1 : open === 1 ? 0.3 : 0.02);
    }
    return total;
  }
  const otherMark = (m) => (m === 'X' ? 'O' : 'X');

  function candidates(board, size) {
    const out = [];
    const any = board.some((c) => c !== null);
    if (!any) return [Math.floor(size / 2) * size + Math.floor(size / 2)];
    for (let i = 0; i < board.length; i++) {
      if (board[i] !== null) continue;
      const r = Math.floor(i / size);
      const c = i % size;
      let near = false;
      for (let dr = -2; dr <= 2 && !near; dr++) {
        for (let dc = -2; dc <= 2 && !near; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 0 && rr < size && cc >= 0 && cc < size && board[rr * size + cc] !== null) near = true;
        }
      }
      if (near) out.push(i);
    }
    return out;
  }

  /** Choisit la case du bot. Avec une probabilité `mistake`, il joue un coup plus faible. */
  function chooseMove(game, botId, prof, rng = Math.random) {
    const me = game.player(botId).mark;
    const opp = otherMark(me);
    const { board, size, align } = game;
    const empties = [];
    for (let i = 0; i < board.length; i++) if (board[i] === null) empties.push(i);
    const mistake = rng() < prof.mistake;

    if (size === 3) {
      if (mistake) return empties[Math.floor(rng() * empties.length)];
      const memo = new Map();
      let best = -Infinity;
      let bestCells = [];
      const b = board.slice();
      for (const i of empties) {
        b[i] = me;
        const s = winLine(b, 3, 3, i, me) ? 100 : minimax(b, opp, me, opp, memo);
        b[i] = null;
        if (s > best + 1e-9) {
          best = s;
          bestCells = [i];
        } else if (Math.abs(s - best) <= 1e-9) bestCells.push(i);
      }
      return bestCells[Math.floor(rng() * bestCells.length)];
    }

    // Grandes grilles : gagner, sinon bloquer, sinon le meilleur alignement
    const wins = winningCells(board.slice(), size, align, me);
    if (wins.length && !(mistake && rng() < 0.3)) return wins[0];
    const blocks = winningCells(board.slice(), size, align, opp);
    if (blocks.length && !(mistake && rng() < 0.5)) return blocks[0];
    const b = board.slice();
    const scored = candidates(board, size).map((i) => {
      const center = (size - 1) / 2;
      const r = Math.floor(i / size);
      const c = i % size;
      const bias = -(Math.abs(r - center) + Math.abs(c - center)) * 0.5;
      let s = cellValue(board, size, align, i, me) * 1.1 + cellValue(board, size, align, i, opp) + bias + rng() * 3;
      if (prof.lookahead && !mistake) {
        // Double menace : deux façons de gagner au coup suivant = victoire assurée (pour nous ou pour l'adversaire)
        b[i] = me;
        if (winningCells(b, size, align, me).length >= 2) s += 5e7;
        b[i] = opp;
        if (winningCells(b, size, align, opp).length >= 2) s += 2e7;
        b[i] = null;
      }
      return { i, s };
    });
    scored.sort((a, b) => b.s - a.s);
    if (mistake) {
      const top = scored.slice(0, Math.min(6, scored.length));
      return top[Math.floor(rng() * top.length)].i;
    }
    return scored[0].i;
  }

  return { MorpionGame, VARIANTS, variant, profile, levelTitle, chooseMove, winLine, winningCells };
});
