import test from "ava";
import type { SceneDocument } from "minerender";
import { parseEmbedUrl, validateEmbedScene } from "../src/params";

const parse = (query: string) => parseEmbedUrl(new URL(`https://embed.example/embed/${query}`));
const scene = (objects: SceneDocument["objects"]): SceneDocument => ({ format: "minerender-scene", version: 1, objects });

test("shorthand sources create validated scene documents with unobtrusive defaults", t => {
    const skin = parse("?skin=Notch");
    t.deepEqual(skin.source, { kind: "scene", scene: scene([{ id: "skin", type: "skin", skin: "Notch" }]) });
    t.deepEqual(skin.view, {
        controls: { enabled: true, zoom: false, rotate: true, pan: false },
        autorotate: 0, background: null, shadow: false, pixelRatio: 1
    });
    for (const type of ["item", "entity", "model"] as const) {
        t.deepEqual(parse(`?${type}=minecraft:creeper`).source, {
            kind: "scene", scene: scene([{ id: type, type, asset: "minecraft:creeper" }])
        });
    }
    t.deepEqual(parse("?block=minecraft:oak_stairs[facing=east,half=top]").source, {
        kind: "scene", scene: scene([{ id: "block", type: "block", asset: "minecraft:oak_stairs", state: { facing: "east", half: "top" } }])
    });
});

test("shorthand modifiers apply only to their matching content", t => {
    t.deepEqual(parse("?skin=Alex&skin.slim=true&cape=Notch&cape.layout=optifine").source, {
        kind: "scene", scene: scene([{ id: "skin", type: "skin", skin: "Alex", options: { slim: true },
            cape: { texture: "Notch", layout: "optifine" } }])
    });
    t.deepEqual(parse("?entity=minecraft:creeper&animate=walk").source, {
        kind: "scene", scene: scene([{ id: "entity", type: "entity", asset: "minecraft:creeper", animation: { name: "walk", loop: true } }])
    });
    for (const query of ["?block=stone&skin.slim=true", "?entity=pig&cape=Notch", "?skin=Notch&animate=walk",
        "?src=https://example.com/scene.json&cape=Notch", "?animate=walk#scene=v1.payload",
        "?skin=Notch&cape.layout=minecraft", "?skin=Notch&cape=Notch&cape.layout=unknown"]) {
        t.throws(() => parse(query));
    }
});

test("inline and remote selectors retain their payload for bounded asynchronous loading", t => {
    t.deepEqual(parse("#scene=v1.abc_-123").source, { kind: "inline", value: "v1.abc_-123" });
    t.deepEqual(parse("?src=https%3A%2F%2Fexample.com%2Fscene.json%3Fid%3D1").source, {
        kind: "remote", url: "https://example.com/scene.json?id=1"
    });
    for (const query of ["?src=http://example.com/scene.json", "?src=/scene.json", "?src=blob:https://example.com/id",
        "?src=https://user:password@example.com/scene.json", "#scene=", "#other=value"]) t.throws(() => parse(query));
});

test("query view settings remain separate from the scene with explicit numeric bounds", t => {
    const request = parse("?item=minecraft:apple&controls=false&controls.zoom=true&controls.rotate=false&controls.pan=true"
        + "&camera.position=10,20,-30&camera.target=0,8,0&autorotate=-12&background=%23aAbBcC&shadow=true&pixelRatio=2&version=1.21.11");
    t.deepEqual(request.view, { controls: { enabled: false, zoom: true, rotate: false, pan: true },
        camera: { position: [10, 20, -30], target: [0, 8, 0] }, autorotate: -12, background: 0xaabbcc, shadow: true, pixelRatio: 2 });
    t.is(request.minecraftVersion, "1.21.11");
    t.deepEqual(parse("?skin=Notch&camera.target=0,12,0").view.camera, { target: [0, 12, 0] });
    for (const option of ["controls=1", "controls.zoom=", "pixelRatio=0", "pixelRatio=4.1", "pixelRatio=0x2",
        "autorotate=Infinity", "autorotate=361", "background=red", "background=fff", "shadow=yes", "camera.position=0,1",
        "camera.target=0,,1", "camera.position=1000001,0,0", "version=..", "version=1/2"]) {
        t.throws(() => parse(`?skin=Notch&${option}`), undefined, option);
    }
    t.throws(() => parse("?skin=Notch&camera.position=1,2,3&camera.target=1,2,3"), { message: /must differ/ });
});

test("duplicate and competing sources fail instead of choosing an implicit winner", t => {
    for (const query of ["", "?skin=Notch&skin=Alex", "?skin=Notch&block=stone", "?skin=Notch#scene=v1.payload",
        "?src=https://example.com/s.json#scene=v1.payload", "#scene=one&scene=two", "?skin=Notch&skin.name=Alex",
        "?skin.name=Notch&skin.url=https://example.com/skin.png", "?skin=Notch&cape=Notch&cape.user=Alex",
        "?models=block/stone&model=block/dirt", "?skin=Notch&controls=true&controls=false", "?skin=Notch&typo=true"]) {
        t.throws(() => parse(query), undefined, query);
    }
});

test("legacy aliases and raw model lists retain their supported meaning", t => {
    t.deepEqual(parse("?skin.name=Notch&cape.user=Alex").source, parse("?skin=Notch&cape=Alex").source);
    t.deepEqual(parse("?skin.url=https://example.com/skin.png&cape.url=https://example.com/cape.png").source,
        parse("?skin=https://example.com/skin.png&cape=https://example.com/cape.png").source);
    t.deepEqual(parse("?models=block/stone,item/diamond_axe").source, { kind: "scene", scene: scene([
        { id: "model-1", type: "model", asset: "block/stone" }, { id: "model-2", type: "model", asset: "item/diamond_axe" }
    ]) });
    for (const option of ["skin.data=abc", "cape.data=abc", "showAxes=false", "autoResize=true", "hideOuterLayers=true"]) {
        t.throws(() => parse(`?skin=Notch&${option}`), { message: /unsupported/ });
    }
});

test("malformed assets, empty values, and repeated block states fail before any asset request", t => {
    for (const query of ["?skin=", "?block=stone[]", "?block=stone[facing]", "?block=stone[facing=east,facing=west]",
        "?block=stone[facing=east,]", "?block=stone[facing=east][half=top]", "?item=minecraft:../stone",
        "?model=https://example.com/model.json", "?models=block/stone,", "?entity=pig&animate=", "?skin=Notch&cape="]) {
        t.throws(() => parse(query), undefined, query);
    }
});

test("hosted scene limits allow bounded multi-object documents and reject oversized geometry inputs", t => {
    const objects: SceneDocument["objects"] = Array.from({ length: 32 }, (_, index) => ({ id: `${index}`, type: "block", asset: "stone" }));
    t.is(validateEmbedScene(scene(objects)).objects.length, 32);
    t.throws(() => validateEmbedScene(scene([])), { message: /1 to 32/ });
    t.throws(() => validateEmbedScene(scene([...objects, { id: "extra", type: "block", asset: "stone" }])), { message: /1 to 32/ });
    for (const transform of [{ position: [1_000_001, 0, 0] }, { rotation: [Infinity, 0, 0] }, { scale: [1025, 1, 1] }]) {
        t.throws(() => validateEmbedScene(scene([{ id: "skin", type: "skin", ...transform } as SceneDocument["objects"][number]])));
    }
    t.throws(() => validateEmbedScene({ ...scene(objects), camera: { position: [0, 0, 0], target: [0, 0, 0] } }), { message: /must differ/ });
    t.throws(() => validateEmbedScene({ ...scene(objects), minecraftVersion: ".." }));
});

test("GUI limits count layers and text across all objects", t => {
    const layers = Array.from({ length: 64 }, () => ({ text: "a".repeat(64) }));
    const valid = scene([{ id: "one", type: "gui", layers }, { id: "two", type: "gui", layers }]);
    t.is(validateEmbedScene(valid).objects.length, 2);
    t.throws(() => validateEmbedScene(scene([{ id: "gui", type: "gui", layers: Array.from({ length: 129 }, () => ({ text: "" })) }])),
        { message: /128 GUI layers/ });
    t.throws(() => validateEmbedScene(scene([{ id: "gui", type: "gui", layers: [{ text: [{ text: "a".repeat(8192) }, { text: "b" }] }] }])),
        { message: /8192 characters/ });
    t.throws(() => validateEmbedScene(scene([{ id: "gui", type: "gui", layers: [{ text: "a", size: [4097, 1] }] }])),
        { message: /4096/ });
});

test("serialized scene size is bounded even when a shorthand supplies a large texture", t => {
    t.throws(() => parse(`?skin=${encodeURIComponent(`https://example.com/${"a".repeat(1024 * 1024)}`)}`), { message: /exceeds 1048576 bytes/ });
    t.throws(() => validateEmbedScene(scene([{ id: "skin", type: "skin", name: "é".repeat(524288) }])), { message: /exceeds 1048576 bytes/ });
});

test("player textures accept usernames, UUIDs, HTTPS, and PNG data URLs without accepting local URL schemes", t => {
    for (const skin of ["Notch", "069a79f444e94726a5befca90e38aaf5", "069a79f4-44e9-4726-a5be-fca90e38aaf5",
        "https://example.com/skin.png", "data:image/png;base64,iVBORw0KGgo="]) {
        t.notThrows(() => validateEmbedScene(scene([{ id: "skin", type: "skin", skin, cape: { texture: skin } }])));
    }
    for (const skin of ["http://example.com/skin.png", "//example.com/skin.png", "/skin.png", "file:///skin.png",
        "blob:https://example.com/id", "javascript:alert(1)", "https://user:pass@example.com/skin.png", "data:image/svg+xml;base64,PHN2Zz4=",
        "data:image/png;base64,", "data:image/png;base64,invalid!"]) {
        t.throws(() => validateEmbedScene(scene([{ id: "skin", type: "skin", skin }])));
    }
});
