import { AssetKey, BlockObject, BlockStates } from "minerender";
import type { Example, ExampleContext, ExampleGroup } from "./types";
import { esmRenderer, fillList, scriptSnippet, selectControl, textControl } from "./shared";

export const BLOCK_RENDERER = {
    camera: {
        position: [26, 20, 30] as [number, number, number],
        lookingAt: [0, 0, 0] as [number, number, number]
    }
};

async function addBlock(context: ExampleContext, name: string): Promise<BlockObject | undefined> {
    const state = await BlockStates.get(AssetKey.parse("blockstates", name));
    if (!state) throw new Error(`Unknown block "${name}"`);
    if (context.signal.aborted) return undefined;
    // Blockstates are not instanced at the blockstate level, so this is always a BlockObject.
    return await context.renderer.scene.addBlock(state) as BlockObject;
}

function remove(block: BlockObject | undefined): void {
    block?.removeFromScene();
}

export const single: Example = {
    id: "block-single",
    title: "Block",
    description: "A blockstate resolves to its default variant. The model's parent chain is merged, textures are packed into an atlas, and preview tints (grass, leaves, water) are applied.",
    renderer: BLOCK_RENDERER,
    placeholder: "/placeholder-block.png",
    async setup(context) {
        let current = await addBlock(context, "grass_block");
        const input = textControl(context, "Block", "grass_block", async name => {
            if (!name) return;
            try {
                const next = await addBlock(context, name);
                if (context.signal.aborted) {
                    remove(next);
                    return;
                }
                remove(current);
                current = next;
            } catch (error) {
                console.warn(error);
            }
        }, []);
        fillList(input, () => BlockStates.getList(), entry => entry.replace(/\.json$/, ""));
    },
    code: {
        esm: `${esmRenderer("AssetKey", "BlockStates")}

const state = await BlockStates.get(AssetKey.parse("blockstates", "grass_block"));
const block = await renderer.scene.addBlock(state!);

// Override or add tint colors by tint index
await renderer.scene.addBlock(state!, { tints: { 0: 0x6fa8dc } });`,
        script: scriptSnippet(`MineRender.BlockStates.get(MineRender.AssetKey.parse("blockstates", "grass_block"))
    .then(state => renderer.scene.addBlock(state));`)
    }
};

const multipart: Example = {
    id: "block-multipart",
    title: "Multipart and variants",
    description: "Multipart blockstates (fences, walls, redstone) combine several models based on properties. Pass properties to pick a state.",
    renderer: BLOCK_RENDERER,
    placeholder: "/placeholder-block.png",
    async setup({ renderer, signal }) {
        const state = await BlockStates.get(AssetKey.parse("blockstates", "oak_fence"));
        if (!state || signal.aborted) return;
        const fence = await renderer.scene.addBlock(state) as BlockObject;
        if (signal.aborted) return;
        await fence.setState({ north: "true", east: "true" });
        renderer.dirty = true;
    },
    code: {
        esm: `${esmRenderer("AssetKey", "BlockStates")}

const state = await BlockStates.get(AssetKey.parse("blockstates", "oak_fence"));
const fence = await renderer.scene.addBlock(state!);

// Pick the variant through blockstate properties
await fence.setState({ north: "true", east: "true" });
renderer.dirty = true;`
    }
};

type Facing = "north" | "east" | "south" | "west";
const FACINGS: Facing[] = ["south", "west", "north", "east"];
const FACING_VECTOR: Record<Facing, [number, number]> = { south: [0, 1], west: [-1, 0], north: [0, -1], east: [1, 0] };
/** 16 steps of 22.5°. A placed skull looks back at the player, so rotation 0 faces north; a sign's front faces south. */
const SKULL_ROTATION: Record<Facing, string> = { north: "0", east: "4", south: "8", west: "12" };
const SIGN_ROTATION: Record<Facing, string> = { south: "0", west: "4", north: "8", east: "12" };

/** One block entity preview: blocks relative to the facing direction, with their properties. */
interface BlockEntityPreview {
    label: string;
    blocks(facing: Facing): Array<{ name: string; properties: Record<string, string>; offset?: [number, number] }>;
}
/** The player's left when looking at a block that faces `facing`. */
function leftOf(facing: Facing): [number, number] {
    const [x, z] = FACING_VECTOR[facing];
    return [-z, x];
}
const BLOCK_ENTITIES: Record<string, BlockEntityPreview> = {
    chest: { label: "Chest", blocks: facing => [{ name: "chest", properties: { facing } }] },
    double_chest: {
        label: "Double chest",
        blocks: facing => [
            { name: "chest", properties: { facing, type: "right" } },
            { name: "chest", properties: { facing, type: "left" }, offset: leftOf(facing) }
        ]
    },
    ender_chest: { label: "Ender chest", blocks: facing => [{ name: "ender_chest", properties: { facing } }] },
    bed: {
        label: "Bed",
        blocks: facing => {
            const [x, z] = FACING_VECTOR[facing];
            return [
                { name: "red_bed", properties: { facing, part: "head" } },
                { name: "red_bed", properties: { facing, part: "foot" }, offset: [-x, -z] }
            ];
        }
    },
    skull: { label: "Skeleton skull", blocks: facing => [{ name: "skeleton_skull", properties: { rotation: SKULL_ROTATION[facing] } }] },
    creeper_head: { label: "Creeper head", blocks: facing => [{ name: "creeper_head", properties: { rotation: SKULL_ROTATION[facing] } }] },
    sign: { label: "Sign", blocks: facing => [{ name: "oak_sign", properties: { rotation: SIGN_ROTATION[facing] } }] },
    shulker_box: { label: "Shulker box", blocks: () => [{ name: "purple_shulker_box", properties: {} }] },
    decorated_pot: { label: "Decorated pot", blocks: facing => [{ name: "decorated_pot", properties: { facing } }] },
    bell: { label: "Bell", blocks: facing => [{ name: "bell", properties: { facing } }] }
};

const blockEntities: Example = {
    id: "block-entities",
    title: "Chests, beds and skulls",
    description: "Blocks drawn by a block-entity renderer in the game have empty block models. The entity dataset maps them to entity models and rotations, so addBlock draws them from their blockstate properties.",
    renderer: {
        camera: {
            position: [34, 26, 40] as [number, number, number],
            lookingAt: [0, 4, 0] as [number, number, number]
        }
    },
    placeholder: "/placeholder-block.png",
    async setup(context) {
        const { renderer, signal } = context;
        let preview = "chest";
        let facing: Facing = "south";
        let current: BlockObject[] = [];
        let token = 0;

        const show = async () => {
            const run = ++token;
            const entries = BLOCK_ENTITIES[preview].blocks(facing);
            const next: BlockObject[] = [];
            for (const entry of entries) {
                const block = await addBlock(context, entry.name);
                if (!block) break;
                next.push(block);
                if (Object.keys(entry.properties).length) await block.setState(entry.properties);
                // Center a pair of blocks on the origin
                const [x, z] = entry.offset ?? [0, 0];
                const spread = entries.length > 1 ? 8 : 0;
                const [sx, sz] = entries[1]?.offset ?? [0, 0];
                block.setPosition(block.getPosition().set(x * 16 - sx * spread, 0, z * 16 - sz * spread));
            }
            if (signal.aborted || run !== token) {
                next.forEach(remove);
                return;
            }
            current.forEach(remove);
            current = next;
            renderer.dirty = true;
        };

        selectControl(context, "Block", Object.entries(BLOCK_ENTITIES).map(([id, { label }]) => [id, label]), preview, value => {
            preview = value;
            show().catch(console.warn);
        });
        selectControl(context, "Facing", FACINGS.map(f => [f, f]), facing, value => {
            facing = value as Facing;
            show().catch(console.warn);
        });
        await show();
    },
    code: {
        esm: `${esmRenderer("AssetKey", "BlockStates")}

// A chest's block model has no geometry; its entity model and lid rotation come from the dataset
const chest = await BlockStates.get(AssetKey.parse("blockstates", "chest"));
const single = await renderer.scene.addBlock(chest!);
await single.setState({ facing: "east" });

// Double chests, beds, skulls, signs, banners and shulker boxes work the same way
const bed = await BlockStates.get(AssetKey.parse("blockstates", "red_bed"));
const head = await renderer.scene.addBlock(bed!);
await head.setState({ facing: "south", part: "head" });
head.setPosition(head.getPosition().set(32, 0, 0));

const skull = await BlockStates.get(AssetKey.parse("blockstates", "skeleton_skull"));
const placed = await renderer.scene.addBlock(skull!);
await placed.setState({ rotation: "4" });     // 16 steps of 22.5°; 0 faces north
placed.setPosition(placed.getPosition().set(-32, 0, 0));
renderer.dirty = true;

// The entity objects a block owns, for posing or hiding parts
single.blockEntities;`
    }
};

const many: Example = {
    id: "block-instanced",
    title: "Hundreds of blocks, one draw call",
    description: "Identical models share an InstancedMesh. Each addBlock call returns an instance reference whose transforms map to a slot in that mesh.",
    renderer: {
        camera: {
            position: [120, 90, 140] as [number, number, number],
            lookingAt: [0, 0, 0] as [number, number, number]
        }
    },
    placeholder: "/placeholder-block.png",
    async setup({ renderer, signal }) {
        const names = ["stone", "cobblestone", "oak_planks", "bricks"];
        const states = await Promise.all(names.map(name => BlockStates.get(AssetKey.parse("blockstates", name))));
        if (signal.aborted) return;
        const size = 7;
        const half = (size - 1) / 2;
        const pending: Promise<unknown>[] = [];
        for (let x = 0; x < size; x++) {
            for (let z = 0; z < size; z++) {
                const height = 1 + Math.round(Math.abs(Math.sin(x * 0.9) * Math.cos(z * 0.7)) * 3);
                for (let y = 0; y < height; y++) {
                    const state = states[(x + z + y) % states.length];
                    if (!state) continue;
                    pending.push(renderer.scene.addBlock(state).then(block => {
                        if (signal.aborted) return;
                        block.setPosition(block.getPosition().set((x - half) * 16, y * 16, (z - half) * 16));
                    }));
                }
            }
        }
        await Promise.all(pending);
        renderer.dirty = true;
    },
    code: {
        esm: `${esmRenderer("AssetKey", "BlockStates")}

const stone = await BlockStates.get(AssetKey.parse("blockstates", "stone"));

for (let x = 0; x < 7; x++) {
    for (let z = 0; z < 7; z++) {
        // Same model → same InstancedMesh; this returns an InstanceReference
        const block = await renderer.scene.addBlock(stone!);
        // 1 block = 16 scene units
        block.setPosition(block.getPosition().set(x * 16, 0, z * 16));
    }
}
renderer.dirty = true;`
    }
};

/** Fluids and blocks with animated textures: [blockstate, properties, label]. */
const FLUIDS: Array<[string, Record<string, string>, string]> = [
    ["water", {}, "Water source"],
    ["water", { level: "4" }, "Flowing water"],
    ["lava", {}, "Lava source"],
    ["lava", { level: "6" }, "Flowing lava"],
    ["seagrass", {}, "Seagrass (in water)"],
    ["oak_fence", { waterlogged: "true", north: "true", south: "true" }, "Waterlogged fence"],
    ["bubble_column", {}, "Bubble column"],
    ["magma_block", {}, "Magma block"],
    ["sea_lantern", {}, "Sea lantern"]
];

export const fluids: Example = {
    id: "block-fluids",
    title: "Water, lava and animated textures",
    description: "Water and lava use their saved level for sloped surfaces and flow textures. Waterlogged blocks and underwater plants include the water. mcmeta frame sequences animate.",
    renderer: BLOCK_RENDERER,
    placeholder: "/placeholder-block.png",
    async setup(context) {
        const { renderer, signal } = context;
        let current: BlockObject | undefined;
        const show = async (index: number) => {
            const [name, properties] = FLUIDS[index];
            const next = await addBlock(context, name);
            if (!next) return;
            if (Object.keys(properties).length) await next.setState(properties);
            if (signal.aborted) {
                remove(next);
                return;
            }
            remove(current);
            current = next;
            renderer.dirty = true;
        };
        selectControl(context, "Block", FLUIDS.map(([, , label], index) => [String(index), label]), "0", value => {
            show(Number(value)).catch(console.warn);
        });
        await show(0);
    },
    code: {
        esm: `${esmRenderer("AssetKey", "BlockStates")}

// A source block; standalone previews assume air around it
const water = await BlockStates.get(AssetKey.parse("blockstates", "water"));
const source = await renderer.scene.addBlock(water!);

// Flowing water slopes according to its level (1–7)
const flowing = await renderer.scene.addBlock(water!);
await flowing.setState({ level: "4" });
flowing.setPosition(flowing.getPosition().set(24, 0, 0));

// Waterlogged blocks include the water alongside their model
const fence = await BlockStates.get(AssetKey.parse("blockstates", "oak_fence"));
const logged = await renderer.scene.addBlock(fence!);
await logged.setState({ waterlogged: "true", north: "true", south: "true" });
logged.setPosition(logged.getPosition().set(-24, 0, 0));
renderer.dirty = true;`
    }
};

export const blocks: ExampleGroup = {
    id: "blocks",
    title: "Blocks",
    lead: "Vanilla blockstates and models from the asset CDN, merged through their parent chain and drawn through shared instanced meshes. Chests, beds and skulls get their entity models; water and lava render with levels and flow.",
    examples: [{ ...single, title: "A single block" }, multipart, blockEntities, fluids, many],
    notes: [
        "Preview tints use the resource pack's colormap at a fixed biome."
    ]
};
