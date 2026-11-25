/**
 * Salons du Morpion (fichier partagé navigateur + serveur), sur le socle commun RoomsCore.
 *  - solo    : contre le système ; la grille et la finesse du système dépendent du niveau.
 *  - friends : 2 joueurs (ou 1 + bot), l'hôte choisit la grille, on alterne qui commence.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./engine.js'), require('../core/rooms-core.js'));
  } else root.MorpionRooms = factory(root.MorpionEngine, root.RoomsCore);
})(typeof self !== 'undefined' ? self : this, function (Engine, Core) {
  'use strict';
  const { MorpionGame } = Engine;
  const { GameError, TURN_MS, OFFLINE_TURN_MS, OFFLINE_AFTER_MS, pick, status, player, notice, emote } = Core;

  const KIND = 'morpion';
  const MAX_PLAYERS = 2;
  const FRIENDS_BOT_LEVEL = 7;
  const IDLE_TEASE_MS = 15000;
  const SIZES = [3, 6, 9];

  const LINES = {
    start: [
      'Prêt à perdre au morpion ?',
      'Allez {name}, aligne si tu peux… hahaha !',
      "Je vais pas te ménager aujourd'hui !",
      'Le morpion, c’est mon jeu. Tu vas voir.',
    ],
    startBig: ['Grande grille, grosse défaite pour toi, hahaha !', 'Sur une grille pareille, je vois tout. Bonne chance !'],
    botThreat: ['Hmm… tu vois ce que je prépare ?', 'Attention, ça sent mauvais pour toi !', 'Je dis ça, je dis rien… mais regarde bien la grille.'],
    botBlock: ["Bloqué ! Tu croyais que je n'avais pas vu ?", 'Ah non, pas par là ! Hahaha !', 'Bien essayé, mais non.'],
    humanBlock: ["Hé ! Tu m'as bloqué…", "D'accord, tu as vu. Pas mal."],
    humanThreat: ['Oh oh… attends, je réfléchis.', "Hein ?! D'où ça sort, ça ?"],
    botWin: [
      'Aligné ! Je te gagne, on rejoue ?',
      'Trop facile ! Même mon fils fait mieux que toi au morpion, hahaha !',
      'Et voilà ! Tu as pris ton déjeuner ce matin ?',
    ],
    humanWin: ["Quoi ?! Tu as triché, c'est sûr !", 'Bon… bien joué. Mais je monte de niveau et je reviens !', 'Revanche ! Tout de suite !'],
    draw: ['Match nul… tu as eu peur de perdre, hein ?', 'Égalité. On recommence, et cette fois je gagne !'],
    humanIdle: ['Allô ? Tu dors ou quoi ?', 'Il y a des cases libres, hein, choisis-en une !', 'Tu réfléchis ou tu fais la sieste ?'],
  };

  // ------------------------------------------------------------------ création / membres
  function newRoom(code, mode, host, now, opts = {}) {
    const level = Core.clampLevel(opts.level || 1);
    const size = mode === 'solo' ? Engine.profile(level).size : SIZES.includes(Number(opts.size)) ? Number(opts.size) : 3;
    return Core.newRoom(code, KIND, mode, host, now, { level, botLevel: FRIENDS_BOT_LEVEL, options: { size }, starter: 0 });
  }

  function newSoloRoom(code, host, now, level) {
    const room = newRoom(code, 'solo', host, now, { level });
    Core.addBot(room);
    return room;
  }

  function profileOf(room) {
    const prof = Engine.profile(room.mode === 'solo' ? room.level : room.botLevel);
    return Object.assign({}, prof, { size: room.options.size });
  }

  function startGame(room, now) {
    if (room.players.length < 2) throw new GameError('Il faut 2 joueurs (ajoutez un bot ou invitez un ami).');
    const players = room.players.slice(0, 2).map(({ id, name, avatar, isBot }) => ({ id, name, avatar, isBot }));
    // Contre le système : vous commencez, sauf aux niveaux élevés ; entre amis, on alterne à chaque manche.
    let starter = room.mode === 'solo' && Engine.profile(room.level).botStarts ? 1 : 0;
    if (room.mode === 'friends') {
      starter = room.game ? 1 - (room.starter || 0) : room.starter || 0;
      room.starter = starter;
    }
    room.game = new MorpionGame(players, { size: room.options.size, starter });
    room.timerKey = null;
    room.dueAt = null;
    room.turnDeadline = null;
    room.updatedAt = now;
  }

  const join = (room, p, now) => Core.join(room, p, now, MAX_PLAYERS);
  const leave = (room, pid) => Core.leave(room, pid);
  const touch = Core.touch;

  // ------------------------------------------------------------------ actions
  function act(room, pid, action, data, now) {
    const common = Core.actCommon(room, pid, action, data, now, { maxPlayers: MAX_PLAYERS, start: startGame });
    if (common.handled) return common.result;
    switch (action) {
      case 'options': {
        if (room.mode === 'friends' && room.hostId !== pid) throw new GameError("Action réservée à l'hôte.");
        if (status(room) === 'playing') throw new GameError('Partie en cours.');
        const size = Number(data.size);
        if (!SIZES.includes(size)) throw new GameError('Grille inconnue.');
        room.options.size = size;
        return;
      }
      case 'move':
        if (!room.game) throw new GameError('Aucune partie en cours.');
        room.game.play(pid, data.cell);
        return;
      default:
        throw new GameError('Action inconnue.');
    }
  }

  // ------------------------------------------------------------------ le système taquin
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
    const add = (key, speaker, target, prio, prob) => {
      if (rng() < prob) cands.push({ key, speaker, prio, vars: { name: target ? nameOf(target) : '' } });
    };
    const fresh = g.events.filter((e) => e.seq > (room.banterSeq || 0));
    if (fresh.length) {
      room.banterSeq = fresh[fresh.length - 1].seq;
      changed = true;
      for (const e of fresh) {
        switch (e.type) {
          case 'start':
            add(g.size > 3 && rng() < 0.5 ? 'startBig' : 'start', anyBot(), firstHuman, 3, 1);
            break;
          case 'threat':
            if (isSpeaker(e.playerId) && isHuman(e.target)) add('botThreat', e.playerId, e.target, 2, g.size === 3 ? 0.45 : 0.75);
            else if (isHuman(e.playerId) && isSpeaker(e.target)) add('humanThreat', e.target, e.playerId, 1, 0.5);
            break;
          case 'block':
            if (isSpeaker(e.playerId) && isHuman(e.target)) add('botBlock', e.playerId, e.target, 2, 0.8);
            else if (isHuman(e.playerId) && isSpeaker(e.target)) add('humanBlock', e.target, e.playerId, 2, 0.7);
            break;
          case 'win':
            if (isSpeaker(e.playerId)) add('botWin', e.playerId, firstHuman, 4, 1);
            else if (isHuman(e.playerId)) add('humanWin', anyBot(), e.playerId, 4, 1);
            break;
          case 'draw':
            add('draw', anyBot(), firstHuman, 4, 1);
            break;
        }
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
    return Core.chooseLine(room, LINES, cands, now, rng) || changed;
  }

  // ------------------------------------------------------------------ le temps qui passe
  function botMove(room, g, cur, now, rng) {
    const cell = Engine.chooseMove(g, cur.id, profileOf(room), rng);
    g.play(cur.id, cell);
    if (g.status === 'ended' && g.winnerId === cur.id && rng() < 0.8) emote(room, cur.id, pick(['🎉', '😎', '🔥'], rng), now);
  }

  function autoMove(room, g, cur, rng) {
    const empties = g.board.map((c, i) => (c === null ? i : -1)).filter((i) => i >= 0);
    g.play(cur.id, empties[Math.floor(rng() * empties.length)]);
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
          const [a, b] = profileOf(room).thinkMs;
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

  // ------------------------------------------------------------------ vue
  function view(room, pid, now) {
    return Core.viewBase(room, pid, now, {
      levelTitle: Engine.levelTitle(room.level),
      maxPlayers: MAX_PLAYERS,
      game: room.game ? room.game.viewFor(pid) : null,
    });
  }

  function parse(json) {
    const room = typeof json === 'string' ? JSON.parse(json) : json;
    if (room.game) room.game = MorpionGame.fromJSON(room.game);
    return room;
  }

  return {
    KIND,
    MAX_PLAYERS,
    SIZES,
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
  };
});
