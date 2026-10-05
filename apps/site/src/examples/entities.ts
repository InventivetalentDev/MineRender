import { BasicAssetKey, Entities, EntityModel } from "minerender";
import type { Example, ExampleContext, ExampleGroup } from "./types";
import { esmRenderer, fillList, frameObject, scriptSnippet, selectControl, textControl } from "./shared";

export const ENTITY_RENDERER = {
    camera: {
        position: [36, 26, 44] as [number, number, number],
        lookingAt: [0, 8, 0] as [number, number, number]
    }
};

/** "cat" uses the dataset's texture; "cat/black" keeps the cat model and picks another texture. */
async function loadEntity(name: string): Promise<EntityModel> {
    const [modelName] = name.split("/");
    const modelKey = new BasicAssetKey("minecraft", modelName);
    const textureKey = name.includes("/") ? new BasicAssetKey("minecraft", name) : undefined;
    const entity = await Entities.getEntity(modelKey, textureKey);
    if (!entity) throw new Error(`Unknown entity "${name}"`);
    return entity;
}

async function showEntity(context: ExampleContext, name: string) {
    const model = await loadEntity(name);
    if (context.signal.aborted) return undefined;
    const entity = await context.renderer.scene.addEntity(model, { instanceMeshes: false });
    if (!context.signal.aborted && "isObject3D" in entity) frameObject(context.renderer, entity);
    return entity;
}

const MOBS = [
    "creeper", "zombie", "skeleton", "enderman", "villager", "pig", "cow", "sheep", "chicken", "spider",
    "slime", "iron_golem", "wolf", "cat", "bee", "phantom", "witch", "piglin", "allay", "warden", "camel"
];
const BLOCK_ENTITIES = ["chest", "ender_chest", "trapped_chest", "shulker_box", "bell", "conduit", "bed_head", "decorated_pot"];
/** Texture variants are chosen through a second key; the dataset supplies a default otherwise. */
const VARIANTS: Array<[string, string]> = [
    ["cat/tabby", "Tabby"], ["cat/black", "Black"], ["cat/siamese", "Siamese"], ["cat/ragdoll", "Ragdoll"], ["cat/calico", "Calico"]
];

export const mob: Example = {
    id: "entity-mob",
    title: "Entity",
    description: "Entity geometry comes from a per-version dataset extracted from the game, including nested parts, poses, mirrored cubes, and texture locations.",
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

const model = await Entities.getEntity(new BasicAssetKey("minecraft", "creeper"));
const creeper = await renderer.scene.addEntity(model!);`,
        script: scriptSnippet(`MineRender.Entities.getEntity(new MineRender.BasicAssetKey("minecraft", "creeper"))
    .then(model => renderer.scene.addEntity(model));`)
    }
};

const blockEntity: Example = {
    id: "entity-block",
    title: "Block entities",
    description: "Chests, shulker boxes, bells, and beds are block entities. They come from the same dataset and load the same way.",
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

// Block entities share the dataset with mobs
const model = await Entities.getEntity(new BasicAssetKey("minecraft", "chest"));
const chest = await renderer.scene.addEntity(model!);`
    }
};

const variants: Example = {
    id: "entity-variants",
    title: "Texture variants",
    description: "One model, many textures. Pass a second key to choose a variant such as a cat breed, a horse coat, or a bed color.",
    renderer: ENTITY_RENDERER,
    placeholder: "/placeholder-block.png",
    async setup(context) {
        let current = await showEntity(context, VARIANTS[0][0]);
        selectControl(context, "Cat", VARIANTS, VARIANTS[0][0], async name => {
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
        });
    },
    code: {
        esm: `${esmRenderer("BasicAssetKey", "Entities")}

const model = await Entities.getEntity(
    new BasicAssetKey("minecraft", "cat"),          // geometry
    new BasicAssetKey("minecraft", "cat/siamese")   // textures/entity/cat/siamese.png
);
await renderer.scene.addEntity(model!);`
    }
};

export const entities: ExampleGroup = {
    id: "entities",
    title: "Entities",
    lead: "Mobs and block entities from a per-version geometry dataset extracted from the game, textured with the game's box UV layout.",
    examples: [{ ...mob, title: "Mobs" }, blockEntity, variants]
};
