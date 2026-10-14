import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { cpus, tmpdir, totalmem } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import * as esbuild from "esbuild";
import { polyfillNode } from "esbuild-plugin-polyfill-node";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repository = path.resolve(root, "../..");
const { values: args } = parseArgs({ options: {
    world: { type: "string" }, output: { type: "string" },
    dimension: { type: "string", default: "overworld" },
    version: { type: "string", default: "1.21.11" },
    center: { type: "string" }, route: { type: "string" },
    "load-radius": { type: "string", default: "1" },
    "unload-radius": { type: "string", default: "2" },
    "settle-ms": { type: "string", default: "1000" },
    "camera-height": { type: "string", default: "160" },
    "max-cached-regions": { type: "string", default: "4" },
    "max-cached-bytes": { type: "string", default: String(64 * 1024 * 1024) },
    "biome-blend-radius": { type: "string", default: "0" },
    "no-section-meshing": { type: "boolean", default: false },
    "saved-lighting": { type: "boolean", default: false },
    "ambient-occlusion": { type: "boolean", default: false },
    "render-entities": { type: "boolean", default: false },
    "software-rendering": { type: "boolean", default: false },
    headed: { type: "boolean", default: false },
    "timeout-ms": { type: "string", default: "1800000" },
    help: { type: "boolean", short: "h", default: false },
} });

if (args.help) {
    console.log(`Usage: yarn workspace @minerender/web benchmark:world --world SAVE_FOLDER [options]

--version VERSION              Minecraft asset version (default 1.21.11)
--dimension overworld|nether|end
--center X,Z                   Starting chunk; default nearest populated chunk to 0,0
--route '[[X,Z],[X,Z],...]'     Outbound chunk centers; return route is automatic
--load-radius N --unload-radius N --settle-ms N --camera-height N
--saved-lighting --ambient-occlusion --biome-blend-radius N --render-entities
--no-section-meshing --max-cached-regions N --max-cached-bytes N
--software-rendering           Use SwiftShader instead of Chrome's selected GPU
--headed --timeout-ms N --output REPORT.json

Set CHROME_PATH for a Chrome binary outside the default macOS installation.
Build the library with yarn build:lib before running.`);
    process.exit(0);
}

function integer(name, min, max = Number.MAX_SAFE_INTEGER) {
    const value = Number(args[name]);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new Error(`--${name} must be an integer from ${min} to ${max}`);
    }
    return value;
}

function coordinates(value) {
    if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isSafeInteger)) {
        throw new Error("Each route center must be [integer chunk X, integer chunk Z]");
    }
    return { x: value[0], z: value[1] };
}

async function nearestChunk(files) {
    const regions = [...files.values()].filter(file => file.kind === "region" && /^r\./.test(file.name))
        .map(file => ({ file, x: Number(file.name.split(".")[1]), z: Number(file.name.split(".")[2]) }))
        .sort((a, b) => regionDistance(a) - regionDistance(b));
    let nearest;
    for (const region of regions) {
        if (nearest && regionDistance(region) > nearest.x ** 2 + nearest.z ** 2) break;
        const handle = await open(region.file.absolute, "r");
        try {
            const header = Buffer.alloc(4096);
            const { bytesRead } = await handle.read(header, 0, header.length, 0);
            if (bytesRead !== header.length) continue;
            for (let index = 0; index < 1024; index++) {
                if (!header.readUInt32BE(index * 4)) continue;
                const candidate = { x: region.x * 32 + index % 32, z: region.z * 32 + Math.floor(index / 32) };
                if (!nearest || candidate.x ** 2 + candidate.z ** 2 < nearest.x ** 2 + nearest.z ** 2) nearest = candidate;
            }
        } finally { await handle.close(); }
    }
    if (!nearest) throw new Error("No populated region headers found; supply --route for entity-only columns");
    return nearest;
}

function regionDistance({ x, z }) {
    const axis = value => value >= 0 ? value * 32 : (value + 1) * 32 - 1;
    return axis(x) ** 2 + axis(z) ** 2;
}

async function fingerprint(file) {
    const before = await stat(file.absolute);
    const hash = createHash("sha256");
    for await (const bytes of createReadStream(file.absolute)) hash.update(bytes);
    const after = await stat(file.absolute);
    if (before.size !== file.size || before.mtimeMs !== file.mtimeMs
        || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
        throw new Error(`World file changed during the benchmark: ${file.relative}`);
    }
    return { path: file.relative, bytes: file.size, sha256: hash.digest("hex") };
}

let browser;
let server;
let page;
let report;
let output;
const problems = [];
try {
    if (!args.world) throw new Error("Supply --world SAVE_FOLDER; use --help for options");
    if (args.center && args.route) throw new Error("Supply --center or --route, not both");
    const dimension = { overworld: "", nether: "DIM-1", end: "DIM1" }[args.dimension];
    if (dimension === undefined) throw new Error("--dimension must be overworld, nether, or end");
    const worldFolder = await realpath(args.world);
    const dimensionFolder = await realpath(path.join(worldFolder, dimension));
    if (dimensionFolder !== worldFolder && !dimensionFolder.startsWith(worldFolder + path.sep)) {
        throw new Error("The dimension folder must be inside the selected save");
    }
    const files = new Map();
    for (const kind of ["region", "entities"]) {
        let entries;
        try { entries = await readdir(path.join(dimensionFolder, kind), { withFileTypes: true }); }
        catch (error) { if (error.code === "ENOENT") continue; throw error; }
        for (const entry of entries) {
            if (!entry.isFile() || !/^(?:r\.-?\d+\.-?\d+\.mca|c\.-?\d+\.-?\d+\.mcc)$/.test(entry.name)) continue;
            const relative = `${kind}/${entry.name}`;
            const absolute = await realpath(path.join(dimensionFolder, kind, entry.name));
            if (!absolute.startsWith(worldFolder + path.sep)) throw new Error(`World file leaves selected save: ${relative}`);
            const info = await stat(absolute);
            files.set(relative, { relative, absolute, kind, name: entry.name, size: info.size, mtimeMs: info.mtimeMs });
        }
    }
    const loadRadius = integer("load-radius", 0, 32);
    const unloadRadius = integer("unload-radius", loadRadius, 32);
    let route;
    if (args.route) {
        const parsed = JSON.parse(args.route);
        if (!Array.isArray(parsed) || !parsed.length || parsed.length > 64) throw new Error("--route needs 1 to 64 chunk centers");
        route = parsed.map(coordinates);
    } else {
        const center = args.center ? coordinates(args.center.split(",").map(Number)) : await nearestChunk(files);
        const step = Math.max(8, 2 * unloadRadius + 1);
        route = Array.from({ length: 4 }, (_, index) => coordinates([center.x + index * step, center.z]));
    }
    const config = {
        version: args.version, route, loadRadius, unloadRadius,
        settleMs: integer("settle-ms", 100, 60000), cameraHeight: integer("camera-height", 1, 4096),
        maxCachedRegions: integer("max-cached-regions", 0), maxCachedBytes: integer("max-cached-bytes", 0),
        biomeBlendRadius: integer("biome-blend-radius", 0, 7), sectionMeshing: !args["no-section-meshing"],
        savedLighting: args["saved-lighting"], ambientOcclusion: args["ambient-occlusion"], renderEntities: args["render-entities"],
    };
    if (!config.sectionMeshing && (config.savedLighting || config.ambientOcclusion || config.biomeBlendRadius)) {
        throw new Error("Saved lighting, ambient occlusion, and biome blending require section meshing");
    }
    const timeout = integer("timeout-ms", 1000);
    const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    await stat(chrome);
    const worker = await readFile(path.join(repository, "packages/minerender/dist/browser/esm/env/browser/section.worker.mjs"));
    const bundle = await esbuild.build({
        entryPoints: [path.join(root, "benchmarks/world.ts")], bundle: true, write: false,
        format: "esm", platform: "browser", target: "es2020", logLevel: "warning",
        plugins: [polyfillNode({ polyfills: { zlib: true } })],
    });
    const requests = new Map();
    const html = '<!doctype html><html lang="en"><meta charset="utf-8"><title>World streaming benchmark</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}#viewport{width:100%;height:100%}#status{position:absolute;top:8px;left:8px;background:white;color:black;padding:8px;font:14px monospace}</style><div id="viewport"></div><output id="status">Starting benchmark</output><script type="module" src="/world.mjs"></script></html>';
    server = createServer((request, response) => {
        const url = new URL(request.url, "http://127.0.0.1");
        response.setHeader("Cache-Control", "no-store");
        const contents = url.pathname === "/" ? html : url.pathname === "/world.mjs" ? bundle.outputFiles[0].contents
            : url.pathname === "/section.worker.mjs" ? worker : undefined;
        if (contents !== undefined) {
            response.setHeader("Content-Type", url.pathname === "/" ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8");
            response.end(contents);
            return;
        }
        const relative = url.pathname.startsWith("/world-files/") ? url.pathname.slice("/world-files/".length) : undefined;
        const file = files.get(relative);
        if (!relative || !/^(region|entities)\/(r\.-?\d+\.-?\d+\.mca|c\.-?\d+\.-?\d+\.mcc)$/.test(relative)) {
            response.writeHead(404).end();
            return;
        }
        requests.set(relative, (requests.get(relative) ?? 0) + 1);
        if (!file) { response.writeHead(404).end(); return; }
        response.setHeader("Content-Type", "application/octet-stream");
        const stream = createReadStream(file.absolute);
        stream.on("error", error => { problems.push(`Read ${relative}: ${error.message}`); response.destroy(error); });
        response.on("close", () => stream.destroy());
        stream.pipe(response);
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const chromeArgs = ["--enable-precise-memory-info", "--js-flags=--expose-gc"];
    if (args["software-rendering"]) chromeArgs.push("--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist");
    browser = await puppeteer.launch({ executablePath: chrome, headless: !args.headed, args: chromeArgs });
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    page.setDefaultTimeout(timeout);
    page.on("pageerror", error => problems.push(`Page: ${error.message}`));
    page.on("console", message => {
        if (message.type() === "error" && !message.text().includes("404")) problems.push(`Console: ${message.text()}`);
        if (message.text().startsWith("[benchmark]")) console.log(message.text());
    });
    const address = server.address();
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "load", timeout });
    await page.waitForFunction(() => typeof window.runWorldBenchmark === "function");
    console.log(`Streaming ${route.length} outbound centers in ${args.dimension} with Minecraft ${config.version}`);
    let timeoutTimer;
    let result;
    try {
        result = await Promise.race([
            page.evaluate(config => window.runWorldBenchmark(config), config),
            new Promise((_, reject) => {
                timeoutTimer = setTimeout(() => reject(new Error(`Benchmark exceeded ${timeout} ms`)), timeout);
                timeoutTimer.unref();
            }),
        ]);
    } finally { clearTimeout(timeoutTimer); }
    const manifest = [];
    for (const relative of [...requests.keys()].sort()) {
        const file = files.get(relative);
        manifest.push(file ? { ...await fingerprint(file), requests: requests.get(relative) }
            : { path: relative, missing: true, requests: requests.get(relative) });
    }
    const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" });
    const dirty = spawnSync("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: repository, encoding: "utf8" });
    report = {
        schemaVersion: 1, createdAt: new Date().toISOString(),
        revision: git.status === 0 ? git.stdout.trim() : null,
        workingTreeDirty: dirty.status === 0 ? !!dirty.stdout.trim() : null,
        save: { dimension: args.dimension, files: manifest },
        browser: { version: await browser.version(), viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
            headless: !args.headed, softwareRenderingRequested: args["software-rendering"], arguments: chromeArgs },
        runtime: { node: process.version, platform: process.platform, arch: process.arch,
            cpuModel: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, memoryBytes: totalmem() },
        artifacts: { scriptSha256: createHash("sha256").update(bundle.outputFiles[0].contents).digest("hex"),
            workerSha256: createHash("sha256").update(worker).digest("hex") },
        ...result, problems,
    };
    output = path.resolve(args.output ?? path.join(tmpdir(), `minerender-world-benchmark-${Date.now()}.json`));
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + "\n");
    for (const run of report.runs) {
        const updateMs = run.waypoints.reduce((sum, point) => sum + point.updateMs, 0);
        const maxGap = Math.max(...run.waypoints.map(point => point.frames.maxMs ?? 0));
        console.log(`${run.pass}: ${updateMs.toFixed(0)} ms streaming, ${maxGap.toFixed(1)} ms maximum frame gap`);
    }
    console.log(`Report: ${output}`);
    if (problems.length || report.runs.some(run => run.waypoints.some(point => point.failedChunks > 0))) process.exitCode = 1;
} catch (error) {
    console.error(error.stack ?? error);
    process.exitCode = 1;
} finally {
    await page?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
