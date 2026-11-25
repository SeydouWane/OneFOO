# OneFOO

Application web (responsive, pensée pour le téléphone) pour jouer en ligne **contre le système** ou **entre amis** via un code / un lien.

Premier jeu : **FOO!**, un jeu de cartes de couleurs (même couleur ou même valeur, +2, Joker +4, Passe, Inverse…).
On annonce « FOO! » quand il ne reste qu'une carte, sinon un adversaire peut vous attraper (+2 cartes).
Plusieurs cartes du même chiffre (couleurs différentes) se posent ensemble ; la dernière posée donne la couleur.
Les +2 et +4 se cumulent : face à un +2, on peut renvoyer un +2 (toute couleur) ou un +4 et la pénalité s'additionne
(+4, +6…) ; un +4 ne se renvoie qu'avec un +4. Celui qui ne peut pas renvoyer pioche le total et passe son tour.
Quand un joueur termine, les autres continuent pour les places suivantes (🥇 🥈 🥉…) jusqu'à ce qu'il n'en reste qu'un ;
s'il ne reste que des bots en jeu, la manche s'arrête et ils sont classés selon leurs cartes restantes.
Contre le système, seule la 1re place fait monter le système de niveau.

Deuxième jeu : **Morpion** (2 joueurs, ✕ contre ◯). Contre le système, la grille grandit avec le niveau :
3×3 (niveaux 1 à 4), 6×6 en alignant 4 (niveaux 5 à 8), 9×9 en alignant 5 (niveau 9 et plus). Le système
commet de moins en moins d'erreurs, repère les doubles menaces aux niveaux élevés et commence la partie aux niveaux 7-8 et 12+.
Entre amis, l'hôte choisit la grille et on alterne qui commence à chaque revanche. Un match nul ne change pas le niveau.

Autres jeux à 2 : **Aligne 4** (grille 7×6, les jetons tombent, aligner 4 ; « Puissance 4 » étant une marque déposée,
le jeu porte un autre nom), **Awalé** (règle abapa : semis, prises à 2-3 graines, interdit d'affamer, 25 graines pour gagner)
et **Dames** internationales 10×10 (prise obligatoire et majoritaire, dames volantes, promotion en fin de coup).
Contre le système, l'IA calcule de plus en plus de coups à l'avance à chaque niveau, et commence aux niveaux élevés.

## Fonctionnalités

- **Contre le système** : à chaque victoire, le système monte d'un niveau (Débutant → Apprenti → Joueur → Confirmé → Expert → Maître → Légende).
  Plus le niveau est haut, plus il y a d'adversaires IA (1 → 3), plus ils jouent finement et plus ils vous attrapent si vous oubliez FOO!.
  Ce mode tourne entièrement dans le navigateur : instantané, et la partie reprend après un rechargement de page.
  Le niveau et les statistiques sont enregistrés sur l'appareil (pas de compte nécessaire).
- **Compte facultatif et classements** : on peut jouer de façon anonyme, sans rien renseigner. Pour apparaître dans les
  classements, on crée un compte avec pseudo, **pays** (liste déroulante, Sénégal en premier), **numéro de téléphone**
  (sans SMS de confirmation), **sexe** et mot de passe. Ensuite, on se reconnecte avec son numéro et son mot de passe ;
  l'appareil reste connecté (session de 400 jours, prolongée à chaque visite).
  - Classement **OneFOO** (meilleur joueur, tous jeux confondus) et un classement **par jeu**, filtrables par pays.
  - Points : contre le système, victoire = 10 + 2 × niveau, nul = 3 + niveau / 2 ; entre amis, victoire = 15 (+5 par
    adversaire en plus), nul = 5, participation = 2.
  - Le numéro et le sexe ne sont jamais affichés publiquement (classements : pseudo, avatar, drapeau du pays).
  - Le niveau du système suit le compte d'un appareil à l'autre.
- **Espace admin** (`/admin`, e-mail + mot de passe) : joueurs inscrits, actifs, parties par jeu (avec compte et anonymes),
  pays, répartition par sexe, activité des 14 derniers jours, meilleurs joueurs, liste des joueurs avec recherche,
  export CSV et mot de passe provisoire pour un joueur qui a oublié le sien.
- **Le système est taquin** : les bots chambrent le joueur (« Je vais pas te ménager aujourd'hui ! », « T'as pas pris de
  déjeuner aujourd'hui ou quoi ? », « Je te gagne ! On rejoue ? »…) dans une bulle, et à voix haute grâce à la synthèse
  vocale du téléphone (une voix par bot). Les répliques dépendent de la partie (début, +2 / +4, pioche, FOO!, attrape,
  lenteur, victoire, défaite) et sont espacées pour rester naturelles. Le bouton 🔊 coupe tout le son.
- **Entre amis** : créez un salon, partagez le **code à 5 caractères**, le **lien** (`/r/CODE`) ou envoyez-le par **WhatsApp**.
  2 à 6 joueurs, bots optionnels, 30 s par tour, revanche, score du salon, réactions emoji.
  Un joueur qui quitte en cours de manche est remplacé par un bot.
- **Micro entre amis** (🎙️) : la voix passe par le relais Cloudflare Realtime (ou directement de téléphone à
  téléphone s'il n'est pas configuré). L'avatar de celui qui parle s'allume en vert. Le bouton 🔊 coupe le jeu et
  les voix du système, pas celles des amis.
- **Main lisible** : ⤢ étale les cartes sur plusieurs lignes, 🎨 / 🔢 les trie par couleur ou par chiffre.
- Installable sur l'écran d'accueil du téléphone (manifeste web).

## Architecture (compatible Vercel)

```
public/                    site statique (HTML/CSS/JS, sans étape de build)
public/js/core/rooms-core.js  socle commun des salons (joueurs, présence, bots, micro, répliques)  } partagés
public/js/foo/engine.js    FOO! : règles                                                       } navigateur
public/js/foo/bot.js       FOO! : IA du système et niveaux                                     } + serveur
public/js/foo/rooms.js     FOO! : salons                                                       }
public/js/core/duel-rooms.js  modèle commun des jeux à 2 + recherche alpha-bêta pour les IA   }
public/js/morpion/engine.js  Morpion : règles et IA (minimax en 3×3, heuristique sinon)        }
public/js/morpion/rooms.js   Morpion : salons                                                  }
public/js/aligne4|awale|dames/engine.js, rooms.js  autres jeux à 2 (règles + IA, salons)      }
public/js/<jeu>/ui.js      affichage de chaque jeu à 2 (plateau, textes, règles), côté navigateur
public/js/core/countries.js  pays, indicatifs et validation des numéros (partagé navigateur + serveur)
public/admin.html, js/admin.js  espace admin
api/room.js                fonction Vercel /api/room (mode entre amis)
api/account.js, admin.js   fonctions Vercel /api/account (comptes, classements) et /api/admin
src/api.js                 API : créer / rejoindre / jouer / rafraîchir
src/account.js             comptes, sessions, points, classements (Redis : ensembles triés)
src/admin.js               statistiques et liste des joueurs pour l'admin
src/games.js               registre des jeux (type de salon -> logique du jeu)
src/store.js               stockage : Upstash Redis (Vercel) ou mémoire (local)
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

Tests : `npm test` (moteur de jeu, salons, API HTTP de bout en bout, comptes et classements, admin, adaptateur Redis).

## Déployer sur Vercel

1. Importez le dépôt GitHub dans Vercel (*Add New → Project*). Aucun réglage à changer : `vercel.json` s'en occupe.
2. Pour le mode **entre amis**, ajoutez une base Redis gratuite : dans le projet Vercel, onglet **Storage → Create Database →
   Upstash (Redis)**, offre gratuite, puis connectez-la au projet. Les variables `KV_REST_API_URL` et `KV_REST_API_TOKEN`
   sont ajoutées automatiquement.
3. Redéployez (onglet *Deployments → Redeploy*) pour que les variables soient prises en compte.

Sans base Redis, le mode contre le système fonctionne déjà ; le mode entre amis affiche un message explicatif.

### Espace admin

Deux variables d'environnement dans Vercel (le mot de passe en clair n'est jamais stocké, ni dans le code ni sur Vercel) :

```
ADMIN_EMAIL=adresse@exemple.sn
ADMIN_PASSWORD_HASH=scrypt$...   # empreinte du mot de passe, à calculer avec :
# node -e "console.log(require('./src/account').hashPassword(process.argv[1]))" 'MotDePasse'
```

Pour changer le mot de passe admin : recalculez l'empreinte, remplacez `ADMIN_PASSWORD_HASH` dans Vercel, puis redéployez.

### Micro sur réseau mobile (optionnel)

**Recommandé : relais Cloudflare Realtime (SFU).** Chaque téléphone se connecte au serveur Cloudflare le plus proche,
y publie sa voix et reçoit celle des autres : ça marche sur tous les réseaux (4G comprise) et chacun n'envoie sa voix
qu'une fois. Créez une application dans dash.cloudflare.com > Realtime > SFU, puis dans Vercel :

```
CF_REALTIME_APP_ID=...      # identifiant de l'application
CF_REALTIME_APP_TOKEN=...   # jeton secret (reste sur le serveur, jamais envoyé aux téléphones)
```

Le serveur garde la session de chaque joueur et ne laisse recevoir que les voix des joueurs du même salon.
Tarif Cloudflare : 1 000 Go gratuits par mois, puis 0,05 $ le Go ; une voix consomme environ 20 Mo par heure et par auditeur.

**Sans ces variables**, le micro relie les téléphones directement (STUN). Cela marche dès qu'un des deux est sur un
Wi-Fi « ouvert », mais **entre deux téléphones en données mobiles** la liaison directe échoue souvent ; un relais TURN
peut alors aider :

```
# Cloudflare Realtime TURN — dash.cloudflare.com > Realtime > TURN : créer une clé
CF_TURN_KEY_ID=...        # identifiant de la clé TURN
CF_TURN_API_TOKEN=...     # jeton d'API de la clé (reste sur le serveur)

# ou Metered / Open Relay — l'adresse complète avec la clé d'API
METERED_TURN_URL=https://<app>.metered.live/api/v1/turn/credentials?apiKey=...

# ou un serveur TURN fixe
TURN_URLS=turn:exemple.relay.com:80,turn:exemple.relay.com:443?transport=tcp
TURN_USERNAME=...
TURN_CREDENTIAL=...
```

Avec Cloudflare, le serveur génère des identifiants valables 24 h (gardés 12 h en cache) ; la clé n'est jamais envoyée
aux téléphones. Une voix relayée consomme environ 20 Mo par heure et par personne écoutée.

Ordre de grandeur des quotas gratuits : une partie de 10 min à 4 humains représente environ 2 000 requêtes à Redis
et autant d'appels de fonction. L'offre gratuite d'Upstash et l'offre Hobby de Vercel suffisent donc pour quelques centaines
de parties par mois.

## Limites actuelles (version simple)

- Sans compte, le niveau du système est stocké dans le navigateur : changer de téléphone ou vider les données le remet à 1.
- Les parties contre le système se jouent dans le navigateur, qui envoie le résultat : un tricheur averti pourrait
  envoyer de fausses victoires (limité à une partie toutes les 5 s, le niveau retenu est celui du serveur). Les parties
  entre amis, arbitrées par le serveur, sont fiables.
- Pas de vérification par SMS : rien n'empêche quelqu'un d'utiliser le numéro d'un autre s'il est encore libre.
- Entre amis, les actions des autres joueurs apparaissent avec ~1 s de décalage (rafraîchissement régulier, pas de temps réel pur).
- La voix du système dépend des voix françaises installées sur le téléphone (plus naturelle sur les téléphones récents).
- Le micro nécessite https (fonctionne sur le site en ligne, pas via `http://192.168.x.x` en local).
- Tous les joueurs d'un salon doivent avoir la même version de la page (rechargée après une mise à jour) pour s'entendre.
- Un salon inactif est supprimé de la base au bout de 2 h.

## Ajouter un jeu

Pour un jeu à 2 joueurs au tour par tour :
1. `public/js/<jeu>/engine.js` : la classe de partie (`play`, `legalMoves`, `viewFor`…) et l'IA (`profile`, `chooseMove`,
   en s'appuyant sur `DuelRooms.searchBest` pour l'alpha-bêta).
2. `public/js/<jeu>/rooms.js` : quelques lignes avec `DuelRooms.create({...})` et les répliques du système.
3. `public/js/<jeu>/ui.js` : l'affichage du plateau, les textes et les règles (`window.OneFOOGames[<jeu>]`).
4. Ajoutez-le à `src/games.js`, aux scripts de `public/index.html`, à `ROOMS` dans `public/js/app.js`, et sa tuile sur l'accueil.
