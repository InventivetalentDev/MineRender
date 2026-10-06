import { AssetKey, BlockObject, BlockStates } from "minerender";
import type { Example, ExampleContext, ExampleGroup } from "./types";
import { esmRenderer, fillList, selectControl, textControl } from "./shared";
import { installResourcePack, resourcePackName } from "../resourcePack";

const BLOCK_RENDERER = {
    camera: {
        position: [26, 20, 30] as [number, number, number],
        lookingAt: [0, 0, 0] as [number, number, number]
    }
};

const upload: Example = {
    id: "resourcepack-zip",
    title: "Load a resource pack ZIP",
    description: "Pick a resource pack ZIP. It becomes the highest-priority asset source for every preview on this page; anything it does not contain falls back to the vanilla assets.",
    renderer: BLOCK_RENDERER,
    placeholder: "/placeholder-block.png",
    async setup(context) {
        const { renderer, signal } = context;
        let current: BlockObject | undefined;
        let blockName = "grass_block";

        const show = async () => {
            const state = await BlockStates.get(AssetKey.parse("blockstates", blockName));
            if (!state || signal.aborted) return;
            const next = await renderer.scene.addBlock(state) as BlockObject;
            if (signal.aborted) {
                next.removeFromScene();
                return;
            }
            current?.removeFromScene();
            current = next;
            renderer.dirty = true;
        };

        await show();

        const picker = document.createElement("label");
        picker.className = "viewport-control viewport-control-file";
        picker.innerHTML = `<span>Resource pack</span><input type="file" accept=".zip,application/zip">`;
        const input = picker.querySelector("input")!;
        input.addEventListener("change", () => {
            const file = input.files?.[0];
            // Installing the pack rebuilds every live preview, including this one.
            if (file) context.track(installResourcePack(file), "Installing resource pack…").catch(console.error);
        });
        context.controls.appendChild(picker);
        if (resourcePackName()) {
            const active = document.createElement("span");
            active.className = "viewport-control viewport-status";
            active.textContent = `Using ${resourcePackName()}`;
            context.controls.appendChild(active);
        }
        const blockInput = textControl(context, "Block", blockName, name => {
            if (!name) return;
            blockName = name;
            context.track(show()).catch(console.warn);
        }, []);
        fillList(blockInput, () => BlockStates.getList(), entry => entry.replace(/\.json$/, ""));
    },
    code: {
        esm: `${esmRenderer("ArchiveAssetSource", "AssetKey", "AssetLoader", "BlockStates", "BrowserArchiveProxy", "Caching", "Models")}

const file = (document.getElementById("pack") as HTMLInputElement).files![0];
const archive = new BrowserArchiveProxy(file);
await archive.getEntries();

// Added sources have the highest priority; vanilla assets stay as the fallback.
AssetLoader.addSource("my-pack", new ArchiveAssetSource(archive));
Caching.clear();
await Models.clearCache();

const state = await BlockStates.get(AssetKey.parse("blockstates", "grass_block"));
await renderer.scene.addBlock(state!);`
    }
};

const VERSIONS = ["1.13.2", "1.14.4", "1.16.5", "1.18.2", "1.20.1"];
const COMPARE_BLOCKS = ["furnace", "oak_planks", "cobblestone", "crafting_table", "bookshelf", "stone", "diamond_ore", "oak_log", "sand", "gravel"];

function versionedKey(block: string, version?: string): AssetKey {
    const root = version ? `https://assets.mcasset.cloud/${version}` : undefined;
    return new AssetKey("minecraft", block, "blockstates", undefined, "assets", ".json", root);
}

const versions: Example = {
    id: "resourcepack-versions",
    title: "Compare game versions",
    description: "Every asset key can carry its own root, so one scene can mix game versions. Left: the older version. Right: the current default.",
    renderer: {
        camera: {
            position: [34, 24, 44] as [number, number, number],
            lookingAt: [0, 0, 0] as [number, number, number]
        }
    },
    placeholder: "/placeholder-block.png",
    async setup(context: ExampleContext) {
        const { renderer, signal } = context;
        let block = COMPARE_BLOCKS[0];
        let version = VERSIONS[0];
        let placed: BlockObject[] = [];

        const show = async () => {
            const states = await Promise.all([BlockStates.get(versionedKey(block, version)), BlockStates.get(versionedKey(block))]);
            if (signal.aborted) return;
            const next: BlockObject[] = [];
            for (const [index, state] of states.entries()) {
                if (!state) continue;
                const object = await renderer.scene.addBlock(state) as BlockObject;
                object.setPosition(object.getPosition().set(index === 0 ? -11 : 11, 0, 0));
                next.push(object);
            }
            if (signal.aborted) {
                next.forEach(object => object.removeFromScene());
                return;
            }
            placed.forEach(object => object.removeFromScene());
            placed = next;
            renderer.dirty = true;
        };

        await show();
        selectControl(context, "Older version", VERSIONS.map(v => [v, v]), version, value => {
            version = value;
            context.track(show()).catch(console.warn);
        });
        selectControl(context, "Block", COMPARE_BLOCKS.map(b => [b, b]), block, value => {
            block = value;
            context.track(show()).catch(console.warn);
        });
    },
    code: {
        esm: `${esmRenderer("AssetKey", "AssetLoader", "BlockStates")}

// AssetLoader.setVersion("1.20.1") switches everything; a key's own root pins just that asset
const old = new AssetKey("minecraft", "furnace", "blockstates", undefined, "assets", ".json",
    "https://assets.mcasset.cloud/1.13.2");
const current = new AssetKey("minecraft", "furnace", "blockstates");

const before = await renderer.scene.addBlock((await BlockStates.get(old))!);
before.setPosition(before.getPosition().set(-11, 0, 0));

const after = await renderer.scene.addBlock((await BlockStates.get(current))!);
after.setPosition(after.getPosition().set(11, 0, 0));`
    }
};

export const resourcepacks: ExampleGroup = {
    id: "resource-packs",
    title: "Resource packs & asset sources",
    lead: "An ordered list of asset sources replaces V1's single asset root. Resource packs, CDNs and custom namespaces layer on top of the vanilla assets.",
    examples: [upload, versions],
    notes: [
        "ZIP sources are browser-only. In Node, add a HostedAssetSource or implement the AssetSource interface."
    ]
};
