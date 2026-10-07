const openf1 = require("./openf1");
const { readChampionshipRound, writeChampionshipRound } = require("./cache");

function info(log, message) {
  if (log && typeof log.info === "function") {
    log.info(message);
    return;
  }
  console.log(message);
}

// Championship rows after one race. Older rounds rarely change, so they come
// from Blob; the latest round is always passed in fresh by the caller.
async function roundRows(sessionKey, log) {
  const cached = await readChampionshipRound(sessionKey);
  if (cached) return cached;
  info(log, `Championship round ${sessionKey} cache MISS — fetching OpenF1`);
  const rows = await openf1.getChampionshipDrivers(sessionKey);
  const compact = rows.map((row) => ({ driverNumber: row.driver_number, points: row.points_current }));
  await writeChampionshipRound(sessionKey, compact);
  return compact;
}

// Cumulative points after every completed Grand Prix, oldest first, for the
// drivers on the current table. `completed` is newest first, as the dashboard
// builder sorts it.
async function buildPointsProgression({ completed, meetings, latestRows, driverChampionship, log }) {
  const ordered = [...completed].reverse();
  const latestKey = completed[0]?.session_key;
  const meetingLookup = new Map(meetings.map((meeting) => [meeting.meeting_key, meeting]));

  const perRound = [];
  for (const session of ordered) {
    const rows =
      session.session_key === latestKey
        ? latestRows.map((row) => ({ driverNumber: row.driver_number, points: row.points_current }))
        : await roundRows(session.session_key, log);
    perRound.push(new Map(rows.map((row) => [row.driverNumber, row.points])));
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

  const drivers = driverChampionship.map((driver) => ({
    driverNumber: driver.driverNumber,
    points: perRound.map((round) => {
      const value = round.get(driver.driverNumber);
      return typeof value === "number" ? value : null;
    }),
  }));

  return { rounds, drivers };
}

module.exports = { buildPointsProgression };
