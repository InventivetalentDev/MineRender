import { AssetKey, BlockStates } from "minerender";
import { Vector3 } from "three";
import { easeOut, fade, orbit, range } from "../motion";
import type { Shot } from "../types";

interface Placed {
    object: { setPositionRotationScale(position?: Vector3, rotation?: undefined, scale?: Vector3): void };
    base: Vector3;
    /** Reveal order, 0–1 by distance from the centre. */
    order: number;
}

const BLOCKS = ["stone", "cobblestone", "oak_planks", "bricks", "mossy_cobblestone", "stone_bricks"];

/** Hundreds of instanced blocks sharing a handful of meshes, growing out from the centre. */
export const blocksInstanced: Shot = {
    id: "blocks-instanced",
    seconds: 7,
    async prepare(context) {
        const { renderer } = context;
        const states = await Promise.all(BLOCKS.map(name => BlockStates.get(AssetKey.parse("blockstates", name))));
        const size = 15;
        const half = (size - 1) / 2;
        const placed: Placed[] = [];
        const pending: Promise<unknown>[] = [];
        for (let x = 0; x < size; x++) {
            for (let z = 0; z < size; z++) {
                const dx = x - half;
                const dz = z - half;
                const distance = Math.hypot(dx, dz) / Math.hypot(half, half);
                const height = 1 + Math.round(Math.abs(Math.sin(x * 0.9) * Math.cos(z * 0.7)) * 3 + (1 - distance) * 2);
                for (let y = 0; y < height; y++) {
                    const state = states[(x * 3 + z * 5 + y) % states.length];
                    if (!state) continue;
                    pending.push(renderer.scene.addBlock(state).then(object => {
                        const base = new Vector3(dx * 16, y * 16, dz * 16);
                        object.setPositionRotationScale(base, undefined, new Vector3(0, 0, 0));
                        placed.push({ object, base, order: distance * 0.75 + y * 0.06 });
                    }));
                }
            }
        }
        await Promise.all(pending);
        context.renderer.scene.userData.placed = placed;
    },
    update({ camera, overlay, renderer, portrait }, t) {
        const placed = renderer.scene.userData.placed as Placed[];
        // Blocks grow from the centre outwards over the first three seconds.
        const progress = range(t, 0.3, 3.2);
        for (const block of placed) {
            const s = easeOut(range(progress, block.order * 0.8, block.order * 0.8 + 0.2));
            // Models are centred on their position, so scaling needs no offset.
            block.object.setPositionRotationScale(block.base, undefined, new Vector3(s, s, s));
        }
        renderer.dirty = true;
        orbit(camera, { target: [0, 20, 0], radius: 300, height: 170, angle: -0.5, speed: 0.12 }, t, portrait ? 1.5 : 1);
        const stats = renderer.scene.stats;
        overlay.set({
            surface: 1,
            caption: "Hundreds of blocks,\n<accent>one mesh per model</accent>",
            captionOpacity: fade(t, 1.2, 99, 0.5),
            stat: `${stats.instanceCount} blocks · ${stats.sceneObjectCount} meshes`,
            statOpacity: range(t, 3.0, 3.6)
        });
    }
};
