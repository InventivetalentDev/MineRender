import test, { ExecutionContext } from "ava";
import { DataTexture, DoubleSide, MeshBasicMaterial, NearestFilter, SRGBColorSpace } from "three";
import { Caching } from "../src/cache/Caching";
import { SkinImage } from "../src/skin/SkinImage";
import { SkinTextures, SkinTexture } from "../src/skin/SkinTextures";
import { PlayerHeadTextures } from "../src/skin/PlayerHeadTextures";
import { Skins } from "../src/skin/Skins";
import { ModelTextures } from "../src/assets/ModelTextures";
import { AssetKey } from "../src/assets/AssetKey";
import type { TextureAsset } from "../src/model/Model";

function image(width: number, height: number, alpha = 255): ImageData {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) data.set([x, y, 99, alpha], (y * width + x) * 4);
    }
    return { width, height, data, colorSpace: "srgb" } as ImageData;
}

function pixel(data: ArrayLike<number>, width: number, x: number, y: number): number[] {
    const offset = (y * width + x) * 4;
    return [0, 1, 2, 3].map(channel => data[offset + channel]);
}

function pixels(skin: SkinTexture): Uint8Array {
    return (skin.material.map as DataTexture).image.data as Uint8Array;
}

function fixture(t: ExecutionContext, images: Record<string, ImageData>) {
    const original = SkinImage.getData;
    const materials = new Set<MeshBasicMaterial>();
    SkinImage.getData = async src => images[src];
    Caching.clear();
    t.teardown(() => {
        SkinImage.getData = original;
        for (const material of materials) {
            material.map!.dispose();
            material.dispose();
        }
        Caching.clear();
    });
    return async (src: string, legacy?: boolean) => {
        const skin = await SkinTextures.get(src, legacy);
        materials.add(skin.material);
        return skin;
    };
}

test.serial("legacy skins mirror every limb face into modern regions without mutating source pixels", async t => {
    const source = image(64, 32);
    source.data[(1 * 64 + 1) * 4 + 3] = 50;
    source.data[(24 * 64 + 8) * 4 + 3] = 0;
    const original = source.data.slice();
    const get = fixture(t, { skin: source });
    const skin = await get("skin");
    const data = pixels(skin);
    t.false(skin.slim);
    t.true(skin.legacy);
    t.deepEqual([skin.material.map!.image.width, skin.material.map!.image.height], [64, 64]);
    for (const [x, y, red, green] of [
        [20, 48, 7, 16], [24, 48, 11, 16], [24, 52, 3, 20],
        [20, 52, 7, 20], [16, 52, 11, 20], [28, 52, 15, 20],
        [36, 48, 47, 16], [40, 48, 51, 16], [40, 52, 43, 20],
        [36, 52, 47, 20], [32, 52, 51, 20], [44, 52, 55, 20],
        [39, 63, 44, 31]
    ]) t.deepEqual(pixel(data, 64, x, y), [red, green, 99, 255]);
    t.deepEqual(pixel(data, 64, 1, 1), [1, 1, 99, 255]);
    t.is(pixel(data, 64, 8, 24)[3], 255);
    t.is(pixel(data, 64, 40, 5)[3], 0);
    t.deepEqual(pixel(data, 64, 1, 40), [0, 0, 0, 0]);
    t.deepEqual(pixel(data, 64, 55, 55), [0, 0, 0, 0]);
    t.deepEqual(source.data, original);
    t.is((await get("skin")).material, skin.material);
    t.is((await get("skin", true)).material, skin.material);
    const texture = skin.material.map!;
    t.deepEqual([texture.colorSpace, texture.flipY, texture.magFilter, texture.minFilter],
        [SRGBColorSpace, true, NearestFilter, NearestFilter]);
    t.deepEqual([skin.material.transparent, skin.material.side, skin.material.alphaTest], [true, DoubleSide, 0.1]);
});

test.serial("legacy hat alpha uses the vanilla threshold and a square image can explicitly use its legacy top half", async t => {
    const opaque = image(64, 32, 128);
    const transparent = image(64, 32, 128);
    transparent.data[(2 * 64 + 32) * 4 + 3] = 127;
    const square = image(64, 64, 128);
    const get = fixture(t, { opaque, transparent, square });
    t.is(pixel(pixels(await get("opaque")), 64, 40, 5)[3], 0);
    const retained = pixels(await get("transparent"));
    t.is(pixel(retained, 64, 32, 2)[3], 127);
    t.is(pixel(retained, 64, 40, 5)[3], 128);
    t.is(pixel(retained, 64, 44, 24)[3], 255);
    const modern = await get("square");
    const legacy = await get("square", true);
    t.false(modern.legacy);
    t.true(legacy.legacy);
    t.not(modern.material, legacy.material);
    t.deepEqual(pixels(legacy), pixels(await get("opaque")));
    t.is(pixel(pixels(modern), 64, 5, 5)[3], 255);
    t.is(pixel(pixels(modern), 64, 40, 5)[3], 128);
});

test.serial("slim detection scans original pixels before modern base layers become opaque", async t => {
    const classic = image(64, 64);
    const slim = image(128, 128);
    for (const [x, y] of [[46, 52], [54, 20]]) {
        for (let row = y * 2; row < (y + 12) * 2; row++) {
            for (let column = x * 2; column < (x + 1) * 2; column++) slim.data[(row * 128 + column) * 4 + 3] = 0;
        }
    }
    slim.data[(5 * 128 + 5) * 4 + 3] = 100;
    slim.data[(40 * 128 + 5) * 4 + 3] = 26;
    const original = slim.data.slice();
    const partial = { ...slim, data: slim.data.slice() };
    partial.data[(63 * 2 * 128 + 46 * 2 + 1) * 4 + 3] = 1;
    const right = { ...slim, data: slim.data.slice() };
    right.data[(31 * 2 * 128 + 54 * 2 + 1) * 4 + 3] = 255;
    const get = fixture(t, { classic, slim, partial, right });
    t.false((await get("classic")).slim);
    const prepared = await get("slim");
    t.true(prepared.slim);
    t.false(prepared.legacy);
    t.false((await get("partial")).slim);
    t.false((await get("right")).slim);
    const data = pixels(prepared);
    const expected = new Uint8Array(original);
    for (let y = 0; y < 128; y++) {
        for (let x = 0; x < 128; x++) {
            const base = (x < 64 && y < 32) || (y >= 32 && y < 64) ||
                (x >= 32 && x < 96 && y >= 96);
            if (base) expected[(y * 128 + x) * 4 + 3] = 255;
        }
    }
    t.deepEqual(data, expected);
    t.deepEqual(slim.data, original);
    t.deepEqual([prepared.material.map!.image.width, prepared.material.map!.image.height], [128, 128]);
});

test.serial("modern opacity preserves hidden RGB and overlay alpha at every base-region boundary", async t => {
    const source = image(64, 64, 0);
    const get = fixture(t, { skin: source });
    const skin = await get("skin");
    const data = pixels(skin);
    for (const [x, y] of [[0, 0], [31, 15], [0, 16], [63, 31], [16, 48], [47, 63]]) {
        t.deepEqual(pixel(data, 64, x, y), [x, y, 99, 255]);
    }
    for (const [x, y] of [[32, 0], [63, 15], [0, 32], [63, 47], [15, 48], [48, 63]]) {
        t.deepEqual(pixel(data, 64, x, y), [x, y, 99, 0]);
    }
    t.true(skin.slim);
    t.is(source.data[3], 0);
    t.is((await get("skin")).material, skin.material);
});

test.serial("scaled legacy skins retain pixel detail and invalid or forced-modern half-height layouts reject", async t => {
    const source = image(128, 64);
    const get = fixture(t, { skin: source, invalid: image(96, 96), short: image(64, 16) });
    const skin = await get("skin");
    t.true(skin.legacy);
    t.false(skin.slim);
    t.deepEqual([skin.material.map!.image.width, skin.material.map!.image.height], [128, 128]);
    t.deepEqual(pixel(pixels(skin), 128, 40, 96), [15, 32, 99, 255]);
    t.deepEqual(pixel(pixels(skin), 128, 47, 103), [8, 39, 99, 255]);
    await t.throwsAsync(get("skin", false), { message: /128x64.*non-legacy/ });
    await t.throwsAsync(get("invalid"), { message: /96x96/ });
    await t.throwsAsync(get("short"), { message: /64x16/ });
});

function profiles(t: ExecutionContext) {
    const original = { preload: ModelTextures.preload, name: Skins.fromUsername, skin: Skins.fromUuid };
    const resources: AssetKey[] = [];
    const lookups: string[] = [];
    ModelTextures.preload = async key => { resources.push(key); return { key } as TextureAsset; };
    Skins.fromUsername = async name => { lookups.push(name); return undefined; };
    Skins.fromUuid = async uuid => { lookups.push(uuid); return `https://textures.minecraft.net/texture/${uuid}`; };
    t.teardown(() => { ModelTextures.preload = original.preload; Skins.fromUsername = original.name; Skins.fromUuid = original.skin; });
    return { resources, lookups };
}

test.serial("player-head profiles preserve vanilla default UUID selection and resource texture overrides", async t => {
    fixture(t, {});
    const { resources, lookups } = profiles(t);
    t.is((await PlayerHeadTextures.get(undefined)).texture.getFullPath(), "entity/player/slim/steve");
    t.is((await PlayerHeadTextures.get({})).texture.getFullPath(), "entity/player/slim/alex");
    const names = ["alex", "ari", "efe", "kai", "makena", "noor", "steve", "sunny", "zuri"];
    for (let index = 0; index < 18; index++) {
        const result = await PlayerHeadTextures.get({ name: "Static", id: [0, 0, 0, index] });
        t.is(result.texture.getFullPath(), `entity/player/${index < 9 ? "slim" : "wide"}/${names[index % 9]}`);
    }
    t.is((await PlayerHeadTextures.get({ name: "Static", id: [-1, 0, 0, 0] })).texture.getFullPath(), "entity/player/wide/zuri");
    const patch = await PlayerHeadTextures.get({ name: "Notch", texture: "pack:custom/head.png" }, "https://pack.test/version");
    t.is(patch.texture.toNamespacedString(), "pack:custom/head.png");
    t.is(patch.texture.extension, ".png");
    t.is(patch.texture.root, "https://pack.test/version");
    t.is(patch.material, undefined);
    t.deepEqual(lookups, []);
    t.is(resources.at(-1), patch.texture);
    ModelTextures.preload = async () => undefined;
    await t.throwsAsync(PlayerHeadTextures.get({ texture: "pack:missing" }), { message: /Missing player-head texture pack:missing/ });
    for (const profile of [null, 5, { id: "00000000-0000-0000-0000-000000000000" }, { id: [0, 0, 0, 2147483648] }, { name: "with space" }, { properties: [{ name: "textures", value: 3 }] }]) {
        await t.throwsAsync(PlayerHeadTextures.get(profile), { message: /[Pp]layer profile/ });
    }
});

test.serial("resolved profile skins prepare the hat once, retain shared ownership, and reject untrusted texture payloads", async t => {
    const url = "https://textures.minecraft.net/texture/resolved";
    const uppercaseUrl = "https://TEXTURES.minecraft.net/texture/resolved";
    const source = image(64, 64, 128);
    const get = fixture(t, { [url]: source, [uppercaseUrl]: source });
    const { resources, lookups } = profiles(t);
    const encoded = (textures: unknown) => Buffer.from(JSON.stringify({ textures })).toString("base64");
    const value = encoded({ SKIN: { url } });
    const profile = { properties: [{ name: "textures", value, signature: "unverified" }] };
    const before = JSON.stringify(profile);
    const result = await PlayerHeadTextures.get(profile);
    const second = await PlayerHeadTextures.get({ properties: { textures: [value] } });
    const skin = await get(url);
    t.is(result.material, skin.material);
    t.is(result.material, second.material);
    t.is(result.material!.map, skin.material.map);
    t.deepEqual([result.material!.transparent, result.material!.alphaTest, result.material!.side, result.material!.depthWrite], [true, 0.1, DoubleSide, true]);
    t.is(skin.material.side, DoubleSide);
    t.deepEqual(pixel(pixels(skin), 64, 8, 8), [8, 8, 99, 255]);
    t.deepEqual(pixel(pixels(skin), 64, 40, 8), [40, 8, 99, 128]);
    t.is(JSON.stringify(profile), before);
    t.deepEqual(resources, []);
    t.deepEqual(lookups, []);
    t.is((await PlayerHeadTextures.get({ properties: { textures: [encoded({ SKIN: { url: uppercaseUrl } })] } })).material, (await get(uppercaseUrl)).material);
    for (const invalid of ["not JSON", `${value}!`, encoded({ SKIN: { url: "https://textures.minecraft.net@example.test/skin.png" } }), encoded({ SKIN: { url: "https://example.test/skin.png" } }),
        encoded({ SKIN: { url }, CAPE: { url: "https://bugs.mojang.com/skin" } }), encoded({ SKIN: {} })]) {
        const fallback = await PlayerHeadTextures.get({ properties: { textures: [invalid, value] } });
        t.is(fallback.material, undefined);
        t.is(fallback.texture.getFullPath(), "entity/player/slim/alex");
    }
});

test.serial("dynamic player profiles retain their input UUID defaults and retry failed lookups and skin loads", async t => {
    const uuid = "00000000-0000-0000-0000-00000000000a";
    const url = `https://textures.minecraft.net/texture/${uuid}`;
    const images: Record<string, ImageData> = {};
    const get = fixture(t, images);
    const { lookups } = profiles(t);
    const offline = await PlayerHeadTextures.get("Notch");
    t.is(offline.texture.getFullPath(), "entity/player/slim/makena");
    Skins.fromUsername = async name => { lookups.push(name); return Skins.fromUuid(uuid); };
    const failed = await PlayerHeadTextures.get("Notch");
    t.is(failed.texture.getFullPath(), "entity/player/slim/makena");
    t.is(failed.material, undefined);
    t.is((await PlayerHeadTextures.get({ id: [0, 0, 0, 10] })).texture.getFullPath(), "entity/player/wide/ari");
    images[url] = image(64, 32);
    const loaded = await PlayerHeadTextures.get("Notch");
    t.is(loaded.material, (await get(url)).material);
    t.deepEqual(lookups, ["Notch", "Notch", uuid, uuid, "Notch", uuid]);
    t.is((await PlayerHeadTextures.get({ id: [0, 0, 0, 10] })).material, loaded.material);
    const data = (loaded.material!.map as DataTexture).image.data;
    t.is(pixel(data, 64, 40, 8)[3], 0);
});
