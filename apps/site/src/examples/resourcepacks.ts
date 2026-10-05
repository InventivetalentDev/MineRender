import { AssetKey, BlockObject, BlockStates } from "minerender";
import type { Example, ExampleGroup } from "./types";
import { esmRenderer, fillList, textControl } from "./shared";
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
            if (file) installResourcePack(file).catch(console.error);
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
            show().catch(console.warn);
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

export const resourcepacks: ExampleGroup = {
    id: "resource-packs",
    title: "Resource packs & asset sources",
    lead: "An ordered list of asset sources replaces V1's single asset root. Resource packs, CDNs and custom namespaces layer on top of the vanilla assets.",
    examples: [upload],
    notes: [
        "ZIP sources are browser-only. In Node, add a HostedAssetSource or implement the AssetSource interface."
    ]
};
