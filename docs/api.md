# API

Base URL in production: `https://func-pitwall-fd884b.azurewebsites.net`

Local: `http://localhost:7071`

The static frontend never talks to OpenF1. It only calls these endpoints.

## `GET /api/dashboard`

Anonymous. Reads `dashboard.json`.

| Status | Meaning |
| --- | --- |
| 200 | Snapshot plus a computed `stale` flag |
| 503 | No snapshot exists yet |

`stale` is `true` when `generatedAt` is missing or older than `DASHBOARD_STALE_MS` (default 12 hours). The Function still returns the last-known-good body. The frontend uses that flag for the freshness banner.

`Cache-Control: public, max-age=60`

Shape (fields the frontend actually consumes):

```json
{
  "generatedAt": "2026-09-21T08:29:30.658Z",
  "source": "OpenF1",
  "schemaVersion": 1,
  "year": 2026,
  "stale": false,
  "nextMeeting": {
    "meetingKey": 1295,
    "meetingName": "Azerbaijan Grand Prix",
    "country": "Azerbaijan",
    "location": "Baku",
    "circuit": "Baku",
    "dateStart": "2026-09-24T08:30:00+00:00",
    "dateEnd": "2026-09-26T13:00:00+00:00",
    "sessions": []
  },
  "latestRace": {
    "sessionKey": 0,
    "meetingName": "Spanish Grand Prix",
    "date": "2026-09-14T01:00:00+00:00",
    "top3": []
  },
  "driverChampionship": [],
  "teamChampionship": [],
  "previousRaces": []
}
```

`previousRaces` is every completed, non-cancelled current-season session whose `session_name` is `Race`, newest first. No lap telemetry is stored here.

## `GET /api/race/{sessionKey}`

Anonymous. `sessionKey` must be a positive integer. Anything else is HTTP 400.

Cache-aside:

```text
cached blob?
  HIT  → return races/<sessionKey>.json
  MISS → OpenF1 → normalize → write blob → return
```

| Header | Value |
| --- | --- |
| `x-pitwall-cache` | `HIT` or `MISS` |
| `Cache-Control` | `public, max-age=300` |

| Status | Meaning |
| --- | --- |
| 200 | Normalized race detail |
| 400 | `sessionKey` is not a positive integer |
| 404 | OpenF1 has no session for that key |
| 429 | OpenF1 rate-limited the miss path |
| 502 | Upstream build failed |

Driver object used by PitWall Battle:

```json
{
  "driverNumber": 1,
  "fullName": "Max Verstappen",
  "acronym": "VER",
  "teamName": "Red Bull Racing",
  "finishPosition": 1,
  "initialPosition": 1,
  "placesGained": 0,
  "fastestLap": 78.123,
  "pitStops": 2,
  "overtakes": 0,
  "dnf": false,
  "dns": false,
  "dsq": false,
  "stints": [
    { "compound": "MEDIUM", "lapStart": 1, "lapEnd": 18, "stintNumber": 1 }
  ]
}
```

`raceControl` is filtered to `Flag`, `SafetyCar`, `SessionStatus`, and `CarEvent`, then sorted by timestamp. The UI renders those messages; it does not invent commentary.

Overtake counts come from OpenF1's `overtakes` dataset. OpenF1 documents that feed as potentially incomplete. The UI labels the metric `OpenF1-recorded overtakes` for that reason.

## `GET /api/race/{sessionKey}/telemetry?driver={driverNumber}`

Anonymous. Both `sessionKey` and `driver` must be positive integers.

This is not the race blob. OpenF1 `car_data` and `location` run at about 3.7 Hz, so a full session will not fit in `races/<sessionKey>.json` and will not be fetched for every car.

On a miss the function:

1. Loads that driver's laps and picks the fastest timed lap that is not a pit-out lap.
2. Requests `car_data` and `location` only for that lap's time window (`date>=`, `date<=`).
3. Requests that driver's `position` and `stints`.
4. Downsamples to at most 220 points and writes `races/<sessionKey>/telemetry/<driver>.json`.

`throttle` is 0–100. `brake` is 0 or 100 (pedal released or pressed). `x` and `y` are the OpenF1 location plane for that lap, which is a different coordinate system from the static circuit outlines. The race view draws this lap as the track and colours it by pedal. Position is the running order at the lap start. Tyre compound is the stint that covers the lap.

| Status | Meaning |
| --- | --- |
| 200 | Downsampled lap |
| 400 | Missing or non-numeric `driver` or `sessionKey` |
| 404 | Driver has no timed lap |
| 429 | OpenF1 rate-limited the miss path |
| 502 | Upstream build failed |

## `POST /api/refresh`

Function-key authentication (`authLevel: "function"`). Not exposed to the browser.

Rebuilds the dashboard snapshot and replaces `dashboard.json` only if the full OpenF1 build succeeds. Used for the first snapshot and for maintenance. There is no anonymous cache-bypass.

## Year selection

Dashboard season is `OPENF1_YEAR` if set, otherwise the current UTC year. The calendar is not hard-coded.
