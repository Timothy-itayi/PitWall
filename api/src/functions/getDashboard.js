const { app } = require("@azure/functions");
const { readDashboard } = require("../lib/cache");
const { refreshDashboard } = require("../lib/refresh");
const { sanitizeDashboardSnapshot } = require("../lib/buildDashboard");

const STALE_MS = Number(process.env.DASHBOARD_STALE_MS) || 12 * 60 * 60 * 1000;

const jsonHeaders = {
  "Content-Type": "application/json",
  "Cache-Control": "public, max-age=60",
};

app.http("getDashboard", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "dashboard",
  handler: async (_request, context) => {
    const snapshot = await readDashboard();
    if (!snapshot) {
      return {
        status: 503,
        headers: jsonHeaders,
        jsonBody: {
          error: "Dashboard snapshot is not available yet. Wait for the next refresh.",
        },
      };
    }

    const generatedAt = Date.parse(snapshot.generatedAt);
    const stale = Number.isNaN(generatedAt) || Date.now() - generatedAt > STALE_MS;
    context.log(`Serving dashboard snapshot generatedAt=${snapshot.generatedAt} stale=${stale}`);

    return {
      status: 200,
      headers: jsonHeaders,
      jsonBody: { ...sanitizeDashboardSnapshot(snapshot), stale },
    };
  },
});

app.http("refreshDashboard", {
  methods: ["POST"],
  authLevel: "function",
  route: "refresh",
  handler: async (_request, context) => {
    const { snapshot, durationMs } = await refreshDashboard(context);
    return {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      jsonBody: {
        ok: true,
        durationMs,
        generatedAt: snapshot.generatedAt,
        nextMeeting: snapshot.nextMeeting?.meetingName || null,
        lastRaceSessionKey: snapshot.latestRace?.sessionKey || null,
      },
    };
  },
});
