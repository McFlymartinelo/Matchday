-- Schéma principal Matchday

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar TEXT DEFAULT '⚽',
  profile_color TEXT DEFAULT '#6B3FD6',
  is_admin INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS competitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  bsd_league_id INTEGER,
  nom TEXT NOT NULL,
  pays TEXT NOT NULL,
  logo TEXT,
  couleur TEXT NOT NULL,
  couleur_bg TEXT NOT NULL,
  emoji TEXT,
  saison_active TEXT DEFAULT '2025-2026'
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  admin_id INTEGER NOT NULL REFERENCES users(id),
  is_public INTEGER DEFAULT 0,
  scoring_exact INTEGER DEFAULT 3,
  scoring_diff INTEGER DEFAULT 2,
  scoring_winner INTEGER DEFAULT 1,
  season_xi_deadline TEXT,
  special_bets_deadline TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS group_competitions (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  competition_id INTEGER NOT NULL REFERENCES competitions(id),
  PRIMARY KEY (group_id, competition_id)
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  joined_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bsd_team_id INTEGER,
  competition_id INTEGER NOT NULL REFERENCES competitions(id),
  name TEXT NOT NULL,
  short_name TEXT,
  logo TEXT
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bsd_event_id INTEGER UNIQUE,
  competition_id INTEGER NOT NULL REFERENCES competitions(id),
  home_team_id INTEGER REFERENCES teams(id),
  away_team_id INTEGER REFERENCES teams(id),
  home_team_name TEXT NOT NULL,
  away_team_name TEXT NOT NULL,
  home_score INTEGER,
  away_score INTEGER,
  status TEXT DEFAULT 'scheduled',
  matchday INTEGER,
  kickoff_at TEXT NOT NULL,
  season TEXT DEFAULT '2025-2026',
  home_bsd_team_id INTEGER,
  away_bsd_team_id INTEGER,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  group_id INTEGER NOT NULL REFERENCES groups(id),
  match_id INTEGER NOT NULL REFERENCES matches(id),
  home_score INTEGER NOT NULL,
  away_score INTEGER NOT NULL,
  points INTEGER,
  points_detail TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, group_id, match_id)
);

CREATE TABLE IF NOT EXISTS special_bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  group_id INTEGER NOT NULL REFERENCES groups(id),
  competition_id INTEGER NOT NULL REFERENCES competitions(id),
  season TEXT NOT NULL,
  bet_type TEXT NOT NULL,
  bet_value TEXT NOT NULL,
  points INTEGER,
  locked_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, group_id, competition_id, season, bet_type)
);

CREATE TABLE IF NOT EXISTS season_xi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  group_id INTEGER NOT NULL REFERENCES groups(id),
  season TEXT NOT NULL,
  locked_at TEXT,
  UNIQUE(user_id, group_id, season)
);

CREATE TABLE IF NOT EXISTS season_xi_players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_xi_id INTEGER NOT NULL REFERENCES season_xi(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL,
  player_name TEXT NOT NULL,
  team_id INTEGER NOT NULL,
  team_name TEXT NOT NULL,
  competition_id INTEGER NOT NULL REFERENCES competitions(id),
  position TEXT NOT NULL,
  UNIQUE(season_xi_id, player_id),
  UNIQUE(season_xi_id, team_id)
);

CREATE TABLE IF NOT EXISTS matchday_xi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_id INTEGER NOT NULL REFERENCES competitions(id),
  season TEXT NOT NULL,
  matchday INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  player_name TEXT NOT NULL,
  position TEXT NOT NULL,
  rating REAL NOT NULL,
  goals INTEGER DEFAULT 0,
  assists INTEGER DEFAULT 0,
  computed_at TEXT NOT NULL,
  UNIQUE(competition_id, season, matchday, player_id)
);

CREATE TABLE IF NOT EXISTS season_xi_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  group_id INTEGER NOT NULL REFERENCES groups(id),
  competition_id INTEGER NOT NULL REFERENCES competitions(id),
  season TEXT NOT NULL,
  matchday INTEGER NOT NULL,
  points INTEGER NOT NULL,
  detail TEXT,
  computed_at TEXT NOT NULL,
  UNIQUE(user_id, group_id, competition_id, season, matchday)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  emoji TEXT NOT NULL,
  UNIQUE(message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS prediction_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prediction_id INTEGER NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  emoji TEXT NOT NULL,
  UNIQUE(prediction_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notification_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'prono_reminder',
  sent_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, match_id, type)
);

CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_type TEXT NOT NULL,
  status TEXT NOT NULL,
  details TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS official_standings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_id INTEGER NOT NULL REFERENCES competitions(id),
  season TEXT NOT NULL,
  position INTEGER NOT NULL,
  team_id INTEGER,
  team_name TEXT NOT NULL,
  played INTEGER DEFAULT 0,
  won INTEGER DEFAULT 0,
  drawn INTEGER DEFAULT 0,
  lost INTEGER DEFAULT 0,
  goals_for INTEGER DEFAULT 0,
  goals_against INTEGER DEFAULT 0,
  points INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(competition_id, season, team_name)
);

CREATE INDEX IF NOT EXISTS idx_matches_competition ON matches(competition_id, season, matchday);
CREATE INDEX IF NOT EXISTS idx_predictions_group ON predictions(group_id, user_id);
CREATE INDEX IF NOT EXISTS idx_group_competitions ON group_competitions(group_id);
