const { buildDashboardSnapshot } = require("./buildDashboard");
const { writeDashboard } = require("./cache");

function logInfo(log, message) {
  if (log && typeof log.info === "function") {
    log.info(message);
    return;
  }
  console.log(message);
}

function logError(log, message) {
  if (log && typeof log.error === "function") {
    log.error(message);
    return;
  }
  console.error(message);
}

async function refreshDashboard(log = console) {
  const started = Date.now();
  logInfo(log, "OpenF1 refresh started");
  try {
    const snapshot = await buildDashboardSnapshot(log);
    await writeDashboard(snapshot);
    const durationMs = Date.now() - started;
    logInfo(log, `OpenF1 refresh completed in ${durationMs}ms`);
    return { snapshot, durationMs };
  } catch (err) {
    const durationMs = Date.now() - started;
    logError(
      log,
      `OpenF1 refresh failed after ${durationMs}ms: ${err && err.stack ? err.stack : err}`
    );
    throw err;
  }
}

module.exports = { refreshDashboard };
