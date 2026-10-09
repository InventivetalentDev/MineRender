import { AssetKey, AssetLoader, AssetParser, BatchedExecutor, MineRenderWorld, type MultiBlockStructure, type NBTAsset, StructureParser } from "minerender";
import { fade, lerp, orbit, range, smooth } from "../motion";
import type { Shot } from "../types";

const STRUCTURE = "pillager_outpost/watchtower";

let structure: MultiBlockStructure;

/** A vanilla structure file placed into a section-meshed world. */
export const structureVanilla: Shot = {
    id: "structure",
    seconds: 7,
    renderer: { camera: { far: 20000 } },
    async prepare({ renderer }) {
        const key = new AssetKey("minecraft", STRUCTURE, "structure", undefined, "data", ".nbt");
        const asset = await AssetLoader.get<NBTAsset>(key, AssetParser.NBT);
        if (!asset) throw new Error(`Structure ${STRUCTURE} missing`);
        structure = await StructureParser.parse(asset);
        const world = new MineRenderWorld(renderer.scene, { sectionMeshing: true });
        await world.placeMultiBlock(structure, true, new BatchedExecutor(1, 64));
    },
    update({ camera, overlay, renderer, portrait }, t) {
        const [sx, sy, sz] = structure.size;
        const target: [number, number, number] = [sx * 8 - 8, sy * 8 - 8, sz * 8 - 8];
        const radius = Math.hypot(sx, sz) * 8 * (portrait ? 3.0 : 2.4);
        // Rise from a low angle to an overview while circling.
        const rise = smooth(t, 0, 6.5);
        orbit(camera, { target, radius, height: lerp(sy * 2, sy * 8, rise), angle: 0.9, speed: 0.1 }, t);
        const stats = renderer.scene.stats;
        overlay.set({
            surface: range(t, 0, 0.4),
            caption: "Structure files,\n<accent>merged per section</accent>",
            captionOpacity: fade(t, 0.8, 99, 0.4),
            stat: `${structure.blocks.length} blocks · ${stats.sceneObjectCount} meshes`,
            statOpacity: range(t, 1.6, 2.2)
        });
    }
};
