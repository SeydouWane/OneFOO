'use strict';
/**
 * Serveur local de développement : reproduit le déploiement Vercel
 * (fichiers statiques de public/ + fonction /api/room) avec un stockage en mémoire.
 *   npm start   ->  http://localhost:3000
 */
const path = require('path');
const os = require('os');
const express = require('express');
const apiHandler = require('./src/api');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const app = express();
app.disable('x-powered-by');
app.use(express.static(PUBLIC_DIR));
app.get('/r/:code', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.all('/api/room', express.json({ limit: '32kb' }), (req, res) => apiHandler(req, res));

/** Adresses IPv4 du réseau local (recalculées à chaque appel : l'IP Wi-Fi peut changer). */
function lanAddresses() {
  const out = [];
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets || []) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.')) out.push(net.address);
    }
  }
  return out;
}

// Page ouverte via "localhost" : le client demande l'adresse Wi-Fi pour que les liens
// d'invitation fonctionnent sur les téléphones. Réservé aux requêtes venant de cet ordinateur.
app.get('/api/lan', (req, res) => {
  const ip = req.socket.remoteAddress || '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) return res.status(404).end();
  res.json({ addresses: lanAddresses(), port: PORT });
});

const server = app.listen(PORT, () => {
  console.log(`\n  OneFOO (local) est lancé !`);
  console.log(`  -> Sur cet ordinateur : http://localhost:${PORT}`);
  for (const address of lanAddresses()) console.log(`  -> Sur votre téléphone (même Wi-Fi) : http://${address}:${PORT}`);
  console.log(`  (Si le téléphone n'y accède plus, l'adresse Wi-Fi a pu changer : redémarrez pour voir la nouvelle.)\n`);
});

module.exports = { app, server };
