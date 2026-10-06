import { BlockObject, BlockStates, isSceneObject, type BlockState, type BlockStateProperties, type MultipartCondition } from "minerender";
import { Box3 } from "three";
import { Playground, type DemoContext, type DemoContent } from "../../playground/Playground";
import { assetKey, button, group, modelControls, modelDefaults, modelOptions, note, select, suggestions, textInput, type ModelSettings } from "./modelControls";

interface BlockSettings extends ModelSettings {
    block: string;
    properties: BlockStateProperties;
}

const defaults: BlockSettings = { ...modelDefaults, block: "minecraft:stone", properties: {} };
const app = new Playground<BlockSettings>({
    title: "Block playground",
    defaults,
    renderer: { camera: { position: [50, 35, 50] } },
    presets: {
        stone: { label: "Stone", state: defaults },
        grass: { label: "Grass and tint colors", state: { ...defaults, block: "minecraft:grass_block" } },
        fence: { label: "Multipart fence", state: { ...defaults, block: "minecraft:oak_fence", properties: { north: "true", east: "true", south: "false", west: "false", waterlogged: "false" } } },
        stairs: { label: "UV-locked stairs", state: { ...defaults, block: "minecraft:oak_stairs", properties: { facing: "west", half: "bottom", shape: "outer_left", waterlogged: "false" } } },
        chest: { label: "Chest block entity", state: { ...defaults, block: "minecraft:chest" } },
        bed: { label: "Bed block entity", state: { ...defaults, block: "minecraft:red_bed", properties: { part: "head", facing: "south", occupied: "false" } } },
        skull: { label: "Skull block entity", state: { ...defaults, block: "minecraft:skeleton_skull", properties: { rotation: "4" } } },
        sign: { label: "Sign block entity", state: { ...defaults, block: "minecraft:oak_sign", properties: { rotation: "8", waterlogged: "false" } } },
        bell: { label: "Bell with block model", state: { ...defaults, block: "minecraft:bell", properties: { attachment: "ceiling", facing: "south", powered: "false" } } }
    },
    load,
    code(state) {
        const key = assetKey(state.block, "blockstates");
        return `const state = await MineRender.BlockStates.get(new MineRender.AssetKey(${JSON.stringify(key.namespace)}, ${JSON.stringify(key.path)}, "blockstates"));
await renderer.scene.addBlock(state, ${JSON.stringify({ ...modelOptions(state), initialState: state.properties }, null, 2)});`;
    }
});

const assets = group(app.controls, "Block");
const input = textInput(assets, "Block ID (namespace:name)", app.state.block, block => void app.update({ block, properties: {} }));
input.id = "block-input";
button(assets, "Load block", () => void app.update({ block: input.value.trim(), properties: {} }));
const propertyPanel = group(app.controls, "Blockstate properties");
const propertyFields = document.createElement("div");
propertyPanel.append(propertyFields);
button(propertyPanel, "Reset blockstate defaults", () => void app.update({ properties: {} }));
const propertyInfo = note(propertyPanel, "Load a block to edit its state.");
const syncModelControls = modelControls(app);
syncModelControls();

async function load(ctx: DemoContext, state: BlockSettings): Promise<DemoContent> {
    const key = assetKey(state.block, "blockstates");
    const [blockState, list] = await Promise.all([BlockStates.get(key), BlockStates.getList().catch(() => [])]);
    if (!blockState) throw new Error(`Blockstate not found: ${state.block}`);
    const properties = validateProperties(state.properties);
    const choices = await propertyChoices(blockState);
    const block = new BlockObject(blockState, { ...modelOptions(state), initialState: properties });
    block.scene = ctx.renderer.scene;
    ctx.onCleanup(() => {
        block.removeFromScene();
        block.dispose();
    });
    await block.init();
    const visuals = ctx.renderer.scene.children.filter(isSceneObject);
    const bounds = new Box3();
    for (const visual of visuals) bounds.union(new Box3().setFromObject(visual));
    const restore = () => {
        input.value = state.block;
        syncModelControls();
        propertyFields.replaceChildren();
        for (const [name, values] of Object.entries(choices)) {
            const current = `${block.state[name] ?? ""}`;
            const options = Object.fromEntries([...new Set([current, ...values])].map(value => [value, value || "Unset"]));
            select(propertyFields, name, options, current, value => {
                void app.update({ properties: { ...block.state, [name]: value } });
            });
        }
        propertyInfo.textContent = Object.keys(choices).length ? "Changes apply before the block's model loads." : "This block has no configurable state properties.";
        const visual = visuals[0];
        if (visual) {
            let instance;
            visual.traverse(child => instance ??= visual.getInstanceReference(child, 0));
            app.inspector?.selectObject(visual, undefined, instance);
        }
        Object.assign(window, { block });
        suggestions(input, list);
    };
    return {
        object: visuals[0],
        bounds,
        activate: restore,
        restore
    };
}

function validateProperties(value: BlockStateProperties): BlockStateProperties {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Blockstate properties must be a JSON object.");
    return Object.fromEntries(Object.entries(value).map(([name, value]) => {
        if (!/^[a-z0-9_]+$/.test(name) || typeof value !== "string" || !/^[a-z0-9_-]+$/.test(value)) {
            throw new Error(`Invalid blockstate property: ${name}`);
        }
        return [name, value];
    }));
}

async function propertyChoices(blockState: BlockState): Promise<Record<string, string[]>> {
    const result: Record<string, Set<string>> = {};
    const add = (name: string, values: unknown[]) => {
        result[name] ??= new Set();
        values.forEach(value => result[name].add(String(value)));
    };
    const defaults = blockState.key ? await BlockStates.getDefaultState(blockState.key) : undefined;
    for (const [name, property] of Object.entries(defaults ?? {})) add(name, property.values);
    for (const variant of Object.keys(blockState.variants ?? {})) {
        for (const property of variant.split(",")) {
            const [name, value] = property.split("=");
            if (name && value !== undefined) add(name, value.split("|"));
        }
    }
    const condition = (when: MultipartCondition) => {
        for (const [name, value] of Object.entries(when)) {
            if (Array.isArray(value)) value.forEach(condition);
            else {
                const values = String(value).split("|");
                if (values.includes("true") || values.includes("false")) values.push("false", "true");
                add(name, values);
            }
        }
    };
    for (const part of blockState.multipart ?? []) if (part.when) condition(part.when);
    return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)).map(([name, values]) => [name, [...values]]));
}

Object.assign(window, { setBlock: (block: string) => app.update({ block, properties: {} }) });
void app.start();
