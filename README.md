# PitWall

Race-weekend dashboard backed by OpenF1, Azure Functions, and Azure Blob
Storage. The frontend is deliberately plain HTML/CSS/JavaScript.

## Architecture

- `api/src/lib/openf1.js` — paced OpenF1 client (free tier: 3 requests/second)
- `api/src/lib/buildDashboard.js` — current-season dashboard snapshot
- `api/src/lib/buildRace.js` — normalized historical race analysis
- `api/src/lib/cache.js` — Blob Storage/Azurite cache
- `api/src/functions/` — timer and HTTP functions
- `frontend/` — static dashboard

The timer builds a complete snapshot before replacing `dashboard.json`, so a
failed upstream refresh preserves the last-known-good response. Historical
races are built on first request and cached as `races/<sessionKey>.json`.

## Local development

Requirements:

- Node.js 20 or newer
- Azure Functions Core Tools v4
- Azurite

Install dependencies:

```bash
cd api
npm install
```

Start Azurite:

```bash
npx azurite --location .azurite
```

Start the API in another terminal:

```bash
cd api
npm start
```

The first dashboard snapshot can be created with the function-key-protected
refresh endpoint or directly during local development:

```bash
cd api
node -e 'require("./src/lib/refresh").refreshDashboard()'
```

Serve the static frontend:

```bash
cd frontend
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Configuration

Local development uses `api/local.settings.json` and Azurite. In Azure, set:

- `CACHE_ACCOUNT_URL=https://<storage-account>.blob.core.windows.net`
- `CACHE_CONTAINER=pitwall-cache` (optional; this is the default)
- `DASHBOARD_STALE_MS` (optional; defaults to 12 hours)

Assign the Function App managed identity Blob Data Contributor access to the
storage account. Do not commit connection strings or function keys.

## API

- `GET /api/dashboard`
- `GET /api/race/{sessionKey}`
- `POST /api/refresh` (function-key authentication)

Race responses include `x-pitwall-cache: MISS` on the first request and
`x-pitwall-cache: HIT` after the detail has been cached.

## Data caveats

OpenF1 championship endpoints are beta. Overtake data may be incomplete, and
the fastest-lap comparison is the lowest valid lap duration in the OpenF1
dataset rather than an official fastest-lap classification.