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
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./bot.js'));
  else root.FooRooms = factory(root.FooEngine, root.FooBot);
})(typeof self !== 'undefined' ? self : this, function (Engine, Bot) {
  'use strict';
  const { FooGame, GameError } = Engine;

  const MAX_PLAYERS = 6;
  const TURN_MS = 30000; // temps max par tour entre amis
  const OFFLINE_TURN_MS = 8000; // joueur hors ligne : on joue à sa place plus vite
  const OFFLINE_AFTER_MS = 25000; // sans nouvelles depuis 25 s = hors ligne
  const LOBBY_DROP_MS = 90000; // hors partie, un absent quitte le salon après 90 s
  const FRIENDS_BOT_LEVEL = 6;

  const AVATARS = ['😎', '🦁', '🐯', '🦊', '🐼', '🐸', '🦉', '🐙', '👽', '🤠', '🦄', '🐵', '🐧', '🐨', '🦖', '👑'];
  const BOT_AVATARS = ['🤖', '👾', '🦾', '🛸', '🧠', '⚙️'];
  const BOT_NAMES = ['Awa', 'Moussa', 'Fatou', 'Ibou', 'Khady', 'Modou', 'Aïda', 'Cheikh', 'Binta', 'Lamine'];
  const EMOTES = ['👍', '😂', '😮', '😡', '🔥', '😈', '🙏', '👋', '😭', '🎉'];

  const pick = (arr, rng = Math.random) => arr[Math.floor(rng() * arr.length)];
  const sanitizeName = (n) =>
    String(n || '')
      .replace(/[\u0000-\u001f\u007f<>]/g, '')
      .trim()
      .slice(0, 16) || 'Joueur';
  const randomId = () => Math.random().toString(36).slice(2, 10);

  // ------------------------------------------------------------------ création / membres
  function human(p, now) {
    return {
      id: p.id,
      name: sanitizeName(p.name),
      avatar: AVATARS.includes(p.avatar) ? p.avatar : pick(AVATARS),
      isBot: false,
      lastSeen: now,
    };
  }

  function newRoom(code, mode, host, now, opts = {}) {
    return {
      code,
      mode,
      hostId: host.id,
      players: [human(host, now)],
      game: null,
      level: Bot.profile(opts.level || 1).level,
      botLevel: FRIENDS_BOT_LEVEL,
      scores: {},
      version: 0,
      notices: [],
      noticeSeq: 0,
      emotes: [],
      emoteSeq: 0,
      timerKey: null,
      dueAt: null,
      turnDeadline: null,
      catchSeq: 0,
      plannedCatch: null,
      scoredGameId: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  function status(room) {
    if (!room.game) return 'lobby';
    return room.game.status === 'playing' ? 'playing' : 'ended';
  }
  const player = (room, id) => room.players.find((p) => p.id === id) || null;
  const humans = (room) => room.players.filter((p) => !p.isBot);
  const profileOf = (room) => Bot.profile(room.mode === 'solo' ? room.level : room.botLevel);

  function notice(room, text) {
    room.notices.push({ seq: ++room.noticeSeq, text });
    if (room.notices.length > 8) room.notices.shift();
  }
  function emote(room, playerId, emoji, now) {
    room.emotes.push({ seq: ++room.emoteSeq, playerId, emoji, at: now });
    if (room.emotes.length > 8) room.emotes.shift();
  }

  function addBot(room) {
    const used = new Set(room.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || 'Bot ' + (room.players.length + 1);
    const usedAv = new Set(room.players.map((p) => p.avatar));
    room.players.push({
      id: 'bot-' + randomId(),
      name,
      avatar: BOT_AVATARS.find((a) => !usedAv.has(a)) || '🤖',
      isBot: true,
      lastSeen: 0,
    });
  }

  function startGame(room, now) {
    if (room.players.length < 2) throw new GameError('Il faut au moins 2 joueurs (ajoutez un bot ou invitez un ami).');
    room.game = new FooGame(room.players.map(({ id, name, avatar, isBot }) => ({ id, name, avatar, isBot })));
    room.timerKey = null;
    room.dueAt = null;
    room.turnDeadline = null;
    room.plannedCatch = null;
    room.updatedAt = now;
  }

  function fixHost(room) {
    const hs = humans(room);
    if (hs.length && !hs.some((p) => p.id === room.hostId)) {
      room.hostId = hs[0].id;
      notice(room, `${hs[0].name} est maintenant l'hôte`);
    }
  }

  function join(room, p, now) {
    if (room.mode !== 'friends') throw new GameError('Aucune partie avec ce code.');
    const existing = player(room, p.id);
    if (existing && !existing.isBot) {
      existing.lastSeen = now;
      return;
    }
    if (status(room) === 'playing') throw new GameError('Une partie est déjà en cours dans ce salon. Réessayez à la fin de la manche.');
    if (existing) room.players.splice(room.players.indexOf(existing), 1); // ancien joueur remplacé par un bot
    if (room.players.length >= MAX_PLAYERS) {
      const botP = room.players.find((x) => x.isBot);
      if (!botP) throw new GameError('Salon complet (6 joueurs max).');
      room.players.splice(room.players.indexOf(botP), 1); // un ami remplace un bot
    }
    if (status(room) === 'ended') room.game = null; // retour au salon pour accueillir le nouveau
    const h = human(p, now);
    room.players.push(h);
    notice(room, `${h.name} a rejoint la partie`);
  }

  /** @returns {boolean} true si le salon est désormais vide (à supprimer) */
  function leave(room, pid) {
    const idx = room.players.findIndex((p) => p.id === pid);
    if (idx === -1) return humans(room).length === 0;
    const p = room.players[idx];
    const g = room.game;
    if (g && g.status === 'playing' && g.player(pid)) {
      // Le joueur qui part est remplacé par un bot pour que la manche continue.
      p.isBot = true;
      p.replaced = true;
      p.avatar = '🤖';
      const gp = g.player(pid);
      gp.isBot = true;
      gp.avatar = '🤖';
      notice(room, `${p.name} a quitté la partie (remplacé par un bot)`);
    } else {
      room.players.splice(idx, 1);
      notice(room, `${p.name} a quitté le salon`);
    }
    if (!humans(room).length || room.mode === 'solo') return true;
    fixHost(room);
    return false;
  }

  function touch(room, pid, now) {
    const p = player(room, pid);
    if (p && !p.isBot) p.lastSeen = now;
  }

  // ------------------------------------------------------------------ actions des joueurs
  function hostOnly(room, pid) {
    if (room.mode === 'friends' && room.hostId !== pid) throw new GameError("Action réservée à l'hôte.");
  }

  function act(room, pid, action, data, now) {
    const p = player(room, pid);
    if (!p || p.isBot) throw new GameError('Vous ne faites pas partie de cette partie.');
    p.lastSeen = now;
    const g = room.game;
    const needGame = () => {
      if (!g) throw new GameError('Aucune partie en cours.');
      return g;
    };
    switch (action) {
      case 'profile':
        if (status(room) !== 'playing') {
          p.name = sanitizeName(data.name);
          if (AVATARS.includes(data.avatar)) p.avatar = data.avatar;
        }
        return;
      case 'addBot':
        hostOnly(room, pid);
        if (status(room) === 'playing') throw new GameError('Partie en cours.');
        if (room.players.length >= MAX_PLAYERS) throw new GameError('Salon complet.');
        addBot(room);
        return;
      case 'removeBot': {
        hostOnly(room, pid);
        if (status(room) === 'playing') throw new GameError('Partie en cours.');
        const i = room.players.findIndex((x) => x.isBot && x.id === data.id);
        if (i !== -1) room.players.splice(i, 1);
        return;
      }
      case 'start':
        hostOnly(room, pid);
        if (status(room) === 'playing') throw new GameError('Partie déjà en cours.');
        startGame(room, now);
        return;
      case 'lobby':
        hostOnly(room, pid);
        if (status(room) === 'playing') throw new GameError('Partie en cours.');
        room.game = null;
        return;
      case 'emote':
        if (!EMOTES.includes(data.emoji)) throw new GameError('Réaction inconnue.');
        if (now - (p.lastEmote || 0) < 700) return;
        p.lastEmote = now;
        emote(room, pid, data.emoji, now);
        return;
      case 'play':
        needGame().play(pid, String(data.cardId), data.color);
        return;
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
    let changed = false;

    // Hors partie, les absents depuis longtemps quittent le salon.
    if (room.mode === 'friends' && status(room) !== 'playing') {
      const gone = room.players.filter((p) => !p.isBot && now - p.lastSeen > LOBBY_DROP_MS);
      for (const p of gone) {
        room.players.splice(room.players.indexOf(p), 1);
        notice(room, `${p.name} a quitté le salon`);
        changed = true;
      }
      if (gone.length) fixHost(room);
    }

    for (let guard = 0; guard < 16; guard++) {
      const g = room.game;
      if (!g) break;
      if (g.status === 'ended') {
        if (room.scoredGameId !== g.id) {
          room.scoredGameId = g.id;
          room.scores[g.winnerId] = (room.scores[g.winnerId] || 0) + 1;
          // les joueurs partis en cours de manche (remplacés par un bot) quittent le salon
          room.players = room.players.filter((p) => !p.replaced);
          room.timerKey = null;
          room.dueAt = null;
          room.turnDeadline = null;
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
    if (changed) room.updatedAt = now;
    return changed;
  }

  // ------------------------------------------------------------------ vue envoyée au joueur
  function view(room, pid, now) {
    const prof = profileOf(room);
    return {
      code: room.code,
      mode: room.mode,
      me: pid,
      version: room.version,
      hostId: room.hostId,
      status: status(room),
      level: room.level,
      levelTitle: prof.title,
      maxPlayers: MAX_PLAYERS,
      players: room.players.map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        isBot: p.isBot,
        connected: p.isBot || now - p.lastSeen < OFFLINE_AFTER_MS,
        wins: room.scores[p.id] || 0,
      })),
      game: room.game ? room.game.viewFor(pid) : null,
      turnDeadline: room.turnDeadline,
      turnMs: TURN_MS,
      serverNow: now,
      notices: room.notices.slice(-5),
      emotes: room.emotes.slice(-6),
    };
  }

  /** Reconstruit un salon depuis du JSON (Redis / localStorage). */
  function parse(json) {
    const room = typeof json === 'string' ? JSON.parse(json) : json;
    if (room.game) room.game = FooGame.fromJSON(room.game);
    return room;
  }

  return {
    MAX_PLAYERS,
    TURN_MS,
    AVATARS,
    EMOTES,
    sanitizeName,
    newRoom,
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
