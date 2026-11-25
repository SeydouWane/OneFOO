/**
 * Aligne 4 (fichier partagé navigateur + serveur) : règles + IA du système.
 *  - Grille de 7 colonnes × 6 rangées. Chacun à son tour lâche un jeton dans une colonne : il tombe tout en bas.
 *  - Le premier qui aligne 4 jetons (ligne, colonne ou diagonale) gagne ; grille pleine = match nul.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../core/rooms-core.js'), require('../core/duel-rooms.js'));
  else root.Aligne4Engine = factory(root.RoomsCore, root.DuelRooms);
})(typeof self !== 'undefined' ? self : this, function (Core, Duel) {
  'use strict';
  const { GameError } = Core;
  const COLS = 7;
  const ROWS = 6;
  const DIRS = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];
  const randomId = () => Math.random().toString(36).slice(2, 12);
  const otherMark = (m) => (m === 'X' ? 'O' : 'X');

  /** Rangée où tombe un jeton dans la colonne (ou -1 si pleine). */
  function dropRow(board, col) {
    for (let r = ROWS - 1; r >= 0; r--) if (board[r * COLS + col] === null) return r;
    return -1;
  }
  function lineAt(board, cell, mark) {
    const r0 = Math.floor(cell / COLS);
    const c0 = cell % COLS;
    for (const [dr, dc] of DIRS) {
      const line = [cell];
      for (const s of [1, -1]) {
        let r = r0 + dr * s;
        let c = c0 + dc * s;
        while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r * COLS + c] === mark) {
          line.push(r * COLS + c);
          r += dr * s;
          c += dc * s;
        }
      }
      if (line.length >= 4) return line.sort((a, b) => a - b);
    }
    return null;
  }
  /** Colonnes où `mark` gagnerait immédiatement. */
  function winningCols(board, mark) {
    const out = [];
    for (let c = 0; c < COLS; c++) {
      const r = dropRow(board, c);
      if (r < 0) continue;
      const i = r * COLS + c;
      board[i] = mark;
      if (lineAt(board, i, mark)) out.push(c);
      board[i] = null;
    }
    return out;
  }

  class Aligne4Game {
    constructor(players, opts = {}) {
      if (players.length !== 2) throw new GameError('Aligne 4 se joue à 2.');
      const starter = opts.starter === 1 ? 1 : 0;
      this.id = randomId();
      this.cols = COLS;
      this.rows = ROWS;
      this.players = players.map((p, i) => ({ id: p.id, name: p.name, avatar: p.avatar || '🙂', isBot: !!p.isBot, mark: i === starter ? 'X' : 'O' }));
      this.board = new Array(COLS * ROWS).fill(null);
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
    static fromJSON(d) {
      return Object.assign(Object.create(Aligne4Game.prototype), d);
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
      const out = [];
      for (let c = 0; c < COLS; c++) if (this.board[c] === null) out.push(c);
      return out;
    }

    play(playerId, col) {
      if (this.status !== 'playing') throw new GameError('La partie est terminée.');
      if (this.current().id !== playerId) throw new GameError("Ce n'est pas votre tour.");
      col = Number(col);
      if (!Number.isInteger(col) || col < 0 || col >= COLS) throw new GameError('Colonne invalide.');
      const row = dropRow(this.board, col);
      if (row < 0) throw new GameError('Cette colonne est pleine.');
      const me = this.current();
      const opp = this.players[1 - this.turn];
      const oppWinsBefore = winningCols(this.board, opp.mark);
      const cell = row * COLS + col;
      this.board[cell] = me.mark;
      this.moves++;
      this.lastMove = cell;
      this.log({ type: 'move', playerId, col, row, cell, mark: me.mark });
      const line = lineAt(this.board, cell, me.mark);
      if (line) {
        this.status = 'ended';
        this.winnerId = playerId;
        this.winLine = line;
        this.log({ type: 'win', playerId, line });
        return { ok: true };
      }
      if (this.moves === COLS * ROWS) {
        this.status = 'ended';
        this.isDraw = true;
        this.log({ type: 'draw' });
        return { ok: true };
      }
      if (oppWinsBefore.includes(col)) this.log({ type: 'block', playerId, target: opp.id });
      const threats = winningCols(this.board, me.mark).length;
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
        cols: COLS,
        rows: ROWS,
        board: this.board.slice(),
        players: this.players.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, isBot: p.isBot, mark: p.mark })),
        turnPlayerId: this.status === 'playing' ? this.current().id : null,
        turnSeq: this.turnSeq,
        winnerId: this.winnerId,
        winLine: this.winLine,
        isDraw: this.isDraw,
        lastMove: this.lastMove,
        myMark: me ? me.mark : null,
        legal: this.status === 'playing' ? this.legalMoves() : [],
        events: this.events.slice(-15),
      };
    }
  }

  // ------------------------------------------------------------------ IA
  function profile(level) {
    const lv = Core.clampLevel(level);
    const depth = [1, 2, 2, 3, 4, 5, 6, 6, 7, 7, 8][Math.min(lv, 11) - 1] || 8;
    const mistake = [0.45, 0.3, 0.18, 0.12, 0.08, 0.05, 0.03, 0.02, 0.01, 0.01, 0][Math.min(lv, 11) - 1] || 0;
    return { level: lv, depth, mistake, botStarts: lv >= 7, title: Core.levelTitle(lv), thinkMs: [450, 900], timeMs: 650 };
  }

  // Évaluation : fenêtres de 4 cases (plus il y a de jetons alignés et libres, mieux c'est) + colonne centrale
  const WINDOWS = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      for (const [dr, dc] of DIRS) {
        const cells = [];
        for (let k = 0; k < 4; k++) {
          const rr = r + dr * k;
          const cc = c + dc * k;
          if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) break;
          cells.push(rr * COLS + cc);
        }
        if (cells.length === 4) WINDOWS.push(cells);
      }
    }
  }
  function evaluate(board, mark) {
    const opp = otherMark(mark);
    let s = 0;
    for (const w of WINDOWS) {
      let a = 0;
      let b = 0;
      for (const i of w) {
        if (board[i] === mark) a++;
        else if (board[i] === opp) b++;
      }
      if (a && b) continue;
      if (a === 3) s += 50;
      else if (a === 2) s += 6;
      else if (b === 3) s -= 60;
      else if (b === 2) s -= 6;
    }
    for (let r = 0; r < ROWS; r++) {
      if (board[r * COLS + 3] === mark) s += 4;
      else if (board[r * COLS + 3] === opp) s -= 4;
    }
    return s;
  }
  const ORDER = [3, 2, 4, 1, 5, 0, 6];

  function chooseMove(game, botId, prof, rng = Math.random) {
    const me = game.player(botId).mark;
    const legal = game.legalMoves();
    // toujours : gagner si possible, sinon bloquer (sauf erreur aux bas niveaux)
    const wins = winningCols(game.board.slice(), me);
    if (wins.length && !(rng() < prof.mistake * 0.3)) return wins[0];
    const blocks = winningCols(game.board.slice(), otherMark(me));
    if (blocks.length && !(rng() < prof.mistake * 0.6)) return blocks[0];
    if (rng() < prof.mistake) return legal[Math.floor(rng() * legal.length)];
    const search = {
      moves: (s) => (s.winner ? [] : ORDER.filter((c) => s.board[c] === null)),
      apply(s, c) {
        const board = s.board.slice();
        const r = dropRow(board, c);
        const cell = r * COLS + c;
        board[cell] = s.toMove;
        const won = !!lineAt(board, cell, s.toMove);
        return { board, toMove: otherMark(s.toMove), winner: won ? s.toMove : null, filled: s.filled + 1 };
      },
      terminal(s) {
        if (s.winner) return s.winner === s.toMove ? 10000 : -10000;
        if (s.filled === COLS * ROWS) return 0;
        return null;
      },
      evaluate: (s) => evaluate(s.board, s.toMove),
    };
    const state = { board: game.board.slice(), toMove: me, winner: null, filled: game.moves };
    return Duel.searchBest(search, state, prof.depth, prof.timeMs || 650);
  }

  return { Aligne4Game, profile, chooseMove, winningCols, COLS, ROWS };
});
