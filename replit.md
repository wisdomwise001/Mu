# Project Notes

## Current App
- Expo Router football match app with an Express API backend.
- Match detail pages live in `app/match/[id].tsx` and use tab components from `components/match/`.
- The Simulation tab renders a stadium pitch from predicted or confirmed lineup data using `components/match/StadiumSimulationTab.tsx`.
- The Simulation tab now calls `/api/event/:eventId/player-simulation` to calculate each starter's experience, intelligence, performance, and overall rating from the team's last 15 match lineups/ratings, then uses those ratings in a live clash simulator.
- Player simulation metrics include role-based strengths from last-15 player stats: defensive, attack, midfield, goalkeeper, and full-back/wing-back strength.
- Lineups tab consumes SofaScore `/event/:eventId/lineups` missingPlayers data and renders injury/suspension reports per team.
- Metro ignores `.local` and `.cache` runtime folders to avoid watcher crashes from transient Replit state files.