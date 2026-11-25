'use strict';
/**
 * Gestion des salons OneFOO (en mémoire).
 *  - mode "solo"    : 1 humain contre le système (bots), le niveau vient du client.
 *  - mode "friends" : salon partagé par code / lien, 2 à 6 joueurs, bots optionnels.
 * Le serveur est l'autorité : chaque client reçoit une vue personnalisée ("room:state").
 */

const crypto = require('crypto');
const { FooGame, GameError } = require('./games/foo/engine');
const bot = require('./games/foo/bot');

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;
const MAX_PLAYERS = 6;
const TURN_MS = 30_000; // temps max par tour entre amis
const OFFLINE_TURN_MS = 8_000; // joueur déconnecté : on joue à sa place plus vite
const IDLE_ROOM_MS = 15 * 60_000; // salon sans humain connecté -> supprimé
const FRIENDS_BOT_LEVEL = 6;
const BOT_SPEED = Number(process.env.ONEFOO_BOT_SPEED) || 1; // < 1 = bots plus rapides (tests)

const AVATARS = ['😎', '🦁', '🐯', '🦊', '🐼', '🐸', '🦉', '🐙', '👽', '🤠', '🦄', '🐵', '🐧', '🐨', '🦖', '👑'];
const BOT_AVATARS = ['🤖', '👾', '🦾', '🛸', '🧠', '⚙️'];
const BOT_NAMES = ['Awa', 'Moussa', 'Fatou', 'Ibou', 'Khady', 'Modou', 'Aïda', 'Cheikh', 'Binta', 'Lamine'];
const EMOTES = ['👍', '😂', '😮', '😡', '🔥', '😈', '🙏', '👋', '😭', '🎉'];

const sanitizeName = (n) =>
  String(n || '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, 16) || 'Joueur';
const validId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(id);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map(); // code -> room
    this.playerRoom = new Map(); // playerId -> code
    this.cleaner = setInterval(() => this.cleanup(), 60_000);
    this.cleaner.unref();
  }

  // ---------------------------------------------------------------- Connexion
  handleConnection(socket) {
    const on = (event, fn) => {
      socket.on(event, (data, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        try {
          if (event !== 'hello' && !socket.data.playerId) throw new GameError('Connexion non initialisée.');
          const res = fn(data && typeof data === 'object' ? data : {}, socket);
          reply({ ok: true, ...(res || {}) });
        } catch (err) {
          if (!(err instanceof GameError)) console.error(`[${event}]`, err);
          reply({ ok: false, error: err instanceof GameError ? err.message : 'Erreur serveur.' });
        }
      });
    };

    on('hello', (d) => {
      if (!validId(d.playerId)) throw new GameError('Identifiant invalide.');
      socket.data.playerId = d.playerId;
      socket.data.name = sanitizeName(d.name);
      socket.data.avatar = AVATARS.includes(d.avatar) ? d.avatar : pick(AVATARS);
      const room = this.roomOf(d.playerId);
      if (room) {
        const p = room.players.find((x) => x.id === d.playerId);
        p.socketId = socket.id;
        p.connected = true;
        this.afterChange(room);
        return { room: room.code };
      }
      return { room: null };
    });

    on('profile', (d) => {
      socket.data.name = sanitizeName(d.name);
      if (AVATARS.includes(d.avatar)) socket.data.avatar = d.avatar;
      const room = this.roomOf(socket.data.playerId);
      if (room && room.status() !== 'playing') {
        const p = room.players.find((x) => x.id === socket.data.playerId);
        p.name = socket.data.name;
        p.avatar = socket.data.avatar;
        this.afterChange(room);
      }
    });

    on('solo:start', (d, s) => {
      this.leave(s.data.playerId);
      const level = bot.profile(Number(d.level) || 1).level;
      const room = this.createRoom('solo', s);
      room.level = level;
      const prof = bot.profile(level);
      for (let i = 0; i < prof.opponents; i++) this.addBot(room);
      this.startGame(room);
      return { code: room.code };
    });

    on('room:create', (d, s) => {
      this.leave(s.data.playerId);
      const room = this.createRoom('friends', s);
      this.afterChange(room);
      return { code: room.code };
    });

    on('room:join', (d, s) => {
      const code = String(d.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const room = this.rooms.get(code);
      if (!room || room.mode !== 'friends') throw new GameError('Aucune partie avec ce code.');
      const pid = s.data.playerId;
      const existing = room.players.find((p) => p.id === pid);
      if (existing && !existing.isBot) {
        existing.socketId = s.id;
        existing.connected = true;
        this.afterChange(room);
        return { code };
      }
      if (existing && room.status() !== 'playing') room.players.splice(room.players.indexOf(existing), 1);
      if (room.status() === 'playing') throw new GameError('Une partie est déjà en cours dans ce salon. Réessayez à la fin de la manche.');
      if (room.players.length >= MAX_PLAYERS) {
        const botP = room.players.find((p) => p.isBot);
        if (!botP) throw new GameError('Salon complet (6 joueurs max).');
        room.players.splice(room.players.indexOf(botP), 1); // un ami remplace un bot
      }
      this.leave(pid);
      if (room.status() === 'ended') room.game = null; // retour au salon pour accueillir le nouveau
      room.players.push(this.humanFrom(s));
      this.playerRoom.set(pid, code);
      this.notice(room, `${s.data.name} a rejoint la partie`);
      this.afterChange(room);
      return { code };
    });

    on('room:leave', (d, s) => {
      this.leave(s.data.playerId);
    });

    on('room:addBot', (d, s) => {
      const room = this.hostRoom(s);
      if (room.status() === 'playing') throw new GameError('Partie en cours.');
      if (room.players.length >= MAX_PLAYERS) throw new GameError('Salon complet.');
      this.addBot(room);
      this.afterChange(room);
    });

    on('room:removeBot', (d, s) => {
      const room = this.hostRoom(s);
      if (room.status() === 'playing') throw new GameError('Partie en cours.');
      const i = room.players.findIndex((p) => p.isBot && p.id === d.id);
      if (i !== -1) room.players.splice(i, 1);
      this.afterChange(room);
    });

    on('room:start', (d, s) => {
      const room = this.roomOf(s.data.playerId);
      if (!room) throw new GameError("Vous n'êtes dans aucun salon.");
      if (room.mode === 'friends' && room.hostId !== s.data.playerId) throw new GameError("Seul l'hôte peut lancer la partie.");
      if (room.status() === 'playing') throw new GameError('Partie déjà en cours.');
      if (room.players.length < 2) throw new GameError('Il faut au moins 2 joueurs (ajoutez un bot ou invitez un ami).');
      this.startGame(room);
    });

    on('room:lobby', (d, s) => {
      const room = this.hostRoom(s);
      if (room.status() === 'playing') throw new GameError('Partie en cours.');
      room.game = null;
      this.afterChange(room);
    });

    on('room:emote', (d, s) => {
      const room = this.roomOf(s.data.playerId);
      if (!room || !EMOTES.includes(d.emoji)) return;
      const now = Date.now();
      if (now - (s.data.lastEmote || 0) < 700) return;
      s.data.lastEmote = now;
      this.emote(room, s.data.playerId, d.emoji);
    });

    // ----- Actions de jeu
    const gameAction = (fn) => (d, s) => {
      const room = this.roomOf(s.data.playerId);
      if (!room || !room.game) throw new GameError('Aucune partie en cours.');
      const res = fn(room.game, s.data.playerId, d, room);
      this.afterChange(room);
      return res;
    };
    on('game:play', gameAction((g, pid, d) => {
      g.play(pid, String(d.cardId), d.color);
    }));
    on('game:draw', gameAction((g, pid) => {
      const r = g.draw(pid);
      return { playable: r.playable };
    }));
    on('game:pass', gameAction((g, pid) => g.pass(pid) && undefined));
    on('game:foo', gameAction((g, pid) => g.sayFoo(pid) && undefined));
    on('game:catch', gameAction((g, pid, d, room) => {
      g.catchFoo(pid, String(d.targetId));
      const target = room.players.find((p) => p.id === d.targetId);
      if (target && target.isBot && Math.random() < 0.6) this.emote(room, target.id, pick(['😭', '😡', '😮']), 400);
    }));

    socket.on('disconnect', () => {
      const pid = socket.data.playerId;
      const room = pid && this.roomOf(pid);
      if (!room) return;
      const p = room.players.find((x) => x.id === pid);
      if (p && p.socketId === socket.id) {
        p.connected = false;
        p.socketId = null;
        this.afterChange(room);
      }
    });
  }

  // ---------------------------------------------------------------- Salons
  roomOf(playerId) {
    const code = this.playerRoom.get(playerId);
    return (code && this.rooms.get(code)) || null;
  }

  hostRoom(socket) {
    const room = this.roomOf(socket.data.playerId);
    if (!room) throw new GameError("Vous n'êtes dans aucun salon.");
    if (room.hostId !== socket.data.playerId) throw new GameError("Action réservée à l'hôte.");
    return room;
  }

  newCode() {
    for (;;) {
      let code = '';
      const bytes = crypto.randomBytes(CODE_LENGTH);
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
      if (!this.rooms.has(code)) return code;
    }
  }

  humanFrom(socket) {
    return {
      id: socket.data.playerId,
      name: socket.data.name,
      avatar: socket.data.avatar,
      isBot: false,
      socketId: socket.id,
      connected: true,
    };
  }

  createRoom(mode, socket) {
    const code = this.newCode();
    const room = {
      code,
      mode,
      hostId: socket.data.playerId,
      players: [this.humanFrom(socket)],
      game: null,
      level: 1,
      botLevel: FRIENDS_BOT_LEVEL,
      scores: {},
      timers: new Set(),
      turnTimer: null,
      timerKey: null,
      turnDeadline: null,
      catchSeq: 0,
      plannedCatch: null,
      scoredGameId: null,
      notices: [],
      noticeSeq: 0,
      lastActivity: Date.now(),
      status() {
        if (!this.game) return 'lobby';
        return this.game.status === 'playing' ? 'playing' : 'ended';
      },
    };
    this.rooms.set(code, room);
    this.playerRoom.set(socket.data.playerId, code);
    return room;
  }

  addBot(room) {
    const used = new Set(room.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || 'Bot ' + (room.players.length + 1);
    const usedAv = new Set(room.players.map((p) => p.avatar));
    room.players.push({
      id: 'bot-' + crypto.randomUUID().slice(0, 8),
      name,
      avatar: BOT_AVATARS.find((a) => !usedAv.has(a)) || '🤖',
      isBot: true,
      connected: true,
      socketId: null,
    });
  }

  startGame(room) {
    room.game = new FooGame(room.players.map(({ id, name, avatar, isBot }) => ({ id, name, avatar, isBot })));
    room.plannedCatch = null;
    room.timerKey = null;
    this.afterChange(room);
  }

  leave(playerId) {
    const room = this.roomOf(playerId);
    this.playerRoom.delete(playerId);
    if (!room) return;
    const idx = room.players.findIndex((p) => p.id === playerId);
    if (idx === -1) return;
    const p = room.players[idx];
    const g = room.game;
    const inGame = g && g.status === 'playing' && g.player(playerId);
    if (inGame) {
      // Le joueur qui part est remplacé par un bot pour que la manche continue.
      p.isBot = true;
      p.replaced = true;
      p.connected = true;
      p.socketId = null;
      const gp = g.player(playerId);
      gp.isBot = true;
      gp.avatar = '🤖';
      p.avatar = '🤖';
      this.notice(room, `${p.name} a quitté la partie (remplacé par un bot)`);
    } else {
      room.players.splice(idx, 1);
      if (room.status() !== 'playing') this.notice(room, `${p.name} a quitté le salon`);
    }
    const humans = room.players.filter((x) => !x.isBot);
    if (!humans.length || room.mode === 'solo') return this.deleteRoom(room);
    if (room.hostId === playerId) {
      room.hostId = humans[0].id;
      this.notice(room, `${humans[0].name} est maintenant l'hôte`);
    }
    this.afterChange(room);
  }

  deleteRoom(room) {
    clearTimeout(room.turnTimer);
    for (const t of room.timers) clearTimeout(t);
    room.timers.clear();
    for (const p of room.players) if (this.playerRoom.get(p.id) === room.code) this.playerRoom.delete(p.id);
    this.rooms.delete(room.code);
  }

  later(room, ms, fn) {
    const t = setTimeout(() => {
      room.timers.delete(t);
      if (this.rooms.get(room.code) !== room) return;
      try {
        fn();
      } catch (err) {
        console.error('[timer]', err);
      }
    }, ms);
    room.timers.add(t);
  }

  notice(room, text) {
    room.notices.push({ seq: ++room.noticeSeq, text });
    if (room.notices.length > 10) room.notices.shift();
  }

  emote(room, playerId, emoji, delay = 0) {
    const send = () => {
      for (const p of room.players) {
        if (!p.isBot && p.connected && p.socketId) this.io.to(p.socketId).emit('emote', { playerId, emoji });
      }
    };
    delay ? this.later(room, delay, send) : send();
  }

  botProfile(room) {
    return bot.profile(room.mode === 'solo' ? room.level : room.botLevel);
  }

  // ---------------------------------------------------------------- Moteur temps réel
  /** À appeler après chaque changement d'état : programme bots / minuteurs, puis diffuse. */
  afterChange(room) {
    if (this.rooms.get(room.code) !== room) return;
    room.lastActivity = Date.now();
    const g = room.game;

    if (g && g.status === 'ended' && room.scoredGameId !== g.id) {
      room.scoredGameId = g.id;
      room.scores[g.winnerId] = (room.scores[g.winnerId] || 0) + 1;
      // les joueurs partis en cours de manche (remplacés par un bot) quittent le salon
      room.players = room.players.filter((p) => !p.replaced);
    }

    if (!g || g.status !== 'playing') {
      clearTimeout(room.turnTimer);
      room.turnTimer = null;
      room.timerKey = null;
      room.turnDeadline = null;
    } else {
      this.planCatch(room, g);
      const cur = g.current();
      const rp = room.players.find((p) => p.id === cur.id);
      const connected = cur.isBot || (rp && rp.connected);
      const key = `${g.id}:${g.turnSeq}:${g.hasDrawn}:${cur.isBot}:${connected}`;
      if (key !== room.timerKey) {
        room.timerKey = key;
        clearTimeout(room.turnTimer);
        room.turnTimer = null;
        room.turnDeadline = null;
        const prof = this.botProfile(room);
        if (cur.isBot) {
          const [a, b] = prof.thinkMs;
          const ms = (g.hasDrawn ? 700 : a + Math.random() * (b - a)) * BOT_SPEED;
          room.turnTimer = setTimeout(() => this.botTurn(room, key), ms);
        } else if (room.mode === 'friends') {
          const ms = connected ? TURN_MS : OFFLINE_TURN_MS;
          room.turnDeadline = Date.now() + ms;
          room.turnTimer = setTimeout(() => this.autoTurn(room, key), ms);
        }
      }
    }
    this.broadcast(room);
  }

  /** Quand un joueur oublie FOO!, un bot décide (selon le niveau) s'il va l'attraper. */
  planCatch(room, g) {
    if (!g.vulnerable || room.catchSeq === g.vulnerableSeq) return;
    room.catchSeq = g.vulnerableSeq;
    room.plannedCatch = null;
    const target = g.vulnerable;
    const catchers = room.players.filter((p) => p.isBot && p.id !== target && g.player(p.id));
    if (!catchers.length) return;
    const prof = this.botProfile(room);
    if (Math.random() >= prof.catchChance) return;
    const seq = g.vulnerableSeq;
    room.plannedCatch = { seq, botId: pick(catchers).id };
    this.later(room, prof.catchDelay * BOT_SPEED, () => this.execCatch(room, g, seq, room.plannedCatch && room.plannedCatch.botId));
  }

  execCatch(room, g, seq, botId, silent = false) {
    if (room.game !== g || g.status !== 'playing' || !g.vulnerable || g.vulnerableSeq !== seq || !botId) return;
    g.catchFoo(botId, g.vulnerable);
    room.plannedCatch = null;
    if (Math.random() < 0.7) this.emote(room, botId, pick(['😈', '😂', '👋']));
    if (!silent) this.afterChange(room);
  }

  botTurn(room, key) {
    const g = room.game;
    if (this.rooms.get(room.code) !== room || !g || room.timerKey !== key || g.status !== 'playing') return;
    room.timerKey = null;
    const cur = g.current();
    if (!cur.isBot) return this.afterChange(room);
    try {
      // Un bot attrape au début de son tour si c'était prévu.
      if (room.plannedCatch && g.vulnerable && g.vulnerable !== cur.id && room.plannedCatch.seq === g.vulnerableSeq) {
        this.execCatch(room, g, g.vulnerableSeq, cur.id, true);
      }
      const prof = this.botProfile(room);
      const r = bot.playStep(g, cur.id, prof);
      if (r.action === 'play') {
        const v = g.top().value;
        if ((v === 'wild4' || v === 'draw2') && Math.random() < 0.3) this.emote(room, cur.id, pick(['😈', '😂', '🔥']), 300);
        if (g.status === 'ended' && Math.random() < 0.8) this.emote(room, cur.id, pick(['🎉', '😎', '🔥']), 300);
      }
    } catch (err) {
      console.error('[bot]', err);
      // sécurité : ne jamais bloquer la partie
      try {
        if (!g.hasDrawn) g.draw(cur.id);
        if (g.status === 'playing' && g.current().id === cur.id && g.hasDrawn) g.pass(cur.id);
      } catch (_) {}
    }
    this.afterChange(room);
  }

  /** Temps écoulé : on pioche et on passe pour le joueur. */
  autoTurn(room, key) {
    const g = room.game;
    if (this.rooms.get(room.code) !== room || !g || room.timerKey !== key || g.status !== 'playing') return;
    room.timerKey = null;
    const cur = g.current();
    try {
      if (!g.hasDrawn) {
        const r = g.draw(cur.id);
        if (r.playable) g.pass(cur.id);
      } else g.pass(cur.id);
      this.notice(room, `Temps écoulé pour ${cur.name}`);
    } catch (err) {
      console.error('[auto]', err);
    }
    this.afterChange(room);
  }

  // ---------------------------------------------------------------- Diffusion
  view(room, playerId) {
    const prof = this.botProfile(room);
    return {
      code: room.code,
      mode: room.mode,
      hostId: room.hostId,
      status: room.status(),
      level: room.level,
      levelTitle: prof.title,
      maxPlayers: MAX_PLAYERS,
      players: room.players.map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        isBot: p.isBot,
        connected: p.connected,
        wins: room.scores[p.id] || 0,
      })),
      game: room.game ? room.game.viewFor(playerId) : null,
      turnDeadline: room.turnDeadline,
      serverNow: Date.now(),
      notices: room.notices.slice(-5),
    };
  }

  broadcast(room) {
    for (const p of room.players) {
      if (!p.isBot && p.connected && p.socketId) this.io.to(p.socketId).emit('room:state', this.view(room, p.id));
    }
  }

  cleanup() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      const anyone = room.players.some((p) => !p.isBot && p.connected);
      if (!anyone && now - room.lastActivity > IDLE_ROOM_MS) this.deleteRoom(room);
    }
  }

  stats() {
    return { rooms: this.rooms.size, players: this.playerRoom.size };
  }
}

module.exports = { RoomManager, AVATARS, EMOTES };
