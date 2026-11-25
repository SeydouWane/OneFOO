'use strict';
/**
 * Stockage des salons "entre amis".
 *  - UpstashStore : Redis Upstash (API REST), utilisé sur Vercel. Variables d'environnement ajoutées
 *    automatiquement par l'intégration Upstash du Marketplace Vercel (KV_REST_API_URL / KV_REST_API_TOKEN)
 *    ou UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN.
 *  - MemoryStore  : en mémoire, pour le développement local et les tests.
 *
 * Chaque salon est un hash Redis { v: version, d: JSON }. L'écriture est un "compare-and-set" atomique
 * (script Lua) : si deux joueurs agissent en même temps, l'un des deux recommence avec l'état à jour.
 */
const { parseRoom } = require('./games');

const PREFIX = 'onefoo:room:';
const TTL_SECONDS = 2 * 60 * 60; // un salon inactif disparaît après 2 h

const CAS_SCRIPT = [
  "local cur = redis.call('HGET', KEYS[1], 'v')",
  "if (cur or '0') ~= ARGV[1] then return 0 end",
  "redis.call('HSET', KEYS[1], 'v', ARGV[2], 'd', ARGV[3])",
  "redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]))",
  'return 1',
].join('\n');

// Messages de mise en relation audio (WebRTC) : une petite file par destinataire, qui expire vite.
const SIG_PREFIX = 'onefoo:sig:';
const SIG_TTL_SECONDS = 90;
const SIG_PUSH_SCRIPT = ["redis.call('RPUSH', KEYS[1], ARGV[1])", "redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))", 'return 1'].join('\n');
const SIG_TAKE_SCRIPT = ["local v = redis.call('LRANGE', KEYS[1], 0, -1)", "redis.call('DEL', KEYS[1])", 'return v'].join('\n');
const sigKey = (code, to) => `${SIG_PREFIX}${code}:${to}`;

const serialize = (room) => JSON.stringify(room);
function deserialize(v, d) {
  const room = parseRoom(d);
  room.version = Number(v);
  return room;
}

class MemoryStore {
  constructor() {
    this.map = new Map();
    this.sig = new Map();
    this.kind = 'memory';
  }
  async pushSignal(code, to, msg) {
    const key = sigKey(code, to);
    const list = (this.sig.get(key) || []).filter((e) => e.exp >= Date.now());
    list.push({ msg: JSON.stringify(msg), exp: Date.now() + SIG_TTL_SECONDS * 1000 });
    this.sig.set(key, list);
  }
  async takeSignals(code, to) {
    const key = sigKey(code, to);
    const list = (this.sig.get(key) || []).filter((e) => e.exp >= Date.now());
    this.sig.delete(key);
    return list.map((e) => JSON.parse(e.msg));
  }
  async load(code) {
    const e = this.map.get(code);
    if (!e || e.exp < Date.now()) return null;
    return deserialize(e.v, e.d);
  }
  async save(room, expected) {
    const e = this.map.get(room.code);
    const cur = e && e.exp >= Date.now() ? e.v : '0';
    if (cur !== String(expected)) return false;
    this.map.set(room.code, { v: String(room.version), d: serialize(room), exp: Date.now() + TTL_SECONDS * 1000 });
    return true;
  }
  async remove(code) {
    this.map.delete(code);
  }
}

class UpstashStore {
  constructor(url, token, fetchImpl = globalThis.fetch) {
    this.url = url.replace(/\/+$/, '');
    this.token = token;
    this.fetch = fetchImpl;
    this.kind = 'upstash';
  }
  async cmd(args) {
    const res = await this.fetch(this.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    let json = {};
    try {
      json = await res.json();
    } catch (_) {}
    if (!res.ok || json.error) throw new Error(`Upstash ${args[0]} : ${json.error || res.status}`);
    return json.result;
  }
  async load(code) {
    const [v, d] = (await this.cmd(['HMGET', PREFIX + code, 'v', 'd'])) || [];
    if (!v || !d) return null;
    return deserialize(v, d);
  }
  async save(room, expected) {
    const r = await this.cmd(['EVAL', CAS_SCRIPT, '1', PREFIX + room.code, String(expected), String(room.version), serialize(room), String(TTL_SECONDS)]);
    return Number(r) === 1;
  }
  async remove(code) {
    await this.cmd(['DEL', PREFIX + code]);
  }
  async pushSignal(code, to, msg) {
    await this.cmd(['EVAL', SIG_PUSH_SCRIPT, '1', sigKey(code, to), JSON.stringify(msg), String(SIG_TTL_SECONDS)]);
  }
  async takeSignals(code, to) {
    const list = (await this.cmd(['EVAL', SIG_TAKE_SCRIPT, '1', sigKey(code, to)])) || [];
    return list.map((s) => JSON.parse(s));
  }
}

/** Upstash si configuré ; sinon mémoire en local ; null sur Vercel sans base (mode amis indisponible). */
function createStore(env = process.env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (url && token) return new UpstashStore(url, token);
  if (env.VERCEL) return null; // la mémoire n'est pas partagée entre les instances Vercel
  return new MemoryStore();
}

module.exports = { createStore, MemoryStore, UpstashStore, CAS_SCRIPT, SIG_PUSH_SCRIPT, SIG_TAKE_SCRIPT, PREFIX, TTL_SECONDS };
