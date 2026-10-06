import test from "ava";
import { JobCancelledError } from "jobqu";
import { BatchedExecutor } from "../src/util/BatchedExecutor";

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function deferred<T = void>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(yes => { resolve = yes; });
    return { promise, resolve };
}

test("the executor limits unfinished work and runs repeated callback submissions separately", async t => {
    t.timeout(3000);
    const executor = new BatchedExecutor(1, 2);
    const gate = deferred(), started = deferred();
    t.teardown(() => { gate.resolve(); executor.stop(); });
    let calls = 0, active = 0, peak = 0;
    const task = async () => {
        const result = ++calls;
        peak = Math.max(peak, ++active);
        if (calls === 2) started.resolve();
        await gate.promise;
        active--;
        return result;
    };
    const results = Promise.all([executor.submit(task), executor.submit(task), executor.submit(task)]);
    await started.promise;
    await delay(20);
    t.is(calls, 2);
    gate.resolve();
    t.deepEqual(await results, [1, 2, 3]);
    t.is(peak, 2);
});

test("the executor honors its interval between batches and accepts work after becoming idle", async t => {
    const executor = new BatchedExecutor(40, 1);
    t.teardown(() => executor.stop());
    const [first, second] = await Promise.all([
        executor.submit(() => Date.now()), executor.submit(() => Date.now())
    ]);
    t.true(second - first >= 35);
    await delay(50);
    t.is(await executor.submit(() => "resumed"), "resumed");
});

test("task failures propagate and stopping rejects queued work while active work finishes", async t => {
    t.timeout(3000);
    const executor = new BatchedExecutor(1, 1);
    const gate = deferred<number>(), started = deferred();
    t.teardown(() => { gate.resolve(42); executor.stop(); });
    const syncError = new Error("sync failure"), asyncError = new Error("async failure");
    await t.throwsAsync(executor.submit(() => { throw syncError; }), { is: syncError });
    await t.throwsAsync(executor.submit(async () => { throw asyncError; }), { is: asyncError });
    const active = executor.submit(() => { started.resolve(); return gate.promise; });
    await started.promise;
    let queuedRan = false;
    const queued = t.throwsAsync(executor.submit(() => { queuedRan = true; }), { instanceOf: JobCancelledError });
    executor.stop();
    executor.stop();
    await queued;
    await t.throwsAsync(executor.submit(() => "never"), { instanceOf: JobCancelledError });
    gate.resolve(42);
    t.is(await active, 42);
    t.false(queuedRan);
});
