const fs = require("fs");
const path = require("path");
const {isDeepStrictEqual} = require("util");

const PART_NUMBERS = [
    "textureWidth", "textureHeight", "textureOffsetU", "textureOffsetV",
    "pivotX", "pivotY", "pivotZ", "pitch", "yaw", "roll"
];
const PART_FIELDS = [...PART_NUMBERS, "mirror", "cubes", "children"];
const CUBE_FIELDS = ["minX", "minY", "minZ", "maxX", "maxY", "maxZ"];

function fail(location, message) {
    throw new Error(`${location}: ${message}`);
}

function object(value, location) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        fail(location, "expected an object");
    }
}

function fields(value, expected, location) {
    object(value, location);
    for (const name of expected) {
        if (!Object.prototype.hasOwnProperty.call(value, name)) {
            fail(`${location}.${name}`, "missing required field in legacy ModelPart format");
        }
    }
    for (const name of Object.keys(value)) {
        if (!expected.includes(name)) {
            fail(`${location}.${name}`, "unsupported field in legacy ModelPart format");
        }
    }
}

function number(value, location) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        fail(location, "expected a finite number");
    }
}

function auditPart(part, location, report) {
    fields(part, PART_FIELDS, location);
    for (const name of PART_NUMBERS) number(part[name], `${location}.${name}`);
    for (const name of ["textureWidth", "textureHeight"]) {
        if (part[name] <= 0) fail(`${location}.${name}`, "expected a positive texture dimension");
    }
    if (typeof part.mirror !== "boolean") fail(`${location}.mirror`, "expected a boolean");
    for (const name of ["cubes", "children"]) {
        if (!Array.isArray(part[name])) fail(`${location}.${name}`, "expected an array");
    }
    report.partCount++;
    part.cubes.forEach((cube, index) => {
        const cubePath = `${location}.cubes[${index}]`;
        fields(cube, CUBE_FIELDS, cubePath);
        for (const name of CUBE_FIELDS) number(cube[name], `${cubePath}.${name}`);
        for (const axis of ["X", "Y", "Z"]) {
            if (cube[`min${axis}`] > cube[`max${axis}`]) {
                fail(`${cubePath}.min${axis}`, `exceeds max${axis}`);
            }
        }
        report.cubeCount++;
    });
    part.children.forEach((child, index) => auditPart(child, `${location}.children[${index}]`, report));
}

function auditFile(file) {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    object(data, "$");
    if (Object.prototype.hasOwnProperty.call(data, "groups")) {
        fail("$.groups", "legacy groups output is not a ModelPart dictionary");
    }
    const report = {
        file,
        modelCount: Object.keys(data).length,
        partCount: 0,
        cubeCount: 0,
        emptyModelCount: 0,
        emptyModels: [],
        intermediaryParts: []
    };
    for (const [id, model] of Object.entries(data)) {
        const modelPath = `$[${JSON.stringify(id)}]`;
        object(model, modelPath);
        const before = report.cubeCount;
        for (const [name, part] of Object.entries(model)) {
            const partPath = `${modelPath}[${JSON.stringify(name)}]`;
            auditPart(part, partPath, report);
            if (/^field_\d+$/.test(name)) report.intermediaryParts.push({model: id, part: name});
        }
        if (report.cubeCount === before) report.emptyModels.push(id);
    }
    report.emptyModelCount = report.emptyModels.length;
    return {report, data};
}

function main() {
    const args = process.argv.slice(2);
    if (args.includes("--help")) {
        console.log(`Usage: node auditModelDumps.js [--json] [--compare DIR] [FILE ...]

Validate legacy ModelPart dictionaries and count geometry recursively.
With no FILE arguments, audit the repository's entityModels.json and
blockEntityModels.json. Relative FILE paths use the working directory.

--json  Print reports and errors as JSON.
--compare DIR  Validate and compare each file with the same basename in DIR.
               Object key order and JSON number formatting do not affect equality.
--help  Show this help.

Empty geometry and intermediary field_N names are reported for review.
Invalid JSON, unsupported schemas, malformed fields, and mismatches exit with status 1.`);
        return;
    }
    const json = args.includes("--json");
    let comparisonDirectory;
    let files = [];
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === "--json") continue;
        if (arg === "--compare") {
            const directory = args[++index];
            if (!directory || directory.startsWith("-")) throw new Error("--compare requires a directory");
            comparisonDirectory = path.resolve(directory);
        } else if (arg.startsWith("-")) {
            throw new Error(`Unknown option: ${arg}`);
        } else {
            files.push(arg);
        }
    }
    if (files.length === 0) {
        files = ["entityModels.json", "blockEntityModels.json"].map(file =>
            path.resolve(__dirname, "../../../packages/minerender/src/entity", file));
    }
    const reports = [];
    const errors = [];
    for (const input of files) {
        const file = path.resolve(input);
        let errorFile = file;
        try {
            const {report, data} = auditFile(file);
            reports.push(report);
            if (comparisonDirectory) {
                report.comparisonFile = path.join(comparisonDirectory, path.basename(file));
                errorFile = report.comparisonFile;
                const comparison = auditFile(report.comparisonFile);
                report.matchesComparison = isDeepStrictEqual(data, comparison.data);
                if (!report.matchesComparison) throw new Error(`model data differs from ${file}`);
            }
        } catch (error) {
            errors.push({file: errorFile, error: error.message});
        }
    }
    if (json) {
        console.log(JSON.stringify({reports, errors}, null, 2));
    } else {
        for (const report of reports) {
            console.log(`${report.file}\n  ${report.modelCount} models, ${report.partCount} parts, ${report.cubeCount} cubes`);
            console.log(`  Empty geometry: ${report.emptyModelCount}; intermediary names: ${report.intermediaryParts.length} (use --json for locations)`);
            if (report.matchesComparison !== undefined) {
                console.log(`  Comparison: ${report.matchesComparison ? "match" : "mismatch"} (${report.comparisonFile})`);
            }
        }
        for (const error of errors) console.error(`${error.file}: ${error.error}`);
    }
    if (errors.length > 0) process.exitCode = 1;
}

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
