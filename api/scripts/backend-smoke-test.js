const { readdirSync } = require("node:fs");
const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

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
