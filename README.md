# Matchday

Application web de pronostics entre amis pour les grands championnats européens de football.

## Stack

- **Backend** : Node.js 20+, Express
- **Base de données** : Turso (prod) / SQLite local (dev)
- **Frontend** : HTML, CSS, JavaScript vanilla (PWA)
- **Données matchs** : [BSD — Bzzoiro Sports Data](https://sports.bzzoiro.com)

## Démarrage local

```bash
cp .env.example .env
npm install
npm run setup
npm run dev
```

Ouvrir http://localhost:3000

## Variables d'environnement

| Variable | Description |
|---|---|
| `JWT_SECRET` | Secret pour les tokens JWT |
| `BSD_API_TOKEN` | Token BSD (gratuit sur sports.bzzoiro.com) |
| `TURSO_DATABASE_URL` | URL Turso (prod, optionnel en dev) |
| `TURSO_AUTH_TOKEN` | Token Turso |
| `VAPID_PUBLIC_KEY` | Clé publique push (prod) |
| `VAPID_PRIVATE_KEY` | Clé privée push (prod) |
| `VAPID_SUBJECT` | ex. `mailto:toi@email.com` |

## Tests

```bash
npm test
```

### Tester les notifications (rappel 1h avant match)

1. Génère les clés VAPID si besoin : `npm run vapid:keys` → copie dans `.env`
2. Lance l'app, connecte-toi, active la cloche 🔔 (abonnement push)
3. Simulation (sans envoi) :

```bash
npm run test:notifications -- --list
npm run test:notifications -- --username marty
```

4. Envoi réel :

```bash
npm run test:notifications -- --send --username marty --group 1
```

Le script crée un match fictif (PSG–OM) dans ~60 min sans pronostic, envoie le push, puis supprime le match (ajoute `--keep` pour le garder).

### Promouvoir un admin application

Par défaut, les comptes créés via l'inscription ne sont pas admin. Pour accéder aux routes `/api/admin/*` :

```bash
npm run admin:promote -- marty
npm run admin:promote -- --list
npm run admin:promote -- --revoke marty
```

En prod, configure `TURSO_DATABASE_URL` dans `.env` puis lance la même commande (elle cible la base Turso). Reconnecte-toi ensuite dans l'app.

En prod (admin connecté), même chose via API :

```http
POST /api/admin/notifications/simulate-reminder
Authorization: Bearer <token admin>
Content-Type: application/json

{ "username": "marty", "groupId": 1, "send": true }
```

## Fonctionnalités

- Groupes privés avec sélection des championnats (Ligue 1, PL, Liga, Serie A, Bundesliga)
- Pronostics avec barème configurable (3/2/1 pts)
- Mon 11 de saison avec équipe type calculée via BSD
- Classement, chat, stats, PWA installable
- Sync automatique BSD (fixtures, scores, classements)
- Rappels pronostic (~1 h avant le match)

## Déploiement sur Render

Oui, Matchday est prêt pour [Render](https://render.com). Le fichier `render.yaml` décrit le service.

### Prérequis

1. **Repo GitHub** — pousse le projet sur GitHub (GitLab fonctionne aussi).
2. **Turso** (recommandé) — sur Render, le disque est éphémère : sans Turso, la base SQLite est **effacée à chaque redéploiement**. Crée une base gratuite :
   ```bash
   # CLI Turso : https://docs.turso.tech/cli
   turso db create matchday
   turso db show matchday --url
   turso db tokens create matchday
   ```
3. **Token BSD** — [sports.bzzoiro.com](https://sports.bzzoiro.com)
4. **Clés VAPID** (notifications push) :
   ```bash
   npm run vapid:keys
   ```

### Étapes Render

1. [dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint** (ou **Web Service** si tu préfères configurer à la main).
2. Connecte le repo **Matchday**.
3. Render détecte `render.yaml` et crée le service `matchday`.
4. Dans **Environment**, renseigne les variables marquées `sync: false` :
   | Variable | Valeur |
   |---|---|
   | `BSD_API_TOKEN` | ton token BSD |
   | `TURSO_DATABASE_URL` | `libsql://…`.turso.io |
   | `TURSO_AUTH_TOKEN` | token Turso |
   | `VAPID_PUBLIC_KEY` | clé publique |
   | `VAPID_PRIVATE_KEY` | clé privée |
5. **Deploy** — build : `npm install && npm run setup`, start : `npm start`.
6. Ouvre l’URL Render (`https://matchday-xxxx.onrender.com`).

`JWT_SECRET` est généré automatiquement par Render si tu utilises le blueprint.

### Après le déploiement

- **Health check** : `GET /api/health` (déjà configuré dans `render.yaml`).
- **Plan free** : le service s’endort après ~15 min sans trafic (cold start ~30 s). Pour limiter ça, configure [UptimeRobot](https://uptimerobot.com) sur `/api/health` toutes les 5 min.
- **Notifications push** : fonctionnent mieux en **HTTPS** (Render le fournit). Réactive la cloche 🔔 sur l’URL de prod.
- **PWA** : installe l’app depuis le navigateur mobile sur l’URL Render.

### Sans Turso (dev / test rapide uniquement)

Tu peux déployer sans `TURSO_*` : SQLite sera créée dans `data/` au build, mais **perdue au prochain deploy**. OK pour tester, pas pour un vrai groupe.
