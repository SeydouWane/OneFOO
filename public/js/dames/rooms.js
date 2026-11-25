/** Salons du jeu de dames (fichier partagé navigateur + serveur), sur le modèle commun des duels. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('../core/duel-rooms.js'));
  else root.DamesRooms = factory(root.DamesEngine, root.DuelRooms);
})(typeof self !== 'undefined' ? self : this, function (Engine, Duel) {
  'use strict';
  const LINES = {
    start: [
      'Aux dames, je ne pardonne rien. Prépare-toi !',
      "Je vais pas te ménager aujourd'hui !",
      'Allez {name}, avance tes pions… si tu oses !',
      'Damier propre, cerveau chaud. On y va !',
    ],
    botCapture: ['Et hop, je mange ton pion !', 'Merci pour le cadeau, {name} !', 'Un de moins ! Hahaha !'],
    bigCapture: ['Rafle ! Plusieurs d’un coup, ça c’est du jeu !', 'Quelle rafle ! Même mon fils n’aurait pas laissé ça, hahaha !'],
    humanCapture: ['Aïe ! Tu as mangé mon pion…', "Hé ! Celle-là, je ne l'avais pas vue.", 'D’accord, bien joué… pour cette fois.'],
    botPromote: ['Dame ! Ma reine va faire le ménage, hahaha !', 'Et voilà ma dame. Tu vas souffrir.'],
    humanPromote: ['Hein ?! Une dame… bon, je vais m’en occuper.', 'Bien joué pour la dame. Mais ça ne suffira pas !'],
    botWin: ['Plus rien à jouer pour toi ! Je te gagne, on rejoue ?', 'Trop facile ! Tu as pris ton déjeuner ce matin ?', 'Victoire ! Reviens quand tu auras révisé tes rafles.'],
    humanWin: ["Quoi ?! Tu m'as battu aux dames ?!", 'Bon… bien joué. Mais je monte de niveau et je reviens !', 'Revanche ! Tout de suite !'],
    draw: ['Match nul… on tourne en rond, hein ?', 'Égalité. La prochaine, je te dévore !'],
    humanIdle: ['Allô ? Tu dors ou quoi ?', 'Tu réfléchis ou tu fais la sieste ?', 'Bouge un pion, voyons !'],
  };

  return Duel.create({
    kind: 'dames',
    Game: Engine.DamesGame,
    botLevel: 5,
    lines: LINES,
    profile: (level) => Engine.profile(level),
    chooseMove: Engine.chooseMove,
    banterEvent(e, { add, isHuman, isSpeaker }) {
      if (e.type === 'capture') {
        if (isSpeaker(e.playerId) && isHuman(e.target)) add(e.count >= 2 ? 'bigCapture' : 'botCapture', e.playerId, e.target, 2, e.count >= 2 ? 0.95 : 0.5);
        else if (isHuman(e.playerId) && isSpeaker(e.target)) add('humanCapture', e.target, e.playerId, 2, 0.55);
      } else if (e.type === 'promote') {
        if (isSpeaker(e.playerId)) add('botPromote', e.playerId, e.target, 3, 0.9);
        else if (isHuman(e.playerId) && isSpeaker(e.target)) add('humanPromote', e.target, e.playerId, 3, 0.85);
      }
    },
  });
});
