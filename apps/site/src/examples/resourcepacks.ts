import { ArchiveAssetSource, AssetKey, AssetLoader, BlockObject, BlockStates, BrowserArchiveProxy, Caching, Models } from "minerender";
import type { Example, ExampleContext, ExampleGroup } from "./types";
import { esmRenderer } from "./shared";

const SOURCE_KEY = "site-resourcepack";

const BLOCK_RENDERER = {
    camera: {
        position: [26, 20, 30] as [number, number, number],
        lookingAt: [0, 0, 0] as [number, number, number]
    }
};

async function resetSources(): Promise<void> {
    AssetLoader.removeSource(SOURCE_KEY);
    Caching.clear();
    await Models.clearCache();
    await BlockStates.clearCache();
}

const upload: Example = {
    id: "resourcepack-zip",
    title: "Load a resource pack ZIP",
    description: "Drop a resource pack. It becomes the highest-priority asset source; anything it does not contain falls back to the vanilla CDN.",
    renderer: BLOCK_RENDERER,
    placeholder: "/placeholder-block.png",
    async setup(context) {
        const { renderer, signal } = context;
        let current: BlockObject | undefined;

        const show = async (name: string) => {
            const state = await BlockStates.get(AssetKey.parse("blockstates", name));
            if (!state || signal.aborted) return;
            const next = await renderer.scene.addBlock(state) as BlockObject;
            if (signal.aborted) {
                next.removeFromScene();
                return;
            }
            current?.removeFromScene();
            current = next;
        };

        await show("grass_block");

        const picker = document.createElement("label");
        picker.className = "viewport-control viewport-control-file";
        picker.innerHTML = `<span>Resource pack</span><input type="file" accept=".zip,application/zip">`;
        const input = picker.querySelector("input")!;
        input.addEventListener("change", async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                const proxy = new BrowserArchiveProxy(file);
                await proxy.getEntries();
                if (signal.aborted) return;
                await resetSources();
                AssetLoader.addSource(SOURCE_KEY, new ArchiveAssetSource(proxy));
                await show("grass_block");
            } catch (error) {
                console.error(error);
            }
        });
        context.controls.appendChild(picker);

        return () => {
            resetSources().catch(console.warn);
        };
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

const LEGACY_ROOT = "https://assets.mcasset.cloud/1.16.5";

const hosted: Example = {
    id: "resourcepack-hosted",
    title: "Asset roots & game versions",
    description: "Every asset key can carry its own root, so a page can mix game versions. Cache keys include the root and never collide.",
    renderer: BLOCK_RENDERER,
    placeholder: "/placeholder-block.png",
    async setup(context: ExampleContext) {
        const { renderer, signal } = context;
        const key = new AssetKey("minecraft", "furnace", "blockstates", undefined, "assets", ".json", LEGACY_ROOT);
        const state = await BlockStates.get(key);
        if (!state || signal.aborted) return;
        await renderer.scene.addBlock(state);
    },
    code: {
        esm: `${esmRenderer("AssetKey", "AssetLoader", "BlockStates", "HostedAssetSource")}

// Default root for keys without one (1.21.11 assets)
console.log(AssetLoader.ROOT);

// Or register another host as a source; added sources are searched first
AssetLoader.addSource("mirror", new HostedAssetSource("https://example.com/mc-assets/1.21.11"));

// Or pin a single key to a different version
const key = new AssetKey("minecraft", "furnace", "blockstates", undefined, "assets", ".json",
    "${LEGACY_ROOT}");
const state = await BlockStates.get(key);
await renderer.scene.addBlock(state!);`
    }
};

export const resourcepacks: ExampleGroup = {
    id: "resource-packs",
    title: "Resource packs & asset sources",
    lead: "An ordered asset source registry replaces V1's single asset root: layer resource packs, CDNs, and custom namespaces.",
    examples: [upload, hosted],
    notes: [
        "ZIP sources are browser-only today; Node consumers can add HostedAssetSources or implement the AssetSource interface."
    ]
};
