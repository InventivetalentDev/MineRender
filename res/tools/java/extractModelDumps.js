const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const METADATA_HASH = "fba9f7833e858a1257d810d21a3a9e3c967f9077";
const FABRIC = "https://maven.fabricmc.net/net/fabricmc";
const TOOLS = [
    ["remapper.jar", `${FABRIC}/tiny-remapper/0.11.2/tiny-remapper-0.11.2-fat.jar`, "0376b17b92f858956e018da672affb5485c18085db681f9547664996e82b6688"],
    ["intermediary.jar", `${FABRIC}/intermediary/1.16.5/intermediary-1.16.5-v2.jar`, "d2e35bbd6aa35c2fe0880e064ea428cb7e2355010903ebad67e4048348bc25a0"],
    ["yarn.jar", `${FABRIC}/yarn/1.16.5+build.6/yarn-1.16.5+build.6-v2.jar`, "fe3819320851288bd03701c4ca32e8a748a661c3f65600d2c67029ca232eaff1"]
];
const HELP = `Reproduce the legacy Minecraft 1.16.5 entity and block-entity model dumps.

Usage: node extractModelDumps.js --output DIR [--cache DIR] [--offline]

Requires Node.js 18+ and a JDK 17+ (java and jar on PATH).
Downloads verified official client/libraries and pinned Fabric mapping tools.
The default cache is res/tools/java/.cache/1.16.5. --offline reuses that cache.
DIR must not exist. Reference dictionaries and hosted assets are not modified.
`;

function options(args) {
    const result = { cache: path.join(__dirname, ".cache", "1.16.5"), offline: false };
    for (let i = 0; i < args.length; i++) {
        const name = args[i];
        if (name === "--offline") {
            result.offline = true;
        } else if (["--output", "--cache"].includes(name)) {
            const value = args[++i];
            if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
            result[name.slice(2)] = value;
        } else {
            throw new Error(`Unknown argument: ${name}`);
        }
    }
    if (!result.output) throw new Error("--output is required (see --help)");
    result.cache = path.resolve(result.cache);
    result.output = path.resolve(result.output);
    return result;
}

function digest(data, hash) {
    return crypto.createHash(hash.length === 64 ? "sha256" : "sha1").update(data).digest("hex");
}

async function cachedFile(file, url, hash, offline) {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(hash)) throw new Error(`Missing hash for ${file}`);
    try {
        const data = await fs.readFile(file);
        if (digest(data, hash) === hash) return data;
        if (offline) throw new Error(`Cached file failed hash verification: ${file}`);
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
    if (offline) throw new Error(`Missing cached file: ${file}. Run once without --offline.`);
    let data;
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        data = Buffer.from(await response.arrayBuffer());
    } catch (error) {
        throw new Error(`${url}: ${error.cause?.code || error.message}`);
    }
    if (digest(data, hash) !== hash) throw new Error(`Download failed hash verification: ${url}`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
    return data;
}

function allowed(library) {
    if (!library.rules) return true;
    const platform = { darwin: "osx", win32: "windows", linux: "linux" }[process.platform];
    const arch = { x64: "x86_64", arm64: "aarch64", ia32: "x86" }[process.arch] || process.arch;
    let allow = false;
    for (const rule of library.rules) {
        if (rule.features && Object.values(rule.features).some(Boolean)) continue;
        if (rule.os) {
            if (rule.os.name && rule.os.name !== platform) continue;
            if (rule.os.arch && !new RegExp(rule.os.arch).test(arch)) continue;
            if (rule.os.version && !new RegExp(rule.os.version).test(os.release())) continue;
        }
        allow = rule.action === "allow";
    }
    return allow;
}

function run(command, args, cwd, log) {
    const result = spawnSync(command, args, { cwd, stdio: log ? ["ignore", log.fd, log.fd] : "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status ?? result.signal})${log ? `; see ${log.file}` : ""}`);
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
        console.log(HELP);
        return;
    }
    const opts = options(args);
    if (typeof fetch !== "function") throw new Error("Node.js 18+ is required.");
    try {
        await fs.lstat(opts.output);
        throw new Error(`Output already exists: ${opts.output}`);
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
    const java = spawnSync("java", ["-version"], { encoding: "utf8" });
    if (java.error || java.status !== 0) throw new Error("Java is unavailable. Put a JDK 17+ on PATH.");
    const javaVersion = Number((java.stderr + java.stdout).match(/version "(\d+)/)?.[1]);
    if (!(javaVersion >= 17)) throw new Error(`JDK 17+ is required; found Java ${javaVersion || "unknown"}.`);
    const jar = spawnSync("jar", ["--version"], { encoding: "utf8" });
    if (jar.error || jar.status !== 0) throw new Error("The jar command is unavailable. Put a JDK 17+ on PATH.");

    const metadata = JSON.parse(await cachedFile(path.join(opts.cache, "version.json"),
        `https://piston-meta.mojang.com/v1/packages/${METADATA_HASH}/1.16.5.json`, METADATA_HASH, opts.offline));
    const artifacts = [
        { ...metadata.downloads.client, file: path.join(opts.cache, "client.jar") },
        ...metadata.libraries.filter(allowed).map(library => library.downloads?.artifact).filter(Boolean)
            .map(artifact => ({ ...artifact, file: path.join(opts.cache, "libraries", artifact.path) })),
        ...TOOLS.map(([name, url, sha1]) => ({ file: path.join(opts.cache, name), url, sha1 }))
    ];
    for (const artifact of artifacts) {
        const relative = path.relative(opts.cache, artifact.file);
        if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Invalid artifact path: ${artifact.file}`);
    }
    console.error(`Preparing Minecraft 1.16.5 and Yarn 1.16.5+build.6 (${opts.offline ? "offline" : "cached or downloaded"})`);
    let next = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
        while (next < artifacts.length) {
            const artifact = artifacts[next++];
            await cachedFile(artifact.file, artifact.url, artifact.sha1, opts.offline);
        }
    }));

    const temporary = await fs.mkdtemp(path.join(opts.cache, "remap-"));
    try {
        const libraries = artifacts.slice(1, -TOOLS.length).map(artifact => artifact.file);
        const intermediary = path.join(temporary, "intermediary.jar");
        const named = path.join(temporary, "named.jar");
        for (const [mapping, input, output, from, to] of [
            ["intermediary", artifacts[0].file, intermediary, "official", "intermediary"],
            ["yarn", intermediary, named, "intermediary", "named"]
        ]) {
            run("jar", ["xf", path.join(opts.cache, `${mapping}.jar`), "mappings/mappings.tiny"], temporary);
            const logFile = path.join(opts.cache, `remap-${mapping}.log`);
            const log = await fs.open(logFile, "w");
            try {
                console.error(`Remapping ${from} to ${to} (log: ${logFile})`);
                run("java", ["-jar", path.join(opts.cache, "remapper.jar"), input, output,
                    path.join(temporary, "mappings/mappings.tiny"), from, to, ...libraries, "--fixPackageAccess"],
                    temporary, { fd: log.fd, file: logFile });
            } finally {
                await log.close();
            }
        }
        // Minecraft's logger writes relative to the process directory.
        run("java", ["-Djava.awt.headless=true", "--class-path", [named, ...libraries].join(path.delimiter),
            path.join(__dirname, "ExtractModelDumps.java"), opts.output], opts.cache);
    } finally {
        await fs.rm(temporary, { recursive: true, force: true });
    }
    run(process.execPath, [path.join(__dirname, "auditModelDumps.js"), "--compare", opts.output], opts.cache);
}

main().catch(error => {
    console.error(`extractModelDumps: ${error.message}`);
    process.exitCode = 1;
});
