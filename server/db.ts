import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "matches.db");
const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS match_simulations (
    id                        INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id                  INTEGER NOT NULL UNIQUE,
    home_team_id              INTEGER,
    home_team_name            TEXT,
    away_team_id              INTEGER,
    away_team_name            TEXT,
    tournament                TEXT,
    sport                     TEXT DEFAULT 'football',
    match_date                TEXT,
    start_timestamp           INTEGER,

    -- Actual outcomes
    home_goals                INTEGER,
    away_goals                INTEGER,
    result                    TEXT,

    -- Home team simulation stats
    home_form_strength        REAL,
    home_scoring_strength     REAL,
    home_defending_strength   REAL,
    home_phase_defensive      REAL,
    home_phase_attack         REAL,
    home_phase_midfield       REAL,
    home_phase_keeper         REAL,
    home_avg_goals_scored     REAL,
    home_avg_goals_conceded   REAL,
    home_avg_xg               REAL,
    home_avg_possession       REAL,
    home_avg_big_chances      REAL,
    home_avg_total_shots      REAL,
    home_avg_shots_on_target  REAL,
    home_avg_pass_accuracy    REAL,
    home_avg_tackles_won      REAL,
    home_avg_interceptions    REAL,
    home_avg_corner_kicks     REAL,
    home_matches_analyzed     INTEGER,

    -- Away team simulation stats
    away_form_strength        REAL,
    away_scoring_strength     REAL,
    away_defending_strength   REAL,
    away_phase_defensive      REAL,
    away_phase_attack         REAL,
    away_phase_midfield       REAL,
    away_phase_keeper         REAL,
    away_avg_goals_scored     REAL,
    away_avg_goals_conceded   REAL,
    away_avg_xg               REAL,
    away_avg_possession       REAL,
    away_avg_big_chances      REAL,
    away_avg_total_shots      REAL,
    away_avg_shots_on_target  REAL,
    away_avg_pass_accuracy    REAL,
    away_avg_tackles_won      REAL,
    away_avg_interceptions    REAL,
    away_avg_corner_kicks     REAL,
    away_matches_analyzed     INTEGER,

    processed_at              TEXT NOT NULL
  )
`);

export default db;
