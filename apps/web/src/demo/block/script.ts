import { BlockObject, BlockStates, isSceneObject, type BlockState, type BlockStateProperties, type MultipartCondition } from "minerender";
import { Box3 } from "three";
import { Playground, type DemoContext, type DemoContent } from "../../playground/Playground";
import { button, group, input, note, select, suggestions } from "../../playground/controls";
import { assetKey, modelControls, modelDefaults, modelOptions, type ModelSettings } from "../../playground/models";

interface BlockSettings extends ModelSettings {
    block: string;
    properties: BlockStateProperties;
}

const defaults: BlockSettings = { ...modelDefaults, block: "minecraft:stone", properties: {} };
const app = new Playground<BlockSettings>({
    title: "Blocks",
    defaults,
    renderer: { camera: { position: [50, 35, 50] } },
    presets: {
        grass: { label: "Grass block (tinted)", state: { block: "minecraft:grass_block" } },
        fence: { label: "Oak fence (multipart)", state: { block: "minecraft:oak_fence", properties: { north: "true", east: "true", south: "false", west: "false", waterlogged: "false" } } },
        stairs: { label: "Oak stairs (UV lock)", state: { block: "minecraft:oak_stairs", properties: { facing: "west", half: "bottom", shape: "outer_left", waterlogged: "false" } } },
        chest: { label: "Chest (block entity)", state: { block: "minecraft:chest" } },
        bed: { label: "Red bed (block entity)", state: { block: "minecraft:red_bed", properties: { part: "head", facing: "south", occupied: "false" } } },
        skull: { label: "Skeleton skull (block entity)", state: { block: "minecraft:skeleton_skull", properties: { rotation: "4" } } },
        sign: { label: "Oak sign (block entity)", state: { block: "minecraft:oak_sign", properties: { rotation: "8", waterlogged: "false" } } },
        bell: { label: "Bell (block model + entity)", state: { block: "minecraft:bell", properties: { attachment: "ceiling", facing: "south", powered: "false" } } }
    },
    load,
    code(state) {
        const key = assetKey(state.block, "blockstates");
        return `const state = await MineRender.BlockStates.get(new MineRender.AssetKey(${JSON.stringify(key.namespace)}, ${JSON.stringify(key.path)}, "blockstates"));
await renderer.scene.addBlock(state, ${JSON.stringify({ ...modelOptions(state), initialState: state.properties }, null, 2)});\n`;
    }
});

const blockGroup = group(app.controls, "Block");
const blockInput = input(blockGroup, "Block ID", app.state.block);
blockInput.id = "block-input";
blockInput.addEventListener("change", () => void app.update({ block: blockInput.value.trim(), properties: {} }));
button(blockGroup, "Load", () => void app.update({ block: blockInput.value.trim(), properties: {} }));
const propertyGroup = group(app.controls, "Blockstate properties");
const propertyFields = document.createElement("div");
propertyGroup.append(propertyFields);
const propertyInfo = note(propertyGroup, "");
button(propertyGroup, "Reset to defaults", () => void app.update({ properties: {} }));
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
    return {
        object: visuals.length === 1 ? visuals[0] : undefined,
        bounds,
        activate() {
            blockInput.value = state.block;
            suggestions(blockInput, list);
            syncModelControls();
            propertyFields.replaceChildren();
            for (const [name, values] of Object.entries(choices)) {
                const current = `${block.state[name] ?? ""}`;
                const picker = select(propertyFields, name, [...new Set([current, ...values])].map(value => [value, value || "(unset)"]), current);
                picker.addEventListener("change", () => void app.update({ properties: { ...block.state, [name]: picker.value } }));
            }
            propertyInfo.textContent = Object.keys(choices).length ? "" : "This block has no state properties.";
            Object.assign(window, { block });
        }
    };
}

function validateProperties(value: BlockStateProperties): BlockStateProperties {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Blockstate properties must be an object.");
    for (const [name, property] of Object.entries(value)) {
        if (!/^[a-z0-9_]+$/.test(name) || typeof property !== "string" || !/^[a-z0-9_-]+$/.test(property)) throw new Error(`Invalid blockstate property: ${name}`);
    }
    return value;
}

/** Collect property values from the default states plus every variant and multipart condition. */
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

Object.assign(window, { setBlock: (block: string, properties: BlockStateProperties = {}) => app.update({ block, properties }) });
void app.start();
