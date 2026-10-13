import test from "ava";
import { deflateSync, inflateSync } from "node:zlib";
import { SceneDocument } from "../src/scene/SceneDocument";
import { decodeSceneDocument, encodeSceneDocument, SCENE_DOCUMENT_MAX_BYTES } from "../src/scene/SceneDocumentCodec";

const scene: SceneDocument = {
    format: "minerender-scene", version: 1, minecraftVersion: "1.21.11",
    camera: { position: [60, 40, 60], target: [0, 16, 0] },
    objects: [{ id: "sign", type: "gui", name: "Grüße 🌍", layers: [{ text: "こんにちは", position: [0, 9] }] }]
};

function encoded(value: string | Uint8Array): string {
    return `v1.${deflateSync(value).toString("base64url")}`;
}

test("scene links round-trip Unicode and use zlib-wrapped deflate with unpadded base64url", async t => {
    const value = await encodeSceneDocument(scene);
    t.regex(value, /^v1\.[A-Za-z0-9_-]+$/);
    t.deepEqual(await decodeSceneDocument(value), scene);
    t.deepEqual(JSON.parse(inflateSync(Buffer.from(value.slice(3), "base64url")).toString("utf8")), scene);
    t.deepEqual(await decodeSceneDocument(encoded(JSON.stringify(scene))), scene);
});

test("scene links validate documents on encode and decode", async t => {
    const invalid = { ...scene, version: 2 };
    await t.throwsAsync(encodeSceneDocument(invalid), { message: /scene.version/ });
    await t.throwsAsync(decodeSceneDocument(encoded(JSON.stringify(invalid))), { message: /scene.version/ });
    await t.throwsAsync(decodeSceneDocument(encoded("{")), { message: /invalid JSON/ });
    await t.throwsAsync(decodeSceneDocument(encoded(new Uint8Array([0xff]))), { message: /Invalid UTF-8/ });
});

test("scene links reject unknown versions, invalid base64url, and damaged compressed data", async t => {
    for (const value of ["", "v2.AAAA", "AAAA"]) {
        await t.throwsAsync(decodeSceneDocument(value), { message: /Unsupported scene encoding version/ });
    }
    for (const value of ["", "A", "AA==", "AA+_", "AA /", "AB"]) {
        await t.throwsAsync(decodeSceneDocument(`v1.${value}`), { message: /Invalid scene base64url/ });
    }
    const compressed = deflateSync(JSON.stringify(scene));
    compressed[compressed.length - 1] ^= 1;
    await t.throwsAsync(decodeSceneDocument(`v1.${compressed.toString("base64url")}`), { message: /Invalid compressed scene/ });
    await t.throwsAsync(decodeSceneDocument("v1.AAAA"), { message: /Invalid compressed scene/ });
});

test("scene links bound serialized UTF-8, compressed input, and decompressed output", async t => {
    const oversized: SceneDocument = { ...scene, objects: [{ id: "text", type: "gui", layers: [{ text: "é".repeat(SCENE_DOCUMENT_MAX_BYTES / 2) }] }] };
    await t.throwsAsync(encodeSceneDocument(oversized), { instanceOf: RangeError, message: /Scene document exceeds/ });
    await t.throwsAsync(decodeSceneDocument(`v1.${"A".repeat(Math.ceil(SCENE_DOCUMENT_MAX_BYTES * 4 / 3) + 1)}`), {
        instanceOf: RangeError, message: /Encoded scene exceeds/
    });
    await t.throwsAsync(decodeSceneDocument(encoded(JSON.stringify(oversized))), { instanceOf: RangeError, message: /Scene document exceeds/ });
});
