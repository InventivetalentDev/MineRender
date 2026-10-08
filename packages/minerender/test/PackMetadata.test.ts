import test from "ava";
import { PackMetadata } from "../src/assets/source/archive/PackMetadata";
import type { PackFormat } from "../src/assets/source/archive/PackMetadata";

test("overlay ranges include major and minor boundaries and prefer explicit endpoints", t => {
    const metadata = PackMetadata.parse({ overlays: { entries: [
        { directory: "precise", formats: 1, min_format: [75, 2], max_format: [76, 1] },
        { directory: "whole-major", min_format: [77], max_format: 77 },
        { directory: "array-major", min_format: 78, max_format: [78] }
    ] } });
    const cases: [PackFormat, string[]][] = [
        [1, []], [[75, 1], []], [[75, 2], ["precise"]], [76, ["precise"]],
        [[76, 1], ["precise"]], [[76, 2], []], [77, ["whole-major"]],
        [[77, 999], ["whole-major"]], [78, ["array-major"]], [[78, 999], ["array-major"]], [79, []]
    ];
    for (const [format, expected] of cases) t.deepEqual(metadata.overlayDirectories(format), expected);
});

test("legacy integer, list and object ranges include both endpoint majors", t => {
    for (const formats of [64, [63, 64], { min_inclusive: 63, max_inclusive: 64 }]) {
        const metadata = PackMetadata.parse({ overlays: { entries: [{ directory: "legacy", formats }] } });
        t.deepEqual(metadata.overlayDirectories(62), []);
        t.deepEqual(metadata.overlayDirectories(63), typeof formats === "number" ? [] : ["legacy"]);
        t.deepEqual(metadata.overlayDirectories(64), ["legacy"]);
        t.deepEqual(metadata.overlayDirectories([64, 5]), ["legacy"]);
        t.deepEqual(metadata.overlayDirectories(65), []);
    }
});

test("applicable overlays use reverse declaration order and unrelated metadata is ignored", t => {
    const metadata = PackMetadata.parse({ pack: { pack_format: 1 }, unrelated: null, overlays: { entries: [
        { directory: "first", formats: [50, 80] },
        { directory: "inactive", formats: 1 },
        { directory: "Last_Overlay-1.0", formats: 75 }
    ] } });
    t.true(metadata.hasOverlays);
    t.deepEqual(metadata.overlayDirectories(75), ["Last_Overlay-1.0", "first"]);
    t.deepEqual(metadata.overlayDirectories(75), ["Last_Overlay-1.0", "first"]);
    for (const value of [{}, { pack: null }, { overlays: { entries: [] } }]) {
        const empty = PackMetadata.parse(value);
        t.false(empty.hasOverlays);
        t.deepEqual(empty.overlayDirectories(75), []);
        t.false(empty.blocks("minecraft", "models/block/stone.json"));
    }
});

test("filters combine namespace and path matches across rules like vanilla", t => {
    const metadata = PackMetadata.parse({ filter: { block: [
        { namespace: "^minecraft$", path: "stone" },
        { namespace: "^custom$", path: "dirt" }
    ] } });
    for (const [namespace, path, expected] of [
        ["minecraft", "models/block/stone.json", true],
        ["custom", "textures/block/dirt.png", true],
        ["minecraft", "textures/block/dirt.png", true],
        ["custom", "models/block/stone.json", true],
        ["minecraft", "models/block/sand.json", false],
        ["other", "models/block/stone.json", false]
    ] as const) {
        t.is(metadata.blocks(namespace, path), expected);
        t.is(metadata.blocks(namespace, path), expected);
    }
    for (const block of [{ namespace: "mine" }, { path: "stone" }, {}]) {
        t.true(PackMetadata.parse({ filter: { block: [block] } }).blocks("minecraft", "models/block/stone.json"));
    }
    t.false(PackMetadata.parse({ filter: { block: [] } }).blocks("minecraft", "models/block/stone.json"));
});

test("malformed metadata identifies the invalid field", t => {
    const entry = { directory: "overlay", formats: 75 };
    const overlayCases: [unknown, RegExp][] = [
        [{ ...entry, directory: "../outside" }, /directory/],
        [{ ...entry, directory: "." }, /directory/],
        [{ ...entry, directory: ".." }, /directory/],
        [{ ...entry, directory: "nested/overlay" }, /directory/],
        [{ ...entry, directory: "overlay\n" }, /directory/],
        [{ ...entry, formats: [76, 75] }, /minimum format/],
        [{ ...entry, formats: [75] }, /formats/],
        [{ ...entry, formats: { min_inclusive: 75 } }, /formats.max_inclusive/],
        [{ ...entry, min_format: 75 }, /max_format/],
        [{ ...entry, max_format: 75 }, /min_format/],
        [{ ...entry, min_format: [75, 2], max_format: [75, 1] }, /minimum format/],
        [{ ...entry, min_format: [], max_format: 75 }, /min_format/],
        [{ ...entry, min_format: 75, max_format: [75, 0, 1] }, /max_format/],
        [{ ...entry, min_format: -1, max_format: 75 }, /min_format/],
        [{ ...entry, min_format: 1.5, max_format: 75 }, /min_format/],
        [{ ...entry, min_format: 75, max_format: Infinity }, /max_format/]
    ];
    for (const [value, message] of overlayCases) {
        t.throws(() => PackMetadata.parse({ overlays: { entries: [value] } }), { message });
    }
    for (const [value, message] of [
        [null, /pack.mcmeta/], [{ overlays: {} }, /overlays.entries/],
        [{ filter: {} }, /filter.block/], [{ filter: { block: [null] } }, /filter.block\[0\]/],
        [{ filter: { block: [{ namespace: "[" }] } }, /namespace/],
        [{ filter: { block: [{ path: 1 }] } }, /path/]
    ] as const) t.throws(() => PackMetadata.parse(value), { message });
    t.throws(() => PackMetadata.parse({}).overlayDirectories([-1, 0]), { message: /target format/ });
});
