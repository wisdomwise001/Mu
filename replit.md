# Project Notes

## Current App
- Expo Router football match app with an Express API backend.
- Match detail pages live in `app/match/[id].tsx` and use tab components from `components/match/`.
- The Simulation tab renders a stadium pitch from predicted or confirmed lineup data using `components/match/StadiumSimulationTab.tsx`.
- The Simulation tab now calls `/api/event/:eventId/player-simulation` to calculate each starter's experience, intelligence, performance, and overall rating from the team's last 15 match lineups/ratings, then uses those ratings in a live clash simulator.
- Player simulation metrics include role-based strengths from last-15 player stats: defensive, attack, midfield, goalkeeper, and full-back/wing-back strength.
- Lineups tab consumes SofaScore `/event/:eventId/lineups` missingPlayers data and renders injury/suspension reports per team.
- If SofaScore has no predicted XI, `/api/event/:eventId/lineups` now builds likely lineups from each team's last 15 match lineups using a weighted 3x/2x/1x recency model, preferred formation/venue context, last-5 player activity, injury/suspension filtering, and predicted player ratings.
- Main sports fixture screens now re-filter provider events by the selected local date, include quick search across teams/leagues/countries, and use reduced mobile web top spacing.
- Simulation tab keeps the visible 90-minute countdown, then runs 1,000,000 fast match-engine simulations and displays the top 20 scorelines by frequency.
- Simulation now adds recent team form strength with the requested scoring rules: 3 for win, 1 for draw, 0 for loss, +2 for wins by 2+ goals, +1 for clean sheets, -1 for draws, and -1 for 0-0. It also calculates separate scoring strength and defending strength from recent goals, scoring rate, big wins, goals conceded, and clean sheets, then feeds those values into the match engine.
- Last-15 match extraction now filters to completed matches before the current fixture, sorts them newest-to-oldest by kickoff timestamp, and then takes 15, avoiding accidental selection of older past-season matches from provider ordering.
- The Matches tab also now applies the same newest-first sorting/filtering because SofaScore's `/team/:id/events/last/0` response can arrive oldest-to-newest inside the page, as seen for Sassuolo.
- AI Insight errors are now sanitized so provider credential/authorization details are not displayed directly in the mobile UI.
- Metro ignores `.local` and `.cache` runtime folders to avoid watcher crashes from transient Replit state files.
- Last-15 match history now fetches pages 0, 1, and 2 in parallel (~30 events) to ensure enough finished matches are always available for the filter to find 15.
- Simulation tab now shows **Scoring & Conceding Patterns** per team — a goal-timing fingerprint built from incidents across the last 15 matches: 15-minute buckets (0–15, 16–30, 31–45, 46–60, 61–75, 76–90), peak scoring window vs vulnerability window, avg first goal/conceded minute, score-first/concede-first rates with win and comeback %, clean-sheet/failed-to-score/BTTS/Over 2.5 rates, blown-leads rate, plus xG over/under-performance to label finishing as Deadly / Clinical / Reliable / Wasteful / Flop, and human-readable style tags ("Lightning starters — wizards at 0–15′ explosions", "Slow to wake", "Heavy scorers", etc). Implemented as `computeScoringPatterns` in `server/routes.ts` and `ScoringPatternsCard` in `components/match/StadiumSimulationTab.tsx`.
- Added **Processing** and **Database** tabs backed by a SQLite database (`data/matches.db`) via `better-sqlite3`.
  - **Processing tab**: pick any past date + sport → "Bulk Upload" starts a background job; matches are processed one at a time with 2.5 s delays (anti-blocking); live progress bar + log; cancel support.
  - **Database tab**: browse all stored match records with search, expandable simulation stats per match (form, scoring, defending, xG, possession, shots, pass accuracy, etc.) and actual outcomes; delete individual records.
  - Schema: `server/db.ts`; API routes added to `server/routes.ts` (`/api/database/*`).
- Added **xG Engine** — a multi-paradigm probabilistic xG forecasting system implemented from scratch in TypeScript (`server/xgEngine.ts`):
  - **Architecture**: ANN (neural network baseline) → HMM (match state) → SVM (boundary correction) → RF + GBM (ensemble refinement) → GP (uncertainty) → GARCH (volatility) → Causal (delta) → Meta-Learner (combination).
  - **Engine Training tab**: New `app/(tabs)/engine.tsx` tab — shows training status, performance metrics (RMSE, MAE), training button with live progress bar, and architecture documentation for all 9 model components.
  - **xG Engine tab in match detail**: New `components/match/XGEngineTab.tsx` — when a match is clicked, shows full-time/first-half/second-half xG predictions with GP confidence intervals, HMM match state chart, GARCH volatility, SVM correction, causal analysis, meta-learner weights, component-level breakdown, and all 38 features used.
  - **Outputs**: home/away FT xG, H1 xG, H2 xG, GP confidence ±, volatility label, HMM match state + state probabilities, BTTS probability, Over 2.5 probability, result probabilities, causal Δ explanations.
  - **Storage**: Trained model weights serialized to SQLite `engine_models` table for persistence across server restarts.
  - **API routes**: `GET /api/engine/status`, `POST /api/engine/train`, `GET /api/engine/training-progress`, `GET /api/engine/predict/:eventId`, `POST /api/engine/predict-features`.