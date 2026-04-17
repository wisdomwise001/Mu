# Project Notes

## Current App
- Expo Router football match app with an Express API backend.
- Match detail pages live in `app/match/[id].tsx` and use tab components from `components/match/`.
- The Simulation tab renders a stadium pitch from predicted or confirmed lineup data using `components/match/StadiumSimulationTab.tsx`.
- Metro ignores `.local` and `.cache` runtime folders to avoid watcher crashes from transient Replit state files.