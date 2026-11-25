'use strict';
/** Accès partagé au stockage (Upstash sur Vercel, mémoire en local) pour toutes les fonctions de l'API. */
const { createStore } = require('./store');

let store; // créé à la première requête (réutilisé tant que l'instance vit)
const getStore = () => (store === undefined ? (store = createStore()) : store);
const setStore = (s) => (store = s); // tests

module.exports = { getStore, setStore };
