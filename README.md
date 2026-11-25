# OneFOO

Application web (responsive, pensée pour le téléphone) pour jouer en ligne **contre le système** ou **entre amis** via un code / un lien.

Premier jeu : **FOO!**, un jeu de cartes de couleurs (même couleur ou même valeur, +2, Joker +4, Passe, Inverse…).
On annonce « FOO! » quand il ne reste qu'une carte, sinon un adversaire peut vous attraper (+2 cartes).

## Fonctionnalités

- **Contre le système** : à chaque victoire, le système monte d'un niveau (Débutant → Apprenti → Joueur → Confirmé → Expert → Maître → Légende).
  Plus le niveau est haut, plus il y a d'adversaires IA (1 → 3), plus ils jouent finement et plus ils vous attrapent si vous oubliez FOO!.
  Ce mode tourne entièrement dans le navigateur : instantané, et la partie reprend après un rechargement de page.
  Le niveau et les statistiques sont enregistrés sur l'appareil (pas de compte nécessaire).
- **Entre amis** : créez un salon, partagez le **code à 5 caractères**, le **lien** (`/r/CODE`) ou envoyez-le par **WhatsApp**.
  2 à 6 joueurs, bots optionnels, 30 s par tour, revanche, score du salon, réactions emoji.
  Un joueur qui quitte en cours de manche est remplacé par un bot.
- Installable sur l'écran d'accueil du téléphone (manifeste web).

## Architecture (compatible Vercel)

```
public/                    site statique (HTML/CSS/JS, sans étape de build)
public/js/foo/engine.js    règles du jeu FOO!          } partagés navigateur + serveur
public/js/foo/bot.js       IA du système et niveaux    }
public/js/foo/rooms.js     logique des salons          }
api/room.js                fonction Vercel /api/room (mode entre amis)
src/api.js                 API : créer / rejoindre / jouer / rafraîchir
src/store.js               stockage des salons : Upstash Redis (Vercel) ou mémoire (local)
local-server.js            serveur de développement local (reproduit Vercel)
tests/                     tests automatisés
```

- **Entre amis**, chaque téléphone rafraîchit le salon toutes les ~1,2 s (`GET /api/room`) et envoie ses coups (`POST /api/room`).
  Les coups des bots et le minuteur de 30 s avancent à chaque rafraîchissement : aucun processus permanent n'est nécessaire.
- Les écritures en base sont atomiques (compare-and-set) : deux joueurs qui agissent en même temps ne s'écrasent pas.
- Chaque appareil garde une clé secrète ; l'identifiant visible des autres en est dérivé. Personne ne peut jouer à la place d'un autre.
- Le serveur est l'unique arbitre en mode amis : les mains adverses ne sont jamais envoyées au navigateur.

## Lancer en local

Prérequis : Node.js 18 ou plus récent.

```bash
npm install
npm start
```

Ouvrez http://localhost:3000. Pour tester sur votre téléphone, connectez-le au même Wi-Fi et ouvrez l'adresse
`http://192.168.x.x:3000` affichée dans le terminal au démarrage. En local, les salons sont gardés en mémoire.

Tests : `npm test` (moteur de jeu, salons, API HTTP de bout en bout, adaptateur Redis).

## Déployer sur Vercel

1. Importez le dépôt GitHub dans Vercel (*Add New → Project*). Aucun réglage à changer : `vercel.json` s'en occupe.
2. Pour le mode **entre amis**, ajoutez une base Redis gratuite : dans le projet Vercel, onglet **Storage → Create Database →
   Upstash (Redis)**, offre gratuite, puis connectez-la au projet. Les variables `KV_REST_API_URL` et `KV_REST_API_TOKEN`
   sont ajoutées automatiquement.
3. Redéployez (onglet *Deployments → Redeploy*) pour que les variables soient prises en compte.

Sans base Redis, le mode contre le système fonctionne déjà ; le mode entre amis affiche un message explicatif.

Ordre de grandeur des quotas gratuits : une partie de 10 min à 4 humains représente environ 2 000 requêtes à Redis
et autant d'appels de fonction. L'offre gratuite d'Upstash et l'offre Hobby de Vercel suffisent donc pour quelques centaines
de parties par mois.

## Limites actuelles (version simple)

- Le niveau du système est stocké dans le navigateur. Changer de téléphone ou vider les données remet le niveau à 1.
  Des comptes joueurs pourraient être ajoutés plus tard.
- Entre amis, les actions des autres joueurs apparaissent avec ~1 s de décalage (rafraîchissement régulier, pas de temps réel pur).
- Un salon inactif est supprimé de la base au bout de 2 h.

## Ajouter un jeu

Créez `public/js/<jeu>/` (moteur, bot, salons) sur le modèle de `foo/`, ajoutez sa route d'API, puis remplacez la tuile
« Bientôt » correspondante dans `public/index.html`.
