import test from "ava";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRenderPool } from "../dist/worker-process.js";

let fixtureDirectory;
let workerUrl;

test.before(async () => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), "minerender-pool-test-"));
    workerUrl = pathToFileURL(join(fixtureDirectory, "worker.mjs"));
    await writeFile(workerUrl, `
        import { writeFile } from "node:fs/promises";
        let renders = 0;
        process.on("message", async ({ request, assetOrigins }) => {
            renders++;
            if (request.fail) return process.send({ ok: false });
            if (request.crash) return process.exit(1);
            if (request.wait) {
                await writeFile(request.wait, JSON.stringify({ pid: process.pid, cwd: process.cwd() }));
                return;
            }
            process.send({ ok: true, png: Buffer.from(JSON.stringify({
                pid: process.pid, cwd: process.cwd(), renders, value: request.value, assetOrigins
            })) });
        });
    `);
});

test.after.always(() => rm(fixtureDirectory, { recursive: true, force: true }));

function pool(t, concurrency = 1) {
    const result = createRenderPool(concurrency, { workerUrl, assetOrigins: ["https://assets.example"] });
    t.teardown(() => result.close());
    return result;
}

async function render(target, request = {}) {
    return JSON.parse((await target.render(request, AbortSignal.timeout(5000))).toString());
}

async function waitForFile(path) {
    for (let attempt = 0; attempt < 100; attempt++) {
        try { return JSON.parse(await readFile(path, "utf8")); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error("The worker did not start the request");
}

test.serial("workers reuse their process and cache directory, then retire after 100 renders", async t => {
    const target = pool(t);
    const first = await render(target, { value: "first" });
    t.deepEqual(first.assetOrigins, ["https://assets.example"]);
    for (let count = 2; count <= 100; count++) {
        const next = await render(target, { value: count });
        t.is(next.pid, first.pid);
        t.is(next.cwd, first.cwd);
        t.is(next.renders, count);
        t.is(next.value, count);
    }
    await t.throwsAsync(stat(first.cwd), { code: "ENOENT" });
    const replacement = await render(target);
    t.not(replacement.pid, first.pid);
    t.not(replacement.cwd, first.cwd);
    t.is(replacement.renders, 1);
    await target.close();
    await t.throwsAsync(stat(replacement.cwd), { code: "ENOENT" });
    await t.throwsAsync(render(target), { instanceOf: Error, message: /shutting down/ });
});

test.serial("aborted renders hold their worker slot until termination and permit a replacement", async t => {
    const target = pool(t);
    const controller = new AbortController();
    const wait = join(fixtureDirectory, "abort.json");
    const pending = target.render({ wait }, controller.signal);
    const failure = t.throwsAsync(pending, { message: "render cancelled" });
    const active = await waitForFile(wait);
    await t.throwsAsync(render(target), { message: /busy/ });
    controller.abort(new Error("render cancelled"));
    await failure;
    t.throws(() => process.kill(active.pid, 0), { code: "ESRCH" });
    await t.throwsAsync(stat(active.cwd), { code: "ENOENT" });
    const replacement = await render(target);
    t.not(replacement.pid, active.pid);
});

test.serial("render failures leave the worker reusable and crashed workers are replaced", async t => {
    const target = pool(t);
    const first = await render(target);
    await t.throwsAsync(render(target, { fail: true }), { message: /scene could not be rendered/ });
    t.is((await render(target)).pid, first.pid);
    await t.throwsAsync(render(target, { crash: true }), { message: /process (disconnected|stopped)/ });
    await t.throwsAsync(stat(first.cwd), { code: "ENOENT" });
    t.not((await render(target)).pid, first.pid);
});

test.serial("closing the pool cleans up both busy and idle workers", async t => {
    const target = pool(t, 2);
    const wait = join(fixtureDirectory, "close.json");
    const pending = target.render({ wait }, AbortSignal.timeout(5000));
    const failure = t.throwsAsync(pending, { message: /shutting down/ });
    const active = await waitForFile(wait);
    const idle = await render(target);
    t.not(active.pid, idle.pid);
    await target.close();
    await failure;
    for (const worker of [active, idle]) {
        t.throws(() => process.kill(worker.pid, 0), { code: "ESRCH" });
        await t.throwsAsync(stat(worker.cwd), { code: "ENOENT" });
    }
    await target.close();
});

test.serial("failed spawns release their slot without waiting for an exit event", async t => {
    const target = pool(t);
    const executable = process.execPath;
    try {
        process.execPath = join(fixtureDirectory, "missing-node");
        await t.throwsAsync(render(target), { message: /process is unavailable/ });
    } finally {
        process.execPath = executable;
    }
    t.is((await render(target)).renders, 1);
});
