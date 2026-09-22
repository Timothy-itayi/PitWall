const openf1 = require("./openf1");
const { OpenF1Error } = require("./openf1");
const { NotFoundError } = require("./buildRace");

const MAX_SAMPLES = 220;
const PEDAL_MATCH_MS = 400;

function pickLap(laps) {
  const usable = (laps || []).filter(
    (lap) =>
      lap &&
      lap.date_start &&
      typeof lap.lap_duration === "number" &&
      Number.isFinite(lap.lap_duration) &&
      lap.lap_duration > 0 &&
      !lap.is_pit_out_lap
  );
  if (!usable.length) return null;
  return usable.reduce((best, lap) => (lap.lap_duration < best.lap_duration ? lap : best));
}

function positionAt(rows, startMs) {
  let atOrBefore = null;
  let firstAfter = null;
  for (const row of rows || []) {
    const time = Date.parse(row.date);
    if (!Number.isFinite(time) || row.position == null) continue;
    if (time <= startMs) atOrBefore = row.position;
    else if (firstAfter == null) firstAfter = row.position;
  }
  return atOrBefore ?? firstAfter;
}

function compoundForLap(stints, lapNumber) {
  const hit = (stints || []).find(
    (stint) => lapNumber >= stint.lap_start && lapNumber <= stint.lap_end
  );
  return hit?.compound || null;
}

function stride(rows, max) {
  if (rows.length <= max) return rows;
  const step = rows.length / max;
  const out = [];
  for (let i = 0; i < max; i += 1) out.push(rows[Math.floor(i * step)]);
  return out;
}

function nearestPedal(cars, time) {
  if (!cars.length) return null;
  let lo = 0;
  let hi = cars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cars[mid].t < time) lo = mid + 1;
    else hi = mid;
  }
  const candidates = [cars[lo - 1], cars[lo]].filter(Boolean);
  candidates.sort((a, b) => Math.abs(a.t - time) - Math.abs(b.t - time));
  const best = candidates[0];
  if (!best || Math.abs(best.t - time) > PEDAL_MATCH_MS) return null;
  return best;
}

function buildSamples({ location, carData, startMs, endMs }) {
  const cars = (carData || [])
    .map((row) => ({
      t: Date.parse(row.date),
      throttle: Number.isFinite(row.throttle) ? row.throttle : null,
      brake: Number.isFinite(row.brake) ? row.brake : null,
    }))
    .filter((row) => Number.isFinite(row.t) && row.t >= startMs && row.t <= endMs)
    .sort((a, b) => a.t - b.t);

  const locs = (location || [])
    .map((row) => ({
      t: Date.parse(row.date),
      x: Number(row.x),
      y: Number(row.y),
    }))
    .filter(
      (row) =>
        Number.isFinite(row.t) &&
        row.t >= startMs &&
        row.t <= endMs &&
        Number.isFinite(row.x) &&
        Number.isFinite(row.y)
    )
    .sort((a, b) => a.t - b.t);

  const source = locs.length >= 2 ? locs : cars;
  return stride(source, MAX_SAMPLES).map((point) => {
    const pedal = point.throttle == null && point.brake == null ? nearestPedal(cars, point.t) : point;
    return {
      t: Math.round((point.t - startMs) / 10) / 100,
      throttle: pedal?.throttle ?? null,
      brake: pedal?.brake ?? null,
      x: Number.isFinite(point.x) ? Math.round(point.x) : null,
      y: Number.isFinite(point.y) ? Math.round(point.y) : null,
    };
  });
}

async function readOrEmpty(request) {
  try {
    return await request();
  } catch (err) {
    if (err instanceof OpenF1Error && err.status === 404) return [];
    throw err;
  }
}

async function buildTelemetry(sessionKey, driverNumber) {
  const laps = await openf1.getLaps(sessionKey, { driver_number: driverNumber });
  const lap = pickLap(laps);
  if (!lap) {
    throw new NotFoundError(`No timed lap for driver ${driverNumber} in session ${sessionKey}`);
  }

  const startMs = Date.parse(lap.date_start);
  const endMs = startMs + lap.lap_duration * 1000 + 200;
  const window = { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() };

  const carData = await readOrEmpty(() => openf1.getCarData(sessionKey, driverNumber, window));
  const location = await readOrEmpty(() => openf1.getLocation(sessionKey, driverNumber, window));
  const positions = await readOrEmpty(() => openf1.getPosition(sessionKey, { driver_number: driverNumber }));
  const stints = await readOrEmpty(() => openf1.getStints(sessionKey, { driver_number: driverNumber }));

  return {
    generatedAt: new Date().toISOString(),
    source: "OpenF1",
    sessionKey,
    driverNumber,
    lapNumber: lap.lap_number,
    lapDuration: lap.lap_duration,
    position: positionAt(positions, startMs),
    compound: compoundForLap(stints, lap.lap_number),
    samples: buildSamples({ location, carData, startMs, endMs }),
  };
}

module.exports = {
  pickLap,
  positionAt,
  compoundForLap,
  buildSamples,
  buildTelemetry,
};
