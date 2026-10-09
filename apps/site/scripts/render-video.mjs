// Renders the announcement video from the stage page in Chrome.
//
//   yarn workspace @minerender/site video                       hero cut, 1920×1080, 60 fps
//   yarn workspace @minerender/site video --timeline vertical --size 1080x1920
//   yarn workspace @minerender/site video --shots open,outro    only these shots (still joined)
//   yarn workspace @minerender/site video --headed              real GPU through a visible Chrome window (viewport at device scale 2)
//   yarn workspace @minerender/site video --scale 1             CSS pixels equal output pixels (default headless; needs a big enough window when headed)
//   yarn workspace @minerender/site video --supersample 2       render at 2x and downscale (4x the GPU work; smooths leaves and other cutout textures)
//   CHROME_PATH=/path/to/chrome yarn workspace @minerender/site video
//
// Each shot is loaded with the clock running (assets load in real time), then stepped frame by
// frame on the injected virtual clock. Every frame is screenshotted and piped into ffmpeg; the
// per-shot clips are joined with crossfades into .video/<timeline>.mp4.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const args = parseArgs(process.argv.slice(2));
const timeline = args.timeline ?? "hero";
const [width, height] = (args.size ?? "1920x1080").split("x").map(Number);
const fps = Number(args.fps ?? 60);
const transition = Number(args.transition ?? 0.4);
const only = args.shots ? String(args.shots).split(",") : undefined;
const headed = Boolean(args.headed);
// Headed Chrome cannot show a 1080p viewport on a laptop screen and resizes its surface on every
// capture when the emulated viewport is larger than the window. Emulating half the size at device
// scale 2 keeps the window on screen and still produces full-resolution frames.
const scale = Number(args.scale ?? (headed ? 2 : 1));
// Render at a multiple of the output size and scale down in ffmpeg: smooths alpha-tested textures such as leaves.
const supersample = Number(args.supersample ?? 1);
if (width % scale || height % scale) {
    console.error(`Size ${width}x${height} is not divisible by scale ${scale}.`);
    process.exit(2);
}
const cssWidth = width * supersample / scale;
const cssHeight = height * supersample / scale;
const port = Number(process.env.PORT ?? 5177);
const base = args.url ?? `http://127.0.0.1:${port}/`;
const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const outDir = path.resolve(root, args.out ?? ".video");
const clipDir = path.join(outDir, "clips");

if (!fs.existsSync(chrome)) {
    console.error(`Chrome not found at ${chrome}; set CHROME_PATH.`);
    process.exit(2);
}
fs.mkdirSync(clipDir, { recursive: true });

const server = args.url ? undefined : await startDevServer();
const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: !headed,
    defaultViewport: { width: cssWidth, height: cssHeight, deviceScaleFactor: scale },
    args: headed
        ? [`--window-size=${cssWidth},${cssHeight + 90}`]
        : ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"]
});

try {
    const page = await browser.newPage();
    page.on("pageerror", error => console.error(`[page] ${error.message}`));
    page.on("console", message => {
        const text = message.text();
        // Asset lookups probe alternative paths, so 404s are expected noise.
        if ((message.type() === "error" || message.type() === "warning") && !/404/.test(text)) console.error(`[console] ${text}`);
    });
    await page.evaluateOnNewDocument(fs.readFileSync(path.join(root, "scripts", "virtual-clock.js"), "utf8"));
    // Diagnostic: screenshots must not change the page size, or Chrome re-lays out every frame.
    await page.evaluateOnNewDocument(() => { window.__resizes = 0; window.addEventListener("resize", () => { window.__resizes++; }); });
    await page.goto(`${base}video.html?timeline=${encodeURIComponent(timeline)}&w=${cssWidth}&h=${cssHeight}&dpr=${scale}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__video?.ready === true, { timeout: 60000 });

    const shots = (await page.evaluate(fps => window.__video.list(fps), fps))
        .filter(shot => !only || only.includes(shot.id));
    if (!shots.length) throw new Error("No shots selected");

    const clips = [];
    for (const [index, shot] of shots.entries()) {
        const clip = path.join(clipDir, `${String(index).padStart(2, "0")}-${shot.id}.mp4`);
        const started = Date.now();
        process.stdout.write(`${shot.id}: loading… `);
        const info = await page.evaluate(({ id, fps }) => window.__video.load(id, fps), { id: shot.id, fps });
        process.stdout.write(`${((Date.now() - started) / 1000).toFixed(1)}s, ${info.frames} frames\n`);

        const encoder = startEncoder(clip);
        const captureStart = Date.now();
        for (let frame = 0; frame < info.frames; frame++) {
            await page.evaluate(() => window.__video.step());
            const png = await capture(page);
            await write(encoder.stdin, png);
            if (frame % fps === 0 || frame === info.frames - 1) {
                const rate = (frame + 1) / ((Date.now() - captureStart) / 1000);
                process.stdout.write(`\r${shot.id}: frame ${frame + 1}/${info.frames} (${rate.toFixed(1)} fps)   `);
            }
        }
        encoder.stdin.end();
        await encoder.done;
        const resizes = await page.evaluate(() => window.__resizes);
        if (resizes) console.error(`[driver] page resized ${resizes} times during ${shot.id}; frames may be inconsistent`);
        process.stdout.write(`\r${shot.id}: ${path.relative(root, clip)}                              \n`);
        clips.push({ ...info, clip });
    }
    await page.evaluate(() => window.__video.unload());

    const output = path.join(outDir, `${timeline}${only ? "-partial" : ""}.mp4`);
    await join(clips, output);
    const total = clips.reduce((sum, clip) => sum + clip.seconds, 0) - transition * (clips.length - 1);
    console.log(`${path.relative(root, output)} (${total.toFixed(1)}s)`);
} finally {
    await browser.close();
    server?.kill();
}

/** Screenshots the stage. The stage is exactly the emulated viewport; capturing beyond it would resize the page on every frame. */
async function capture(page, attempt = 0) {
    try {
        return await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: cssWidth, height: cssHeight }, captureBeyondViewport: false, optimizeForSpeed: true });
    } catch (error) {
        // A capture occasionally fails inside the protocol layer; the frame is unchanged until the next step, so retry.
        if (attempt >= 2) throw error;
        console.error(`[driver] screenshot failed (${error.message}); retrying`);
        return capture(page, attempt + 1);
    }
}

function parseArgs(argv) {
    const result = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith("--")) continue;
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
            result[key] = next;
            i++;
        } else {
            result[key] = true;
        }
    }
    return result;
}

async function startDevServer() {
    const vite = path.join(path.dirname(require.resolve("vite/package.json")), "bin", "vite.js");
    const child = spawn(process.execPath, [vite, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
        cwd: root,
        stdio: ["ignore", "ignore", "pipe"]
    });
    let log = "";
    child.stderr.on("data", chunk => { log += chunk; });
    for (let attempt = 0; ; attempt++) {
        try {
            if ((await fetch(`${base}video.html`)).ok) return child;
        } catch { /* not up yet */ }
        if (child.exitCode !== null || attempt > 120) {
            console.error(`Dev server did not start on port ${port}.\n${log}`);
            child.kill();
            process.exit(2);
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
}

function startEncoder(file) {
    const child = spawn("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
        ...(supersample !== 1 ? ["-vf", `scale=${width}:${height}:flags=lanczos`] : []),
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
        "-r", String(fps),
        file
    ], { stdio: ["pipe", "inherit", "inherit"] });
    const done = new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("close", code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code} for ${file}`)));
    });
    return { stdin: child.stdin, done };
}

function write(stream, chunk) {
    return new Promise((resolve, reject) => {
        stream.write(chunk, error => error ? reject(error) : resolve());
    });
}

/** Concatenates clips with crossfades. Clip durations are exact (frames / fps), so the offsets are too. */
async function join(clips, output) {
    const inputs = clips.flatMap(clip => ["-i", clip.clip]);
    let filter = "";
    if (clips.length === 1) {
        filter = "[0:v]copy[v]";
    } else {
        let offset = 0;
        let previous = "[0:v]";
        clips.slice(1).forEach((clip, i) => {
            offset += clips[i].seconds - transition;
            const label = i === clips.length - 2 ? "[v]" : `[x${i}]`;
            filter += `${previous}[${i + 1}:v]xfade=transition=fade:duration=${transition}:offset=${offset.toFixed(3)}${label};`;
            previous = label;
        });
        filter = filter.slice(0, -1);
    }
    const child = spawn("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        ...inputs,
        "-filter_complex", filter, "-map", "[v]",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        output
    ], { stdio: ["ignore", "inherit", "inherit"] });
    await new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("close", code => code === 0 ? resolve() : reject(new Error(`ffmpeg join exited with ${code}`)));
    });
}
