'use strict';
/** Registre des jeux de la plateforme : type de salon -> logique des salons (partagée avec le navigateur). */
const GAMES = {
  foo: require('../public/js/foo/rooms.js'),
  morpion: require('../public/js/morpion/rooms.js'),
  aligne4: require('../public/js/aligne4/rooms.js'),
  awale: require('../public/js/awale/rooms.js'),
  dames: require('../public/js/dames/rooms.js'),
};

/** Logique du jeu d'un salon (les anciens salons sans type sont des parties de FOO!). */
const roomsFor = (roomOrKind) => {
  const kind = typeof roomOrKind === 'string' ? roomOrKind : roomOrKind && roomOrKind.kind;
  return GAMES[kind] || GAMES.foo;
};

/** Reconstruit un salon depuis son JSON, selon son type. */
function parseRoom(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  return roomsFor(data).parse(data);
}

module.exports = { GAMES, roomsFor, parseRoom };
