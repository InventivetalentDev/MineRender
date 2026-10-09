import { BatchedExecutor, MineRenderWorld, type MultiBlockBlock } from "minerender";
import { fade, lerp, range, smooth } from "../motion";
import type { Shot } from "../types";

/** Chunks per side of the generated terrain. */
const CHUNKS = 5;
const SIZE = CHUNKS * 16;
const SEA = 5;

function height(x: number, z: number): number {
    const n = Math.sin(x * 0.11) * 2.2 + Math.cos(z * 0.09) * 2.2 + Math.sin((x + z) * 0.05) * 3.5 + Math.sin(x * 0.31 + z * 0.17) * 0.8;
    return Math.round(7 + n);
}

function terrain(): MultiBlockBlock[] {
    const blocks: MultiBlockBlock[] = [];
    const put = (x: number, y: number, z: number, type: string, properties?: Record<string, string>) =>
        blocks.push({ type: `minecraft:${type}`, position: [x, y, z], properties });
    for (let x = 0; x < SIZE; x++) {
        for (let z = 0; z < SIZE; z++) {
            const h = height(x, z);
            for (let y = 0; y <= Math.max(h, SEA); y++) {
                if (y > h) {
                    put(x, y, z, "water");
                } else if (y === h) {
                    put(x, y, z, h <= SEA ? "sand" : h > 11 ? "stone" : "grass_block");
                } else if (y > h - 3) {
                    put(x, y, z, h <= SEA + 1 ? "sand" : "dirt");
                } else {
                    put(x, y, z, "stone");
                }
            }
            // Sparse trees on grass, placed by a hash so the layout is stable (kept non-negative: JS % keeps the sign).
            const hash = ((((x * 73856093) ^ (z * 19349663)) % 97) + 97) % 97;
            if (h > SEA + 1 && h <= 11 && hash < 3 && x > 2 && z > 2 && x < SIZE - 3 && z < SIZE - 3) {
                for (let y = 1; y <= 4; y++) put(x, h + y, z, "oak_log", { axis: "y" });
                for (let dx = -2; dx <= 2; dx++) {
                    for (let dz = -2; dz <= 2; dz++) {
                        for (let dy = 3; dy <= 5; dy++) {
                            if (Math.abs(dx) + Math.abs(dz) + (dy - 3) > 3 || (dx === 0 && dz === 0 && dy < 5)) continue;
                            put(x + dx, h + dy, z + dz, "oak_leaves", { persistent: "true" });
                        }
                    }
                }
            }
        }
    }
    return blocks;
}

let blockCount = 0;

/** Generated terrain across several chunks with section meshing, revealed by a camera pull-back. */
export const worldTerrain: Shot = {
    id: "world",
    seconds: 8,
    renderer: { camera: { far: 30000 } },
    async prepare({ renderer }) {
        const blocks = terrain();
        blockCount = blocks.length;
        const world = new MineRenderWorld(renderer.scene, { sectionMeshing: true });
        await world.placeMultiBlock({ size: [SIZE, 24, SIZE], blocks }, true, new BatchedExecutor(1, 256));
    },
    update({ camera, overlay, renderer, portrait }, t) {
        const center = SIZE * 8;
        const pull = smooth(t, 0, 7.5);
        const distance = lerp(SIZE * 9, SIZE * (portrait ? 26 : 17), pull);
        const angle = 0.7 + t * 0.05;
        camera.position.set(center + Math.sin(angle) * distance, lerp(300, SIZE * 9, pull), center + Math.cos(angle) * distance);
        camera.lookAt(center, 120, center);
        const stats = renderer.scene.stats;
        overlay.set({
            surface: range(t, 0, 0.4),
            caption: "Whole <accent>worlds</accent>:\nchunks, culling, section meshes",
            captionOpacity: fade(t, 1.0, 99, 0.4),
            stat: `${blockCount} blocks · ${stats.sceneObjectCount} meshes`,
            statOpacity: range(t, 2.0, 2.6)
        });
    }
};
