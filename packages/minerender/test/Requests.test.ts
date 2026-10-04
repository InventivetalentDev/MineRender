import test, { ExecutionContext } from "ava";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { JobCancelledError } from "jobqu";
import { RequestConfig, RequestError, Requests } from "../src/request/Requests";

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const waitFor = async (condition: () => boolean) => {
    const deadline = Date.now() + 3000;
    while (!condition()) {
        if (Date.now() > deadline) throw new Error("Request did not make progress");
        await delay(5);
    }
};

async function server(t: ExecutionContext, handler: (request: IncomingMessage, response: ServerResponse) => void) {
    const http = createServer(handler);
    await new Promise<void>((resolve, reject) => {
        http.once("error", reject);
        http.listen(0, "127.0.0.1", resolve);
    });
    t.teardown(async () => {
        http.closeAllConnections();
        await new Promise<void>(resolve => http.close(() => resolve()));
    });
    return `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
}

test.after.always(() => Requests.end());

test.serial("GET retries recover without changing caller config; permanent and parse failures reject", async t => {
    const counts = new Map<string, number>();
    const url = await server(t, (request, response) => {
        const path = request.url!;
        const count = (counts.get(path) ?? 0) + 1;
        counts.set(path, count);
        if (path === "/network" && count === 1) {
            request.socket.destroy();
            return;
        }
        response.setHeader("X-Asset", "test");
        if (path === "/missing") response.statusCode = 404;
        else if (path === "/exhausted" || path === "/post" || (path === "/recover" && count === 1)) response.statusCode = 503;
        response.end(path === "/invalid-json" ? "{broken" : '{"ok":true}');
    });
    const config = Object.freeze({ url: `${url}/recover`, headers: Object.freeze({ "X-Test": "value" }) });
    const result = await Requests.genericRequest(config);
    t.deepEqual(result.data, { ok: true });
    t.is(result.headers.get("X-Asset"), "test");
    t.is(counts.get("/recover"), 2);
    t.deepEqual(config, { url: `${url}/recover`, headers: { "X-Test": "value" } });

    await Requests.genericRequest({ url: `${url}/network` });
    t.is(counts.get("/network"), 2);

    for (const path of ["/exhausted", "/missing", "/post"]) {
        const error = await t.throwsAsync(Requests.genericRequest({ url: url + path, method: path === "/post" ? "POST" : "GET" }), { instanceOf: RequestError });
        t.is((error as RequestError).response?.status, path === "/missing" ? 404 : 503);
        t.is(counts.get(path), path === "/exhausted" ? 4 : 1);
    }
    await t.throwsAsync(Requests.genericRequest({ url: `${url}/invalid-json` }), { instanceOf: SyntaxError });
    t.is(counts.get("/invalid-json"), 1);
    await t.throwsAsync(Requests.genericRequest({ url: "not an absolute URL" }), { instanceOf: TypeError });
});

test.serial("numeric Retry-After delays retries; unsupported values leave retry timing to the caller", async t => {
    const calls: Record<string, number[]> = {};
    const url = await server(t, (request, response) => {
        const path = request.url!;
        (calls[path] ??= []).push(Date.now());
        if (calls[path].length === 1) {
            response.statusCode = 503;
            response.setHeader("Retry-After", path === "/seconds" ? "0.2" : path === "/cancel" ? "60" : path === "/date" ? "Wed, 01 Jan 2031 00:00:00 GMT" : "later");
        }
        response.end("{}");
    });
    await Requests.genericRequest({ url: `${url}/seconds` });
    t.is(calls["/seconds"].length, 2);
    t.true(calls["/seconds"][1] - calls["/seconds"][0] >= 190);
    const controller = new AbortController(), reason = new Error("cancel retry delay");
    const cancelled = Requests.genericRequest({ url: `${url}/cancel`, signal: controller.signal }).catch(error => error);
    await waitFor(() => calls["/cancel"]?.length === 1);
    await delay(30);
    controller.abort(reason);
    t.is(await cancelled, reason);
    t.is(calls["/cancel"].length, 1);
    t.deepEqual(Requests.queueSizes, { generic: 0, mcAsset: 0 });

    for (const path of ["/date", "/invalid"]) {
        await t.throwsAsync(Requests.genericRequest({ url: url + path }), { instanceOf: RequestError });
        t.is(calls[path].length, 1);
    }
});

test.serial("each queue holds eight slots through body reading and cancellation removes queued work", async t => {
    const active = { generic: 0, assets: 0 }, peaks = { generic: 0, assets: 0 };
    const held: ServerResponse[] = [];
    let released = false, received = 0;
    const url = await server(t, (request, response) => {
        const group = request.url!.startsWith("/assets") ? "assets" : "generic";
        received++;
        active[group]++;
        peaks[group] = Math.max(peaks[group], active[group]);
        response.once("close", () => active[group]--);
        response.writeHead(200, { "Content-Type": "application/json" });
        response.write('{"ok":');
        if (released) response.end("true}");
        else held.push(response);
    });
    const controller = new AbortController();
    const reason = new Error("cancel queued request");
    const generic = Array.from({ length: 10 }, (_, index) => Requests.genericRequest({
        url: `${url}/generic/${index}`, signal: index === 9 ? controller.signal : undefined
    }));
    const assets = Array.from({ length: 10 }, (_, index) => Requests.mcAssetRequest({ url: `${url}/assets/${index}` }));
    const settled = Promise.allSettled([...generic, ...assets]);
    const cancelled = generic[9].catch(error => error);
    await waitFor(() => held.length === 16);
    await delay(35);
    t.is(received, 16);
    t.deepEqual(peaks, { generic: 8, assets: 8 });
    controller.abort(reason);
    t.is(await cancelled, reason);
    t.is(received, 16);
    released = true;
    held.forEach(response => response.end("true}"));
    const results = await settled;
    t.is(results.filter(result => result.status === "fulfilled").length, 19);
    t.is(received, 19);
    t.deepEqual(peaks, { generic: 8, assets: 8 });
    t.deepEqual(Requests.queueSizes, { generic: 0, mcAsset: 0 });
});

test.serial("body timeouts retry four attempts and active cancellation preserves its reason", async t => {
    let timeouts = 0, activeStarted = false;
    const url = await server(t, (request, response) => {
        if (request.url === "/timeout") timeouts++;
        else activeStarted = true;
        response.writeHead(200);
        response.write('{"unfinished":');
    });
    await t.throwsAsync(Requests.genericRequest({ url: `${url}/timeout`, timeout: 30 }), { instanceOf: DOMException, name: "TimeoutError" });
    t.is(timeouts, 4);
    const controller = new AbortController(), reason = new Error("cancel active body");
    const active = Requests.genericRequest({ url: `${url}/active`, timeout: 0, signal: controller.signal }).catch(error => error);
    await waitFor(() => activeStarted);
    controller.abort(reason);
    t.is(await active, reason);
});

test.serial("queued calls share an attempt by config identity and bodyless or binary responses resolve", async t => {
    let calls = 0;
    const url = await server(t, (request, response) => {
        calls++;
        if (request.url === "/204" || request.url === "/205") response.statusCode = Number(request.url.slice(1));
        response.end(request.url === "/binary" ? Buffer.from([0, 128, 255]) : "{}");
    });
    const config: RequestConfig = { url: `${url}/shared` };
    const [first, second] = await Promise.all([Requests.genericRequest(config), Requests.genericRequest(config)]);
    t.is(first, second);
    t.is(calls, 1);
    for (const config of [{ url: `${url}/head`, method: "HEAD" }, { url: `${url}/204` }, { url: `${url}/205` }]) {
        t.is((await Requests.genericRequest(config)).data, undefined);
    }
    const binary = await Requests.genericRequest({ url: `${url}/binary`, responseType: "arraybuffer" });
    t.deepEqual(new Uint8Array(binary.data), new Uint8Array([0, 128, 255]));
});

test.serial("shutdown rejects queued and retrying calls while active requests finish without retry", async t => {
    const held: ServerResponse[] = [];
    let retryCalls = 0;
    const url = await server(t, (request, response) => {
        if (request.url === "/retry") {
            retryCalls++;
            response.writeHead(503, { "Retry-After": "60" });
            response.end("{}");
        } else {
            response.statusCode = request.url === "/active/0" ? 503 : 200;
            held.push(response);
        }
    });
    const retry = Requests.genericRequest({ url: `${url}/retry` }).catch(error => error);
    await waitFor(() => retryCalls === 1);
    await delay(30);
    const active = Array.from({ length: 8 }, (_, index) => Requests.genericRequest({ url: `${url}/active/${index}` }));
    const results = Promise.allSettled(active);
    await waitFor(() => held.length === 8);
    const queued = Requests.genericRequest({ url: `${url}/queued` }).catch(error => error);
    Requests.end();
    for (const error of [await retry, await queued, await Requests.genericRequest({ url }).catch(error => error)]) {
        t.true(error instanceof JobCancelledError);
        t.is(error.reason, "ended");
    }
    held.forEach(response => response.end("{}"));
    const settled = await results;
    t.is(settled[0].status, "rejected");
    t.true(settled[0].status === "rejected" && settled[0].reason instanceof RequestError);
    t.is(settled.filter(result => result.status === "fulfilled").length, 7);
    t.is(retryCalls, 1);
    t.is(held.length, 8);
    t.deepEqual(Requests.queueSizes, { generic: 0, mcAsset: 0 });
});
