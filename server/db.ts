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
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id                    INTEGER NOT NULL UNIQUE,
    home_team_id                INTEGER,
    home_team_name              TEXT,
    away_team_id                INTEGER,
    away_team_name              TEXT,
    tournament                  TEXT,
    sport                       TEXT DEFAULT 'football',
    match_date                  TEXT,
    start_timestamp             INTEGER,

    home_goals                  INTEGER,
    away_goals                  INTEGER,
    result                      TEXT,

    -- Home role strengths (last 15)
    home_phase_defensive        REAL,
    home_phase_attack           REAL,
    home_phase_midfield         REAL,
    home_phase_keeper           REAL,
    home_phase_fullback         REAL,

    -- Home form strengths
    home_form_strength          REAL,
    home_scoring_strength       REAL,
    home_defending_strength     REAL,

    -- Home form summary
    home_form_points            INTEGER,
    home_goals_for              INTEGER,
    home_goals_against          INTEGER,
    home_clean_sheets           INTEGER,
    home_recent_form            TEXT,

    -- Home avg match stats
    home_avg_goals_scored       REAL,
    home_avg_goals_conceded     REAL,
    home_avg_xg                 REAL,
    home_avg_possession         REAL,
    home_avg_big_chances        REAL,
    home_avg_total_shots        REAL,
    home_avg_shots_on_target    REAL,
    home_avg_shots_off_target   REAL,
    home_avg_blocked_shots      REAL,
    home_avg_shots_inside_box   REAL,
    home_avg_big_chances_scored REAL,
    home_avg_big_chances_missed REAL,
    home_avg_corner_kicks       REAL,
    home_avg_fouls              REAL,
    home_avg_total_passes       REAL,
    home_avg_pass_accuracy      REAL,
    home_avg_duels_won          REAL,
    home_avg_tackles_won        REAL,
    home_avg_interceptions      REAL,
    home_avg_clearances         REAL,
    home_avg_goalkeeper_saves   REAL,
    home_avg_goals_prevented    REAL,
    home_matches_analyzed       INTEGER,

    -- Away role strengths (last 15)
    away_phase_defensive        REAL,
    away_phase_attack           REAL,
    away_phase_midfield         REAL,
    away_phase_keeper           REAL,
    away_phase_fullback         REAL,

    -- Away form strengths
    away_form_strength          REAL,
    away_scoring_strength       REAL,
    away_defending_strength     REAL,

    -- Away form summary
    away_form_points            INTEGER,
    away_goals_for              INTEGER,
    away_goals_against          INTEGER,
    away_clean_sheets           INTEGER,
    away_recent_form            TEXT,

    -- Away avg match stats
    away_avg_goals_scored       REAL,
    away_avg_goals_conceded     REAL,
    away_avg_xg                 REAL,
    away_avg_possession         REAL,
    away_avg_big_chances        REAL,
    away_avg_total_shots        REAL,
    away_avg_shots_on_target    REAL,
    away_avg_shots_off_target   REAL,
    away_avg_blocked_shots      REAL,
    away_avg_shots_inside_box   REAL,
    away_avg_big_chances_scored REAL,
    away_avg_big_chances_missed REAL,
    away_avg_corner_kicks       REAL,
    away_avg_fouls              REAL,
    away_avg_total_passes       REAL,
    away_avg_pass_accuracy      REAL,
    away_avg_duels_won          REAL,
    away_avg_tackles_won        REAL,
    away_avg_interceptions      REAL,
    away_avg_clearances         REAL,
    away_avg_goalkeeper_saves   REAL,
    away_avg_goals_prevented    REAL,
    away_matches_analyzed       INTEGER,

    -- Halftime scores (for BTTS / highest scoring half)
    home_ht_goals               INTEGER,
    away_ht_goals               INTEGER,

    -- Home 1st half avg stats
    home_h1_avg_goals_scored    REAL,
    home_h1_avg_goals_conceded  REAL,
    home_h1_avg_xg              REAL,
    home_h1_avg_possession      REAL,
    home_h1_avg_big_chances     REAL,
    home_h1_avg_total_shots     REAL,
    home_h1_avg_pass_accuracy   REAL,
    home_h1_avg_total_passes    REAL,

    -- Home 2nd half avg stats
    home_h2_avg_goals_scored    REAL,
    home_h2_avg_goals_conceded  REAL,
    home_h2_avg_xg              REAL,
    home_h2_avg_possession      REAL,
    home_h2_avg_big_chances     REAL,
    home_h2_avg_total_shots     REAL,
    home_h2_avg_pass_accuracy   REAL,
    home_h2_avg_total_passes    REAL,

    -- Away 1st half avg stats
    away_h1_avg_goals_scored    REAL,
    away_h1_avg_goals_conceded  REAL,
    away_h1_avg_xg              REAL,
    away_h1_avg_possession      REAL,
    away_h1_avg_big_chances     REAL,
    away_h1_avg_total_shots     REAL,
    away_h1_avg_pass_accuracy   REAL,
    away_h1_avg_total_passes    REAL,

    -- Away 2nd half avg stats
    away_h2_avg_goals_scored    REAL,
    away_h2_avg_goals_conceded  REAL,
    away_h2_avg_xg              REAL,
    away_h2_avg_possession      REAL,
    away_h2_avg_big_chances     REAL,
    away_h2_avg_total_shots     REAL,
    away_h2_avg_pass_accuracy   REAL,
    away_h2_avg_total_passes    REAL,

    processed_at                TEXT NOT NULL,

    -- Injury / suspension reports (JSON arrays)
    home_injured_players        TEXT,
    away_injured_players        TEXT,
    home_suspended_players      TEXT,
    away_suspended_players      TEXT,
    home_injury_impact          REAL,
    away_injury_impact          REAL
  )
`);

// Migrate existing databases — safely add any columns not yet present
function col(name: string, type: string) {
  try { db.exec(`ALTER TABLE match_simulations ADD COLUMN ${name} ${type}`); } catch {}
}
col("home_phase_fullback", "REAL");
col("home_form_points", "INTEGER");
col("home_goals_for", "INTEGER");
col("home_goals_against", "INTEGER");
col("home_clean_sheets", "INTEGER");
col("home_recent_form", "TEXT");
col("home_avg_shots_off_target", "REAL");
col("home_avg_blocked_shots", "REAL");
col("home_avg_shots_inside_box", "REAL");
col("home_avg_big_chances_scored", "REAL");
col("home_avg_big_chances_missed", "REAL");
col("home_avg_fouls", "REAL");
col("home_avg_total_passes", "REAL");
col("home_avg_duels_won", "REAL");
col("home_avg_clearances", "REAL");
col("home_avg_goalkeeper_saves", "REAL");
col("home_avg_goals_prevented", "REAL");
col("away_phase_fullback", "REAL");
col("away_form_points", "INTEGER");
col("away_goals_for", "INTEGER");
col("away_goals_against", "INTEGER");
col("away_clean_sheets", "INTEGER");
col("away_recent_form", "TEXT");
col("away_avg_shots_off_target", "REAL");
col("away_avg_blocked_shots", "REAL");
col("away_avg_shots_inside_box", "REAL");
col("away_avg_big_chances_scored", "REAL");
col("away_avg_big_chances_missed", "REAL");
col("away_avg_fouls", "REAL");
col("away_avg_total_passes", "REAL");
col("away_avg_duels_won", "REAL");
col("away_avg_clearances", "REAL");
col("away_avg_goalkeeper_saves", "REAL");
col("away_avg_goals_prevented", "REAL");
// New half-time and per-half columns
col("home_ht_goals", "INTEGER");
col("away_ht_goals", "INTEGER");
col("home_h1_avg_goals_scored", "REAL");
col("home_h1_avg_goals_conceded", "REAL");
col("home_h1_avg_xg", "REAL");
col("home_h1_avg_possession", "REAL");
col("home_h1_avg_big_chances", "REAL");
col("home_h1_avg_total_shots", "REAL");
col("home_h1_avg_pass_accuracy", "REAL");
col("home_h1_avg_total_passes", "REAL");
col("home_h2_avg_goals_scored", "REAL");
col("home_h2_avg_goals_conceded", "REAL");
col("home_h2_avg_xg", "REAL");
col("home_h2_avg_possession", "REAL");
col("home_h2_avg_big_chances", "REAL");
col("home_h2_avg_total_shots", "REAL");
col("home_h2_avg_pass_accuracy", "REAL");
col("home_h2_avg_total_passes", "REAL");
col("away_h1_avg_goals_scored", "REAL");
col("away_h1_avg_goals_conceded", "REAL");
col("away_h1_avg_xg", "REAL");
col("away_h1_avg_possession", "REAL");
col("away_h1_avg_big_chances", "REAL");
col("away_h1_avg_total_shots", "REAL");
col("away_h1_avg_pass_accuracy", "REAL");
col("away_h1_avg_total_passes", "REAL");
col("away_h2_avg_goals_scored", "REAL");
col("away_h2_avg_goals_conceded", "REAL");
col("away_h2_avg_xg", "REAL");
col("away_h2_avg_possession", "REAL");
col("away_h2_avg_big_chances", "REAL");
col("away_h2_avg_total_shots", "REAL");
col("away_h2_avg_pass_accuracy", "REAL");
col("away_h2_avg_total_passes", "REAL");
// Injury / suspension columns
col("home_injured_players", "TEXT");
col("away_injured_players", "TEXT");
col("home_suspended_players", "TEXT");
col("away_suspended_players", "TEXT");
col("home_injury_impact", "REAL");
col("away_injury_impact", "REAL");

// ── Startup: prune stored matches that are missing the key half-period stats ─
// Matches missing 1H/2H possession or shots will always show "—" in the UI
// and are useless for half-time training. Remove them once at startup so the
// user doesn't need to clear and re-upload the entire database.
{
  const pruneResult = db.prepare(`
    DELETE FROM match_simulations
    WHERE home_h1_avg_possession IS NULL
       OR home_h1_avg_total_shots IS NULL
       OR home_h2_avg_possession IS NULL
       OR home_h2_avg_total_shots IS NULL
       OR away_h1_avg_possession IS NULL
       OR away_h1_avg_total_shots IS NULL
       OR away_h2_avg_possession IS NULL
       OR away_h2_avg_total_shots IS NULL
       OR home_avg_xg IS NULL
       OR home_avg_possession IS NULL
       OR home_avg_total_shots IS NULL
       OR away_avg_xg IS NULL
       OR away_avg_possession IS NULL
       OR away_avg_total_shots IS NULL
  `).run();
  if (pruneResult.changes > 0) {
    console.log(`[DB] Pruned ${pruneResult.changes} incomplete match(es) missing key half-period or full-match stats.`);
  }
}

export default db;
