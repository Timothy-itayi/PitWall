const { readdirSync } = require("node:fs");
const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const { sanitizeDashboardSnapshot } = require("../src/lib/buildDashboard");

const sourceDirectories = ["src/lib", "src/functions"];

function javascriptFiles(directory) {
  return readdirSync(resolve(directory))
    .filter((file) => file.endsWith(".js"))
    .sort()
    .map((file) => resolve(directory, file));
}

const files = sourceDirectories.flatMap(javascriptFiles);

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

for (const file of javascriptFiles("src/functions")) {
  require(file);
}

console.log(`Parsed ${files.length} files and imported all Function entry points.`);

const cleaned = sanitizeDashboardSnapshot({
  driverChampionship: [
    { position: 1, driverNumber: 12, fullName: "Kimi ANTONELLI", teamName: "Mercedes", points: 292 },
    { position: 8, driverNumber: 6, fullName: "Driver #6", teamName: null, points: 71 },
    { position: 9, driverNumber: 30, fullName: "Liam LAWSON", teamName: "Red Bull Racing", points: 59 },
  ],
  teamChampionship: [
    { position: 1, teamName: "Mercedes", points: 503 },
    { position: 2, teamName: "", points: 0 },
  ],
  latestRace: {
    top3: [
      { driverNumber: 12, fullName: "Kimi ANTONELLI", teamName: "Mercedes" },
      { driverNumber: 6, fullName: "Driver #6" },
    ],
  },
});

if (cleaned.driverChampionship.map((row) => row.driverNumber).join(",") !== "12,30") {
  throw new Error("Unidentified championship rows must be dropped");
}
if (cleaned.driverChampionship[1].position !== 2) {
  throw new Error("Championship positions must compact after dropping ghosts");
}
if (cleaned.teamChampionship.length !== 1) {
  throw new Error("Constructor rows without a team name must be dropped");
}
if (cleaned.latestRace.top3.length !== 1) {
  throw new Error("Unidentified podium rows must be dropped");
}

console.log("Sanitized unidentified championship rows.");
