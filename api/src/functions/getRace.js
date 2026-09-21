const { app } = require("@azure/functions");
const { readRace, writeRace } = require("../lib/cache");
const { buildRaceDetail, NotFoundError } = require("../lib/buildRace");
const { OpenF1Error } = require("../lib/openf1");

const jsonHeaders = {
  "Content-Type": "application/json",
  "Cache-Control": "public, max-age=300",
};

function invalidKeyResponse() {
  return {
    status: 400,
    headers: jsonHeaders,
    jsonBody: { error: "sessionKey must be a positive integer." },
  };
}

app.http("getRace", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "race/{sessionKey}",
  handler: async (request, context) => {
    const rawKey = request.params.sessionKey;
    if (!/^\d+$/.test(rawKey)) {
      return invalidKeyResponse();
    }

    const sessionKey = Number(rawKey);
    const cached = await readRace(sessionKey);
    if (cached) {
      context.log(`Race ${sessionKey} cache HIT`);
      return {
        status: 200,
        headers: { ...jsonHeaders, "x-pitwall-cache": "HIT" },
        jsonBody: cached,
      };
    }

    context.log(`Race ${sessionKey} cache MISS — fetching OpenF1`);
    try {
      const detail = await buildRaceDetail(sessionKey);
      await writeRace(sessionKey, detail);
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
      context.error(`Race ${sessionKey} build failed: ${err && err.stack ? err.stack : err}`);
      const status = err instanceof OpenF1Error && err.status === 429 ? 429 : 502;
      return {
        status,
        headers: jsonHeaders,
        jsonBody: {
          error: "Failed to build race detail from OpenF1.",
          detail: err.message,
        },
      };
    }
  },
});
