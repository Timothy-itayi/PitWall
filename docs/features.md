# Features

- next Grand Prix and session schedule
- latest completed race podium
- current driver standings
- current team standings
- **Season So Far** archive of completed Grand Prix races
- on-demand cached race detail
- **PitWall Battle** two-driver comparison
- tyre-stint and pit-stop comparison
- **Race Timeline** using race-control events
- data freshness indicator
- last-known-good behavior when scheduled upstream refreshes fail

## Season So Far

PitWall discovers the completed Grand Prix races dynamically from OpenF1 session data.

The application does not hard-code the race calendar.

The archive filters for completed, non-cancelled sessions whose session name is `Race`, then sorts them newest first.

## PitWall Battle

For a selected race, two drivers can be compared by:

- finishing position
- initial recorded position
- places gained/lost when available
- fastest lap derived from OpenF1 lap data
- pit-stop count
- OpenF1-recorded overtakes
- tyre strategy/stints

OpenF1 notes that the overtakes dataset may be incomplete, so PitWall labels the metric accordingly rather than presenting it as an official complete statistic.

## Race Timeline

Race-control messages are displayed chronologically for the selected event, including flags, safety-car events and session-status messages when available.

PitWall displays the upstream event information rather than inventing race commentary.

## Limitations

- not a live timing product
- no official Formula 1 affiliation
- OpenF1 historical data begins in 2023
- OpenF1 overtakes may be incomplete
- upstream beta championship schemas can change
- historical cached results may require maintenance refreshes after post-race amendments
