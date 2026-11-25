/**
 * Logique des salons OneFOO pour FOO! (fichier partagé navigateur + serveur).
 *
 * Un salon est un objet JSON (stockable dans Redis ou localStorage). Aucun minuteur :
 * `advance(room, now)` fait avancer le temps (coups des bots, attrapes, temps écoulé),
 * ce qui permet de fonctionner sur des fonctions serverless (Vercel) appelées à chaque rafraîchissement.
 *  - mode "solo"    : exécuté dans le navigateur, le niveau vient du joueur.
 *  - mode "friends" : exécuté sur le serveur, salon partagé par code / lien.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./engine.js'), require('./bot.js'), require('../core/rooms-core.js'));
  } else root.FooRooms = factory(root.FooEngine, root.FooBot, root.RoomsCore);
})(typeof self !== 'undefined' ? self : this, function (Engine, Bot, Core) {
  'use strict';
  const { FooGame, GameError } = Engine;
  const { TURN_MS, OFFLINE_TURN_MS, OFFLINE_AFTER_MS, AVATARS, EMOTES, pick, sanitizeName, status, player, notice, emote } = Core;

  const KIND = 'foo';
  const MAX_PLAYERS = 6;
  const FRIENDS_BOT_LEVEL = 6;

  // Le système est taquin : répliques selon ce qui se passe ({name} = joueur visé, {level} = niveau).
  const LINES = {
    start: [
      "Je vais pas te ménager aujourd'hui !",
      'Prépare-toi à perdre, hein !',
      "Encore toi ? Tu n'as pas eu ta dose la dernière fois ?",
      'Allez {name}, montre-moi ce que tu sais faire… si tu sais faire quelque chose !',
      "Aujourd'hui, c'est moi le patron de la table.",
      'Mélange bien les cartes, ça ne changera rien. Hahaha !',
    ],
    startHigh: ['Niveau {level} ? Tu vas souffrir, hahaha !', 'Au niveau {level}, je ne fais plus de cadeaux. Accroche-toi !'],
    startLow: ["Je débute, mais j'ai l'impression que toi aussi. Hihihi !"],
    botPenalty: [
      'Tiens, cadeau ! Hahaha !',
      'Ramasse, ramasse ! Hahaha !',
      'Prends ça ! Et sans rancune, hein…',
      'Désolé… non, en fait je ne suis pas désolé du tout !',
      "Distribution gratuite aujourd'hui, profite !",
      '{name}, tu collectionnes les cartes ? Je t’aide !',
    ],
    botSkip: ["Assieds-toi, c'est encore mon tour !", 'Tu passes ton tour. Repose-toi un peu !', 'Chut, laisse jouer les grands. Hihihi !'],
    humanDraw: [
      "Tu pioches encore ? T'as pas pris de déjeuner aujourd'hui ou quoi ?",
      'Pioche, pioche… tu vas finir avec tout le paquet !',
      'Même mon fils fait mieux que ça, hahaha !',
      'Rien à jouer ? Ça commence mal pour toi, hein !',
    ],
    humanPenalty: ['Aïe ! Tu vas me le payer !', "Ah, c'est comme ça ? D'accord, d'accord…", 'Ouh là, enfin tu te réveilles !', 'Pas mal… pour un début.'],
    humanSkip: ["Hé ! C'était mon tour !", "Coup de chance, c'est tout."],
    botFoo: ['FOO ! Tu sens la défaite arriver ?', 'Plus qu’une carte… Tu commences à transpirer, {name} ?', "FOO ! Bientôt c'est fini pour toi, hahaha !"],
    humanFoo: ['Hein ?! Attends, attends… pas si vite !', 'Une seule carte ? Je vais te faire piocher, tu vas voir.', 'Tu crois que tu vas gagner ? Hahaha… bon, peut-être.'],
    botCatch: ['Attrapé ! Tu as oublié de dire FOO, hahaha !', 'Et hop, deux cartes pour toi ! Il faut parler, hein !', "T'es nul ! Même mon fils dit FOO, lui !"],
    humanCatch: ["Ah zut ! Tu m'as eu…", "Bien vu… je l'avoue."],
    humanMany: ['Tu as combien de cartes, là ? On dirait un éventail !', 'Tu joues aux cartes ou tu vends des cartes ? Hahaha !'],
    humanIdle: ['Allô ? Tu dors ou quoi ?', 'Tu réfléchis ou tu fais la sieste ?', 'Prends ton temps… non je rigole, joue !'],
    botMulti: ["Et paf, plusieurs d'un coup !", "Double ! Tu ne l'as pas vu venir, hein ?"],
    humanMulti: ["Oh, tout d'un coup ! D'accord, je note…", 'Hé, doucement avec tes doubles !'],
    botWin: [
      'Je te gagne ! On rejoue ? Hahaha !',
      'Trop facile ! Reviens quand tu auras révisé.',
      'Gagné ! Va prendre ton déjeuner et reviens, hahaha !',
      'T’es nul, même mon fils fait mieux ! Allez, on rejoue ?',
    ],
    humanWin: [
      "Quoi ?! Coup de chance, c'est tout !",
      'Bon… tu as gagné cette fois. La prochaine, tu vas voir !',
      "D'accord, bien joué. Mais je monte de niveau et je reviens !",
      'Revanche ! Je demande la revanche !',
    ],
    botFinish: [
      "J'ai fini ! Bon courage pour la suite, hahaha !",
      'Terminé ! Je vous regarde vous battre pour la 2e place.',
      'Et voilà, plus de cartes ! Quelqu’un veut des conseils ?',
    ],
    humanLast: [
      'Dernière place ! Même mon fils fait mieux, hahaha ! On rejoue ?',
      "Le dernier paie le déjeuner, c'est la règle ! Hahaha !",
      'Dernier ! Allez, ne pleure pas, on rejoue ?',
    ],
    botLast: ['Bon… dernier. Je vous ai laissé gagner, c’est tout.', 'Pfff, ces cartes sont truquées !'],
    botStack: [
      "Ah, tu croyais t'en sortir ? Je renvoie : plus {count} !",
      'Non non non, je te la renvoie ! Plus {count}, bon appétit !',
      "Et hop, retour à l'envoyeur ! Ça fait plus {count} maintenant.",
    ],
    humanStack: ['Hein ?! Tu me la renvoies ? Ah, tu es coriace…', "D'accord, d'accord… plus {count}, rien que ça !"],
    bigPenalty: [
      'Plus {count} ! Tu vas avoir besoin d’un sac pour tes cartes, hahaha !',
      '{count} cartes ! Même mon fils ne s’est jamais fait avoir comme ça, hahaha !',
    ],
  };
  const IDLE_TEASE_MS = 15000; // un humain qui traîne se fait chambrer

  // ------------------------------------------------------------------ création / membres
  function newRoom(code, mode, host, now, opts = {}) {
    return Core.newRoom(code, KIND, mode, host, now, {
      level: Bot.profile(opts.level || 1).level,
      botLevel: FRIENDS_BOT_LEVEL,
      catchSeq: 0,
      plannedCatch: null,
    });
  }

  /** Partie contre le système : le nombre d'adversaires dépend du niveau. */
  function newSoloRoom(code, host, now, level) {
    const room = newRoom(code, 'solo', host, now, { level });
    for (let i = 0; i < Bot.profile(level).opponents; i++) Core.addBot(room);
    return room;
  }

  const profileOf = (room) => Bot.profile(room.mode === 'solo' ? room.level : room.botLevel);
  const addBot = Core.addBot;

  function startGame(room, now) {
    if (room.players.length < 2) throw new GameError('Il faut au moins 2 joueurs (ajoutez un bot ou invitez un ami).');
    room.game = new FooGame(room.players.map(({ id, name, avatar, isBot }) => ({ id, name, avatar, isBot })));
    room.timerKey = null;
    room.dueAt = null;
    room.turnDeadline = null;
    room.plannedCatch = null;
    room.updatedAt = now;
  }

  const join = (room, p, now) => Core.join(room, p, now, MAX_PLAYERS);
  // Le joueur qui part est remplacé par un bot ; s'il ne reste plus d'humain en jeu, la manche se termine.
  const leave = (room, pid) => Core.leave(room, pid, (r, g) => g.checkEnd());
  const touch = Core.touch;

  // ------------------------------------------------------------------ actions des joueurs
  function act(room, pid, action, data, now) {
    const common = Core.actCommon(room, pid, action, data, now, { maxPlayers: MAX_PLAYERS, start: startGame });
    if (common.handled) return common.result;
    const g = room.game;
    const needGame = () => {
      if (!g) throw new GameError('Aucune partie en cours.');
      return g;
    };
    switch (action) {
      case 'play': {
        const ids = Array.isArray(data.cardIds) ? data.cardIds.slice(0, 10).map(String) : String(data.cardId);
        needGame().play(pid, ids, data.color);
        return;
      }
      case 'draw':
        return { playable: needGame().draw(pid).playable };
      case 'pass':
        needGame().pass(pid);
        return;
      case 'foo':
        needGame().sayFoo(pid);
        return;
      case 'catch': {
        const targetId = String(data.targetId);
        needGame().catchFoo(pid, targetId);
        const target = player(room, targetId);
        if (target && target.isBot && Math.random() < 0.6) emote(room, targetId, pick(['😭', '😡', '😮']), now);
        return;
      }
      default:
        throw new GameError('Action inconnue.');
    }
  }

  // ------------------------------------------------------------------ le temps qui passe
  function botStep(room, g, cur, now, rng) {
    // Un bot attrape au début de son tour si c'était prévu.
    if (room.plannedCatch && g.vulnerable && g.vulnerable !== cur.id && room.plannedCatch.seq === g.vulnerableSeq) {
      g.catchFoo(cur.id, g.vulnerable);
      room.plannedCatch = null;
      if (rng() < 0.7) emote(room, cur.id, pick(['😈', '😂', '👋'], rng), now);
    }
    try {
      const r = Bot.playStep(g, cur.id, profileOf(room), rng);
      if (r.action === 'play') {
        const v = g.top().value;
        if ((v === 'wild4' || v === 'draw2') && rng() < 0.3) emote(room, cur.id, pick(['😈', '😂', '🔥'], rng), now);
        if (g.status === 'ended' && rng() < 0.8) emote(room, cur.id, pick(['🎉', '😎', '🔥'], rng), now);
      }
    } catch (err) {
      // sécurité : ne jamais bloquer la partie
      if (typeof console !== 'undefined') console.error('[bot]', err);
      try {
        if (!g.hasDrawn) g.draw(cur.id);
        if (g.status === 'playing' && g.current().id === cur.id && g.hasDrawn) g.pass(cur.id);
      } catch (_) {}
    }
  }

  // ------------------------------------------------------------------ le système taquin
  /** Les bots réagissent aux derniers événements de la partie (une réplique à la fois). */
  function banter(room, now, rng) {
    const g = room.game;
    if (!g) return false;
    const speakers = room.players.filter((p) => p.isBot && !p.replaced && g.player(p.id));
    if (!speakers.length) return false;
    let changed = false;
    if (room.banterGame !== g.id) {
      room.banterGame = g.id;
      room.banterSeq = 0;
      room.manyTeased = false;
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
      if (rng() < prob) cands.push({ key, speaker, prio, vars: { name: target ? nameOf(target) : '', level: room.level, ...extra } });
    };

    const fresh = g.events.filter((e) => e.seq > (room.banterSeq || 0));
    if (fresh.length) {
      room.banterSeq = fresh[fresh.length - 1].seq;
      changed = true;
      let lastPlayer = null;
      for (const e of g.events) if (e.seq < fresh[0].seq && e.type === 'play') lastPlayer = e.playerId;
      for (const e of fresh) {
        switch (e.type) {
          case 'start': {
            let key = 'start';
            if (room.mode === 'solo' && room.level >= 9 && rng() < 0.5) key = 'startHigh';
            else if (room.mode === 'solo' && room.level <= 1 && rng() < 0.4) key = 'startLow';
            add(key, anyBot(), firstHuman, 3, 1);
            break;
          }
          case 'play':
            lastPlayer = e.playerId;
            if (e.cards && isSpeaker(e.playerId)) add('botMulti', e.playerId, null, 1, 0.7);
            else if (e.cards && isHuman(e.playerId)) add('humanMulti', anyBot(), e.playerId, 1, 0.6);
            break;
          case 'stack':
            // un +2 / +4 renvoyé (la pénalité dépasse la carte posée) : la pénalité grossit
            if (e.count > e.add) {
              if (isSpeaker(e.playerId) && isHuman(e.target)) add('botStack', e.playerId, e.target, 2, 0.85, { count: e.count });
              else if (isHuman(e.playerId) && isSpeaker(e.target)) add('humanStack', e.target, e.playerId, 2, 0.7, { count: e.count });
            }
            break;
          case 'penalty':
            if (e.count >= 6 && isHuman(e.playerId)) add('bigPenalty', isSpeaker(e.by) ? e.by : anyBot(), e.playerId, 3, 0.9, { count: e.count });
            else if (isSpeaker(e.by) && isHuman(e.playerId)) add('botPenalty', e.by, e.playerId, 2, 0.85);
            else if (isHuman(e.by) && isSpeaker(e.playerId)) add('humanPenalty', e.playerId, e.by, 2, 0.75);
            break;
          case 'skip':
            if (isSpeaker(lastPlayer) && isHuman(e.playerId)) add('botSkip', lastPlayer, e.playerId, 1, 0.6);
            else if (isHuman(lastPlayer) && isSpeaker(e.playerId)) add('humanSkip', e.playerId, lastPlayer, 1, 0.55);
            break;
          case 'draw':
            if (isHuman(e.playerId)) add('humanDraw', anyBot(), e.playerId, 0, 0.3);
            break;
          case 'foo':
            if (isSpeaker(e.playerId)) add('botFoo', e.playerId, firstHuman, 2, 0.85);
            else if (isHuman(e.playerId)) add('humanFoo', anyBot(), e.playerId, 2, 0.65);
            break;
          case 'caught':
            if (isSpeaker(e.by) && isHuman(e.playerId)) add('botCatch', e.by, e.playerId, 3, 1);
            else if (isHuman(e.by) && isSpeaker(e.playerId)) add('humanCatch', e.playerId, e.by, 3, 0.9);
            break;
          case 'finish':
            // Le premier a fini mais la partie continue pour les autres places
            if (e.rank === 1 && g.status === 'playing') {
              if (isSpeaker(e.playerId)) add('botFinish', e.playerId, firstHuman, 3, 1);
              else if (isHuman(e.playerId)) add('humanWin', anyBot(), e.playerId, 3, 1);
            }
            break;
          case 'win':
            if (e.continued) {
              // fin d'une partie jouée jusqu'au bout : on chambre le dernier
              if (isHuman(e.loserId)) add('humanLast', anyBot(), e.loserId, 4, 1);
              else if (isSpeaker(e.loserId)) add('botLast', e.loserId, null, 4, 0.9);
            } else if (isSpeaker(e.playerId)) add('botWin', e.playerId, firstHuman, 4, 1);
            else if (isHuman(e.playerId)) add('humanWin', anyBot(), e.playerId, 4, 1);
            break;
        }
      }
      if (!room.manyTeased && g.status === 'playing') {
        const heavy = g.players.find((p) => isHuman(p.id) && p.hand.length >= 10);
        if (heavy) {
          room.manyTeased = true;
          add('humanMany', anyBot(), heavy.id, 1, 0.8);
        }
      }
    }

    // Un humain qui traîne à jouer se fait chambrer (une fois par tour).
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

  function autoTurn(room, g, cur) {
    if (!g.hasDrawn) {
      const r = g.draw(cur.id);
      if (r.playable) g.pass(cur.id);
    } else g.pass(cur.id);
    notice(room, `Temps écoulé pour ${cur.name}`);
  }

  /**
   * Fait avancer le salon jusqu'à `now` : coups des bots, attrapes FOO!, temps écoulés.
   * @returns {boolean} true si le salon a changé (à sauvegarder)
   */
  function advance(room, now, rng = Math.random) {
    let changed = Core.dropAbsent(room, now); // hors partie, les absents quittent le salon

    for (let guard = 0; guard < 16; guard++) {
      const g = room.game;
      if (!g) break;
      if (g.status === 'ended') {
        if (Core.scoreEnded(room)) {
          room.plannedCatch = null;
          changed = true;
        }
        break;
      }

      // Quelqu'un a oublié FOO! : un bot décide (selon le niveau) s'il va l'attraper.
      if (g.vulnerable && room.catchSeq !== g.vulnerableSeq) {
        room.catchSeq = g.vulnerableSeq;
        room.plannedCatch = null;
        changed = true;
        const catchers = room.players.filter((p) => p.isBot && p.id !== g.vulnerable && g.player(p.id));
        const prof = profileOf(room);
        if (catchers.length && rng() < prof.catchChance) {
          room.plannedCatch = { seq: g.vulnerableSeq, botId: pick(catchers, rng).id, at: now + prof.catchDelay };
        }
      }
      if (room.plannedCatch && (!g.vulnerable || g.vulnerableSeq !== room.plannedCatch.seq)) {
        room.plannedCatch = null;
        changed = true;
      }
      if (room.plannedCatch && now >= room.plannedCatch.at) {
        const botId = room.plannedCatch.botId;
        room.plannedCatch = null;
        g.catchFoo(botId, g.vulnerable);
        if (rng() < 0.7) emote(room, botId, pick(['😈', '😂', '👋'], rng), now);
        changed = true;
        continue;
      }

      // Minuteur du tour en cours
      const turnKey = g.id + ':' + g.turnSeq;
      if (room.turnSeen !== turnKey) {
        room.turnSeen = turnKey;
        room.turnStartAt = now;
        changed = true;
      }
      const cur = g.current();
      const rp = player(room, cur.id);
      const online = cur.isBot || (rp && now - rp.lastSeen < OFFLINE_AFTER_MS);
      const key = `${g.id}:${g.turnSeq}:${g.hasDrawn}:${cur.isBot}:${online}`;
      if (key !== room.timerKey) {
        room.timerKey = key;
        changed = true;
        if (cur.isBot) {
          const [a, b] = profileOf(room).thinkMs;
          room.dueAt = now + (g.hasDrawn ? 700 : a + rng() * (b - a));
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
        if (cur.isBot) botStep(room, g, cur, now, rng);
        else autoTurn(room, g, cur);
        changed = true;
        continue;
      }
      break;
    }
    if (banter(room, now, rng)) changed = true;
    if (changed) room.updatedAt = now;
    return changed;
  }

  // ------------------------------------------------------------------ vue envoyée au joueur
  function view(room, pid, now) {
    return Core.viewBase(room, pid, now, {
      levelTitle: profileOf(room).title,
      maxPlayers: MAX_PLAYERS,
      game: room.game ? room.game.viewFor(pid) : null,
    });
  }

  /** Reconstruit un salon depuis du JSON (Redis / localStorage). */
  function parse(json) {
    const room = typeof json === 'string' ? JSON.parse(json) : json;
    room.kind = room.kind || KIND;
    if (room.game) room.game = FooGame.fromJSON(room.game);
    return room;
  }

  return {
    KIND,
    MAX_PLAYERS,
    TURN_MS,
    AVATARS,
    EMOTES,
    sanitizeName,
    newRoom,
    newSoloRoom,
    status,
    addBot,
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
