'use strict';
/**
 * Moteur du jeu FOO! (jeu de cartes de couleurs, famille "Crazy Eights").
 * Pur JavaScript, sans dépendance réseau : le serveur est l'unique autorité.
 *
 * Règles :
 *  - 108 cartes : 4 couleurs x (0 x1, 1-9 x2, Passe x2, Inverse x2, +2 x2) + 4 Jokers + 4 Jokers +4.
 *  - 7 cartes chacun. On pose une carte de même couleur OU de même valeur, ou un Joker.
 *  - Si on ne peut/veut pas jouer : on pioche 1 carte. Si elle est jouable, on peut la poser, sinon le tour passe.
 *  - Passe : le suivant saute son tour. Inverse : change le sens (à 2 joueurs = Passe).
 *  - +2 / Joker +4 : le suivant pioche 2 / 4 et saute son tour.
 *  - Quand il ne reste qu'une carte, il faut annoncer "FOO!". Sinon un adversaire peut vous attraper : +2 cartes.
 *  - Le premier qui n'a plus de cartes gagne la manche.
 */

const crypto = require('crypto');

const COLORS = ['red', 'yellow', 'green', 'blue'];
const ACTIONS = ['skip', 'reverse', 'draw2'];
const HAND_SIZE = 7;
const DECK_SIZE = 108;

class GameError extends Error {}

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

class FooGame {
  /**
   * @param {{id:string,name:string,avatar?:string,isBot?:boolean}[]} players
   * @param {{rng?:() => number}} [opts]
   */
  constructor(players, opts = {}) {
    if (players.length < 2 || players.length > 10) throw new GameError('Il faut entre 2 et 10 joueurs.');
    this.rng = opts.rng || Math.random;
    this.id = crypto.randomUUID().slice(0, 8);
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
  nextIndex(from = this.turn, steps = 1) {
    const n = this.players.length;
    return (((from + this.direction * steps) % n) + n) % n;
  }
  log(evt) {
    evt.seq = ++this.eventSeq;
    this.events.push(evt);
    if (this.events.length > 40) this.events.shift();
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
  play(playerId, cardId, chosenColor) {
    this.assertTurn(playerId);
    const p = this.player(playerId);
    const idx = p.hand.findIndex((c) => c.id === cardId);
    if (idx === -1) throw new GameError("Vous n'avez pas cette carte.");
    const card = p.hand[idx];
    if (this.hasDrawn && card.id !== this.drawnCardId) throw new GameError('Vous ne pouvez jouer que la carte piochée.');
    if (!isPlayable(card, this.top(), this.currentColor)) throw new GameError('Cette carte ne peut pas être jouée.');
    if (card.color === 'wild' && !COLORS.includes(chosenColor)) throw new GameError('Choisissez une couleur.');

    this.closeVulnerability(playerId);
    p.hand.splice(idx, 1);
    this.discard.push(card);
    this.currentColor = card.color === 'wild' ? chosenColor : card.color;
    this.log({ type: 'play', playerId, card, color: this.currentColor });

    if (p.hand.length === 0) {
      this.status = 'ended';
      this.winnerId = playerId;
      this.vulnerable = null;
      this.log({ type: 'win', playerId });
      return { ok: true, won: true };
    }
    if (p.hand.length === 1 && !p.saidFoo) {
      this.vulnerable = playerId;
      this.vulnerableSeq++;
    }

    const n = this.players.length;
    switch (card.value) {
      case 'skip': {
        const victim = this.players[this.nextIndex()];
        this.log({ type: 'skip', playerId: victim.id });
        this.startTurn(this.nextIndex(this.turn, 2));
        break;
      }
      case 'reverse': {
        if (n === 2) {
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
    return { ok: true };
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

  sayFoo(playerId) {
    if (this.status !== 'playing') throw new GameError('La partie est terminée.');
    const p = this.player(playerId);
    if (!p) throw new GameError('Joueur inconnu.');
    if (p.hand.length > 2) throw new GameError('FOO! se dit quand il vous reste 1 ou 2 cartes.');
    if (p.saidFoo) return { ok: true };
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
        // les cartes restantes ne sont révélées qu'en fin de partie
        hand: this.status === 'ended' && p.id !== viewerId ? p.hand : undefined,
      })),
      hand: me ? me.hand : [],
      playable: me ? this.playableIds(viewerId) : [],
      events: this.events.slice(-15),
    };
  }
}

module.exports = { FooGame, GameError, COLORS, DECK_SIZE, isPlayable, buildDeck };
