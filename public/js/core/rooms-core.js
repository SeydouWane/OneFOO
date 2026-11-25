/**
 * Socle commun des salons OneFOO (tous les jeux) — fichier partagé navigateur + serveur.
 * Joueurs, hôte, présence, bots, réactions, micro, annonces, répliques du système, vue de base.
 * Chaque jeu (foo/rooms.js, morpion/rooms.js) ajoute ses règles par-dessus.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RoomsCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class GameError extends Error {
    constructor(message) {
      super(message);
      this.name = 'GameError';
      this.isGameError = true;
    }
  }

  const TURN_MS = 30000; // temps max par tour entre amis
  const OFFLINE_TURN_MS = 8000; // joueur hors ligne : on joue à sa place plus vite
  const OFFLINE_AFTER_MS = 25000; // sans nouvelles depuis 25 s = hors ligne
  const LOBBY_DROP_MS = 90000; // hors partie, un absent quitte le salon après 90 s
  const SAY_GAP_MS = 3500; // délai minimum entre deux répliques du système (sauf moments forts)

  const AVATARS = ['😎', '🦁', '🐯', '🦊', '🐼', '🐸', '🦉', '🐙', '👽', '🤠', '🦄', '🐵', '🐧', '🐨', '🦖', '👑'];
  const BOT_AVATARS = ['🤖', '👾', '🦾', '🛸', '🧠', '⚙️'];
  const BOT_NAMES = ['Awa', 'Moussa', 'Fatou', 'Ibou', 'Khady', 'Modou', 'Aïda', 'Cheikh', 'Binta', 'Lamine'];
  const EMOTES = ['👍', '😂', '😮', '😡', '🔥', '😈', '🙏', '👋', '😭', '🎉'];
  const LEVEL_TITLES = [[1, 'Débutant'], [2, 'Apprenti'], [4, 'Joueur'], [6, 'Confirmé'], [9, 'Expert'], [12, 'Maître'], [15, 'Légende']];

  const pick = (arr, rng = Math.random) => arr[Math.floor(rng() * arr.length)];
  const randomId = () => Math.random().toString(36).slice(2, 10);
  const sanitizeName = (n) =>
    String(n || '')
      .replace(/[\u0000-\u001f\u007f<>]/g, '')
      .trim()
      .slice(0, 16) || 'Joueur';
  const levelTitle = (lv) => LEVEL_TITLES.reduce((t, [min, name]) => (lv >= min ? name : t), LEVEL_TITLES[0][1]);
  const clampLevel = (lv) => Math.max(1, Math.min(99, Math.floor(lv) || 1));

  // ------------------------------------------------------------------ membres
  function human(p, now) {
    return {
      id: p.id,
      name: sanitizeName(p.name),
      avatar: AVATARS.includes(p.avatar) ? p.avatar : pick(AVATARS),
      isBot: false,
      lastSeen: now,
      uid: p.uid || null, // compte OneFOO (classements) — jamais envoyé aux autres joueurs
    };
  }

  function newRoom(code, kind, mode, host, now, extra = {}) {
    return Object.assign(
      {
        code,
        kind,
        mode,
        hostId: host.id,
        players: [human(host, now)],
        game: null,
        level: 1,
        scores: {},
        version: 0,
        notices: [],
        noticeSeq: 0,
        emotes: [],
        emoteSeq: 0,
        says: [],
        saySeq: 0,
        voice: {},
        timerKey: null,
        dueAt: null,
        turnDeadline: null,
        scoredGameId: null,
        createdAt: now,
        updatedAt: now,
      },
      extra
    );
  }

  function status(room) {
    if (!room.game) return 'lobby';
    return room.game.status === 'playing' ? 'playing' : 'ended';
  }
  const player = (room, id) => room.players.find((p) => p.id === id) || null;
  const humans = (room) => room.players.filter((p) => !p.isBot);

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

  function fixHost(room) {
    const hs = humans(room);
    if (hs.length && !hs.some((p) => p.id === room.hostId)) {
      room.hostId = hs[0].id;
      notice(room, `${hs[0].name} est maintenant l'hôte`);
    }
  }

  function join(room, p, now, maxPlayers) {
    if (room.mode !== 'friends') throw new GameError('Aucune partie avec ce code.');
    const existing = player(room, p.id);
    if (existing && !existing.isBot) {
      existing.lastSeen = now;
      if (p.uid) existing.uid = p.uid;
      return;
    }
    if (status(room) === 'playing') throw new GameError('Une partie est déjà en cours dans ce salon. Réessayez à la fin de la manche.');
    if (existing) room.players.splice(room.players.indexOf(existing), 1); // ancien joueur remplacé par un bot
    if (room.players.length >= maxPlayers) {
      const botP = room.players.find((x) => x.isBot);
      if (!botP) throw new GameError(`Salon complet (${maxPlayers} joueurs max).`);
      room.players.splice(room.players.indexOf(botP), 1); // un ami remplace un bot
    }
    if (status(room) === 'ended') room.game = null; // retour au salon pour accueillir le nouveau
    const h = human(p, now);
    room.players.push(h);
    notice(room, `${h.name} a rejoint la partie`);
  }

  /**
   * Un joueur quitte. En pleine partie, il est remplacé par un bot (onPlayingLeave peut terminer la manche).
   * @returns {boolean} true si le salon est désormais vide (à supprimer)
   */
  function leave(room, pid, onPlayingLeave) {
    stopVoice(room, pid);
    const idx = room.players.findIndex((p) => p.id === pid);
    if (idx === -1) return humans(room).length === 0;
    const p = room.players[idx];
    const g = room.game;
    if (g && g.status === 'playing' && g.player(pid)) {
      p.isBot = true;
      p.replaced = true;
      p.avatar = '🤖';
      const gp = g.player(pid);
      gp.isBot = true;
      gp.avatar = '🤖';
      notice(room, `${p.name} a quitté la partie (remplacé par un bot)`);
      if (onPlayingLeave) onPlayingLeave(room, g, pid);
    } else {
      room.players.splice(idx, 1);
      notice(room, `${p.name} a quitté le salon`);
    }
    if (!humans(room).length || room.mode === 'solo') return true;
    fixHost(room);
    return false;
  }

  /** Micro coupé : plus de voix ni de piste audio publiée (relais Cloudflare). */
  function stopVoice(room, pid) {
    if (room.voice) delete room.voice[pid];
    if (room.voiceTracks) delete room.voiceTracks[pid];
  }

  function touch(room, pid, now) {
    const p = player(room, pid);
    if (p && !p.isBot) p.lastSeen = now;
  }

  /** Hors partie, les absents depuis longtemps quittent le salon. @returns {boolean} changé */
  function dropAbsent(room, now) {
    if (room.mode !== 'friends' || status(room) === 'playing') return false;
    const gone = room.players.filter((p) => !p.isBot && now - p.lastSeen > LOBBY_DROP_MS);
    for (const p of gone) {
      room.players.splice(room.players.indexOf(p), 1);
      stopVoice(room, p.id);
      notice(room, `${p.name} a quitté le salon`);
    }
    if (gone.length) fixHost(room);
    return gone.length > 0;
  }

  /** Fin de manche : score du gagnant (une seule fois) ; les joueurs partis quittent le salon. */
  function scoreEnded(room) {
    const g = room.game;
    if (!g || g.status === 'playing' || room.scoredGameId === g.id) return false;
    room.scoredGameId = g.id;
    if (g.winnerId) room.scores[g.winnerId] = (room.scores[g.winnerId] || 0) + 1;
    room.players = room.players.filter((p) => !p.replaced);
    room.timerKey = null;
    room.dueAt = null;
    room.turnDeadline = null;
    return true;
  }

  function hostOnly(room, pid) {
    if (room.mode === 'friends' && room.hostId !== pid) throw new GameError("Action réservée à l'hôte.");
  }

  /**
   * Actions communes à tous les jeux.
   * @returns {{handled:boolean, result?:any}}
   */
  function actCommon(room, pid, action, data, now, cfg) {
    const p = player(room, pid);
    if (!p || p.isBot) throw new GameError('Vous ne faites pas partie de cette partie.');
    p.lastSeen = now;
    switch (action) {
      case 'profile':
        if (status(room) !== 'playing') {
          p.name = sanitizeName(data.name);
          if (AVATARS.includes(data.avatar)) p.avatar = data.avatar;
        }
        return { handled: true };
      case 'addBot':
        hostOnly(room, pid);
        if (status(room) === 'playing') throw new GameError('Partie en cours.');
        if (room.players.length >= cfg.maxPlayers) throw new GameError('Salon complet.');
        addBot(room);
        return { handled: true };
      case 'removeBot': {
        hostOnly(room, pid);
        if (status(room) === 'playing') throw new GameError('Partie en cours.');
        const i = room.players.findIndex((x) => x.isBot && x.id === data.id);
        if (i !== -1) room.players.splice(i, 1);
        return { handled: true };
      }
      case 'start':
        hostOnly(room, pid);
        if (status(room) === 'playing') throw new GameError('Partie déjà en cours.');
        cfg.start(room, now);
        return { handled: true };
      case 'lobby':
        hostOnly(room, pid);
        if (status(room) === 'playing') throw new GameError('Partie en cours.');
        room.game = null;
        return { handled: true };
      case 'emote':
        if (!EMOTES.includes(data.emoji)) throw new GameError('Réaction inconnue.');
        if (now - (p.lastEmote || 0) >= 700) {
          p.lastEmote = now;
          emote(room, pid, data.emoji, now);
        }
        return { handled: true };
      case 'voice':
        if (!data.on) {
          stopVoice(room, pid);
          return { handled: true };
        }
        room.voice = room.voice || {};
        room.voice[pid] = now;
        // piste publiée sur le relais audio : { s: session, t: nom } — fournie par le serveur, jamais par le client
        room.voiceTracks = room.voiceTracks || {};
        if (data.sfu && data.sfu.s && data.sfu.t) room.voiceTracks[pid] = { s: String(data.sfu.s), t: String(data.sfu.t) };
        return { handled: true };
      default:
        return { handled: false };
    }
  }

  // ------------------------------------------------------------------ répliques du système
  const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));

  function sayLine(room, lines, speakerId, key, vars, now, rng) {
    const pool = (lines[key] || []).filter((l) => !l.includes('{name}') || vars.name);
    if (!pool.length) return false;
    room.recentLines = room.recentLines || [];
    const fresh = pool.filter((l) => !room.recentLines.includes(l));
    const line = pick(fresh.length ? fresh : pool, rng);
    room.recentLines.push(line);
    if (room.recentLines.length > 12) room.recentLines.shift();
    room.says = room.says || [];
    room.saySeq = (room.saySeq || 0) + 1;
    room.says.push({ seq: room.saySeq, playerId: speakerId, text: fill(line, vars), at: now });
    if (room.says.length > 6) room.says.shift();
    room.lastSayAt = now;
    return true;
  }

  /** Choisit la meilleure réplique candidate (priorité), en respectant le délai entre deux répliques. */
  function chooseLine(room, lines, cands, now, rng) {
    if (!cands.length) return false;
    cands.sort((a, b) => b.prio - a.prio);
    const best = cands[0];
    if (best.prio < 3 && now - (room.lastSayAt || 0) < SAY_GAP_MS) return false;
    return sayLine(room, lines, best.speaker, best.key, best.vars, now, rng);
  }

  // ------------------------------------------------------------------ vue
  function viewBase(room, pid, now, extra) {
    return Object.assign(
      {
        kind: room.kind || 'foo',
        code: room.code,
        mode: room.mode,
        me: pid,
        version: room.version,
        hostId: room.hostId,
        status: status(room),
        level: room.level,
        options: room.options || null,
        players: room.players.map((p) => ({
          id: p.id,
          name: p.name,
          avatar: p.avatar,
          isBot: p.isBot,
          connected: p.isBot || now - p.lastSeen < OFFLINE_AFTER_MS,
          wins: room.scores[p.id] || 0,
          mic: !!(room.voice && room.voice[p.id]),
          // nom de la piste audio publiée (la session reste côté serveur)
          vt: (room.mode === 'friends' && room.voice && room.voice[p.id] && room.voiceTracks && room.voiceTracks[p.id] && room.voiceTracks[p.id].t) || null,
        })),
        turnDeadline: room.turnDeadline,
        turnMs: TURN_MS,
        serverNow: now,
        notices: room.notices.slice(-5),
        emotes: room.emotes.slice(-6),
        says: (room.says || []).slice(-4),
      },
      extra
    );
  }

  return {
    GameError,
    TURN_MS,
    OFFLINE_TURN_MS,
    OFFLINE_AFTER_MS,
    AVATARS,
    EMOTES,
    pick,
    randomId,
    sanitizeName,
    levelTitle,
    clampLevel,
    newRoom,
    status,
    player,
    humans,
    notice,
    emote,
    addBot,
    fixHost,
    join,
    leave,
    touch,
    dropAbsent,
    scoreEnded,
    actCommon,
    sayLine,
    chooseLine,
    viewBase,
  };
});
