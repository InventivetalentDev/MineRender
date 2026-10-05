import { AssetKey, DisplayPosition, ModelObject, Models } from "minerender";
import type { Example, ExampleGroup } from "./types";
import { esmRenderer, fillList, scriptSnippet, selectControl, textControl } from "./shared";

export const ITEM_RENDERER = {
    camera: {
        position: [8, 6, 34] as [number, number, number],
        lookingAt: [0, 0, 0] as [number, number, number]
    }
};

function itemKey(name: string): AssetKey {
    return new AssetKey("minecraft", name, "models", "item", "assets");
}

export const generated: Example = {
    id: "item-generated",
    title: "Item",
    description: "Flat item models get their 16×16 texture extruded into a one-pixel-thick model, the same way the game does it.",
    renderer: ITEM_RENDERER,
    placeholder: "/placeholder-block.png",
    async setup(context) {
        const { renderer, signal } = context;
        let current: ModelObject | undefined;
        const show = async (name: string) => {
            const model = await Models.getMerged(itemKey(name));
            if (!model) throw new Error(`Unknown item "${name}"`);
            if (signal.aborted) return;
            // Without instancing the scene returns the ModelObject itself, which can be removed again.
            const next = await renderer.scene.addModel(model, { instanceMeshes: false }) as ModelObject;
            if (signal.aborted) {
                next.removeFromScene();
                return;
            }
            current?.removeFromScene();
            current?.disposeAndRemoveAllChildren();
            current = next;
        };
        await show("diamond_sword");
        const input = textControl(context, "Item", "diamond_sword", name => {
            if (name) show(name).catch(console.warn);
        }, []);
        fillList(input, () => Models.getItemList(), entry => entry.replace(/\.json$/, ""));
    },
    code: {
        esm: `${esmRenderer("AssetKey", "Models")}

const model = await Models.getMerged(
    new AssetKey("minecraft", "diamond_sword", "models", "item", "assets")
);
const sword = await renderer.scene.addModel(model!);`,
        script: scriptSnippet(`MineRender.Models.getMerged(
    new MineRender.AssetKey("minecraft", "diamond_sword", "models", "item", "assets")
).then(model => renderer.scene.addModel(model));`)
    }
};

const POSES: Array<[string, string]> = [
    [DisplayPosition.GUI, "Inventory (gui)"],
    [DisplayPosition.GROUND, "Dropped (ground)"],
    [DisplayPosition.FIXED, "Item frame (fixed)"],
    [DisplayPosition.THIRDPERSON_RIGHTHAND, "Held (thirdperson_righthand)"],
    [DisplayPosition.HEAD, "Worn (head)"],
    ["none", "No pose"]
];

const poses: Example = {
    id: "item-display",
    title: "Display poses",
    description: "Models carry display transforms for each context the game shows them in. Pick one to apply its rotation, translation, and scale.",
    renderer: {
        camera: {
            position: [10, 8, 40] as [number, number, number],
            lookingAt: [0, 0, 0] as [number, number, number]
        }
    },
    placeholder: "/placeholder-block.png",
    async setup(context) {
        const { renderer, signal } = context;
        const model = await Models.getMerged(itemKey("diamond_pickaxe"));
        if (!model || signal.aborted) return;
        let current: ModelObject | undefined;
        const show = async (pose: string) => {
            const next = await renderer.scene.addModel(model, {
                instanceMeshes: false,
                displayPosition: pose === "none" ? undefined : pose as DisplayPosition
            }) as ModelObject;
            if (signal.aborted) {
                next.removeFromScene();
                return;
            }
            current?.removeFromScene();
            current?.disposeAndRemoveAllChildren();
            current = next;
            renderer.dirty = true;
        };
        await show(DisplayPosition.GUI);
        selectControl(context, "Pose", POSES, DisplayPosition.GUI, pose => void show(pose).catch(console.warn));
    },
    code: {
        esm: `${esmRenderer("AssetKey", "DisplayPosition", "Models")}

const model = await Models.getMerged(
    new AssetKey("minecraft", "diamond_pickaxe", "models", "item", "assets")
);

// Apply the model's own "gui" display transform
await renderer.scene.addModel(model!, { displayPosition: DisplayPosition.GUI });`
    }
};

const blockItem: Example = {
    id: "item-block",
    title: "Block items",
    description: "Items that reference a block model render as the full 3D block.",
    renderer: {
        camera: {
            position: [24, 18, 28] as [number, number, number],
            lookingAt: [0, 0, 0] as [number, number, number]
        }
    },
    placeholder: "/placeholder-block.png",
    async setup({ renderer, signal }) {
        const model = await Models.getMerged(itemKey("enchanting_table"));
        if (!model || signal.aborted) return;
        await renderer.scene.addModel(model);
    },
    code: {
        esm: `${esmRenderer("AssetKey", "Models")}

const model = await Models.getMerged(
    new AssetKey("minecraft", "enchanting_table", "models", "item", "assets")
);
await renderer.scene.addModel(model!);`
    }
};

const custom: Example = {
    id: "item-custom",
    title: "Custom model JSON",
    description: "Any Java-edition model JSON works, including resource-pack style custom models. Parents and textures resolve through the asset loader.",
    renderer: {
        camera: {
            position: [26, 20, 30] as [number, number, number],
            lookingAt: [0, 0, 0] as [number, number, number]
        }
    },
    placeholder: "/placeholder-block.png",
    async setup({ renderer, signal }) {
        const model = await Models.getMerged(new AssetKey("minecraft", "lantern", "models", "block", "assets"));
        if (!model || signal.aborted) return;
        const custom = {
            ...model,
            elements: [
                ...(model.elements ?? []),
                { from: [6, 0, 6], to: [10, 2, 10], faces: { up: { texture: "#lantern" }, down: { texture: "#lantern" }, north: { texture: "#lantern" }, south: { texture: "#lantern" }, east: { texture: "#lantern" }, west: { texture: "#lantern" } } }
            ]
        };
        await renderer.scene.addModel(custom as typeof model);
    },
    code: {
        esm: `${esmRenderer("AssetKey", "Models")}

// Start from a vanilla model and add an element
const lantern = await Models.getMerged(
    new AssetKey("minecraft", "lantern", "models", "block", "assets")
);
const custom = {
    ...lantern!,
    elements: [
        ...lantern!.elements!,
        {
            from: [6, 0, 6], to: [10, 2, 10],
            faces: { up: { texture: "#lantern" }, down: { texture: "#lantern" },
                     north: { texture: "#lantern" }, south: { texture: "#lantern" },
                     east: { texture: "#lantern" }, west: { texture: "#lantern" } }
        }
    ]
};
await renderer.scene.addModel(custom);`
    }
};

export const items: ExampleGroup = {
    id: "items",
    title: "Items & models",
    lead: "Item definitions, generated item models, block items, and hand-written model JSON all go through the same model pipeline.",
    examples: [{ ...generated, title: "Generated item models" }, poses, blockItem, custom],
    notes: [
        "Item previews use the GUI display context. Composite item renderers (player heads, shields, tinted items) are not supported yet."
    ]
};
