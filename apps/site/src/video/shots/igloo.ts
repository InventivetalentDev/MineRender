import { AssetKey, AssetLoader, AssetParser, BatchedExecutor, MineRenderWorld, type NBTAsset, StructureParser } from "minerender";
import { fade, lerp, orbit, range, smooth } from "../motion";
import type { Shot } from "../types";

let size: [number, number, number] = [7, 9, 7];

/** The igloo basement from the vanilla structure files, with its saved villager and zombie villager rendered. */
export const structureEntities: Shot = {
    id: "structure-entities",
    seconds: 7,
    async prepare({ renderer }) {
        const key = new AssetKey("minecraft", "igloo/bottom", "structure", undefined, "data", ".nbt");
        const nbt = await AssetLoader.get<NBTAsset>(key, AssetParser.NBT);
        if (!nbt) throw new Error("igloo/bottom not found");
        const structure = await StructureParser.parse(nbt);
        size = structure.size;
        // Cutaway: drop the roof and the wall in front of the cells so the two mobs inside are visible.
        const blocks = structure.blocks.filter(({ position: [, y, z], type }) => y < 4 && z > 0 && type !== "minecraft:structure_block");
        const world = new MineRenderWorld(renderer.scene, { sectionMeshing: true, renderEntities: true });
        await world.placeMultiBlock({ ...structure, blocks }, true, new BatchedExecutor(1, 64));
    },
    update({ camera, overlay, portrait }, t) {
        const [sx, , sz] = size;
        const rise = smooth(t, 0, 6.5);
        // The open side faces -Z; look in from there, climbing slightly.
        orbit(camera, {
            target: [sx * 8, 20, sz * 6],
            radius: Math.hypot(sx, sz) * 8 * (portrait ? 2.4 : 1.6),
            height: lerp(36, 70, rise),
            angle: Math.PI + 0.45,
            speed: -0.09
        }, t);
        overlay.set({
            surface: range(t, 0, 0.4),
            caption: "Saved <accent>mobs</accent>\nfrom structures and worlds",
            captionOpacity: fade(t, 0.8, 99, 0.4),
            code: "new MineRenderWorld(scene, {\n    sectionMeshing: true,\n    renderEntities: true\n}).placeMultiBlock(structure);",
            codeOpacity: fade(t, 2.6, 99, 0.5)
        });
    }
};
