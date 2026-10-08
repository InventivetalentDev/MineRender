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
    resolve!({ resource_pack_version: 75, resource_pack_version_minor: 2, data_pack_version: 94, data_pack_version_minor: 1 });
    t.deepEqual(await resource, [75, 2]);
    t.deepEqual(await data, [94, 1]);
    t.deepEqual(await PackFormats.get("shared-format-test", "assets"), [75, 2]);
    t.is(urls.length, 1);
});

test.serial("legacy metadata defaults missing minor versions to zero", async t => {
    fixture(t, () => ({ resource_pack_version: 64, data_pack_version: 81 }));
    t.deepEqual(await PackFormats.get("legacy-format-test", "assets"), [64, 0]);
    t.deepEqual(await PackFormats.get("legacy-format-test", "data"), [81, 0]);
});

test.serial("invalid metadata is rejected and evicted before a later retry", async t => {
    const valid = { resource_pack_version: 75, data_pack_version: 94 };
    const invalid = [
        null, [], "75", {},
        { ...valid, resource_pack_version: "75" },
        { ...valid, resource_pack_version: -1 },
        { ...valid, resource_pack_version: 75.1 },
        { ...valid, resource_pack_version: Number.MAX_SAFE_INTEGER + 1 },
        { ...valid, resource_pack_version_minor: null },
        { ...valid, resource_pack_version_minor: -1 },
        { ...valid, data_pack_version: undefined },
        { ...valid, data_pack_version_minor: 0.5 },
        { ...valid, data_pack_version_minor: Number.MAX_SAFE_INTEGER + 1 }
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
        return { resource_pack_version: 75, data_pack_version: 94 };
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
        return { resource_pack_version: 75, data_pack_version: 94 };
    });
    await PackFormats.get("format/test ?#", "assets");
    await PackFormats.get("FORMAT/test ?#", "assets");
    await PackFormats.get("format/test ?#", "assets");
    t.deepEqual(urls, [
        "https://raw.githubusercontent.com/misode/mcmeta/format%2Ftest%20%3F%23-summary/version.json",
        "https://raw.githubusercontent.com/misode/mcmeta/FORMAT%2Ftest%20%3F%23-summary/version.json"
    ]);
});
