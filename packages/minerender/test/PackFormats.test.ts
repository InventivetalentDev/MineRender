import test, { ExecutionContext } from "ava";
import { PackFormats } from "../src/assets/source/archive/PackFormats";
import { Requests, RequestConfig } from "../src/request/Requests";

function fixture(t: ExecutionContext, load: (request: RequestConfig) => unknown | Promise<unknown>) {
    const original = Requests.genericRequest;
    t.teardown(() => { Requests.genericRequest = original; });
    const urls: string[] = [];
    Requests.genericRequest = async request => {
        urls.push(request.url);
        return { data: await load(request), status: 200, statusText: "OK", headers: new Headers(), url: request.url };
    };
    return urls;
}

test.serial("resource and data formats share pending and completed version requests", async t => {
    let resolve: (data: unknown) => void;
    const response = new Promise(resolveResponse => { resolve = resolveResponse; });
    const urls = fixture(t, () => response);
    const resource = PackFormats.get("shared-format-test", "assets");
    const data = PackFormats.get("shared-format-test", "data");
    t.is(urls.length, 1);
    resolve!({ pack_version: { resource_major: 75, resource_minor: 2, data_major: 94, data_minor: 1 } });
    t.deepEqual(await resource, [75, 2]);
    t.deepEqual(await data, [94, 1]);
    t.deepEqual(await PackFormats.get("shared-format-test", "assets"), [75, 2]);
    t.is(urls.length, 1);
});

test.serial("legacy metadata has separate resource and data formats with minor version zero", async t => {
    fixture(t, () => ({ pack_version: { resource: 64, data: 81 } }));
    t.deepEqual(await PackFormats.get("legacy-format-test", "assets"), [64, 0]);
    t.deepEqual(await PackFormats.get("legacy-format-test", "data"), [81, 0]);
});

test.serial("scalar pack_version applies to both resource and data formats", async t => {
    fixture(t, () => ({ pack_version: 4 }));
    t.deepEqual(await PackFormats.get("scalar-format-test", "assets"), [4, 0]);
    t.deepEqual(await PackFormats.get("scalar-format-test", "data"), [4, 0]);
});

test.serial("invalid metadata is rejected and evicted before a later retry", async t => {
    const packs = { resource_major: 75, resource_minor: 0, data_major: 94, data_minor: 1 };
    const valid = { pack_version: packs };
    const invalid = [
        null, [], "75", {},
        ...[null, [], "75", -1, 4.5, {}, { resource: 64 },
            { ...packs, resource_major: "75" },
            { ...packs, resource_major: -1 },
            { ...packs, resource_major: 75.1 },
            { ...packs, resource_major: Number.MAX_SAFE_INTEGER + 1 },
            { ...packs, resource_minor: null },
            { ...packs, resource_minor: -1 },
            { ...packs, resource_minor: undefined },
            { ...packs, data_major: undefined },
            { ...packs, data_minor: 0.5 },
            { ...packs, data_minor: Number.MAX_SAFE_INTEGER + 1 },
            { resource: 75, data: 94, resource_major: 75 }
        ].map(pack_version => ({ pack_version }))
    ];
    let response: unknown;
    const urls = fixture(t, () => response);
    for (const [index, metadata] of invalid.entries()) {
        const version = `invalid-format-test-${index}`;
        response = metadata;
        const error = await t.throwsAsync(PackFormats.get(version, "assets"));
        t.true(error!.message.includes(version));
        t.true(error!.message.includes("ArchiveAssetSource resourcePackFormat"));
        response = valid;
        t.deepEqual(await PackFormats.get(version, "assets"), [75, 0]);
    }
    t.is(urls.length, invalid.length * 2);
});

test.serial("failed requests can be retried and name the explicit format option", async t => {
    let failed = true;
    const urls = fixture(t, () => {
        if (failed) throw new Error("metadata service unavailable");
        return { pack_version: { resource: 75, data: 94 } };
    });
    const error = await t.throwsAsync(PackFormats.get("failed-format-test", "data"));
    t.true(error!.message.includes("failed-format-test"));
    t.true(error!.message.includes("ArchiveAssetSource dataPackFormat"));
    t.true(error!.message.includes("metadata service unavailable"));
    failed = false;
    t.deepEqual(await PackFormats.get("failed-format-test", "data"), [94, 0]);
    t.is(urls.length, 2);
});

test.serial("version lookup escapes the URL and preserves exact version cache keys", async t => {
    const urls = fixture(t, request => {
        t.is(request.responseType, "json");
        return { pack_version: { resource: 75, data: 94 } };
    });
    await PackFormats.get("format/test ?#", "assets");
    await PackFormats.get("FORMAT/test ?#", "assets");
    await PackFormats.get("format/test ?#", "assets");
    t.deepEqual(urls, [
        "https://assets.mcasset.cloud/format%2Ftest%20%3F%23/game-version.json",
        "https://assets.mcasset.cloud/FORMAT%2Ftest%20%3F%23/game-version.json"
    ]);
});

test.serial("moving aliases refresh after five minutes while concrete versions stay cached", async t => {
    const original = Date.now;
    let now = original();
    Date.now = () => now;
    t.teardown(() => { Date.now = original; });
    let format = 75;
    const urls = fixture(t, () => ({ pack_version: { resource: format, data: 94 } }));
    const versions = ["latest", "release", "snapshot", "concrete-cache-format-test"];
    for (const version of versions) t.deepEqual(await PackFormats.get(version, "assets"), [75, 0]);
    format = 76;
    now += 299_999;
    for (const version of versions) t.deepEqual(await PackFormats.get(version, "assets"), [75, 0]);
    now += 1;
    for (const version of versions.slice(0, 3)) t.deepEqual(await PackFormats.get(version, "assets"), [76, 0]);
    t.deepEqual(await PackFormats.get(versions[3], "assets"), [75, 0]);
    t.is(urls.length, 7);
});
