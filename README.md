# Matchday

Application web de pronostics entre amis pour les grands championnats européens de football.

## Stack

- **Backend** : Node.js 20+, Express (ESM)
- **Base de données** : Turso (prod) / SQLite local (dev)
- **Frontend** : HTML, CSS, JavaScript vanilla (PWA installable)
- **Données matchs** : [BSD — Bzzoiro Sports Data](https://sports.bzzoiro.com)
- **Auth** : JWT (bcryptjs)
- **Push** : Web Push / VAPID
- **Cron** : node-cron (sync BSD toutes les 6h, scores live toutes les 5 min, rappels pronostics)

## Fonctionnalités

- Groupes privés avec sélection des championnats (Ligue 1, PL, Liga, Serie A, Bundesliga)
- Pronostics avec barème configurable (3/2/1 pts)
- Paris vainqueur de saison par championnat
- Mon 11 de saison avec équipe type calculée via BSD
- Classement général, chat de groupe, stats, duel entre joueurs
- Sync automatique BSD (fixtures, scores, classements)
- Rappels pronostic (matin des journées + ~1 h avant le match)
- PWA installable (mobile / desktop)

## Démarrage local

```bash
cp .env.example .env
npm install
npm run setup
npm run dev
```

Ouvrir [http://localhost:3000](http://localhost:3000)

## Variables d'environnement

| Variable | Description | Obligatoire |
|---|---|---|
| `JWT_SECRET` | Secret pour les tokens JWT. **Obligatoire en production** (pas de fallback). | Oui |
| `BSD_API_TOKEN` | Token BSD ([sports.bzzoiro.com](https://sports.bzzoiro.com)) | Recommandé |
| `TURSO_DATABASE_URL` | URL Turso — `libsql://…turso.io` (prod) | Non (SQLite sinon) |
| `TURSO_AUTH_TOKEN` | Token Turso | Non |
| `VAPID_PUBLIC_KEY` | Clé publique push | Non (push désactivé) |
| `VAPID_PRIVATE_KEY` | Clé privée push | Non |
| `VAPID_SUBJECT` | ex. `mailto:toi@email.com` | Non |
| `NOTIFICATION_MORNING_ENABLED` | `false` pour désactiver le rappel matin | Non |
| `NOTIFICATION_MORNING_HOUR` | Heure du rappel matin (défaut : `8`) | Non |
| `NOTIFICATION_MORNING_TZ` | Fuseau horaire (défaut : `Europe/Paris`) | Non |
| `SYNC_SECRET` | Header `x-sync-secret` pour `/api/sync/fixtures` | Non |
| `PORT` | Port d'écoute (défaut : `3000`) | Non |

## Déploiement — Serveur Debian (Docker)

Matchday tourne sur un serveur Debian local derrière un reverse proxy, accessible à **[matchday.martylab.fr](https://matchday.martylab.fr)**.

### Prérequis serveur

- Docker + Docker Compose v2
- Reverse proxy (Nginx / Traefik) avec TLS sur `matchday.martylab.fr`
- Volume persistant pour la base SQLite (ou variables Turso si tu préfères le cloud)

### `docker-compose.yml`

Le fichier `docker-compose.yml` est versionné à la racine. Build + volume SQLite :

```bash
docker compose up -d --build
```

### Déploiement initial

```bash
# Copier le projet sur le serveur
git clone <repo> /opt/matchday && cd /opt/matchday

# Configurer l'environnement
cp .env.example .env
nano .env   # renseigne JWT_SECRET, BSD_API_TOKEN, VAPID_*, etc.

# Lancer
docker compose up -d
docker compose logs -f
```

### Mises à jour

```bash
cd /opt/matchday
git pull
docker compose up -d --build
```

### Health check

```bash
curl https://matchday.martylab.fr/api/health
```

Réponse attendue :

```json
{ "status": "ok", "app": "Matchday", "matchCount": 420, "upcomingMatches": 38, ... }
```

### Clés VAPID (notifications push)

```bash
docker compose exec matchday npm run vapid:keys
# → copie VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY dans .env
docker compose restart matchday
```

---

## Tests

```bash
npm test
```

### Tester les notifications (rappel matin + 1h avant match)

1. Génère les clés VAPID si besoin : `npm run vapid:keys` → copie dans `.env`
2. Lance l'app, connecte-toi, active la cloche 🔔 (abonnement push)
3. Rappels automatiques :
   - **Matin** (8h Paris par défaut) : matchs du jour sans pronostic
   - **~1h avant** le coup d'envoi : rappel par match
4. Simulation (sans envoi) :

```bash
npm run test:notifications -- --list
npm run test:notifications -- --username marty
```

Envoi réel :

```bash
npm run test:notifications -- --send --username marty --group 1
```

Sur le serveur Docker :

```bash
docker compose exec matchday npm run test:notifications -- --send --username marty --group 1
```

Le script crée un match fictif (PSG–OM) dans ~60 min sans pronostic, envoie le push, puis supprime le match (ajoute `--keep` pour le garder).

---

## Scripts d'administration

### Promouvoir un admin

Par défaut, les comptes créés via l'inscription ne sont pas admin. Pour accéder aux routes `/api/admin/*` :

```bash
npm run admin:promote -- marty
npm run admin:promote -- --list
npm run admin:promote -- --revoke marty
```

Pour réinitialiser le mot de passe d’un compte (plus de reset public) : `POST /api/admin/users/:id/reset-password` avec un JWT admin.

Sur le serveur Docker :

```bash
docker compose exec matchday npm run admin:promote -- marty
```

### Copier les pronostics d'un utilisateur entre groupes

Utile pour migrer les pronos (et paris vainqueur) d'un groupe de test vers un groupe réel.

```bash
# Simulation (rien n'est écrit)
npm run copy:predictions -- --user Breizhantifa --from GroupeTest --to "La Cousinade" --dry-run

# Copie réelle
npm run copy:predictions -- --user Breizhantifa --from GroupeTest --to "La Cousinade"
```

Sur le serveur Docker :

```bash
docker compose exec matchday npm run copy:predictions -- --user Breizhantifa --from GroupeTest --to "La Cousinade"
```

L'utilisateur doit déjà être membre du groupe destination. Seuls les championnats suivis par les deux groupes sont copiés.

### Sync BSD manuelle

```bash
# Via l'API (nécessite SYNC_SECRET dans .env)
curl -X POST https://matchday.martylab.fr/api/sync/fixtures \
  -H "x-sync-secret: <SYNC_SECRET>"
```

---

## Architecture

```
matchday/
├── server/
│   ├── index.js          # Cron, init DB, listen 0.0.0.0
│   ├── app.js            # Express : routes, headers, static
│   ├── db/
│   │   ├── connection.js # SQLite / Turso (libsql)
│   │   ├── migrate.js    # Migrations DDL
│   │   └── seed.js       # Compétitions + matchs démo
│   ├── routes/           # auth, groups, matches, standings, chat, admin…
│   ├── services/
│   │   ├── bsd.js        # Appels BSD API
│   │   ├── sync.js       # Sync fixtures, scores, standings
│   │   └── notifications.js # Web Push (rappels)
│   ├── lib/              # scoring, matches, badges, championBets, season
│   └── middleware/       # auth JWT
├── public/               # Frontend HTML/CSS/JS vanilla (PWA)
│   ├── js/
│   │   ├── app.js        # Router SPA, état global
│   │   ├── matchesUi.js  # Écran matchs / pronostics
│   │   ├── api.js        # Couche fetch
│   │   └── …             # chatUi, profile, standings, seasonXi…
│   └── manifest.json     # PWA manifest
├── scripts/              # promote-admin, copy-predictions, test-notification…
└── package.json
```

## API — principaux endpoints

| Méthode | Chemin | Description |
|---|---|---|
| `GET` | `/api/health` | Statut app + stats DB |
| `POST` | `/api/auth/register` | Inscription |
| `POST` | `/api/auth/login` | Connexion → JWT |
| `POST` | `/api/auth/change-password` | Changer son mot de passe (connecté) |
| `GET` | `/api/groups` | Mes groupes |
| `GET` | `/api/groups/:id/matches` | Matchs + pronostics du groupe |
| `POST` | `/api/groups/:id/predictions` | Sauvegarder un pronostic |
| `GET` | `/api/groups/:id/standings` | Classement |
| `GET` | `/api/groups/:id/chat` | Messages du chat |
| `POST` | `/api/admin/notifications/simulate-reminder` | Test rappel push (admin) |
| `POST` | `/api/sync/fixtures` | Sync BSD (protégé par `SYNC_SECRET`) |
