import { BasicAssetKey, Entities, EntityModel } from "minerender";
import type { Example, ExampleContext, ExampleGroup } from "./types";
import { esmRenderer, fillList, scriptSnippet, textControl } from "./shared";

const ENTITY_RENDERER = {
    camera: {
        position: [36, 26, 44] as [number, number, number],
        lookingAt: [0, 8, 0] as [number, number, number]
    }
};

/** "pig/temperate_pig" selects the pig model and the textures/entity/pig/temperate_pig.png texture. */
async function loadEntity(name: string): Promise<EntityModel> {
    const modelKey = new BasicAssetKey("minecraft", name.split("/")[0]);
    const textureKey = new BasicAssetKey("minecraft", name);
    const entity = await Entities.getEntity(modelKey, textureKey);
    if (entity?.parts) return entity;
    const blockEntity = await Entities.getBlock(modelKey, textureKey);
    if (!blockEntity?.parts) throw new Error(`Unknown entity "${name}"`);
    return blockEntity;
}

async function showEntity(context: ExampleContext, name: string) {
    const model = await loadEntity(name);
    if (context.signal.aborted) return undefined;
    return context.renderer.scene.addEntity(model, { instanceMeshes: false });
}

/** Entities whose texture lives at textures/entity/<path>.png in current game versions. */
const MOBS = [
    "creeper/creeper", "zombie/zombie", "skeleton/skeleton", "enderman/enderman", "villager/villager",
    "pig/temperate_pig", "cow/temperate_cow", "sheep/sheep", "chicken/temperate_chicken", "spider/spider",
    "slime/slime", "iron_golem/iron_golem", "wolf/wolf", "cat/tabby", "bee/bee", "phantom", "witch", "piglin"
];
const BLOCK_ENTITIES = ["chest/normal", "chest/ender", "chest/trapped", "shulker/shulker", "bell/bell_body", "conduit/base", "bed/red"];

const mob: Example = {
    id: "entity-mob",
    title: "Mobs",
    description: "Entity models are dumps of the game's own ModelPart trees, textured with the game's box-UV layout. The part after the slash picks the texture variant.",
    renderer: ENTITY_RENDERER,
    placeholder: "/placeholder-block.png",
    async setup(context) {
        let current = await showEntity(context, MOBS[0]);
        const input = textControl(context, "Entity", MOBS[0], async name => {
            if (!name) return;
            try {
                const next = await showEntity(context, name);
                if (!next) return;
                if (current && "removeFromScene" in current) {
                    current.removeFromScene();
                    current.disposeAndRemoveAllChildren();
                }
                current = next;
            } catch (error) {
                console.warn(error);
            }
        }, MOBS);
        fillList(input, () => Entities.getEntityList());
    },
    code: {
        esm: `${esmRenderer("BasicAssetKey", "Entities")}

// The model name, and the texture under assets/minecraft/textures/entity/
const model = await Entities.getEntity(
    new BasicAssetKey("minecraft", "creeper"),
    new BasicAssetKey("minecraft", "creeper/creeper")
);
const creeper = await renderer.scene.addEntity(model!);`,
        script: scriptSnippet(`MineRender.Entities.getEntity(
    new MineRender.BasicAssetKey("minecraft", "creeper"),
    new MineRender.BasicAssetKey("minecraft", "creeper/creeper")
).then(model => renderer.scene.addEntity(model));`)
    }
};

const blockEntity: Example = {
    id: "entity-block",
    title: "Block entities",
    description: "Chests, shulker boxes, bells, and other block entities come from a separate model set and load the same way.",
    renderer: ENTITY_RENDERER,
    placeholder: "/placeholder-block.png",
    async setup(context) {
        let current = await showEntity(context, BLOCK_ENTITIES[0]);
        const input = textControl(context, "Block entity", BLOCK_ENTITIES[0], async name => {
            if (!name) return;
            try {
                const next = await showEntity(context, name);
                if (!next) return;
                if (current && "removeFromScene" in current) {
                    current.removeFromScene();
                    current.disposeAndRemoveAllChildren();
                }
                current = next;
            } catch (error) {
                console.warn(error);
            }
        }, BLOCK_ENTITIES);
        fillList(input, () => Entities.getBlockList());
    },
    code: {
        esm: `${esmRenderer("BasicAssetKey", "Entities")}

const model = await Entities.getBlock(
    new BasicAssetKey("minecraft", "chest"),
    new BasicAssetKey("minecraft", "chest/normal")
);
const chest = await renderer.scene.addEntity(model!);`
    }
};

export const entities: ExampleGroup = {
    id: "entities",
    title: "Entities",
    lead: "Mobs and block entities rendered from the game's ModelPart definitions, served from the minerender fallback-assets repository.",
    examples: [mob, blockEntity],
    notes: [
        "Nested child parts, mirrored cubes, and automatic texture-variant lookup are still being completed, so some entities render partially or need an explicit texture path."
    ]
};
