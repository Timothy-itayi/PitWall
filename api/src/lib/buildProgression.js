const openf1 = require("./openf1");
const { readSeasonRound, writeSeasonRound } = require("./cache");

// Bump when the cached round shape changes so old blobs are rebuilt.
const ROUND_VERSION = 2;

function info(log, message) {
  if (log && typeof log.info === "function") {
    log.info(message);
    return;
  }
  console.log(message);
}

function raceStatus(row) {
  if (row.dsq) return "DSQ";
  if (row.dns) return "DNS";
  if (row.dnf) return "DNF";
  return null;
}

function qualifyingSessionKey(raceSession, sessions) {
  const match = (sessions || []).find(
    (session) =>
      session.meeting_key === raceSession.meeting_key &&
      session.session_name === "Qualifying" &&
      session.is_cancelled !== true
  );
  return match ? match.session_key : null;
}

// Everything the head-to-head needs from one Grand Prix weekend.
async function fetchRound(raceSession, sessions, fresh = {}) {
  const sessionKey = raceSession.session_key;
  const standings = fresh.standings || (await openf1.getChampionshipDrivers(sessionKey));
  const results = fresh.results || (await openf1.getSessionResult(sessionKey));
  const qualiKey = qualifyingSessionKey(raceSession, sessions);
  let qualifying = [];
  if (qualiKey) {
    // A missing qualifying result should not cost the whole round.
    qualifying = await openf1.getSessionResult(qualiKey).catch(() => []);
  }
  return {
    version: ROUND_VERSION,
    standings: standings.map((row) => ({ driverNumber: row.driver_number, points: row.points_current })),
    results: results.map((row) => ({
      driverNumber: row.driver_number,
      position: row.position ?? null,
      status: raceStatus(row),
      points: typeof row.points === "number" ? row.points : 0,
    })),
    qualifying: qualifying
      .filter((row) => row.position != null)
      .map((row) => ({ driverNumber: row.driver_number, position: row.position })),
  };
}

// Older rounds rarely change, so they come from Blob; the latest round is
// always rebuilt from the rows the dashboard just fetched.
async function loadRound(raceSession, sessions, log) {
  const cached = await readSeasonRound(raceSession.session_key);
  if (cached && cached.version === ROUND_VERSION) return cached;
  info(log, `Season round ${raceSession.session_key} cache MISS — fetching OpenF1`);
  const round = await fetchRound(raceSession, sessions);
  await writeSeasonRound(raceSession.session_key, round);
  return round;
}

// Per-driver season series, oldest round first, for the drivers on the
// current table. `completed` is newest first, as the dashboard builder sorts it.
async function buildPointsProgression({ completed, meetings, sessions, latestRows, latestResults, driverChampionship, log }) {
  const ordered = [...completed].reverse();
  const latestKey = completed[0]?.session_key;
  const meetingLookup = new Map(meetings.map((meeting) => [meeting.meeting_key, meeting]));

  const perRound = [];
  for (const session of ordered) {
    const round =
      session.session_key === latestKey
        ? await fetchRound(session, sessions, { standings: latestRows, results: latestResults })
        : await loadRound(session, sessions, log);
    perRound.push({
      standings: new Map(round.standings.map((row) => [row.driverNumber, row.points])),
      results: new Map(round.results.map((row) => [row.driverNumber, row])),
      qualifying: new Map(round.qualifying.map((row) => [row.driverNumber, row.position])),
    });
  }

  const rounds = ordered.map((session, index) => {
    const meeting = meetingLookup.get(session.meeting_key);
    return {
      round: index + 1,
      sessionKey: session.session_key,
      meetingName: meeting?.meeting_name || session.circuit_short_name,
      date: session.date_end,
    };
  });

  const drivers = driverChampionship.map((driver) => {
    const number = driver.driverNumber;
    const series = (fn) => perRound.map((round) => fn(round) ?? null);
    return {
      driverNumber: number,
      points: series((round) => (typeof round.standings.get(number) === "number" ? round.standings.get(number) : null)),
      finish: series((round) => round.results.get(number)?.position),
      status: series((round) => round.results.get(number)?.status),
      racePoints: series((round) => round.results.get(number)?.points),
      qualifying: series((round) => round.qualifying.get(number)),
    };
  });

  return { rounds, drivers };
}

module.exports = { buildPointsProgression };
