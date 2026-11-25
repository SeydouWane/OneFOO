# OneFOO

Application web (responsive, pensée pour le téléphone) pour jouer en ligne **contre le système** ou **entre amis** via un code / un lien.

Premier jeu : **FOO!**, un jeu de cartes de couleurs (même couleur ou même valeur, +2, Joker +4, Passe, Inverse…).
On annonce « FOO! » quand il ne reste qu'une carte, sinon un adversaire peut vous attraper (+2 cartes).

## Fonctionnalités

- **Contre le système** : à chaque victoire, le système monte d'un niveau (Débutant → Apprenti → Joueur → Confirmé → Expert → Maître → Légende).
  Plus le niveau est haut, plus il y a d'adversaires IA (1 → 3), plus ils jouent finement et plus ils vous attrapent si vous oubliez FOO!.
  Le niveau et les statistiques sont enregistrés sur l'appareil du joueur (pas de compte nécessaire).
- **Entre amis** : créez un salon, partagez le **code à 5 caractères**, le **lien** (`/r/CODE`) ou envoyez-le par **WhatsApp**.
  2 à 6 joueurs, bots optionnels, 30 s par tour, revanche, score du salon, réactions emoji.
- Reconnexion automatique (recharger la page ramène dans la partie). Un joueur qui quitte en cours de manche est remplacé par un bot.
- Installable sur l'écran d'accueil du téléphone (manifeste web).

## Lancer en local

Prérequis : Node.js 18 ou plus récent.

```bash
npm install
npm start
```

Ouvrez http://localhost:3000. Pour tester sur votre téléphone, connectez-le au même Wi-Fi et ouvrez l'adresse
`http://192.168.x.x:3000` affichée dans le terminal au démarrage.

Tests : `npm test` (moteur de jeu + parties en ligne simulées avec de vrais clients Socket.io).

## Mettre en ligne

Le serveur garde une connexion temps réel (WebSocket) avec chaque joueur. Il faut donc un hébergeur qui exécute
un serveur Node.js en continu : **Render**, Railway, Fly.io ou un VPS. Les hébergeurs « serverless » comme Vercel ou Netlify ne conviennent pas.

**Render (gratuit)** : poussez ce dossier sur GitHub, puis sur render.com faites *New → Blueprint* et choisissez le dépôt.
Le fichier `render.yaml` configure tout. Sur l'offre gratuite, le serveur s'endort après 15 min sans visite :
le premier chargement prend alors environ 30 s.

Variables d'environnement : `PORT` (fournie par l'hébergeur).

## Structure

```
server.js                 serveur HTTP + Socket.io
src/rooms.js              salons, codes, bots, minuteurs, reconnexion
src/games/foo/engine.js   règles du jeu FOO! (le serveur est l'unique arbitre)
src/games/foo/bot.js      IA du système et réglage de la difficulté par niveau
public/                   interface (HTML/CSS/JS sans framework ni étape de build)
tests/                    tests automatisés
```

## Limites actuelles (version simple)

- Les salons sont gardés en mémoire : un redémarrage du serveur termine les parties en cours.
  Un salon sans joueur connecté est supprimé au bout de 15 min.
- Le niveau du système est stocké dans le navigateur. Changer de téléphone ou vider les données remet le niveau à 1.
  Des comptes joueurs pourraient être ajoutés plus tard.
- Un seul serveur à la fois. Pour en faire tourner plusieurs, il faudrait un adaptateur Redis pour Socket.io.

## Ajouter un jeu

Créez `src/games/<jeu>/` (moteur + bot) sur le modèle de `foo/`, branchez-le dans `src/rooms.js`, puis remplacez la tuile
« Bientôt » correspondante dans `public/index.html`.
