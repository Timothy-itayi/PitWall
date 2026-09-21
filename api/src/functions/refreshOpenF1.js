const { app } = require("@azure/functions");
const { refreshDashboard } = require("../lib/refresh");

app.timer("refreshOpenF1", {
  schedule: "0 15 */6 * * *",
  handler: async (_timer, context) => {
    await refreshDashboard(context);
  },
});
