# SofaScore Proxy API Documentation & Configuration

This project implements a secure proxy for the SofaScore API to provide sports fixtures and match data.

## Proxy Architecture
- **Backend**: Node.js Express server
- **SofaScore Base URL**: `https://api.sofascore.com/api/v1`
- **Headers**: Mimics a standard browser request to bypass basic anti-bot protections.

## Configured Endpoints

### Fixtures & Events
- `GET /api/sport/:sport/scheduled-events/:date`
  - Fetch scheduled events for a specific sport and date.
- `GET /api/event/:eventId`
  - Get detailed information for a specific match/event.
- `GET /api/event/:eventId/incidents`
  - Fetch match incidents (goals, cards, substitutions).
- `GET /api/event/:eventId/statistics`
  - Get match statistics (possession, shots, etc.).
- `GET /api/event/:eventId/lineups`
  - Get team lineups and player ratings.
- `GET /api/event/:eventId/best-players`
  - Fetch top-performing players for the event.
- `GET /api/event/:eventId/h2h/events`
  - Fetch head-to-head history.
- `GET /api/event/:eventId/odds/1/all`
  - Fetch match odds.

### League & Team Data
- `GET /api/unique-tournament/:tournamentId/season/:seasonId/standings/total`
  - Fetch league table/standings.
- `GET /api/team/:teamId/events/last/:page`
  - Fetch recent results for a specific team.

### Media (Image Proxy)
These endpoints proxy images from `api.sofascore.app` with proper caching headers.
- `GET /api/team/:teamId/image`
- `GET /api/unique-tournament/:tournamentId/image`
- `GET /api/player/:playerId/image`

## Configuration Setup
1. **Server-side**: The proxy is implemented in `server/routes.ts`.
2. **Client-side**: API calls are made via `@tanstack/react-query` using the base URL of the deployment.
3. **Environment**: The frontend expects `EXPO_PUBLIC_DOMAIN` to be set to the server address.

## How to use
Point your application to your server's `/api` routes instead of directly calling SofaScore to benefit from the pre-configured headers and caching logic.
