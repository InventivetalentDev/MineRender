import test, { ExecutionContext } from "ava";
import { Env } from "../src/Env";
import { BrowserEnv, registerBrowserEnv } from "../src/env/browser/BrowserEnv";
import { Logging, LogHandler } from "../src/util/log";

function fixture(t: ExecutionContext) {
    const provider = Env["_provider"], worker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
    const messages: Parameters<LogHandler>[] = [];
    Logging.setHandler((...message) => { messages.push(message); });
    t.teardown(() => {
        Env["_provider"] = provider;
        if (worker) Object.defineProperty(globalThis, "Worker", worker);
        else delete (globalThis as { Worker?: typeof Worker }).Worker;
        Logging.setHandler();
    });
    return messages;
}

for (const sectionWorker of ["/assets/section.worker.mjs", new URL("https://example.com/assets/section.worker.mjs")]) {
    test.serial(`browser section workers accept a ${typeof sectionWorker === "string" ? "string" : "URL"} option`, t => {
        const messages = fixture(t), calls: unknown[][] = [];
        globalThis.Worker = class {
            constructor(url: string | URL, options: WorkerOptions) { calls.push([url, options]); }
        } as unknown as typeof Worker;
        const worker = new BrowserEnv({ sectionWorker }).createWorker("section");
        t.true(worker instanceof Worker);
        t.deepEqual(calls, [[sectionWorker, { type: "module" }]]);
        t.deepEqual(messages, []);
    });
}

test.serial("browser section workers accept a function without calling the Worker constructor", t => {
    const messages = fixture(t), worker = {} as Worker;
    let calls = 0;
    globalThis.Worker = class {
        constructor() { t.fail("Worker constructor should not be called"); }
    } as unknown as typeof Worker;
    const env = new BrowserEnv({ sectionWorker: () => { calls++; return worker; } });
    t.is(env.createWorker("section"), worker);
    t.is(calls, 1);
    t.deepEqual(messages, []);
});

test.serial("browser section workers warn once when the Worker constructor throws", t => {
    const messages = fixture(t), error = new Error("Worker blocked");
    globalThis.Worker = class {
        constructor() { throw error; }
    } as unknown as typeof Worker;
    t.is(new BrowserEnv({ sectionWorker: "/assets/section.worker.mjs" }).createWorker("section"), undefined);
    t.deepEqual(messages, [["warn", "BrowserEnv", [
        "Could not start the section worker, so sections build on the main thread. Pass sectionWorker to registerBrowserEnv to load it from another URL.", error
    ]]]);
});

test.serial("browser section workers stay silent without a Worker global", t => {
    const messages = fixture(t);
    delete (globalThis as { Worker?: typeof Worker }).Worker;
    const env = new BrowserEnv({ sectionWorker: () => { t.fail("worker function should not be called"); return {} as Worker; } });
    t.is(env.createWorker("section"), undefined);
    t.deepEqual(messages, []);
});

test.serial("registerBrowserEnv installs a provider that uses the section worker option", t => {
    const messages = fixture(t), calls: unknown[][] = [], sectionWorker = "/assets/section.worker.mjs";
    globalThis.Worker = class {
        constructor(url: string | URL, options: WorkerOptions) { calls.push([url, options]); }
    } as unknown as typeof Worker;
    const env = registerBrowserEnv({ sectionWorker });
    t.is(Env.provider, env);
    t.true(Env.provider.createWorker!("section") instanceof Worker);
    t.deepEqual(calls, [[sectionWorker, { type: "module" }]]);
    t.deepEqual(messages, []);
});
