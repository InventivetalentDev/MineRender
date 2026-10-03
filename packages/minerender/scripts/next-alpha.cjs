const semver = require("semver");
const { version } = require("../package.json");

console.log(semver.inc(version, "prerelease", "alpha"));
