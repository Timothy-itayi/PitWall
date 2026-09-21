const openf1 = require("./openf1");

const SCHEMA_VERSION = 1;
const TIMELINE_CATEGORIES = new Set(["Flag", "SafetyCar", "SessionStatus", "CarEvent"]);

class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "NotFoundError";
    this.status = 404;
  }
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

function normalizeTeamColour(value) {
  const hex = String(value || "").replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(hex) ? hex : null;
}

function firstPositionByDriver(positions) {
  const map = new Map();
  const sorted = [...positions].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  for (const row of sorted) {
    if (!map.has(row.driver_number)) {
      map.set(row.driver_number, row.position);
    }
  }
  return map;
}

function fastestLapByDriver(laps) {
  const map = new Map();
  for (const lap of laps) {
    const duration = lap.lap_duration;
    if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) continue;
    const current = map.get(lap.driver_number);
    if (current == null || duration < current) {
      map.set(lap.driver_number, duration);
    }
  }
  return map;
}

function countByDriver(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const driverNumber = row[key];
    map.set(driverNumber, (map.get(driverNumber) || 0) + 1);
  }
  return map;
}

function stintsByDriver(stints) {
  const map = new Map();
  const sorted = [...stints].sort((a, b) => {
    if (a.driver_number !== b.driver_number) return a.driver_number - b.driver_number;
    return (a.stint_number || a.lap_start || 0) - (b.stint_number || b.lap_start || 0);
  });
  for (const stint of sorted) {
    const list = map.get(stint.driver_number) || [];
    list.push({
      compound: stint.compound || null,
      lapStart: stint.lap_start,
      lapEnd: stint.lap_end,
      stintNumber: stint.stint_number,
    });
    map.set(stint.driver_number, list);
  }
  return map;
}

function normalizeTimeline(events) {
  return [...events]
    .filter((event) => TIMELINE_CATEGORIES.has(event.category))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    .map((event) => ({
      date: event.date,
      lapNumber: event.lap_number ?? null,
      category: event.category,
      flag: event.flag || null,
      message: event.message || "",
      driverNumber: event.driver_number ?? null,
    }));
}

async function buildRaceDetail(sessionKey) {
  const sessions = await openf1.getSession(sessionKey);
  const session = sessions[0];
  if (!session) {
    throw new NotFoundError(`No OpenF1 session found for sessionKey ${sessionKey}`);
  }

  const meetings = await openf1.getMeeting(session.meeting_key);
  const meeting = meetings[0] || null;
  const results = await openf1.getSessionResult(sessionKey);
  const drivers = await openf1.getDrivers(sessionKey);
  const laps = await openf1.getLaps(sessionKey);
  const stints = await openf1.getStints(sessionKey);
  const pits = await openf1.getPit(sessionKey);
  const positions = await openf1.getPosition(sessionKey);
  const overtakes = await openf1.getOvertakes(sessionKey);
  const raceControl = await openf1.getRaceControl(sessionKey);

  const driversByNumber = driverMap(drivers);
  const finishByDriver = new Map(results.map((row) => [row.driver_number, row]));
  const initialByDriver = firstPositionByDriver(positions);
  const fastestByDriver = fastestLapByDriver(laps);
  const pitsByDriver = countByDriver(pits, "driver_number");
  const overtakesByDriver = countByDriver(overtakes, "overtaking_driver_number");
  const driverStints = stintsByDriver(stints);

  const driverNumbers = new Set([
    ...driversByNumber.keys(),
    ...finishByDriver.keys(),
  ]);

  const normalizedDrivers = [...driverNumbers]
    .map((driverNumber) => {
      const driver = driversByNumber.get(driverNumber);
      const result = finishByDriver.get(driverNumber);
      const finishPosition = result?.position ?? null;
      const initialPosition = initialByDriver.has(driverNumber)
        ? initialByDriver.get(driverNumber)
        : null;
      const placesGained =
        initialPosition != null && finishPosition != null
          ? initialPosition - finishPosition
          : null;

      return {
        driverNumber,
        fullName: displayName(driver, driverNumber),
        acronym: driver?.name_acronym || null,
        teamName: driver?.team_name || null,
        teamColour: normalizeTeamColour(driver?.team_colour),
        finishPosition,
        initialPosition,
        placesGained,
        fastestLap: fastestByDriver.get(driverNumber) ?? null,
        pitStops: pitsByDriver.get(driverNumber) || 0,
        overtakes: overtakesByDriver.get(driverNumber) || 0,
        dnf: Boolean(result?.dnf),
        dns: Boolean(result?.dns),
        dsq: Boolean(result?.dsq),
        stints: driverStints.get(driverNumber) || [],
      };
    })
    .sort((a, b) => {
      if (a.finishPosition == null) return 1;
      if (b.finishPosition == null) return -1;
      return a.finishPosition - b.finishPosition;
    });

  return {
    generatedAt: new Date().toISOString(),
    source: "OpenF1",
    schemaVersion: SCHEMA_VERSION,
    sessionKey,
    meeting: meeting
      ? {
          meetingKey: meeting.meeting_key,
          meetingName: meeting.meeting_name,
          country: meeting.country_name,
          location: meeting.location,
          circuit: meeting.circuit_short_name,
          dateStart: meeting.date_start,
          dateEnd: meeting.date_end,
        }
      : {
          meetingKey: session.meeting_key,
          meetingName: session.circuit_short_name,
          country: session.country_name,
          location: session.location,
          circuit: session.circuit_short_name,
          dateStart: session.date_start,
          dateEnd: session.date_end,
        },
    session: {
      sessionName: session.session_name,
      sessionType: session.session_type,
      dateStart: session.date_start,
      dateEnd: session.date_end,
    },
    drivers: normalizedDrivers,
    raceControl: normalizeTimeline(raceControl),
  };
}

module.exports = {
  NotFoundError,
  buildRaceDetail,
};
