'use strict';
/** Petits outils HTTP communs aux fonctions /api/account et /api/admin (Vercel et serveur local). */
const { GameError } = require('../public/js/core/rooms-core.js');

function send(res, statusCode, obj, contentType = 'application/json; charset=utf-8') {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-store');
  res.end(typeof obj === 'string' ? obj : JSON.stringify(obj));
}

function query(req) {
  return req.query || Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 32768) throw new GameError('Requête trop volumineuse.');
  }
  return raw ? JSON.parse(raw) : {};
}

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || (req.socket && req.socket.remoteAddress) || 'inconnue';
}

/** Enveloppe commune : erreurs "métier" -> { ok:false, error }, autres -> 500. */
function wrap(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err && err.isGameError) return send(res, err.status || 200, { ok: false, error: err.message });
      if (err instanceof SyntaxError) return send(res, 400, { ok: false, error: 'Requête invalide.' });
      console.error('[api]', err);
      send(res, 500, { ok: false, error: 'Erreur serveur, réessayez.' });
    }
  };
}

module.exports = { send, query, readBody, clientIp, wrap };
