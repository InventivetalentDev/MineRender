import { BatchedExecutor, MineRenderWorld, type MultiBlockBlock } from "minerender";
import { fade, orbit, range } from "../motion";
import type { Shot } from "../types";

const SIZE = 14;

/** A stone slab with a water pool spilling down a flow, a lava pool, and animated-texture blocks around them. */
function basin(): MultiBlockBlock[] {
    const blocks: MultiBlockBlock[] = [];
    const put = (x: number, y: number, z: number, type: string, properties?: Record<string, string>) =>
        blocks.push({ type: `minecraft:${type}`, position: [x, y, z], properties });
    for (let x = 0; x < SIZE; x++) {
        for (let z = 0; z < SIZE; z++) {
            put(x, 0, z, (x + z) % 7 === 0 ? "polished_deepslate" : "deepslate_tiles");
        }
    }
    // Water pool with a prismarine rim and a gap on its east side.
    for (let x = 1; x <= 6; x++) {
        for (let z = 1; z <= 6; z++) {
            const rim = x === 1 || x === 6 || z === 1 || z === 6;
            if (rim && !(x === 6 && (z === 3 || z === 4))) {
                put(x, 1, z, (x + z) % 2 ? "prismarine_bricks" : "prismarine");
            } else {
                put(x, 1, z, "water");
            }
        }
    }
    // The spill flows east, one level lower every block.
    for (let level = 1; level <= 7; level++) {
        for (const z of [3, 4]) put(6 + level, 1, z, "water", { level: String(level) });
    }
    // Lava pool with a magma rim, trickling east.
    for (let x = 1; x <= 5; x++) {
        for (let z = 8; z <= 12; z++) {
            const rim = x === 1 || x === 5 || z === 8 || z === 12;
            if (rim && !(x === 5 && z === 10)) {
                put(x, 1, z, "magma_block");
            } else {
                put(x, 1, z, "lava");
            }
        }
    }
    for (const [index, level] of [2, 4, 6].entries()) put(6 + index, 1, 10, "lava", { level: String(level) });
    // Waterlogged plants and lights around the edges.
    put(12, 1, 1, "sea_lantern");
    put(12, 1, 12, "sea_lantern");
    put(1, 1, 7, "sea_lantern");
    put(9, 1, 7, "oak_fence", { waterlogged: "true", east: "true", west: "true" });
    put(10, 1, 7, "oak_fence", { waterlogged: "true", east: "true", west: "true" });
    put(11, 1, 7, "oak_fence", { waterlogged: "true", west: "true" });
    put(10, 1, 12, "seagrass");
    put(11, 1, 12, "kelp", { age: "0" });
    return blocks;
}

/** Water and lava levels, waterlogging, and mcmeta animations ticking in world sections. */
export const fluidsAnimated: Shot = {
    id: "fluids",
    seconds: 7,
    async prepare({ renderer }) {
        const world = new MineRenderWorld(renderer.scene, { sectionMeshing: true });
        await world.placeMultiBlock({ size: [SIZE, 4, SIZE], blocks: basin() }, true, new BatchedExecutor(1, 64));
    },
    update({ camera, overlay, renderer, portrait }, t) {
        renderer.dirty = true;
        const center = SIZE * 8;
        orbit(camera, { target: [center, 10, center], radius: SIZE * 19, height: SIZE * 12, angle: 2.6, speed: 0.09 }, t, portrait ? 1.5 : 1);
        overlay.set({
            surface: range(t, 0, 0.4),
            caption: "<accent>Fluids</accent> with levels,\nwaterlogging, animated textures",
            captionOpacity: fade(t, 0.8, 99, 0.4),
            code: "await world.setBlockAt(7, 1, 3, {\n    type: \"minecraft:water\",\n    properties: { level: \"1\" }\n});",
            codeOpacity: fade(t, 2.8, 99, 0.5)
        });
    }
};
