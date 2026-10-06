import { BasicAssetKey, Entities, EntityModel, EntityObject, InstanceReference } from "minerender";
import type { Example, ExampleContext, ExampleGroup } from "./types";
import { esmRenderer, fillList, frameObject, scriptSnippet, selectControl, textControl, toggleControl } from "./shared";

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

function removeEntity(entity: EntityObject | InstanceReference<EntityObject> | undefined): void {
    if (!entity) return;
    entity.removeFromScene();
    // Releases the object's geometry, or the instance slot for reuse
    entity.dispose();
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
const VARIANTS: Record<string, string[]> = {
    cat: ["tabby", "black", "siamese", "ragdoll", "calico", "red", "british_shorthair", "jellie", "persian", "white"],
    horse: ["horse_brown", "horse_white", "horse_black", "horse_chestnut", "horse_creamy", "horse_darkbrown", "horse_gray"],
    wolf: ["wolf", "wolf_ashen", "wolf_black", "wolf_chestnut", "wolf_rusty", "wolf_snowy", "wolf_spotted", "wolf_striped", "wolf_woods"],
    axolotl: ["axolotl_lucy", "axolotl_cyan", "axolotl_gold", "axolotl_wild", "axolotl_blue"],
    rabbit: ["brown", "white", "black", "white_splotched", "gold", "salt", "toast"],
    frog: ["temperate_frog", "cold_frog", "warm_frog"]
};

function variantLabel(variant: string, animal: string): string {
    return variant.replace(new RegExp(`^${animal}_?`), "").replace(/_frog$/, "").replace(/_/g, " ") || variant;
}

export const mob: Example = {
    id: "entity-mob",
    title: "Entity",
    description: "Entity geometry comes from a per-version dataset extracted from the game, including nested parts, poses, mirrored cubes, and texture locations. Extra draws such as spider eyes or the slime's outer shell are included.",
    renderer: ENTITY_RENDERER,
    placeholder: "/placeholder-block.png",
    async setup(context) {
        let current = await showEntity(context, MOBS[0]);
        const show = async (name: string) => {
            try {
                const next = await showEntity(context, name);
                if (!next) return;
                removeEntity(current);
                current = next;
            } catch (error) {
                console.warn(error);
            }
        };
        const input = textControl(context, "Entity", MOBS[0], name => {
            if (name) void context.track(show(name));
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
        const show = async (name: string) => {
            try {
                const next = await showEntity(context, name);
                if (!next) return;
                removeEntity(current);
                current = next;
            } catch (error) {
                console.warn(error);
            }
        };
        const input = textControl(context, "Block entity", BLOCK_ENTITIES[0], name => {
            if (name) void context.track(show(name));
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
    description: "One model, many textures. Pass a second key to choose a variant such as a cat breed, a horse coat, or a wolf fur.",
    renderer: ENTITY_RENDERER,
    placeholder: "/placeholder-block.png",
    async setup(context) {
        let animal = "cat";
        let current = await showEntity(context, `${animal}/${VARIANTS[animal][0]}`);
        const show = async (name: string) => {
            try {
                const next = await showEntity(context, name);
                if (!next) return;
                removeEntity(current);
                current = next;
            } catch (error) {
                console.warn(error);
            }
        };
        const variantOptions = (name: string): Array<[string, string]> => VARIANTS[name].map(v => [v, variantLabel(v, name)]);
        const variantSelect = selectControl(context, "Texture", variantOptions(animal), VARIANTS[animal][0], variant => void context.track(show(`${animal}/${variant}`)));
        selectControl(context, "Animal", Object.keys(VARIANTS).map(name => [name, name]), animal, name => {
            animal = name;
            variantSelect.innerHTML = "";
            for (const [value, label] of variantOptions(name)) {
                const option = document.createElement("option");
                option.value = value;
                option.textContent = label;
                variantSelect.appendChild(option);
            }
            variantSelect.value = VARIANTS[name][0];
            void context.track(show(`${name}/${VARIANTS[name][0]}`));
        });
        // Put the animal picker first
        context.controls.prepend(context.controls.lastElementChild!);
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

/** Entities with a conditional dataset pass: [entity, state label, control label, tint label]. */
const STATES: Array<[string, string, string, string?]> = [
    ["creeper", "powered", "Charged"],
    ["sheep", "not_sheared", "Wool", "wool_color"],
    ["wolf", "tamed", "Collar", "collar_color"],
    ["cat", "tamed", "Collar", "collar_color"]
];
const TINTS: Array<[string, string]> = [
    ["ffffff", "White"], ["f9801d", "Orange"], ["3ab3da", "Light blue"], ["f38baa", "Pink"], ["80c71f", "Lime"], ["b02e26", "Red"]
];

const states: Example = {
    id: "entity-states",
    title: "States, passes and tints",
    description: "The dataset lists the extra draws vanilla adds to a model: a charged creeper's armor, a sheep's wool, spider eyes. Unconditional passes are drawn by default; states enable the others, and tint labels take colors.",
    renderer: ENTITY_RENDERER,
    placeholder: "/placeholder-block.png",
    async setup(context) {
        const { renderer, signal } = context;
        let [name, state, , tint] = STATES[0];
        let current: EntityObject | undefined;
        let enabled = true;
        let color = TINTS[1][0];

        const show = async () => {
            const model = await Entities.getEntity(new BasicAssetKey("minecraft", name), undefined, { when: enabled ? [state] : [] });
            if (!model || signal.aborted) return;
            const tints = tint ? { [tint]: parseInt(color, 16) } : undefined;
            const next = await renderer.scene.addEntity(model, { instanceMeshes: false, tints }) as EntityObject;
            if (signal.aborted) {
                removeEntity(next);
                return;
            }
            removeEntity(current);
            current = next;
            frameObject(renderer, current);
        };

        selectControl(context, "Entity", STATES.map(([entity, , label]) => [entity, `${entity} (${label.toLowerCase()})`]), name, value => {
            const entry = STATES.find(([entity]) => entity === value);
            if (!entry) return;
            [name, state, , tint] = entry;
            tintSelect.disabled = !tint;
            context.track(show()).catch(console.warn);
        });
        toggleControl(context, "State", enabled, value => {
            enabled = value;
            context.track(show()).catch(console.warn);
        });
        const tintSelect = selectControl(context, "Tint", TINTS, color, value => {
            color = value;
            context.track(show()).catch(console.warn);
        });
        tintSelect.disabled = !tint;
        await show();
    },
    code: {
        esm: `${esmRenderer("BasicAssetKey", "Entities")}

// Which states a model has: Entities.getPassList(key) lists its passes and their "when" labels
const creeper = await Entities.getEntity(new BasicAssetKey("minecraft", "creeper"), undefined, {
    when: ["powered"]       // draw the charged creeper's armor pass
});
await renderer.scene.addEntity(creeper!);

// Tint labels color a pass; the sheep's wool uses "wool_color"
const sheep = await Entities.getEntity(new BasicAssetKey("minecraft", "sheep"), undefined, { when: ["not_sheared"] });
await renderer.scene.addEntity(sheep!, { tints: { wool_color: 0xf9801d } });

// Or pick geometry layers directly, without any passes
const pig = await Entities.getEntity(new BasicAssetKey("minecraft", "pig"), undefined, { layers: ["main", "saddle"] });
const saddled = await renderer.scene.addEntity(pig!);
saddled.getLayerGroup("saddle")!.visible = false;   // each layer is a group`
    }
};

/** Mobs with keyframe animations in the dataset, and the animation shown first. */
const ANIMATED: Array<[string, string]> = [
    ["warden", "roar"], ["frog", "croak"], ["camel", "walk"], ["bat", "flying"], ["breeze", "idle"], ["armadillo", "roll_up"], ["sniffer", "sniffer_happy"]
];

const animated: Example = {
    id: "entity-animation",
    title: "Keyframe animations",
    description: "Mobs animated with vanilla's keyframe system carry those animations in the dataset. Play one on the entity and advance it from the renderer's frame callback.",
    renderer: ENTITY_RENDERER,
    placeholder: "/placeholder-block.png",
    async setup(context) {
        const { renderer, signal } = context;
        let [name, animationName] = ANIMATED[0];
        let current: EntityObject | undefined;
        let animations: Awaited<ReturnType<typeof Entities.getAnimations>>;
        let stopFrames: (() => void) | undefined;

        const play = () => {
            stopFrames?.();
            stopFrames = undefined;
            const animation = animations?.[animationName];
            if (!current || !animation) {
                current?.stopAnimation();
                renderer.dirty = true;
                return;
            }
            const entity = current;
            entity.playAnimation(animation, { loop: true });
            // Entities own no clock: the frame callback advances the animation and keeps the scene drawing
            stopFrames = renderer.onFrame(({ delta }) => entity.advanceAnimation(delta));
        };
        const show = async () => {
            const key = new BasicAssetKey("minecraft", name);
            const [model, nextAnimations] = await Promise.all([Entities.getEntity(key), Entities.getAnimations(key)]);
            if (!model || signal.aborted) return;
            const next = await renderer.scene.addEntity(model, { instanceMeshes: false }) as EntityObject;
            if (signal.aborted) {
                removeEntity(next);
                return;
            }
            stopFrames?.();
            removeEntity(current);
            current = next;
            animations = nextAnimations;
            const names = Object.keys(animations ?? {});
            if (!names.includes(animationName)) animationName = names[0] ?? "";
            animationSelect.innerHTML = "";
            for (const option of names) {
                const element = document.createElement("option");
                element.value = element.textContent = option;
                animationSelect.appendChild(element);
            }
            animationSelect.value = animationName;
            frameObject(renderer, current);
            play();
        };

        selectControl(context, "Entity", ANIMATED.map(([entity]) => [entity, entity]), name, value => {
            const entry = ANIMATED.find(([entity]) => entity === value);
            if (!entry) return;
            [name, animationName] = entry;
            context.track(show()).catch(console.warn);
        });
        const animationSelect = selectControl(context, "Animation", [[animationName, animationName]], animationName, value => {
            animationName = value;
            play();
        });
        await show();

        return () => {
            stopFrames?.();
        };
    },
    code: {
        esm: `${esmRenderer("BasicAssetKey", "Entities")}

const key = new BasicAssetKey("minecraft", "warden");
const model = await Entities.getEntity(key);
const warden = await renderer.scene.addEntity(model!);

// undefined for mobs without keyframe animations
const animations = await Entities.getAnimations(key);
warden.playAnimation(animations!.roar, { loop: true });

// The entity owns no clock; advance it once per frame
const stop = renderer.onFrame(({ delta }) => warden.advanceAnimation(delta));

// Later: stop the frame callback and restore the default pose
stop();
warden.stopAnimation();`
    }
};

export const entities: ExampleGroup = {
    id: "entities",
    title: "Entities",
    lead: "Mobs and block entities from a per-version geometry dataset extracted from the game, with texture variants, render passes, and keyframe animations.",
    examples: [{ ...mob, title: "Mobs" }, blockEntity, variants, states, animated]
};
