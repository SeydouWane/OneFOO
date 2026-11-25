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
  };
  const SAY_GAP_MS = 3500; // délai minimum entre deux répliques (sauf moments forts)
  const IDLE_TEASE_MS = 15000; // un humain qui traîne se fait chambrer

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
      says: [],
      saySeq: 0,
      voice: {},
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
    if (room.voice) delete room.voice[pid];
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
      case 'play': {
        const ids = Array.isArray(data.cardIds) ? data.cardIds.slice(0, 10).map(String) : String(data.cardId);
        needGame().play(pid, ids, data.color);
        return;
      }
      case 'voice':
        // micro activé / coupé (la voix passe directement entre téléphones, voir le client)
        room.voice = room.voice || {};
        if (data.on) room.voice[pid] = now;
        else delete room.voice[pid];
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

  // ------------------------------------------------------------------ le système taquin
  const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));

  function sayLine(room, speakerId, key, vars, now, rng) {
    const pool = (LINES[key] || []).filter((l) => !l.includes('{name}') || vars.name);
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
    const add = (key, speaker, target, prio, prob) => {
      if (rng() < prob) cands.push({ key, speaker, prio, vars: { name: target ? nameOf(target) : '', level: room.level } });
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
          case 'penalty':
            if (isSpeaker(e.by) && isHuman(e.playerId)) add('botPenalty', e.by, e.playerId, 2, 0.85);
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
          case 'win':
            if (isSpeaker(e.playerId)) add('botWin', e.playerId, firstHuman, 4, 1);
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

    if (!cands.length) return changed;
    cands.sort((a, b) => b.prio - a.prio);
    const best = cands[0];
    if (best.prio < 3 && now - (room.lastSayAt || 0) < SAY_GAP_MS) return changed;
    return sayLine(room, best.speaker, best.key, best.vars, now, rng) || changed;
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
        if (room.voice) delete room.voice[p.id];
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
        mic: !!(room.voice && room.voice[p.id]),
      })),
      game: room.game ? room.game.viewFor(pid) : null,
      turnDeadline: room.turnDeadline,
      turnMs: TURN_MS,
      serverNow: now,
      notices: room.notices.slice(-5),
      emotes: room.emotes.slice(-6),
      says: (room.says || []).slice(-4),
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
