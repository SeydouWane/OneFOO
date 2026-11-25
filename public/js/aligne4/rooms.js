/** Salons d'Aligne 4 (fichier partagé navigateur + serveur), sur le modèle commun des duels. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('../core/duel-rooms.js'));
  else root.Aligne4Rooms = factory(root.Aligne4Engine, root.DuelRooms);
})(typeof self !== 'undefined' ? self : this, function (Engine, Duel) {
  'use strict';
  const LINES = {
    start: [
      'Aligne 4 ? Je vais te faire tourner la tête, hahaha !',
      "Je vais pas te ménager aujourd'hui !",
      'Allez {name}, lâche tes jetons… je t’attends.',
      'Quatre à la suite, c’est ma spécialité.',
    ],
    botThreat: ['Attention… regarde bien cette colonne !', 'Hmm, je sens que ça va tomber pour moi.', 'Tu vois ce que je prépare, ou pas ?'],
    botBlock: ['Bloqué ! Pas par là, mon ami… hahaha !', "Tu croyais que je n'avais pas vu ?", 'Bien essayé, mais non.'],
    humanBlock: ['Hé ! Tu as vu mon piège…', "D'accord, d'accord. Pas mal."],
    humanThreat: ['Oh oh… attends, laisse-moi réfléchir.', "Hein ?! D'où sort cette menace ?"],
    botWin: ['Quatre à la suite ! Je te gagne, on rejoue ?', 'Trop facile ! Même mon fils fait mieux, hahaha !', 'Et voilà ! Tu as pris ton déjeuner ce matin ?'],
    humanWin: ["Quoi ?! Je n'ai pas vu venir celle-là…", 'Bon… bien joué. Mais je monte de niveau et je reviens !', 'Revanche ! Tout de suite !'],
    draw: ['Grille pleine… tu as eu chaud, hein ?', 'Match nul. La prochaine, je gagne !'],
    humanIdle: ['Allô ? Tu dors ou quoi ?', 'Choisis une colonne, il y en a sept !', 'Tu réfléchis ou tu fais la sieste ?'],
  };

  return Duel.create({
    kind: 'aligne4',
    Game: Engine.Aligne4Game,
    botLevel: 6,
    lines: LINES,
    profile: (level) => Engine.profile(level),
    chooseMove: Engine.chooseMove,
    banterEvent(e, { add, isHuman, isSpeaker }) {
      if (e.type === 'threat') {
        if (isSpeaker(e.playerId) && isHuman(e.target)) add('botThreat', e.playerId, e.target, 2, 0.7);
        else if (isHuman(e.playerId) && isSpeaker(e.target)) add('humanThreat', e.target, e.playerId, 1, 0.5);
      } else if (e.type === 'block') {
        if (isSpeaker(e.playerId) && isHuman(e.target)) add('botBlock', e.playerId, e.target, 2, 0.8);
        else if (isHuman(e.playerId) && isSpeaker(e.target)) add('humanBlock', e.target, e.playerId, 2, 0.7);
      }
    },
  });
});
