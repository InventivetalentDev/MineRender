import { AssetKey, BlockObject, BlockStates } from "minerender";
import type { Example, ExampleContext, ExampleGroup } from "./types";
import { esmRenderer, fillList, scriptSnippet, textControl } from "./shared";

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

export const blocks: ExampleGroup = {
    id: "blocks",
    title: "Blocks",
    lead: "Vanilla blockstates and models from the asset CDN, merged through their parent chain and drawn through shared instanced meshes.",
    examples: [{ ...single, title: "A single block" }, multipart, many],
    notes: [
        "Preview tints use the resource pack's colormap at a fixed biome. Biome-dependent colors need world context and are part of the world work."
    ]
};
