import { AssetKey, BasicAssetKey, BlockStates, DisplayPosition, Entities, Models } from "minerender";
import type { Example } from "./types";
import { STEVE_TEXTURE, esmRenderer, standOn } from "./shared";
import { pose } from "./skins";

/**
 * The hero scene: every content type in one renderer. V1 needed a separate renderer class
 * for each of these.
 */
export const composed: Example = {
    id: "scene-composed",
    title: "Scene",
    description: "One scene, every content type: blocks, a player, an item, and a mob share a camera and a render loop.",
    renderer: {
        camera: {
            position: [70, 52, 92] as [number, number, number],
            lookingAt: [0, 12, 0] as [number, number, number]
        }
    },
    placeholder: "/placeholder-block.png",
    async setup({ renderer, signal }) {
        const scene = renderer.scene;
        const block = async (name: string, x: number, y: number, z: number) => {
            const state = await BlockStates.get(AssetKey.parse("blockstates", name));
            if (!state || signal.aborted) return;
            const object = await scene.addBlock(state);
            if (signal.aborted) return;
            object.setPosition(object.getPosition().set(x * 16, y * 16, z * 16));
        };

        const floor: Promise<unknown>[] = [];
        for (let x = -2; x <= 2; x++) {
            for (let z = -2; z <= 2; z++) {
                const edge = Math.abs(x) === 2 || Math.abs(z) === 2;
                floor.push(block(edge ? "stone_bricks" : "grass_block", x, -1, z));
            }
        }
        await Promise.all([
            ...floor,
            block("oak_log", 2, 0, -2),
            block("oak_log", 2, 1, -2),
            block("oak_leaves", 2, 2, -2),
            block("crafting_table", -2, 0, 2),
            block("lantern", -2, 1, 2)
        ]);
        if (signal.aborted) return;

        const skin = await scene.addSkin(STEVE_TEXTURE);
        if (signal.aborted) return;
        skin.position.set(-8, 0, 8);
        skin.rotation.y = 0.6;
        pose(skin);

        const creeperModel = await Entities.getEntity(new BasicAssetKey("minecraft", "creeper"));
        if (!creeperModel || signal.aborted) return;
        const creeper = await scene.addEntity(creeperModel, { instanceMeshes: false });
        if (signal.aborted) return;
        if ("position" in creeper) {
            creeper.position.set(20, 0, -8);
            creeper.rotation.y = -0.8;
            standOn(creeper);
        }

        const sword = await Models.getMerged(new AssetKey("minecraft", "diamond_sword", "models", "item", "assets"));
        if (!sword || signal.aborted) return;
        const item = await scene.addModel(sword, { instanceMeshes: false, displayPosition: DisplayPosition.GROUND });
        if (signal.aborted) return;
        if ("position" in item) item.position.set(14, 2, 20);

        renderer.dirty = true;
    },
    code: {
        esm: `${esmRenderer("AssetKey", "BasicAssetKey", "BlockStates", "DisplayPosition", "Entities", "Models")}

const scene = renderer.scene;

// Blocks: identical models share one instanced mesh
const grass = await BlockStates.get(AssetKey.parse("blockstates", "grass_block"));
for (let x = -2; x <= 2; x++) {
    for (let z = -2; z <= 2; z++) {
        const block = await scene.addBlock(grass!);
        block.setPosition(block.getPosition().set(x * 16, -16, z * 16));
    }
}

// A player
const skin = await scene.addSkin("${STEVE_TEXTURE}");
skin.position.set(-8, 0, 8);

// A mob
const creeper = await Entities.getEntity(new BasicAssetKey("minecraft", "creeper"));
const mob = await scene.addEntity(creeper!);
mob.setPosition(mob.getPosition().set(20, 0, -8));

// An item, posed as if dropped on the ground
const sword = await Models.getMerged(new AssetKey("minecraft", "diamond_sword", "models", "item", "assets"));
await scene.addModel(sword!, { displayPosition: DisplayPosition.GROUND });`
    }
};
