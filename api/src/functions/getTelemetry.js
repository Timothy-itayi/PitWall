const { app } = require("@azure/functions");
const { readTelemetry, writeTelemetry } = require("../lib/cache");
const { buildTelemetry } = require("../lib/buildTelemetry");
const { NotFoundError } = require("../lib/buildRace");
const { OpenF1Error } = require("../lib/openf1");

const jsonHeaders = {
  "Content-Type": "application/json",
  "Cache-Control": "public, max-age=300",
};

function invalid(message) {
  return {
    status: 400,
    headers: jsonHeaders,
    jsonBody: { error: message },
  };
}

app.http("getTelemetry", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "race/{sessionKey}/telemetry",
  handler: async (request, context) => {
    const rawKey = request.params.sessionKey;
    const rawDriver = request.query.get("driver");
    if (!/^\d+$/.test(rawKey || "")) {
      return invalid("sessionKey must be a positive integer.");
    }
    if (!/^\d+$/.test(rawDriver || "")) {
      return invalid("driver must be a positive integer.");
    }

    const sessionKey = Number(rawKey);
    const driverNumber = Number(rawDriver);
    const cached = await readTelemetry(sessionKey, driverNumber);
    if (cached) {
      context.log(`Telemetry ${sessionKey}/${driverNumber} cache HIT`);
      return {
        status: 200,
        headers: { ...jsonHeaders, "x-pitwall-cache": "HIT" },
        jsonBody: cached,
      };
    }

    context.log(`Telemetry ${sessionKey}/${driverNumber} cache MISS — fetching OpenF1`);
    try {
      const detail = await buildTelemetry(sessionKey, driverNumber);
      await writeTelemetry(sessionKey, driverNumber, detail);
      return {
        status: 200,
        headers: { ...jsonHeaders, "x-pitwall-cache": "MISS" },
        jsonBody: detail,
      };
    } catch (err) {
      if (err instanceof NotFoundError) {
        return {
          status: 404,
          headers: jsonHeaders,
          jsonBody: { error: err.message },
        };
      }
      context.error(`Telemetry ${sessionKey}/${driverNumber} failed: ${err && err.stack ? err.stack : err}`);
      const status = err instanceof OpenF1Error && err.status === 429 ? 429 : 502;
      return {
        status,
        headers: jsonHeaders,
        jsonBody: {
          error: "Failed to build lap telemetry from OpenF1.",
          detail: err.message,
        },
      };
    }
  },
});
