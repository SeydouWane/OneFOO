/**
 * Salons du Morpion (fichier partagé navigateur + serveur), sur le modèle commun des duels.
 *  - solo    : contre le système ; la grille et la finesse du système dépendent du niveau.
 *  - friends : 2 joueurs (ou 1 + bot), l'hôte choisit la grille, on alterne qui commence.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./engine.js'), require('../core/rooms-core.js'), require('../core/duel-rooms.js'));
  } else root.MorpionRooms = factory(root.MorpionEngine, root.RoomsCore, root.DuelRooms);
})(typeof self !== 'undefined' ? self : this, function (Engine, Core, Duel) {
  'use strict';
  const { GameError } = Core;
  const SIZES = [3, 6, 9];

  const LINES = {
    start: [
      'Prêt à perdre au morpion ?',
      'Allez {name}, aligne si tu peux… hahaha !',
      "Je vais pas te ménager aujourd'hui !",
      'Le morpion, c’est mon jeu. Tu vas voir.',
    ],
    startBig: ['Grande grille, grosse défaite pour toi, hahaha !', 'Sur une grille pareille, je vois tout. Bonne chance !'],
    botThreat: ['Hmm… tu vois ce que je prépare ?', 'Attention, ça sent mauvais pour toi !', 'Je dis ça, je dis rien… mais regarde bien la grille.'],
    botBlock: ["Bloqué ! Tu croyais que je n'avais pas vu ?", 'Ah non, pas par là ! Hahaha !', 'Bien essayé, mais non.'],
    humanBlock: ["Hé ! Tu m'as bloqué…", "D'accord, tu as vu. Pas mal."],
    humanThreat: ['Oh oh… attends, je réfléchis.', "Hein ?! D'où ça sort, ça ?"],
    botWin: [
      'Aligné ! Je te gagne, on rejoue ?',
      'Trop facile ! Même mon fils fait mieux que toi au morpion, hahaha !',
      'Et voilà ! Tu as pris ton déjeuner ce matin ?',
    ],
    humanWin: ["Quoi ?! Tu as triché, c'est sûr !", 'Bon… bien joué. Mais je monte de niveau et je reviens !', 'Revanche ! Tout de suite !'],
    draw: ['Match nul… tu as eu peur de perdre, hein ?', 'Égalité. On recommence, et cette fois je gagne !'],
    humanIdle: ['Allô ? Tu dors ou quoi ?', 'Il y a des cases libres, hein, choisis-en une !', 'Tu réfléchis ou tu fais la sieste ?'],
  };

  const rooms = Duel.create({
    kind: 'morpion',
    Game: Engine.MorpionGame,
    botLevel: 7,
    lines: LINES,
    makeOptions(mode, level, opts) {
      const size = mode === 'solo' ? Engine.profile(level).size : SIZES.includes(Number(opts.size)) ? Number(opts.size) : 3;
      return { size };
    },
    setOptions(room, data) {
      const size = Number(data.size);
      if (!SIZES.includes(size)) throw new GameError('Grille inconnue.');
      room.options.size = size;
    },
    profile: (level, options) => Object.assign({}, Engine.profile(level), { size: options.size || Engine.profile(level).size }),
    chooseMove: Engine.chooseMove,
    startKey: (g, rng) => (g.size > 3 && rng() < 0.5 ? 'startBig' : 'start'),
    banterEvent(e, { g, add, isHuman, isSpeaker }) {
      if (e.type === 'threat') {
        if (isSpeaker(e.playerId) && isHuman(e.target)) add('botThreat', e.playerId, e.target, 2, g.size === 3 ? 0.45 : 0.75);
        else if (isHuman(e.playerId) && isSpeaker(e.target)) add('humanThreat', e.target, e.playerId, 1, 0.5);
      } else if (e.type === 'block') {
        if (isSpeaker(e.playerId) && isHuman(e.target)) add('botBlock', e.playerId, e.target, 2, 0.8);
        else if (isHuman(e.playerId) && isSpeaker(e.target)) add('humanBlock', e.target, e.playerId, 2, 0.7);
      }
    },
  });

  return Object.assign({ SIZES }, rooms);
});
