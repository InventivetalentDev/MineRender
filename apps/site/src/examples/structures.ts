import { AssetKey, AssetLoader, AssetParser, BatchedExecutor, MineRenderWorld, NBTAsset, Renderer, StructureParser } from "minerender";
import type { Example, ExampleGroup } from "./types";
import { esmRenderer, textControl } from "./shared";

/**
 * The world prototype still adds chunk bounds and block wireframes unconditionally
 * (ROADMAP item 11). Hide those line helpers so the showcase shows the blocks only.
 */
function hideDebugLines(renderer: Renderer): void {
    renderer.scene.traverse(object => {
        if ((object as { isLineSegments?: boolean }).isLineSegments || (object as { isLine?: boolean }).isLine) {
            object.visible = false;
        }
    });
    renderer.dirty = true;
}

const STRUCTURES = [
    "village/plains/houses/plains_small_house_1",
    "end_city/ship",
    "end_city/base_floor",
    "igloo/top",
    "igloo/bottom",
    "village/plains/houses/plains_medium_house_1",
    "village/plains/town_centers/plains_fountain_01",
    "village/desert/houses/desert_small_house_1",
    "village/savanna/houses/savanna_small_house_1",
    "village/taiga/houses/taiga_small_house_1",
    "pillager_outpost/watchtower",
    "shipwreck/with_mast",
    "ruined_portal/portal_1",
    "underwater_ruin/brick_1"
];

async function loadStructure(name: string) {
    const key = new AssetKey("minecraft", name, "structure", undefined, "data", ".nbt");
    const asset = await AssetLoader.get<NBTAsset>(key, AssetParser.NBT);
    if (!asset) throw new Error(`Unknown structure "${name}"`);
    return StructureParser.parse(asset);
}

const vanilla: Example = {
    id: "structure-vanilla",
    title: "Vanilla structure files",
    description: "Structure .nbt files are parsed in the browser and placed block by block into a world. Block placement is batched so the page stays responsive.",
    renderer: {
        camera: {
            position: [230, 170, 230] as [number, number, number],
            lookingAt: [72, 40, 72] as [number, number, number],
            far: 10000
        }
    },
    placeholder: "/placeholder-block.png",
    async setup(context) {
        const { renderer, signal } = context;
        const world = new MineRenderWorld(renderer.scene);
        let executor: BatchedExecutor | undefined;
        let token = 0;

        const show = async (name: string) => {
            const current = ++token;
            const structure = await loadStructure(name);
            if (signal.aborted || current !== token) return;
            await world.clear();
            executor = new BatchedExecutor(1, 32);
            const [sx, sy, sz] = structure.size;
            renderer.controls?.target.set(sx * 8, sy * 8, sz * 8);
            renderer.controls?.update();
            await world.placeMultiBlock(structure, true, executor);
            hideDebugLines(renderer);
        };

        await show(STRUCTURES[0]);
        textControl(context, "Structure", STRUCTURES[0], name => {
            if (name) show(name).catch(console.warn);
        }, STRUCTURES);

        return () => {
            token++;
            world.clear().catch(() => undefined);
        };
    },
    code: {
        esm: `${esmRenderer("AssetKey", "AssetLoader", "AssetParser", "MineRenderWorld", "StructureParser")}

const key = new AssetKey("minecraft", "village/plains/houses/plains_small_house_1", "structure", undefined, "data", ".nbt");
const nbt = await AssetLoader.get(key, AssetParser.NBT);
const structure = await StructureParser.parse(nbt!);

const world = new MineRenderWorld(renderer.scene);
await world.placeMultiBlock(structure);`
    }
};

const programmatic: Example = {
    id: "structure-world",
    title: "Build a world in code",
    description: "MineRenderWorld places Block descriptors on a 16³ chunk grid. Identical blocks share instanced meshes, so large builds stay cheap to draw.",
    renderer: {
        camera: {
            position: [230, 170, 230] as [number, number, number],
            lookingAt: [72, 24, 72] as [number, number, number],
            far: 10000
        }
    },
    placeholder: "/placeholder-block.png",
    async setup({ renderer, signal }) {
        const world = new MineRenderWorld(renderer.scene);
        const pending: Promise<unknown>[] = [];
        const size = 10;
        for (let x = 0; x < size; x++) {
            for (let z = 0; z < size; z++) {
                const height = 2 + Math.round(2 + 1.5 * Math.sin(x * 0.7) + 1.5 * Math.cos(z * 0.6));
                for (let y = 0; y < height; y++) {
                    const type = y === height - 1 ? "minecraft:moss_block" : y === 0 ? "minecraft:stone" : "minecraft:dirt";
                    pending.push(world.setBlockAt(x, y, z, { type }));
                }
            }
        }
        await Promise.all(pending);
        if (signal.aborted) return;
        hideDebugLines(renderer);
        return () => {
            world.clear().catch(() => undefined);
        };
    },
    code: {
        esm: `${esmRenderer("MineRenderWorld")}

const world = new MineRenderWorld(renderer.scene);

for (let x = 0; x < 10; x++) {
    for (let z = 0; z < 10; z++) {
        const height = 2 + Math.round(2 + 1.5 * Math.sin(x * 0.7) + 1.5 * Math.cos(z * 0.6));
        for (let y = 0; y < height; y++) {
            const type = y === height - 1 ? "minecraft:moss_block" : "minecraft:dirt";
            await world.setBlockAt(x, y, z, { type });
        }
    }
}`
    }
};

export const structures: ExampleGroup = {
    id: "structures",
    title: "Structures & worlds",
    lead: "V2's headline goal: go beyond single models to structures and, eventually, full worlds, built on instanced chunk storage.",
    examples: [vanilla, programmatic],
    notes: [
        "The world subsystem is an early prototype: no face culling between neighbours, lighting, or chunk streaming yet. Anvil region (.mca) and schematic loaders are planned."
    ]
};
