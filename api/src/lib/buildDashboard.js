const openf1 = require("./openf1");

const SCHEMA_VERSION = 1;

function info(log, message) {
  if (log && typeof log.info === "function") {
    log.info(message);
    return;
  }
  if (log && typeof log === "function") {
    log(message);
    return;
  }
  console.log(message);
}

function toTime(value) {
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function isCancelled(row) {
  return row && row.is_cancelled === true;
}

function driverMap(drivers) {
  const map = new Map();
  for (const driver of drivers) {
    map.set(driver.driver_number, driver);
  }
  return map;
}

function displayName(driver, driverNumber) {
  if (!driver) return `Driver #${driverNumber}`;
  return driver.full_name || driver.broadcast_name || `Driver #${driverNumber}`;
}

function normalizeSession(session) {
  return {
    sessionKey: session.session_key,
    sessionName: session.session_name,
    sessionType: session.session_type,
    dateStart: session.date_start,
    dateEnd: session.date_end,
    isCancelled: Boolean(session.is_cancelled),
  };
}

function meetingFrom(meeting, sessions) {
  if (!meeting) return null;
  return {
    meetingKey: meeting.meeting_key,
    meetingName: meeting.meeting_name,
    country: meeting.country_name,
    location: meeting.location,
    circuit: meeting.circuit_short_name,
    dateStart: meeting.date_start,
    dateEnd: meeting.date_end,
    sessions: sessions
      .filter((session) => session.meeting_key === meeting.meeting_key && !isCancelled(session))
      .sort((a, b) => (toTime(a.date_start) || 0) - (toTime(b.date_start) || 0))
      .map(normalizeSession),
  };
}

function selectNextMeeting(meetings, now) {
  return meetings
    .filter((meeting) => !isCancelled(meeting) && toTime(meeting.date_end) > now)
    .sort((a, b) => (toTime(a.date_start) || 0) - (toTime(b.date_start) || 0))[0] || null;
}

function isCompletedGrandPrix(session, now) {
  return (
    session.session_name === "Race" &&
    !isCancelled(session) &&
    toTime(session.date_end) !== null &&
    toTime(session.date_end) < now
  );
}

function previousRaces(sessions, meetings, now) {
  const meetingLookup = new Map(meetings.map((meeting) => [meeting.meeting_key, meeting]));
  return sessions
    .filter((session) => isCompletedGrandPrix(session, now))
    .sort((a, b) => (toTime(b.date_end) || 0) - (toTime(a.date_end) || 0))
    .map((session) => {
      const meeting = meetingLookup.get(session.meeting_key);
      return {
        sessionKey: session.session_key,
        meetingKey: session.meeting_key,
        meetingName: meeting?.meeting_name || session.circuit_short_name,
        country: meeting?.country_name || session.country_name,
        circuit: meeting?.circuit_short_name || session.circuit_short_name,
        location: meeting?.location || session.location,
        date: session.date_end,
      };
    });
}

function latestRaceResult(results, drivers) {
  const driversByNumber = driverMap(drivers);
  return [...results]
    .filter((row) => row.position != null)
    .sort((a, b) => a.position - b.position)
    .slice(0, 3)
    .map((row) => {
      const driver = driversByNumber.get(row.driver_number);
      return {
        position: row.position,
        driverNumber: row.driver_number,
        fullName: displayName(driver, row.driver_number),
        acronym: driver?.name_acronym || null,
        teamName: driver?.team_name || null,
      };
    });
}

function normalizeDriverChampionship(rows, drivers) {
  const driversByNumber = driverMap(drivers);
  return [...rows]
    .sort((a, b) => (a.position_current || 99) - (b.position_current || 99))
    .map((row) => {
      const driver = driversByNumber.get(row.driver_number);
      return {
        position: row.position_current,
        driverNumber: row.driver_number,
        fullName: displayName(driver, row.driver_number),
        acronym: driver?.name_acronym || null,
        teamName: driver?.team_name || null,
        points: row.points_current,
      };
    });
}

function normalizeTeamChampionship(rows) {
  return [...rows]
    .sort((a, b) => (a.position_current || 99) - (b.position_current || 99))
    .map((row) => ({
      position: row.position_current,
      teamName: row.team_name,
      points: row.points_current,
    }));
}

async function buildDashboardSnapshot(log = console) {
  const year = Number(process.env.OPENF1_YEAR) || new Date().getUTCFullYear();
  const now = Date.now();

  const meetings = await openf1.getMeetings(year);
  const sessions = await openf1.getSessions(year);

  const nextMeetingRow = selectNextMeeting(meetings, now);
  const nextMeeting = meetingFrom(nextMeetingRow, sessions);
  info(log, nextMeeting
    ? `Selected next meeting: ${nextMeeting.meetingName} (${nextMeeting.meetingKey})`
    : "No upcoming meeting found");

  const completed = sessions
    .filter((session) => isCompletedGrandPrix(session, now))
    .sort((a, b) => (toTime(b.date_end) || 0) - (toTime(a.date_end) || 0));
  const latestSession = completed[0] || null;
  info(log, latestSession
    ? `Selected last race session key: ${latestSession.session_key}`
    : "No completed Grand Prix race found");

  let latestRace = null;
  let driverChampionship = [];
  let teamChampionship = [];

  if (latestSession) {
    const results = await openf1.getSessionResult(latestSession.session_key);
    const drivers = await openf1.getDrivers(latestSession.session_key);
    const championshipDrivers = await openf1.getChampionshipDrivers(latestSession.session_key);
    const championshipTeams = await openf1.getChampionshipTeams(latestSession.session_key);
    const meeting = meetings.find((row) => row.meeting_key === latestSession.meeting_key);

    latestRace = {
      sessionKey: latestSession.session_key,
      meetingKey: latestSession.meeting_key,
      meetingName: meeting?.meeting_name || latestSession.circuit_short_name,
      country: meeting?.country_name || latestSession.country_name,
      circuit: meeting?.circuit_short_name || latestSession.circuit_short_name,
      location: meeting?.location || latestSession.location,
      date: latestSession.date_end,
      top3: latestRaceResult(results, drivers),
    };
    driverChampionship = normalizeDriverChampionship(championshipDrivers, drivers);
    teamChampionship = normalizeTeamChampionship(championshipTeams);
  }

  return {
    generatedAt: new Date().toISOString(),
    source: "OpenF1",
    schemaVersion: SCHEMA_VERSION,
    year,
    nextMeeting,
    latestRace,
    driverChampionship,
    teamChampionship,
    previousRaces: previousRaces(sessions, meetings, now),
  };
}

module.exports = {
  buildDashboardSnapshot,
};
