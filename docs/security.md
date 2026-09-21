# Security

PitWall is a public read-only site in front of a private cache. The security model is about keeping Azure credentials and upstream writes off the visitor path.

## What is implemented

- The browser never receives Azure credentials or OpenF1 tokens.
- The Blob container is private. Only the Function App reads and writes it.
- In Azure, the Function App uses a system-assigned managed identity (`CACHE_ACCOUNT_URL` + `DefaultAzureCredential`). Connection strings stay in local Azurite settings, which are gitignored.
- `POST /api/refresh` requires a Function key. There is no anonymous force-refresh.
- `GET /api/race/{sessionKey}` rejects anything that is not a positive integer.
- Function CORS is restricted to the Static Web App origin. It is an Azure Function App setting, not application code.
- `frontend/app.js` escapes values before inserting them into HTML. OpenF1 strings are treated as untrusted.

## What is intentionally public

`GET /api/dashboard` and `GET /api/race/{sessionKey}` are anonymous because the site is a public dashboard. Authentication on those reads would add accounts without changing the data.

## What is not in this version

- Azure Front Door / API Management
- private-network restrictions on the Function App
- separate dev and prod environments
- Infrastructure as Code for the Azure resources

Those are reasonable follow-ups. They are not required for the current threat model (a public JSON dashboard with a private write path).
