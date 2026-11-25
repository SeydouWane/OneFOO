/**
 * Modèle commun des salons pour les jeux à 2 joueurs au tour par tour (Morpion, Aligne 4, Awalé, Dames…).
 * Fichier partagé navigateur + serveur, construit sur RoomsCore.
 *
 * Un jeu fournit :
 *  - kind, Game : classe de partie { constructor(players, opts), static fromJSON, play(pid, move), legalMoves(),
 *                 current(), player(id), checkEnd(), viewFor(pid), status, winnerId, isDraw, turnSeq, events }
 *  - profile(level, options) -> { mistake, thinkMs, botStarts, ... } : réglages du système selon le niveau
 *  - chooseMove(game, botId, prof, rng) -> coup du système
 *  - lines : répliques taquines (start, botWin, humanWin, draw, humanIdle + celles du jeu)
 *  - banterEvent(e, ctx) : réactions propres au jeu (ctx.add(key, speaker, target, prio, prob))
 *  - makeOptions(mode, level, opts) / setOptions(room, data) : options de partie (facultatif)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rooms-core.js'));
  else root.DuelRooms = factory(root.RoomsCore);
})(typeof self !== 'undefined' ? self : this, function (Core) {
  'use strict';
  const { GameError, TURN_MS, OFFLINE_TURN_MS, OFFLINE_AFTER_MS, pick, status, player, notice, emote } = Core;
  const IDLE_TEASE_MS = 15000;

  function create(def) {
    const MAX_PLAYERS = 2;

    function newRoom(code, mode, host, now, opts = {}) {
      const level = Core.clampLevel(opts.level || 1);
      const options = def.makeOptions ? def.makeOptions(mode, level, opts) : {};
      return Core.newRoom(code, def.kind, mode, host, now, { level, botLevel: def.botLevel || 7, options, starter: 0 });
    }

    function newSoloRoom(code, host, now, level) {
      const room = newRoom(code, 'solo', host, now, { level });
      Core.addBot(room);
      return room;
    }

    const profileOf = (room) => def.profile(room.mode === 'solo' ? room.level : room.botLevel, room.options || {});

    function startGame(room, now) {
      if (room.players.length < 2) throw new GameError('Il faut 2 joueurs (ajoutez un bot ou invitez un ami).');
      const players = room.players.slice(0, 2).map(({ id, name, avatar, isBot }) => ({ id, name, avatar, isBot }));
      // Contre le système : vous commencez, sauf aux niveaux élevés ; entre amis, on alterne à chaque manche.
      let starter = room.mode === 'solo' && profileOf(room).botStarts ? 1 : 0;
      if (room.mode === 'friends') {
        starter = room.game ? 1 - (room.starter || 0) : room.starter || 0;
        room.starter = starter;
      }
      room.game = new def.Game(players, Object.assign({}, room.options, { starter }));
      room.timerKey = null;
      room.dueAt = null;
      room.turnDeadline = null;
      room.updatedAt = now;
    }

    const join = (room, p, now) => Core.join(room, p, now, MAX_PLAYERS);
    const leave = (room, pid) => Core.leave(room, pid);
    const touch = Core.touch;

    function act(room, pid, action, data, now) {
      const common = Core.actCommon(room, pid, action, data, now, { maxPlayers: MAX_PLAYERS, start: startGame });
      if (common.handled) return common.result;
      switch (action) {
        case 'options':
          if (!def.setOptions) throw new GameError('Pas d’options pour ce jeu.');
          if (room.mode === 'friends' && room.hostId !== pid) throw new GameError("Action réservée à l'hôte.");
          if (status(room) === 'playing') throw new GameError('Partie en cours.');
          def.setOptions(room, data);
          return;
        case 'move':
          if (!room.game) throw new GameError('Aucune partie en cours.');
          room.game.play(pid, data.move !== undefined ? data.move : data.cell);
          return;
        default:
          throw new GameError('Action inconnue.');
      }
    }

    // ---------------------------------------------------------------- le système taquin
    function banter(room, now, rng) {
      const g = room.game;
      if (!g) return false;
      const speakers = room.players.filter((p) => p.isBot && !p.replaced && g.player(p.id));
      if (!speakers.length) return false;
      let changed = false;
      if (room.banterGame !== g.id) {
        room.banterGame = g.id;
        room.banterSeq = 0;
        changed = true;
      }
      const isHuman = (id) => !!id && room.players.some((p) => p.id === id && !p.isBot);
      const isSpeaker = (id) => !!id && speakers.some((s) => s.id === id);
      const nameOf = (id) => {
        const p = player(room, id) || g.player(id);
        return p ? p.name : '';
      };
      const anyBot = () => pick(speakers, rng).id;
      const firstHuman = (room.players.find((p) => !p.isBot) || {}).id;
      const cands = [];
      const add = (key, speaker, target, prio, prob, extra) => {
        if (def.lines[key] && rng() < prob) cands.push({ key, speaker, prio, vars: Object.assign({ name: target ? nameOf(target) : '' }, extra) });
      };
      const ctx = { g, room, add, isHuman, isSpeaker, anyBot, firstHuman, rng };
      const fresh = g.events.filter((e) => e.seq > (room.banterSeq || 0));
      if (fresh.length) {
        room.banterSeq = fresh[fresh.length - 1].seq;
        changed = true;
        for (const e of fresh) {
          if (e.type === 'start') add(def.startKey ? def.startKey(g, rng) : 'start', anyBot(), firstHuman, 3, 1);
          else if (e.type === 'win') {
            if (isSpeaker(e.playerId)) add('botWin', e.playerId, firstHuman, 4, 1);
            else if (isHuman(e.playerId)) add('humanWin', anyBot(), e.playerId, 4, 1);
          } else if (e.type === 'draw') add('draw', anyBot(), firstHuman, 4, 1);
          else if (def.banterEvent) def.banterEvent(e, ctx);
        }
      }
      if (g.status === 'playing') {
        const cur = g.current();
        const idleKey = g.id + ':' + g.turnSeq;
        if (isHuman(cur.id) && room.turnStartAt && now - room.turnStartAt > IDLE_TEASE_MS && room.idleTeased !== idleKey) {
          room.idleTeased = idleKey;
          changed = true;
          add('humanIdle', anyBot(), cur.id, 1, 0.9);
        }
      }
      return Core.chooseLine(room, def.lines, cands, now, rng) || changed;
    }

    // ---------------------------------------------------------------- le temps qui passe
    function botMove(room, g, cur, now, rng) {
      const move = def.chooseMove(g, cur.id, profileOf(room), rng);
      g.play(cur.id, move);
      if (g.status === 'ended' && g.winnerId === cur.id && rng() < 0.8) emote(room, cur.id, pick(['🎉', '😎', '🔥'], rng), now);
    }

    function autoMove(room, g, cur, rng) {
      const moves = g.legalMoves();
      g.play(cur.id, moves[Math.floor(rng() * moves.length)]);
      notice(room, `Temps écoulé pour ${cur.name}`);
    }

    function advance(room, now, rng = Math.random) {
      let changed = Core.dropAbsent(room, now);
      for (let guard = 0; guard < 6; guard++) {
        const g = room.game;
        if (!g) break;
        if (g.status !== 'playing') {
          if (Core.scoreEnded(room)) changed = true;
          break;
        }
        const turnKey = g.id + ':' + g.turnSeq;
        if (room.turnSeen !== turnKey) {
          room.turnSeen = turnKey;
          room.turnStartAt = now;
          changed = true;
        }
        const cur = g.current();
        const rp = player(room, cur.id);
        const online = cur.isBot || (rp && now - rp.lastSeen < OFFLINE_AFTER_MS);
        const key = `${g.id}:${g.turnSeq}:${cur.isBot}:${online}`;
        if (key !== room.timerKey) {
          room.timerKey = key;
          changed = true;
          if (cur.isBot) {
            const [a, b] = profileOf(room).thinkMs || [550, 1100];
            room.dueAt = now + a + rng() * (b - a);
            room.turnDeadline = null;
          } else if (room.mode === 'friends') {
            room.dueAt = now + (online ? TURN_MS : OFFLINE_TURN_MS);
            room.turnDeadline = room.dueAt;
          } else {
            room.dueAt = null;
            room.turnDeadline = null;
          }
        }
        if (room.dueAt != null && now >= room.dueAt) {
          room.timerKey = null;
          room.dueAt = null;
          room.turnDeadline = null;
          if (cur.isBot) botMove(room, g, cur, now, rng);
          else autoMove(room, g, cur, rng);
          changed = true;
          continue;
        }
        break;
      }
      if (banter(room, now, rng)) changed = true;
      if (changed) room.updatedAt = now;
      return changed;
    }

    function view(room, pid, now) {
      return Core.viewBase(room, pid, now, {
        levelTitle: Core.levelTitle(room.level),
        maxPlayers: MAX_PLAYERS,
        game: room.game ? room.game.viewFor(pid) : null,
      });
    }

    function parse(json) {
      const room = typeof json === 'string' ? JSON.parse(json) : json;
      if (room.game) room.game = def.Game.fromJSON(room.game);
      return room;
    }

    return {
      KIND: def.kind,
      MAX_PLAYERS,
      newRoom,
      newSoloRoom,
      status,
      startGame,
      join,
      leave,
      touch,
      act,
      advance,
      view,
      parse,
      profileOf,
    };
  }

  /**
   * Recherche alpha-bêta (negamax) avec approfondissement progressif et limite de temps,
   * utilisée par les IA d'Aligne 4, d'Awalé et des Dames.
   * @param {object} g  { moves(state) -> coups, apply(state, move) -> nouvel état, evaluate(state) -> score pour le joueur au trait,
   *                      terminal(state) -> score | null, order?(state, moves) -> coups triés }
   */
  function searchBest(g, state, maxDepth, timeMs) {
    const deadline = Date.now() + timeMs;
    let best = null;
    let timeout = false;
    function negamax(s, depth, alpha, beta) {
      if (Date.now() > deadline) {
        timeout = true;
        return 0;
      }
      const t = g.terminal(s);
      if (t !== null) return t * (1 + depth * 0.01); // gagner vite, perdre tard
      if (depth === 0) return g.evaluate(s);
      let moves = g.moves(s);
      if (!moves.length) return g.evaluate(s);
      if (g.order) moves = g.order(s, moves);
      let value = -Infinity;
      for (const m of moves) {
        const child = g.apply(s, m);
        const sign = child.toMove === s.toMove ? 1 : -1;
        const v = sign * negamax(child, depth - 1, sign === 1 ? alpha : -beta, sign === 1 ? beta : -alpha);
        if (timeout) return 0;
        if (v > value) value = v;
        if (value > alpha) alpha = value;
        if (alpha >= beta) break;
      }
      return value;
    }
    let moves = g.moves(state);
    if (g.order) moves = g.order(state, moves);
    for (let depth = 1; depth <= maxDepth; depth++) {
      let bestHere = null;
      let alpha = -Infinity;
      const scored = [];
      for (const m of moves) {
        const child = g.apply(state, m);
        const sign = child.toMove === state.toMove ? 1 : -1;
        const v = sign * negamax(child, depth - 1, sign === 1 ? alpha : -Infinity, sign === 1 ? Infinity : -alpha);
        if (timeout) break;
        scored.push({ m, v });
        if (!bestHere || v > bestHere.v) bestHere = { m, v };
        if (v > alpha) alpha = v;
      }
      if (timeout) break;
      best = bestHere;
      // le meilleur coup en premier pour la profondeur suivante
      scored.sort((a, b) => b.v - a.v);
      moves = scored.map((x) => x.m);
      if (best && best.v > 9000) break; // victoire forcée trouvée
    }
    return best ? best.m : moves[0];
  }

  return { create, searchBest };
});
