import test from "ava";
import { yieldToEventLoop } from "../src/util/util";

test("yielding uses a macrotask instead of scheduler.yield, so chained yields let frames render", async t => {
    const global = globalThis as typeof globalThis & { scheduler?: unknown };
    const previous = Object.getOwnPropertyDescriptor(global, "scheduler");
    let prioritized = 0;
    global.scheduler = { yield: () => { prioritized++; return Promise.resolve(); } };
    try {
        await yieldToEventLoop();
        t.is(prioritized, 0);
    } finally {
        if (previous) Object.defineProperty(global, "scheduler", previous);
        else delete global.scheduler;
    }
});
