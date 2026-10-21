import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { before, after, test } from "node:test";
import puppeteer from "puppeteer-core";
import { encodeSceneDocument } from "minerender/browser";

let browser, server, origin, inspector, red, blue;
const camera = { position: [40, 25, 60], target: [0, 16, 0] };
const skinScene = skin => ({ format: "minerender-scene", version: 1, camera, objects: [{ id: "skin", type: "skin", skin }] });
const fragment = async scene => `#scene=${await encodeSceneDocument(scene)}`;
const cube = {
    textures: { all: "minecraft:block/embed_test" },
    elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: Object.fromEntries(
        ["north", "south", "east", "west", "up", "down"].map(face => [face, { texture: "#all" }])
    ) }]
};

before(async () => {
    const headers = await readFile(fileURLToPath(new URL("../dist/_headers", import.meta.url)), "utf8");
    const allowOrigin = headers.match(/^\/embed\/\*\r?\n[ \t]+Access-Control-Allow-Origin:[ \t]*(\S+)/m)?.[1];
    const files = new Map(await Promise.all(["index.html", "main.js"].map(async name => [name,
        await readFile(fileURLToPath(new URL(`../dist/embed/${name}`, import.meta.url)))
    ])));
    server = createServer((request, response) => {
        const path = new URL(request.url, "http://localhost").pathname;
        if (path.startsWith("/embed/") && allowOrigin) response.setHeader("Access-Control-Allow-Origin", allowOrigin);
        if (path === "/") {
            response.setHeader("Content-Type", "text/html");
            response.end('<!doctype html><style>body{margin:0}iframe{display:block;border:0}</style>');
        } else {
            const name = path === "/embed/" ? "index.html" : path === "/embed/main.js" ? "main.js" : undefined;
            response.writeHead(name ? 200 : 404, { "Content-Type": name === "main.js" ? "text/javascript" : "text/html" });
            response.end(name ? files.get(name) : "Not found");
        }
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    origin = `http://127.0.0.1:${server.address().port}`;
    browser = await puppeteer.launch({
        executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        headless: true,
        args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"]
    });
    inspector = await browser.newPage();
    [red, blue] = await inspector.evaluate(() => ["#ff0000", "#0000ff"].map(color => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 64;
        const context = canvas.getContext("2d");
        context.fillStyle = color;
        context.fillRect(0, 0, 64, 64);
        return canvas.toDataURL();
    }));
}, { timeout: 30000 });

after(async () => {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
});

async function open(t, source, { sandbox, intercept } = {}) {
    const context = await browser.createBrowserContext();
    t.after(() => context.close());
    const page = await context.newPage();
    await page.setViewport({ width: 800, height: 600 });
    const errors = [], unexpected = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on("request", async request => {
        try {
            const url = new URL(request.url());
            if ([origin, "null"].includes(url.origin)) return await request.continue();
            if (intercept && await intercept(request)) return;
            const headers = { "Access-Control-Allow-Origin": "*" };
            if (url.hostname === "assets.mcasset.cloud") {
                if (url.pathname.endsWith("/models/block/embed_test.json")) {
                    return await request.respond({ status: 200, contentType: "application/json", headers, body: JSON.stringify(cube) });
                }
                if (url.pathname.endsWith("/textures/block/embed_test.png")) {
                    return await request.respond({ status: 200, contentType: "image/png", headers, body: Buffer.from(red.split(",")[1], "base64") });
                }
                if (url.pathname.endsWith("/textures/block/_list.json")) {
                    return await request.respond({ status: 200, contentType: "application/json", headers, body: JSON.stringify({ directories: [], files: ["embed_test.png"] }) });
                }
                if (url.pathname.endsWith(".mcmeta")) return await request.respond({ status: 404, headers });
            }
            unexpected.push(request.url());
            await request.abort();
        } catch (error) {
            if (!/already handled|Target closed|Session closed|Invalid InterceptionId/.test(String(error))) errors.push(String(error));
        }
    });
    t.after(() => {
        assert.deepEqual(unexpected, [], "All rendering assets must come from deterministic fixtures");
        assert.deepEqual(errors, [], "No uncaught page or fixture errors");
    });
    await page.goto(origin);
    await page.evaluate(({ src, sandbox }) => {
        const iframe = document.createElement("iframe");
        iframe.width = iframe.height = "320";
        if (sandbox !== undefined) iframe.setAttribute("sandbox", sandbox);
        iframe.src = src;
        const spacer = document.createElement("div");
        spacer.style.height = "2000px";
        document.body.append(iframe, spacer);
    }, { src: `${origin}/embed/${source}`, sandbox });
    const iframe = await page.waitForSelector("iframe");
    const frame = await iframe.contentFrame();
    await frame.waitForSelector("#viewport");
    return { page, frame };
}

async function ready(frame) {
    await frame.waitForFunction(() => ["ready", "error"].includes(document.querySelector("#viewport")?.dataset.state), { timeout: 15000 });
    const state = await frame.$eval("#viewport", element => element.dataset.state);
    assert.equal(state, "ready", await frame.$eval("#status", element => element.textContent));
}

async function color(frame, expected) {
    await frame.waitForSelector("#viewport canvas");
    await assertColor(await frame.page().screenshot({ encoding: "base64" }), expected);
}

async function assertColor(screenshot, expected) {
    const counts = await inspector.evaluate(async png => {
        const image = new Image();
        image.src = `data:image/png;base64,${png}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const counts = { red: 0, blue: 0 };
        for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i] > 40 && pixels[i] > pixels[i + 1] * 2 && pixels[i] > pixels[i + 2] * 2) counts.red++;
            if (pixels[i + 2] > 40 && pixels[i + 2] > pixels[i + 1] * 2 && pixels[i + 2] > pixels[i] * 2) counts.blue++;
        }
        return counts;
    }, screenshot);
    assert.ok(counts[expected] > 200, `Expected visible ${expected} geometry; pixels: ${JSON.stringify(counts)}`);
    assert.equal(counts[expected === "red" ? "blue" : "red"], 0, "No geometry from the previous scene");
}

async function changeFragment(frame, hash) {
    await frame.evaluate(hash => {
        window.readyFrames = [];
        new MutationObserver(() => {
            const viewport = document.querySelector("#viewport");
            const canvas = viewport.querySelector("canvas");
            if (viewport.dataset.state === "ready" && canvas) window.readyFrames.push(canvas.toDataURL().split(",")[1]);
        }).observe(document.querySelector("#viewport"), { attributes: true, attributeFilter: ["data-state"] });
        window.documentMarker = true;
        location.hash = hash;
    }, hash);
}

async function fragmentReady(frame) {
    await frame.waitForFunction(() => window.readyFrames.length || document.querySelector("#viewport")?.dataset.state === "error");
    await ready(frame);
}

test("changing #scene renders the new scene in the same iframe document", { timeout: 30000 }, async t => {
    const { frame } = await open(t, await fragment(skinScene(red)));
    await ready(frame);
    await color(frame, "red");
    await changeFragment(frame, await fragment(skinScene(blue)));
    await fragmentReady(frame);
    assert.equal(await frame.evaluate(() => window.documentMarker), true);
    await color(frame, "blue");
});

test("a superseded asset load cannot replace a newer fragment", { timeout: 30000 }, async t => {
    let requested, release;
    const pending = new Promise(resolve => { requested = resolve; });
    const { page, frame } = await open(t, await fragment(skinScene("https://fixtures.invalid/slow.png")), {
        intercept: async request => {
            if (request.url() !== "https://fixtures.invalid/slow.png") return false;
            requested();
            await new Promise(resolve => { release = resolve; });
            await request.respond({ status: 200, contentType: "image/png", headers: { "Access-Control-Allow-Origin": "*" }, body: Buffer.from(red.split(",")[1], "base64") });
            return true;
        }
    });
    await pending;
    await changeFragment(frame, await fragment(skinScene(blue)));
    release();
    await fragmentReady(frame);
    await page.waitForNetworkIdle({ idleTime: 100, timeout: 5000 });
    await color(frame, "blue");
    for (const screenshot of await frame.evaluate(() => window.readyFrames)) await assertColor(screenshot, "blue");
});

test("off-screen embeds release their context and recreate it when visible", { timeout: 30000 }, async t => {
    const { page, frame } = await open(t, await fragment(skinScene(red)));
    await ready(frame);
    await frame.evaluate(() => {
        window.previousCanvas = document.querySelector("#viewport canvas");
        window.previousContext = window.previousCanvas.getContext("webgl2");
    });
    await page.evaluate(() => scrollTo(0, 1800));
    await frame.waitForFunction(() => window.previousContext.isContextLost()
        && !document.querySelector("#viewport canvas"), { timeout: 10000 });
    await page.evaluate(() => scrollTo(0, 0));
    await ready(frame);
    assert.equal(await frame.evaluate(() => document.querySelector("#viewport canvas") !== window.previousCanvas), true);
    await color(frame, "red");
});

test("released skin renderers allow their WebGL contexts to be collected", { timeout: 30000 }, async t => {
    const source = await fragment(skinScene(red));
    const { page, frame } = await open(t, source);
    await page.evaluateOnNewDocument(() => {
        window.contexts = [];
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (...args) {
            const context = getContext.apply(this, args);
            if (args[0] === "webgl2" && context) window.contexts.push(new WeakRef(context));
            return context;
        };
    });
    await frame.goto(`${origin}/embed/?controls=false${source}`);
    await ready(frame);
    for (let cycle = 0; cycle < 6; cycle++) {
        await page.evaluate(() => scrollTo(0, 1800));
        await frame.waitForFunction(() => !document.querySelector("#viewport canvas"), { timeout: 10000 });
        await page.evaluate(() => scrollTo(0, 0));
        await ready(frame);
    }
    const session = await page.createCDPSession();
    for (let pass = 0; pass < 3; pass++) await session.send("HeapProfiler.collectGarbage");
    const { created, reachable } = await frame.evaluate(() => ({
        created: window.contexts.length,
        reachable: window.contexts.filter(context => context.deref()).length
    }));
    assert.equal(created, 7);
    assert.ok(reachable <= 2, `Expected at most two reachable WebGL contexts, got ${reachable}`);
    await session.detach();
});

test("twenty embeds share the page without retaining off-screen WebGL contexts", { timeout: 60000 }, async t => {
    const source = await fragment(skinScene(red));
    const { page } = await open(t, source);
    await page.evaluate(src => {
        for (let index = 1; index < 20; index++) {
            const iframe = document.createElement("iframe");
            iframe.width = iframe.height = "320";
            iframe.src = src;
            const spacer = document.createElement("div");
            spacer.style.height = "800px";
            document.body.append(iframe, spacer);
        }
    }, `${origin}/embed/${source}`);
    let previous;
    for (const [index, iframe] of (await page.$$("iframe")).entries()) {
        await iframe.evaluate(element => element.scrollIntoView());
        const frame = await iframe.contentFrame();
        await ready(frame);
        try { await color(frame, "red"); }
        catch (error) {
            t.diagnostic(`Iframe ${index}: ${JSON.stringify(await frame.evaluate(() => ({ state: document.querySelector("#viewport").dataset.state,
                lost: document.querySelector("canvas")?.getContext("webgl2").isContextLost(), hidden: document.hidden,
                width: document.querySelector("canvas")?.width, height: document.querySelector("canvas")?.height })))}`);
            throw error;
        }
        await frame.evaluate(() => { window.previousContext = document.querySelector("#viewport canvas").getContext("webgl2"); });
        if (previous) await previous.waitForFunction(() => window.previousContext.isContextLost());
        previous = frame;
    }
});

test("forced context loss leaves ready state and redraws after restoration or Retry", { timeout: 30000 }, async t => {
    const { frame } = await open(t, await fragment(skinScene(red)));
    await ready(frame);
    await frame.evaluate(() => {
        window.contextLoss = document.querySelector("#viewport canvas").getContext("webgl2").getExtension("WEBGL_lose_context");
        if (!window.contextLoss) throw new Error("Chrome must support WEBGL_lose_context");
        window.contextLoss.loseContext();
    });
    await frame.waitForFunction(() => document.querySelector("#viewport")?.dataset.state === "context-lost");
    assert.equal(await frame.$eval("#status", element => element.hidden), false);
    await frame.evaluate(() => window.contextLoss.restoreContext());
    await ready(frame);
    await color(frame, "red");
    await frame.evaluate(() => {
        window.previousCanvas = document.querySelector("#viewport canvas");
        window.contextLoss.loseContext();
    });
    await frame.waitForFunction(() => document.querySelector("#viewport")?.dataset.state === "context-lost");
    await frame.click("#retry");
    await ready(frame);
    assert.equal(await frame.evaluate(() => document.querySelector("#viewport canvas") !== window.previousCanvas), true);
    await color(frame, "red");
});

test("an allow-scripts sandbox renders model assets when browser storage is unavailable", { timeout: 30000 }, async t => {
    const { frame } = await open(t, "?model=minecraft:block/embed_test", { sandbox: "allow-scripts" });
    assert.equal(await frame.evaluate(() => {
        try { localStorage.getItem("test"); return false; }
        catch (error) { return error.name === "SecurityError"; }
    }), true);
    await ready(frame);
    await color(frame, "red");
});
