/**
 * IA du "système" pour FOO! (fichier partagé navigateur + serveur).
 * Le niveau (1, 2, 3...) contrôle : nombre d'adversaires, finesse des choix,
 * mémoire pour annoncer FOO! et vigilance pour attraper un joueur qui oublie.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.FooBot = factory(root.FooEngine);
})(typeof self !== 'undefined' ? self : this, function (Engine) {
  'use strict';
  const { COLORS } = Engine;

  const LEVEL_TITLES = [
    [1, 'Débutant'],
    [2, 'Apprenti'],
    [4, 'Joueur'],
    [6, 'Confirmé'],
    [9, 'Expert'],
    [12, 'Maître'],
    [15, 'Légende'],
  ];

  function levelTitle(level) {
    let title = LEVEL_TITLES[0][1];
    for (const [min, t] of LEVEL_TITLES) if (level >= min) title = t;
    return title;
  }

  function profile(level) {
    const lv = Math.max(1, Math.min(99, Math.floor(level) || 1));
    const skill = Math.min(1, (lv - 1) / 12); // 0 au niveau 1, 1 au niveau 13+
    return {
      level: lv,
      skill,
      title: levelTitle(lv),
      opponents: lv <= 2 ? 1 : lv <= 5 ? 2 : 3,
      fooChance: 0.6 + 0.4 * skill, // le bot pense à dire FOO!
      catchChance: 0.12 + 0.83 * skill, // le bot vous attrape si vous oubliez
      catchDelay: Math.round(3200 - 2000 * skill), // ms avant de vous attraper
      thinkMs: [900, 1600],
    };
  }

  function colorCounts(hand) {
    const counts = { red: 0, yellow: 0, green: 0, blue: 0 };
    for (const c of hand) if (c.color !== 'wild') counts[c.color]++;
    return counts;
  }

  function chooseColor(hand, skill, rng = Math.random) {
    if (rng() > 0.3 + 0.7 * skill) return COLORS[Math.floor(rng() * 4)];
    const counts = colorCounts(hand);
    let best = [];
    let max = -1;
    for (const col of COLORS) {
      if (counts[col] > max) {
        max = counts[col];
        best = [col];
      } else if (counts[col] === max) best.push(col);
    }
    return best[Math.floor(rng() * best.length)];
  }

  /**
   * Choisit la carte à jouer, ou null s'il faut piocher.
   * @returns {{cardId:string,color?:string}|null}
   */
  function chooseMove(game, botId, skill, rng = Math.random) {
    const allowed = new Set(game.playableIds(botId));
    if (!allowed.size) return null;
    const me = game.player(botId);
    const playable = me.hand.filter((c) => allowed.has(c.id));

    let pick;
    if (rng() < (1 - skill) * 0.55) {
      // Coup "naïf"
      pick = playable[Math.floor(rng() * playable.length)];
    } else {
      const n = game.players.length;
      const next = game.players[game.nextIndex()];
      const prev = game.players[game.nextIndex(game.turn, -1)];
      const counts = colorCounts(me.hand);
      const top = game.top();
      const myCount = me.hand.length;

      let bestScore = -Infinity;
      for (const card of playable) {
        let s = 0;
        if (card.color === 'wild') {
          s -= 6; // on garde les Jokers pour plus tard
          if (card.value === 'wild4') s -= 2;
          if (myCount <= 3) s += 6;
          if (next.hand.length <= 2) s += card.value === 'wild4' ? 12 : 3;
        } else {
          s += counts[card.color] * 1.2; // rester sur sa couleur forte
          if (card.color !== game.currentColor && card.value === top.value) {
            s += (counts[card.color] - counts[game.currentColor]) * 0.8;
          }
          if (card.value === 'skip' || card.value === 'draw2' || card.value === 'reverse') {
            s += 1;
            if (next.hand.length <= 2) s += 8;
            if (card.value === 'draw2') s += 1;
            if (card.value === 'reverse' && n > 2 && prev.hand.length <= 2) s -= 6;
          } else {
            s += Number(card.value) * 0.1;
          }
        }
        s += rng() * (1.6 - skill);
        if (s > bestScore) {
          bestScore = s;
          pick = card;
        }
      }
    }

    const move = { cardId: pick.id };
    if (pick.color === 'wild') {
      const rest = me.hand.filter((c) => c.id !== pick.id);
      move.color = chooseColor(rest, skill, rng);
    }
    return move;
  }

  /**
   * Une étape de jeu d'un bot : poser une carte, sinon piocher, sinon passer.
   * Après une pioche jouable, l'appelant rappelle playStep (avec un délai visible).
   */
  function playStep(game, botId, prof, rng = Math.random) {
    const me = game.player(botId);
    const move = chooseMove(game, botId, prof.skill, rng);
    if (move) {
      if (me.hand.length === 2 && rng() < prof.fooChance) game.sayFoo(botId);
      game.play(botId, move.cardId, move.color);
      return { action: 'play', move };
    }
    if (!game.hasDrawn) {
      const res = game.draw(botId);
      return { action: 'draw', playable: res.playable };
    }
    game.pass(botId);
    return { action: 'pass' };
  }

  /** Tour complet sans délai (simulations / tests). */
  function playTurn(game, botId, prof, rng = Math.random) {
    if (game.vulnerable && game.vulnerable !== botId && rng() < prof.catchChance) {
      game.catchFoo(botId, game.vulnerable);
    }
    let r = playStep(game, botId, prof, rng);
    if (r.action === 'draw' && r.playable) r = playStep(game, botId, prof, rng);
    return r;
  }

  return { profile, levelTitle, chooseMove, chooseColor, playStep, playTurn };
});
