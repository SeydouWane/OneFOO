/**
 * Jeu de dames international (10×10) — fichier partagé navigateur + serveur : règles + IA du système.
 *  - 20 pions chacun sur les cases foncées. Les blancs (en bas) commencent.
 *  - Les pions avancent d'une case en diagonale ; ils prennent en sautant une pièce adverse, en avant ET en arrière.
 *  - La prise est obligatoire, et il faut choisir la rafle qui prend le PLUS de pièces (règle de la majorité).
 *  - Pendant une rafle, on ne saute pas deux fois la même pièce ; les pièces prises sont retirées à la fin.
 *  - Un pion qui TERMINE son coup sur la dernière rangée devient une dame : elle se déplace et prend à distance.
 *  - Celui qui n'a plus de pièce ou ne peut plus jouer a perdu. 25 coups de chaque côté sans prise ni
 *    mouvement de pion = match nul.
 * Cases : index r*10+c (r=0 en haut). Pièces : 'w' / 'W' (blancs, côté 0), 'b' / 'B' (noirs, côté 1).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../core/rooms-core.js'), require('../core/duel-rooms.js'));
  else root.DamesEngine = factory(root.RoomsCore, root.DuelRooms);
})(typeof self !== 'undefined' ? self : this, function (Core, Duel) {
  'use strict';
  const { GameError } = Core;
  const N = 10;
  const DIRS = [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ];
  const QUIET_LIMIT = 50; // 25 coups de chaque côté sans prise ni mouvement de pion
  const randomId = () => Math.random().toString(36).slice(2, 12);
  const inside = (r, c) => r >= 0 && r < N && c >= 0 && c < N;
  const isKing = (p) => p === 'W' || p === 'B';
  const sideOfPiece = (p) => (p === 'w' || p === 'W' ? 0 : p === 'b' || p === 'B' ? 1 : -1);
  const isOpp = (p, side) => p !== null && sideOfPiece(p) === 1 - side;

  function initialBoard() {
    const b = new Array(N * N).fill(null);
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if ((r + c) % 2 !== 1) continue;
        if (r <= 3) b[r * N + c] = 'b';
        else if (r >= 6) b[r * N + c] = 'w';
      }
    }
    return b;
  }

  /** Toutes les rafles possibles d'une pièce (on ne garde que les fins de rafle). */
  function captureSequences(board, from, side) {
    const king = isKing(board[from]);
    const out = [];
    const free = (i, captured) => i === from || (board[i] === null && !captured.includes(i));
    function dfs(pos, captured, path) {
      let extended = false;
      const r0 = Math.floor(pos / N);
      const c0 = pos % N;
      for (const [dr, dc] of DIRS) {
        if (!king) {
          const r1 = r0 + dr;
          const c1 = c0 + dc;
          const r2 = r1 + dr;
          const c2 = c1 + dc;
          if (!inside(r2, c2)) continue;
          const mid = r1 * N + c1;
          const land = r2 * N + c2;
          if (isOpp(board[mid], side) && !captured.includes(mid) && (board[land] === null || land === from)) {
            extended = true;
            dfs(land, captured.concat(mid), path.concat(land));
          }
        } else {
          // dame volante : glisse sur les cases vides, saute une pièce adverse, atterrit plus loin
          let r1 = r0 + dr;
          let c1 = c0 + dc;
          while (inside(r1, c1) && (board[r1 * N + c1] === null || r1 * N + c1 === from)) {
            r1 += dr;
            c1 += dc;
          }
          if (!inside(r1, c1)) continue;
          const mid = r1 * N + c1;
          if (!isOpp(board[mid], side) || captured.includes(mid)) continue;
          let r2 = r1 + dr;
          let c2 = c1 + dc;
          while (inside(r2, c2) && free(r2 * N + c2, captured)) {
            extended = true;
            dfs(r2 * N + c2, captured.concat(mid), path.concat(r2 * N + c2));
            r2 += dr;
            c2 += dc;
          }
        }
      }
      if (!extended && captured.length) out.push({ from, to: pos, path, captures: captured });
    }
    dfs(from, [], [from]);
    return out;
  }

  /** Coups légaux du camp `side` (prise obligatoire et maximale). */
  function legalMoves(board, side) {
    let caps = [];
    for (let i = 0; i < N * N; i++) if (sideOfPiece(board[i]) === side) caps = caps.concat(captureSequences(board, i, side));
    if (caps.length) {
      const max = Math.max(...caps.map((m) => m.captures.length));
      const seen = new Set();
      return caps.filter((m) => {
        if (m.captures.length !== max) return false;
        const key = `${m.from}>${m.to}:${m.captures.slice().sort((a, b) => a - b).join(',')}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    const moves = [];
    const fwd = side === 0 ? -1 : 1;
    for (let i = 0; i < N * N; i++) {
      const p = board[i];
      if (sideOfPiece(p) !== side) continue;
      const r0 = Math.floor(i / N);
      const c0 = i % N;
      for (const [dr, dc] of DIRS) {
        if (!isKing(p)) {
          if (dr !== fwd) continue;
          const r = r0 + dr;
          const c = c0 + dc;
          if (inside(r, c) && board[r * N + c] === null) moves.push({ from: i, to: r * N + c, path: [i, r * N + c], captures: [] });
        } else {
          let r = r0 + dr;
          let c = c0 + dc;
          while (inside(r, c) && board[r * N + c] === null) {
            moves.push({ from: i, to: r * N + c, path: [i, r * N + c], captures: [] });
            r += dr;
            c += dc;
          }
        }
      }
    }
    return moves;
  }

  function applyMove(board, m) {
    const b = board.slice();
    let p = b[m.from];
    b[m.from] = null;
    for (const k of m.captures) b[k] = null;
    const r = Math.floor(m.to / N);
    let promoted = false;
    if (p === 'w' && r === 0) {
      p = 'W';
      promoted = true;
    } else if (p === 'b' && r === N - 1) {
      p = 'B';
      promoted = true;
    }
    b[m.to] = p;
    return { board: b, promoted, wasMan: !isKing(board[m.from]) };
  }

  class DamesGame {
    constructor(players, opts = {}) {
      if (players.length !== 2) throw new GameError('Les dames se jouent à 2.');
      const starter = opts.starter === 1 ? 1 : 0;
      const ordered = starter === 1 ? [players[1], players[0]] : [players[0], players[1]];
      this.id = randomId();
      // côté 0 = blancs (en bas, commencent), côté 1 = noirs
      this.players = ordered.map((p, side) => ({ id: p.id, name: p.name, avatar: p.avatar || '🙂', isBot: !!p.isBot, side, mark: side === 0 ? 'X' : 'O' }));
      this.board = initialBoard();
      this.turn = 0;
      this.turnSeq = 0;
      this.quiet = 0;
      this.moves = 0;
      this.lastMove = null;
      this.status = 'playing';
      this.winnerId = null;
      this.isDraw = false;
      this.events = [];
      this.eventSeq = 0;
      this.log({ type: 'start', playerId: this.players[0].id });
    }
    toJSON() {
      return Object.assign({}, this);
    }
    static fromJSON(d) {
      return Object.assign(Object.create(DamesGame.prototype), d);
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
      return this.status === 'playing' ? legalMoves(this.board, this.turn) : [];
    }

    /** move = { from, to, path? } (le chemin départage deux rafles différentes vers la même case) */
    play(playerId, move) {
      if (this.status !== 'playing') throw new GameError('La partie est terminée.');
      if (this.current().id !== playerId) throw new GameError("Ce n'est pas votre tour.");
      if (!move || typeof move !== 'object') throw new GameError('Coup invalide.');
      const legal = legalMoves(this.board, this.turn);
      const from = Number(move.from);
      const to = Number(move.to);
      let candidates = legal.filter((m) => m.from === from && m.to === to);
      if (!candidates.length) {
        const mustTake = legal.length && legal[0].captures.length;
        throw new GameError(mustTake ? `Prise obligatoire : vous devez prendre ${legal[0].captures.length} pièce${legal[0].captures.length > 1 ? 's' : ''}.` : 'Ce déplacement est interdit.');
      }
      if (candidates.length > 1 && Array.isArray(move.path)) {
        const exact = candidates.find((m) => m.path.join(',') === move.path.map(Number).join(','));
        if (exact) candidates = [exact];
      }
      const m = candidates[0];
      const side = this.turn;
      const r = applyMove(this.board, m);
      this.board = r.board;
      this.moves++;
      this.lastMove = { from: m.from, to: m.to, path: m.path, captures: m.captures };
      this.quiet = m.captures.length || r.wasMan ? 0 : this.quiet + 1;
      const opp = this.players[1 - side];
      this.log({ type: 'move', playerId, from: m.from, to: m.to, captures: m.captures.length, promote: r.promoted });
      if (m.captures.length) this.log({ type: 'capture', playerId, count: m.captures.length, target: opp.id });
      if (r.promoted) this.log({ type: 'promote', playerId, target: opp.id });

      this.turn = 1 - side;
      this.turnSeq++;
      if (!legalMoves(this.board, this.turn).length) {
        this.status = 'ended';
        this.winnerId = playerId;
        this.log({ type: 'win', playerId, reason: this.board.some((p) => sideOfPiece(p) === this.turn) ? 'bloqué' : 'plus de pièces' });
      } else if (this.quiet >= QUIET_LIMIT) {
        this.status = 'ended';
        this.isDraw = true;
        this.log({ type: 'draw' });
      }
      return { ok: true };
    }

    counts() {
      const c = [0, 0];
      for (const p of this.board) if (p) c[sideOfPiece(p)]++;
      return c;
    }

    viewFor(viewerId) {
      const me = this.player(viewerId);
      const myTurn = this.status === 'playing' && me && this.current().id === viewerId;
      const counts = this.counts();
      return {
        id: this.id,
        status: this.status,
        board: this.board.slice(),
        players: this.players.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, isBot: p.isBot, side: p.side, mark: p.mark, pieces: counts[p.side] })),
        turnPlayerId: this.status === 'playing' ? this.current().id : null,
        turnSeq: this.turnSeq,
        winnerId: this.winnerId,
        isDraw: this.isDraw,
        mySide: me ? me.side : 0,
        legal: myTurn ? legalMoves(this.board, this.turn) : [],
        lastMove: this.lastMove,
        quiet: this.quiet,
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
      depth: [1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6][i],
      mistake: [0.35, 0.2, 0.12, 0.08, 0.05, 0.03, 0.02, 0.01, 0.01, 0, 0][i],
      botStarts: lv >= 8,
      title: Core.levelTitle(lv),
      thinkMs: [500, 950],
      timeMs: 800,
    };
  }

  function evaluate(board, side) {
    let s = 0;
    for (let i = 0; i < N * N; i++) {
      const p = board[i];
      if (!p) continue;
      const ps = sideOfPiece(p);
      const r = Math.floor(i / N);
      const c = i % N;
      let v;
      if (isKing(p)) v = 3.2;
      else {
        const adv = ps === 0 ? 9 - r : r; // rangées avancées
        v = 1 + adv * 0.04 + (c >= 2 && c <= 7 ? 0.03 : 0) + ((ps === 0 && r === 9) || (ps === 1 && r === 0) ? 0.05 : 0);
      }
      s += ps === side ? v : -v;
    }
    return s * 100;
  }

  function chooseMove(game, botId, prof, rng = Math.random) {
    const side = game.player(botId).side;
    const legal = legalMoves(game.board, side);
    if (legal.length === 1) return legal[0];
    if (rng() < prof.mistake) return legal[Math.floor(rng() * legal.length)];
    const search = {
      moves: (s) => legalMoves(s.board, s.toMove),
      apply(s, m) {
        const r = applyMove(s.board, m);
        return { board: r.board, toMove: 1 - s.toMove, quiet: m.captures.length || r.wasMan ? 0 : s.quiet + 1 };
      },
      terminal(s) {
        if (s.quiet >= QUIET_LIMIT) return 0;
        if (!legalMoves(s.board, s.toMove).length) return -10000;
        return null;
      },
      evaluate: (s) => evaluate(s.board, s.toMove),
      order: (s, moves) => moves.slice().sort((a, b) => b.captures.length - a.captures.length),
    };
    const state = { board: game.board.slice(), toMove: side, quiet: game.quiet };
    return Duel.searchBest(search, state, prof.depth, prof.timeMs || 800);
  }

  return { DamesGame, profile, chooseMove, legalMoves, applyMove, initialBoard, N };
});
