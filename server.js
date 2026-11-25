'use strict';
const path = require('path');
const http = require('http');
const os = require('os');
const express = require('express');
const { Server } = require('socket.io');
const { RoomManager } = require('./src/rooms');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const INDEX = path.join(PUBLIC_DIR, 'index.html');

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.static(PUBLIC_DIR, { maxAge: '1h', index: 'index.html' }));

// Lien d'invitation : https://mon-site/r/ABCDE
app.get('/r/:code', (req, res) => res.sendFile(INDEX));

const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 10_000,
  pingTimeout: 8_000,
  maxHttpBufferSize: 10_000,
});
const rooms = new RoomManager(io);
io.on('connection', (socket) => rooms.handleConnection(socket));

app.get('/health', (req, res) => res.json({ ok: true, ...rooms.stats() }));

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

// En local, quand la page est ouverte via "localhost", le client demande l'adresse Wi-Fi
// pour que les liens d'invitation fonctionnent sur les téléphones. Réservé aux requêtes locales.
app.get('/api/lan', (req, res) => {
  const ip = req.socket.remoteAddress || '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) return res.status(404).end();
  res.json({ addresses: lanAddresses(), port: PORT });
});

server.listen(PORT, () => {
  console.log(`\n  OneFOO est lancé !`);
  console.log(`  ➜ Sur cet ordinateur : http://localhost:${PORT}`);
  for (const address of lanAddresses()) console.log(`  ➜ Sur votre téléphone (même Wi-Fi) : http://${address}:${PORT}`);
  console.log(`  (Si le téléphone n'y accède plus, l'adresse Wi-Fi a pu changer : redémarrez le serveur pour voir la nouvelle.)\n`);
});

module.exports = { server, io, rooms };
