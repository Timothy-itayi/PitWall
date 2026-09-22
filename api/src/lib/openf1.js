const BASE_URL = "https://api.openf1.org/v1";
const MIN_INTERVAL_MS = Number(process.env.OPENF1_MIN_INTERVAL_MS) || 400;

class OpenF1Error extends Error {
  constructor(message, { status, path } = {}) {
    super(message);
    this.name = "OpenF1Error";
    this.status = status;
    this.path = path;
  }
}

let lastRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pace() {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) {
    await sleep(wait);
  }
  lastRequestAt = Date.now();
}

function toQuery(params) {
  const parts = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    // OpenF1 writes comparison filters as `date>value`. The `=` is the normal
    // query separator, so the key is `date>`, not `date>=`. Encoding `>` makes
    // the filter miss and the API returns 404.
    const encodedKey = /^[A-Za-z0-9_><=]+$/.test(key) ? key : encodeURIComponent(key);
    parts.push(`${encodedKey}=${encodeURIComponent(String(value))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

async function get(path, params = {}, attempt = 0) {
  await pace();
  const url = `${BASE_URL}/${path}${toQuery(params)}`;
  let response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (err) {
    throw new OpenF1Error(`OpenF1 ${path} network error: ${err.message}`, { path });
  }

  if (response.status === 429 && attempt < 2) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const backoffMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 2000;
    await sleep(backoffMs);
    return get(path, params, attempt + 1);
  }

  if (response.status < 200 || response.status >= 300) {
    const body = await response.text().catch(() => "");
    throw new OpenF1Error(
      `OpenF1 ${path} failed with HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
      { status: response.status, path }
    );
  }

  try {
    return await response.json();
  } catch {
    throw new OpenF1Error(`OpenF1 ${path} returned invalid JSON`, {
      status: response.status,
      path,
    });
  }
}

function getMeetings(year) {
  return get("meetings", { year });
}

function getMeeting(meetingKey) {
  return get("meetings", { meeting_key: meetingKey });
}

function getSessions(year) {
  return get("sessions", { year });
}

function getSession(sessionKey) {
  return get("sessions", { session_key: sessionKey });
}

function getSessionResult(sessionKey) {
  return get("session_result", { session_key: sessionKey });
}

function getDrivers(sessionKey) {
  return get("drivers", { session_key: sessionKey });
}

function getChampionshipDrivers(sessionKey) {
  return get("championship_drivers", { session_key: sessionKey });
}

function getChampionshipTeams(sessionKey) {
  return get("championship_teams", { session_key: sessionKey });
}

function getLaps(sessionKey, params = {}) {
  return get("laps", { session_key: sessionKey, ...params });
}

function getCarData(sessionKey, driverNumber, window) {
  return get("car_data", {
    session_key: sessionKey,
    driver_number: driverNumber,
    "date>": window.start,
    "date<": window.end,
  });
}

function getLocation(sessionKey, driverNumber, window) {
  return get("location", {
    session_key: sessionKey,
    driver_number: driverNumber,
    "date>": window.start,
    "date<": window.end,
  });
}

function getStints(sessionKey, params = {}) {
  return get("stints", { session_key: sessionKey, ...params });
}

function getPit(sessionKey) {
  return get("pit", { session_key: sessionKey });
}

function getPosition(sessionKey, params = {}) {
  return get("position", { session_key: sessionKey, ...params });
}

function getOvertakes(sessionKey) {
  return get("overtakes", { session_key: sessionKey });
}

function getRaceControl(sessionKey) {
  return get("race_control", { session_key: sessionKey });
}

module.exports = {
  OpenF1Error,
  get,
  getMeetings,
  getMeeting,
  getSessions,
  getSession,
  getSessionResult,
  getDrivers,
  getChampionshipDrivers,
  getChampionshipTeams,
  getLaps,
  getCarData,
  getLocation,
  getStints,
  getPit,
  getPosition,
  getOvertakes,
  getRaceControl,
};
