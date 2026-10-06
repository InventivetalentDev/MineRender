import test from "ava";
import { Env, EnvProvider } from "../src/Env";
import { ModelTextures } from "../src/assets/ModelTextures";
import { ImageLoader } from "../src/image/ImageLoader";
import { UVMapper } from "../src/UVMapper";
import { ModelGenerator } from "../src/model/ModelGenerator";
import type { ModelElement } from "../src/model/ModelElement";
import type { CompatCanvas } from "../src/canvas/CanvasCompat";
import type { ExtractableImageData } from "../src/ExtractableImageData";

// "#" is an opaque texel, anything else is transparent
function mask(...rows: string[]) {
    const width = rows[0].length;
    const data = new Uint8ClampedArray(width * rows.length * 4);
    rows.forEach((row, y) => [...row].forEach((texel, x) => data[(y * width + x) * 4 + 3] = texel === "#" ? 255 : 0));
    return { width, height: rows.length, data };
}

// "<face> <from> <to> <uv>" for every side element, in generation order
function sides(elements: ModelElement[]): string[] {
    return elements.slice(1).map(element => {
        const [name, face] = Object.entries(element.faces)[0];
        return `${name} ${element.from} ${element.to} ${face.uv}`;
    });
}

test("a single texel gets front, back, and four full-length side faces", t => {
    const elements = ModelGenerator.generateItemModel(mask("#"), "layer0");
    t.deepEqual(elements[0].faces.south?.uv, [0, 0, 16, 16]);
    t.deepEqual(elements[0].faces.north?.uv, [16, 0, 0, 16]);
    t.deepEqual([elements[0].from, elements[0].to], [[0, 0, 7.5], [16, 16, 8.5]]);
    t.deepEqual(sides(elements), [
        "up 0,16,7.5 16,16,8.5 0,0,16,16",
        "down 0,0,7.5 16,0,8.5 0,0,16,16",
        "west 0,0,7.5 0,16,8.5 0,0,16,16",
        "east 16,0,7.5 16,16,8.5 0,0,16,16"
    ]);
    t.true(elements.every(element => Object.keys(element.faces).length === (element === elements[0] ? 2 : 1)));
});

test("texel runs merge into one side face, and holes get inward faces", t => {
    const elements = ModelGenerator.generateItemModel(mask(
        "####",
        "#..#",
        "####",
        "...."
    ), "layer0");
    t.deepEqual(sides(elements), [
        // top edge, then the bottom of the hole (the up faces of row 2 under the hole)
        "up 0,16,7.5 16,16,8.5 0,0,16,4",
        "up 4,8,7.5 12,8,8.5 4,8,12,12",
        "down 4,12,7.5 12,12,8.5 4,0,12,4",
        "down 0,4,7.5 16,4,8.5 0,8,16,12",
        "west 0,4,7.5 0,16,8.5 0,0,4,12",
        "west 12,8,7.5 12,12,8.5 12,4,16,8",
        "east 4,8,7.5 4,12,8.5 0,4,4,8",
        "east 16,4,7.5 16,16,8.5 12,0,16,12"
    ]);
});

test("separate runs in one row stay separate, and fully transparent or opaque sprites need no inner faces", t => {
    t.deepEqual(sides(ModelGenerator.generateItemModel(mask("#.##"), "layer0")).filter(side => side.startsWith("up")), [
        "up 0,16,7.5 4,16,8.5 0,0,4,16",
        "up 8,16,7.5 16,16,8.5 8,0,16,16"
    ]);
    t.is(ModelGenerator.generateItemModel(mask("..", ".."), "layer0").length, 1);
    t.is(ModelGenerator.generateItemModel(mask("##", "##"), "layer0").length, 5);
});

test("side faces scale to textures that are not 16 pixels wide", t => {
    const pixels = mask(...Array.from({ length: 32 }, (_, y) => ".".repeat(32)));
    for (const x of [4, 5]) pixels.data[(6 * 32 + x) * 4 + 3] = 1; // any non-zero alpha counts, as in vanilla
    t.deepEqual(sides(ModelGenerator.generateItemModel(pixels, "layer0")), [
        "up 2,13,7.5 3,13,8.5 2,3,3,3.5",
        "down 2,12.5,7.5 3,12.5,8.5 2,3,3,3.5",
        "west 2,12.5,7.5 2,13,8.5 2,3,2.5,3.5",
        "east 3,12.5,7.5 3,13,8.5 2.5,3,3,3.5"
    ]);
});

test("every face of a layer uses that layer's texture and tint index", t => {
    for (const [index, layer] of ModelGenerator.ITEM_LAYERS.entries()) {
        const faces = ModelGenerator.generateItemModel(mask("#.", ".#"), layer).flatMap(element => Object.values(element.faces));
        t.is(faces.length, 2 + 8);
        t.true(faces.every(face => face.texture === `#${layer}` && face.tintindex === index));
    }
});

test.serial("layered models outline each layer from the first animation frame and map side faces into the atlas", async t => {
    const originals = { provider: Env["_provider"], get: ModelTextures.get, meta: ModelTextures.getMeta, data: ImageLoader.getData };
    t.teardown(() => {
        Env["_provider"] = originals.provider;
        ModelTextures.get = originals.get;
        ModelTextures.getMeta = originals.meta;
        ImageLoader.getData = originals.data;
    });
    Env.register({
        name: "test",
        createCanvas: (width, height) => ({
            width, height,
            getContext: () => ({ putImageData() {} }),
            toDataURL: () => ""
        } as unknown as CompatCanvas)
    } as EnvProvider);
    // layer0 is a 2x2 sprite with two frames: one texel, then fully opaque. layer1 is a static full sprite.
    const strip = mask("#.", "..", "##", "##");
    const sections: number[][] = [];
    ModelTextures.get = async key => (key.path.endsWith("animated") ? {
        width: 2, height: 4,
        data: {
            getImageData: (sx: number, sy: number, sw: number, sh: number) => {
                sections.push([sx, sy, sw, sh]);
                return sw === 2 && sh === 2 ? mask(...(sy === 0 ? ["#.", ".."] : ["##", "##"])) : strip;
            }
        }
    } : { width: 2, height: 2, data: { getImageData: () => mask("##", "##") } }) as unknown as ExtractableImageData;
    ModelTextures.getMeta = async key => key.path.endsWith("animated") ? { animation: {} } as any : undefined;
    ImageLoader.getData = async () => mask("#") as any;

    const atlas = (await UVMapper.createAtlas({ textures: { layer0: "item/animated", layer1: "item/overlay" } }))!;
    const elements = atlas.model.elements!;
    t.deepEqual(elements.map(element => Object.keys(element.faces).join()), [
        "south,north", "up", "down", "west", "east",
        "south,north", "up", "down", "west", "east"
    ]);
    t.deepEqual(elements.map(element => Object.values(element.faces)[0].tintindex), [0, 0, 0, 0, 0, 1, 1, 1, 1, 1]);
    // first frame: only the top-left texel is outlined
    t.deepEqual([elements[1].from, elements[1].to], [[0, 16, 7.5], [8, 16, 8.5]]);
    t.deepEqual([elements[6].from, elements[6].to], [[0, 16, 7.5], [16, 16, 8.5]]);
    t.true(sections.some(([sx, sy, sw, sh]) => sx === 0 && sy === 0 && sw === 2 && sh === 2));
    // 4x4 atlas of 2px cells: layer0 at (2,0); its up face samples texel (0,0) there
    t.is(atlas.image.width, 4);
    t.deepEqual(elements[1].mappedUv!.slice(16, 24), [0.5, 1, 0.75, 1, 0.5, 0.75, 0.75, 0.75]);
    t.true(elements.every(element => element.mappedUv?.length === 48));
});
