/** Salons d'Awalé (fichier partagé navigateur + serveur), sur le modèle commun des duels. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('../core/duel-rooms.js'));
  else root.AwaleRooms = factory(root.AwaleEngine, root.DuelRooms);
})(typeof self !== 'undefined' ? self : this, function (Engine, Duel) {
  'use strict';
  const LINES = {
    start: [
      'On sème, on récolte… et c’est moi qui récolte, hahaha !',
      "Je vais pas te ménager aujourd'hui !",
      'Allez {name}, montre-moi comment on joue à l’awalé chez toi !',
      'Les graines, ça me connaît. Prépare-toi.',
    ],
    botCapture: ['Je ramasse tout ça, merci !', 'Hop, dans mon grenier ! Hahaha !', 'Merci pour les graines, {name} !'],
    bigCapture: ['Grosse récolte ! Tu m’as servi ça sur un plateau, hahaha !', 'Waouh, quelle moisson ! Même mon fils ne laisse pas autant de graines.'],
    humanCapture: ['Hé ! Rends-moi mes graines !', 'Aïe… tu as bien semé, je l’avoue.', "D'accord, celle-là tu l'as bien vue."],
    grandSlam: ['Pas le droit de tout prendre, hein ! Il faut laisser à manger.'],
    botWin: ['Mon grenier est plein ! Je te gagne, on rejoue ?', 'Trop facile ! Tu as pris ton déjeuner ce matin ?', 'Victoire ! Reviens quand tu auras révisé tes semis.'],
    humanWin: ["Quoi ?! Tu m'as affamé…", 'Bon… bien joué. Mais je monte de niveau et je reviens !', 'Revanche ! Tout de suite !'],
    draw: ['24 partout… tu as eu peur, hein ?', 'Match nul. La prochaine, je remplis mon grenier !'],
    humanIdle: ['Allô ? Les graines ne vont pas se semer toutes seules !', 'Tu réfléchis ou tu fais la sieste ?', 'Choisis une case, voyons !'],
  };

  return Duel.create({
    kind: 'awale',
    Game: Engine.AwaleGame,
    botLevel: 6,
    lines: LINES,
    profile: (level) => Engine.profile(level),
    chooseMove: Engine.chooseMove,
    banterEvent(e, { add, isHuman, isSpeaker, anyBot, firstHuman }) {
      if (e.type === 'capture') {
        if (isSpeaker(e.playerId) && isHuman(e.target)) add(e.count >= 5 ? 'bigCapture' : 'botCapture', e.playerId, e.target, 2, e.count >= 5 ? 0.95 : 0.65);
        else if (isHuman(e.playerId) && isSpeaker(e.target)) add('humanCapture', e.target, e.playerId, 2, 0.65);
      } else if (e.type === 'grandslam' && isHuman(e.playerId)) add('grandSlam', anyBot(), firstHuman, 1, 0.8);
    },
  });
});
