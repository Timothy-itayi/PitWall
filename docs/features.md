# Features

- next Grand Prix and session schedule
- latest completed race podium
- current driver standings
- current team standings
- **Season So Far** archive of completed Grand Prix races
- on-demand cached race detail, used by PitWall Battle
- **Season head-to-head**: pick two drivers and compare points, wins, podiums, race and qualifying head-to-heads, poles, average finish and grid slot, points finishes and retirements; a cumulative points chart with the gap shaded in the leader's team colour; and a round-by-round strip of both finishes
- **PitWall Battle** compares up to six driver-and-race cards
- each card shows finishing position, fastest lap, and tyre stints
- data freshness indicator
- instant repeat visits from a browser copy of the last snapshot, refreshed in the background
- entrance motion with GSAP (podium, standings, countdown), off under `prefers-reduced-motion`
- last-known-good behavior when scheduled upstream refreshes fail

## Season So Far

PitWall discovers the completed Grand Prix races dynamically from OpenF1 session data.

The application does not hard-code the race calendar.

The archive filters for completed, non-cancelled sessions whose session name is `Race`, then sorts them newest first.

## PitWall Battle

Add up to six drivers. Each card is one driver at one completed Grand Prix.

The board shows:

- finishing position, or DNF / DSQ / DNS
- fastest lap derived from OpenF1 lap data
- tyre strategy/stints

The Grand Prix list is the season calendar. PitWall does not know which races a driver started until that race is loaded. If they are missing from the result, the card says they did not start.

Fastest-lap highlighting only appears when every card is from the same Grand Prix. Lap times from different circuits are not compared. The best finish is marked across the whole board.

## Limitations

- not a live timing product
- no official Formula 1 affiliation
- OpenF1 historical data begins in 2023
- OpenF1 overtakes may be incomplete
- upstream beta championship schemas can change
- historical cached results may require maintenance refreshes after post-race amendments
