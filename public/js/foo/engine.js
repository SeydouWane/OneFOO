/**
 * Moteur du jeu FOO! (jeu de cartes de couleurs, famille "Crazy Eights").
 * Fichier partagé : utilisé par le navigateur (mode solo) ET par le serveur (mode entre amis).
 *
 * Règles :
 *  - 108 cartes : 4 couleurs x (0 x1, 1-9 x2, Passe x2, Inverse x2, +2 x2) + 4 Jokers + 4 Jokers +4.
 *  - 7 cartes chacun. On pose une carte de même couleur OU de même valeur, ou un Joker.
 *  - Si on ne peut/veut pas jouer : on pioche 1 carte. Si elle est jouable, on peut la poser, sinon le tour passe.
 *  - Passe : le suivant saute son tour. Inverse : change le sens (à 2 joueurs = Passe).
 *  - +2 / Joker +4 : le suivant pioche 2 / 4 et saute son tour.
 *  - Plusieurs cartes du même chiffre (couleurs différentes) peuvent être posées ensemble :
 *    la première doit être jouable, la dernière posée donne la couleur.
 *  - Quand il ne reste qu'une carte, il faut annoncer "FOO!". Sinon un adversaire peut vous attraper : +2 cartes.
 *  - Le premier qui n'a plus de cartes gagne la manche ; les autres continuent pour les places suivantes
 *    jusqu'à ce qu'il n'en reste qu'un (le dernier). S'il ne reste que des bots en jeu, la manche s'arrête
 *    et ils sont classés selon leurs cartes restantes.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FooEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLORS = ['red', 'yellow', 'green', 'blue'];
  const ACTIONS = ['skip', 'reverse', 'draw2'];
  const HAND_SIZE = 7;
  const DECK_SIZE = 108;

  class GameError extends Error {
    constructor(message) {
      super(message);
      this.name = 'GameError';
      this.isGameError = true;
    }
  }

  function randomId(len = 8) {
    const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < len; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return s;
  }

  function buildDeck() {
    const deck = [];
    let n = 0;
    const add = (color, value) => deck.push({ id: 'c' + n++, color, value });
    for (const color of COLORS) {
      add(color, '0');
      for (let i = 1; i <= 9; i++) {
        add(color, String(i));
        add(color, String(i));
      }
      for (const a of ACTIONS) {
        add(color, a);
        add(color, a);
      }
    }
    for (let i = 0; i < 4; i++) {
      add('wild', 'wild');
      add('wild', 'wild4');
    }
    return deck;
  }

  function shuffle(arr, rng = Math.random) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function isPlayable(card, top, currentColor) {
    if (card.color === 'wild') return true;
    if (card.color === currentColor) return true;
    return card.value === top.value;
  }
  const isNumber = (card) => /^\d$/.test(card.value);

  class FooGame {
    /**
     * @param {{id:string,name:string,avatar?:string,isBot?:boolean}[]} players
     * @param {{rng?:() => number}} [opts]
     */
    constructor(players, opts = {}) {
      if (players.length < 2 || players.length > 10) throw new GameError('Il faut entre 2 et 10 joueurs.');
      this.rng = opts.rng || Math.random;
      this.stopWhenOnlyBots = opts.stopWhenOnlyBots !== false;
      this.finished = []; // ids des joueurs ayant posé toutes leurs cartes, dans l'ordre d'arrivée
      this.ranking = null; // classement final (fin de manche)
      this.id = randomId(10);
      this.players = players.map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar || '🙂',
        isBot: !!p.isBot,
        hand: [],
        saidFoo: false,
      }));
      this.drawPile = shuffle(buildDeck(), this.rng);
      this.discard = [];
      this.direction = 1;
      this.turn = Math.floor(this.rng() * this.players.length);
      this.hasDrawn = false;
      this.drawnCardId = null;
      this.vulnerable = null; // id du joueur qui a 1 carte sans avoir dit FOO
      this.vulnerableSeq = 0;
      this.turnSeq = 0;
      this.status = 'playing';
      this.winnerId = null;
      this.events = [];
      this.eventSeq = 0;

      for (let i = 0; i < HAND_SIZE; i++) {
        for (const p of this.players) p.hand.push(this.drawPile.pop());
      }
      // La première carte retournée est toujours un chiffre.
      let first = this.drawPile.pop();
      while (!/^\d$/.test(first.value)) {
        this.drawPile.unshift(first);
        first = this.drawPile.pop();
      }
      this.discard.push(first);
      this.currentColor = first.color;
      this.log({ type: 'start', playerId: this.current().id });
    }

    // ---------- Sérialisation (stockage Redis / localStorage) ----------
    toJSON() {
      const o = {};
      for (const k of Object.keys(this)) if (k !== 'rng') o[k] = this[k];
      return o;
    }
    static fromJSON(data, opts = {}) {
      const g = Object.create(FooGame.prototype);
      Object.assign(g, data);
      g.rng = opts.rng || Math.random;
      return g;
    }

    // ---------- Helpers ----------
    current() {
      return this.players[this.turn];
    }
    player(id) {
      return this.players.find((p) => p.id === id) || null;
    }
    top() {
      return this.discard[this.discard.length - 1];
    }
    isDone(id) {
      return this.finished.includes(id);
    }
    activePlayers() {
      return this.players.filter((p) => !this.finished.includes(p.id));
    }
    /** Indice du joueur encore en jeu situé `steps` places plus loin (négatif = en arrière). */
    nextIndex(from = this.turn, steps = 1) {
      const n = this.players.length;
      const dir = steps < 0 ? -this.direction : this.direction;
      let i = from;
      for (let k = 0, guard = 0; k < Math.abs(steps) && guard < n * 4; guard++) {
        i = (((i + dir) % n) + n) % n;
        if (!this.finished.includes(this.players[i].id)) k++;
      }
      return i;
    }
    log(evt) {
      evt.seq = ++this.eventSeq;
      this.events.push(evt);
      if (this.events.length > 30) this.events.shift();
    }
    totalCards() {
      return this.drawPile.length + this.discard.length + this.players.reduce((s, p) => s + p.hand.length, 0);
    }

    reshuffle() {
      if (this.discard.length <= 1) return;
      const top = this.discard.pop();
      const rest = this.discard;
      this.discard = [top];
      this.drawPile = shuffle(rest, this.rng);
      this.log({ type: 'reshuffle' });
    }

    drawCards(player, count) {
      const drawn = [];
      for (let i = 0; i < count; i++) {
        if (this.drawPile.length === 0) this.reshuffle();
        if (this.drawPile.length === 0) break; // plus aucune carte disponible
        const c = this.drawPile.pop();
        player.hand.push(c);
        drawn.push(c);
      }
      if (drawn.length) player.saidFoo = false;
      return drawn;
    }

    startTurn(index) {
      this.turn = index;
      this.hasDrawn = false;
      this.drawnCardId = null;
      this.turnSeq++;
    }

    assertTurn(playerId) {
      if (this.status !== 'playing') throw new GameError('La partie est terminée.');
      if (this.current().id !== playerId) throw new GameError("Ce n'est pas votre tour.");
    }

    /** Un autre joueur agit : la fenêtre pour attraper celui qui a oublié FOO se referme. */
    closeVulnerability(actorId) {
      if (this.vulnerable && this.vulnerable !== actorId) this.vulnerable = null;
    }

    playableIds(playerId) {
      if (this.status !== 'playing' || this.current().id !== playerId) return [];
      const p = this.player(playerId);
      const top = this.top();
      return p.hand
        .filter((c) => (!this.hasDrawn || c.id === this.drawnCardId) && isPlayable(c, top, this.currentColor))
        .map((c) => c.id);
    }

    // ---------- Actions ----------
    /**
     * Pose une carte, ou plusieurs cartes du même chiffre (dans l'ordre donné).
     * @param {string|string[]} cardIds
     */
    play(playerId, cardIds, chosenColor) {
      const ids = (Array.isArray(cardIds) ? cardIds : [cardIds]).map(String);
      if (!ids.length || ids.length > 10 || new Set(ids).size !== ids.length) throw new GameError('Sélection de cartes invalide.');
      this.assertTurn(playerId);
      const p = this.player(playerId);
      const cards = ids.map((id) => p.hand.find((c) => c.id === id));
      if (cards.some((c) => !c)) throw new GameError("Vous n'avez pas cette carte.");
      const first = cards[0];
      if (this.hasDrawn && (cards.length > 1 || first.id !== this.drawnCardId)) throw new GameError('Vous ne pouvez jouer que la carte piochée.');
      if (!isPlayable(first, this.top(), this.currentColor)) throw new GameError('Cette carte ne peut pas être jouée.');
      if (cards.length > 1 && !cards.every((c) => isNumber(c) && c.value === first.value)) {
        throw new GameError('On ne peut poser ensemble que des cartes du même chiffre.');
      }
      if (first.color === 'wild' && !COLORS.includes(chosenColor)) throw new GameError('Choisissez une couleur.');

      this.closeVulnerability(playerId);
      for (const c of cards) {
        p.hand.splice(p.hand.indexOf(c), 1);
        this.discard.push(c);
      }
      const card = cards[cards.length - 1]; // la dernière posée donne la couleur
      this.currentColor = card.color === 'wild' ? chosenColor : card.color;
      const evt = { type: 'play', playerId, card, color: this.currentColor };
      if (cards.length > 1) evt.cards = cards;
      this.log(evt);

      const done = p.hand.length === 0;
      if (done) {
        this.finished.push(playerId);
        if (this.vulnerable === playerId) this.vulnerable = null;
        this.log({ type: 'finish', playerId, rank: this.finished.length });
        if (this.checkEnd()) return { ok: true, finished: true, ended: true };
      } else if (p.hand.length === 1 && !p.saidFoo) {
        this.vulnerable = playerId;
        this.vulnerableSeq++;
      }

      // Effet de la carte (même si le joueur vient de terminer : il s'applique au suivant encore en jeu)
      const n = this.activePlayers().length;
      switch (card.value) {
        case 'skip': {
          const victim = this.players[this.nextIndex()];
          this.log({ type: 'skip', playerId: victim.id });
          this.startTurn(this.nextIndex(this.turn, 2));
          break;
        }
        case 'reverse': {
          if (n === 2 && !done) {
            const victim = this.players[this.nextIndex()];
            this.log({ type: 'skip', playerId: victim.id });
            this.startTurn(this.turn); // le même joueur rejoue
          } else {
            this.direction *= -1;
            this.log({ type: 'reverse', direction: this.direction });
            this.startTurn(this.nextIndex());
          }
          break;
        }
        case 'draw2':
        case 'wild4': {
          const count = card.value === 'draw2' ? 2 : 4;
          const victim = this.players[this.nextIndex()];
          const got = this.drawCards(victim, count);
          this.log({ type: 'penalty', playerId: victim.id, count: got.length, by: playerId });
          this.startTurn(this.nextIndex(this.turn, 2));
          break;
        }
        default:
          this.startTurn(this.nextIndex());
      }
      return { ok: true, finished: done };
    }

    /**
     * Termine la manche s'il ne reste qu'un joueur en jeu (ou plus aucun humain en jeu).
     * Les joueurs restants sont classés selon leurs cartes. @returns {boolean} true si terminée
     */
    checkEnd() {
      if (this.status !== 'playing') return true;
      const active = this.activePlayers();
      const humansLeft = active.some((p) => !p.isBot);
      if (active.length > 1 && (humansLeft || !this.stopWhenOnlyBots || !this.finished.length)) return false;
      const rest = active.slice().sort((a, b) => a.hand.length - b.hand.length);
      this.ranking = [...this.finished, ...rest.map((p) => p.id)];
      this.status = 'ended';
      this.winnerId = this.ranking[0];
      this.vulnerable = null;
      this.log({
        type: 'win',
        playerId: this.winnerId,
        loserId: this.ranking[this.ranking.length - 1],
        continued: this.finished.length > 1,
      });
      return true;
    }

    draw(playerId) {
      this.assertTurn(playerId);
      if (this.hasDrawn) throw new GameError('Vous avez déjà pioché. Jouez la carte ou passez.');
      this.closeVulnerability(playerId);
      const p = this.player(playerId);
      const [card] = this.drawCards(p, 1);
      this.log({ type: 'draw', playerId, count: card ? 1 : 0 });
      if (card && isPlayable(card, this.top(), this.currentColor)) {
        this.hasDrawn = true;
        this.drawnCardId = card.id;
        return { ok: true, card, playable: true };
      }
      this.log({ type: 'pass', playerId });
      this.startTurn(this.nextIndex());
      return { ok: true, card: card || null, playable: false };
    }

    pass(playerId) {
      this.assertTurn(playerId);
      if (!this.hasDrawn) throw new GameError("Piochez d'abord une carte.");
      this.log({ type: 'pass', playerId });
      this.startTurn(this.nextIndex());
      return { ok: true };
    }

    /**
     * FOO! peut être annoncé avec 1 ou 2 cartes, ou à son tour quand une série de chiffres
     * identiques jouable laisserait exactement 1 carte.
     */
    canSayFoo(playerId) {
      const p = this.player(playerId);
      if (!p || this.status !== 'playing' || !p.hand.length) return false;
      if (p.hand.length <= 2) return true;
      if (this.current().id !== playerId || this.hasDrawn) return false;
      const top = this.top();
      const groups = {};
      for (const c of p.hand) if (isNumber(c)) (groups[c.value] = groups[c.value] || []).push(c);
      return Object.values(groups).some((g) => g.length === p.hand.length - 1 && g.some((c) => isPlayable(c, top, this.currentColor)));
    }

    sayFoo(playerId) {
      if (this.status !== 'playing') throw new GameError('La partie est terminée.');
      const p = this.player(playerId);
      if (!p) throw new GameError('Joueur inconnu.');
      if (p.saidFoo) return { ok: true };
      if (!this.canSayFoo(playerId)) throw new GameError("FOO! se dit quand il ne va plus vous rester qu'une carte.");
      p.saidFoo = true;
      if (this.vulnerable === playerId) this.vulnerable = null;
      this.log({ type: 'foo', playerId });
      return { ok: true };
    }

    catchFoo(catcherId, targetId) {
      if (this.status !== 'playing') throw new GameError('La partie est terminée.');
      if (!this.player(catcherId)) throw new GameError('Joueur inconnu.');
      if (catcherId === targetId || this.vulnerable !== targetId) throw new GameError('Trop tard !');
      const target = this.player(targetId);
      const got = this.drawCards(target, 2);
      this.vulnerable = null;
      this.log({ type: 'caught', playerId: targetId, by: catcherId, count: got.length });
      return { ok: true };
    }

    // ---------- Vue envoyée à un joueur (sans les cartes des autres) ----------
    viewFor(viewerId) {
      const me = this.player(viewerId);
      const isMyTurn = this.status === 'playing' && this.current().id === viewerId;
      return {
        id: this.id,
        status: this.status,
        winnerId: this.winnerId,
        currentColor: this.currentColor,
        direction: this.direction,
        turnPlayerId: this.status === 'playing' ? this.current().id : null,
        turnSeq: this.turnSeq,
        pile: this.discard.slice(-3),
        drawCount: this.drawPile.length,
        hasDrawn: isMyTurn ? this.hasDrawn : false,
        drawnCardId: isMyTurn ? this.drawnCardId : null,
        vulnerable: this.vulnerable,
        players: this.players.map((p) => ({
          id: p.id,
          name: p.name,
          avatar: p.avatar,
          isBot: p.isBot,
          cardCount: p.hand.length,
          saidFoo: p.saidFoo,
          rank: this.finished.includes(p.id) ? this.finished.indexOf(p.id) + 1 : null,
        })),
        ranking: this.ranking,
        hand: me ? me.hand : [],
        playable: me ? this.playableIds(viewerId) : [],
        canFoo: me ? !me.saidFoo && this.canSayFoo(viewerId) : false,
        events: this.events.slice(-15),
      };
    }
  }

  return { FooGame, GameError, COLORS, DECK_SIZE, isPlayable, isNumber, buildDeck, shuffle };
});
