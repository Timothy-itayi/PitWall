# Local development

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

The first dashboard snapshot can be created with the function-key-protected refresh endpoint or directly during local development:

```bash
cd api
node -e 'require("./src/lib/refresh").refreshDashboard()'
```

Serve the static frontend:

```bash
cd frontend
python3 -m http.server 4173
```

Then open `http://localhost:4173`. On localhost the frontend targets `http://localhost:7071`.

## Configuration

Local development uses `api/local.settings.json` and Azurite. That file is gitignored.

In Azure, set:

- `CACHE_ACCOUNT_URL=https://<storage-account>.blob.core.windows.net`
- `CACHE_CONTAINER=pitwall-cache` (optional; this is the default)
- `DASHBOARD_STALE_MS` (optional; defaults to 12 hours)
- `OPENF1_YEAR` (optional; defaults to the current UTC year)
- `OPENF1_MIN_INTERVAL_MS` (optional; defaults to 400)

Assign the Function App managed identity Blob Data Contributor access to the storage account. Do not commit connection strings or function keys.

## Checks

```bash
cd api
npm run check
```

That syntax-checks every file under `api/src` and imports the Function entry points. GitHub Actions runs the same command on `api/**` changes.
