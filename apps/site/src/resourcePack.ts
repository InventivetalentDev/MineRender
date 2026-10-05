import { ArchiveAssetSource, AssetLoader, BlockStates, BrowserArchiveProxy, Caching, ModelTextures, Models } from "minerender";

/**
 * One resource pack for the whole page. Installing it puts the ZIP ahead of the vanilla
 * assets for every example; listeners (the viewports) rebuild their scenes afterwards.
 *
 * The library persists blockstates, models and texture metadata in IndexedDB under keys that
 * do not include the source they came from. While a pack is active, its files land in that
 * cache and survive a reload without the pack, after which the page requests the pack's
 * variant files (for example "grass_block7") from the vanilla CDN. So the persistent caches
 * are cleared whenever a pack is installed or removed, and once more on the next page load
 * if the previous session ended with a pack active.
 */
const SOURCE_KEY = "site-resourcepack";
const PACK_ACTIVE_FLAG = "minerender-site-pack-active";
/** Bump to clear every visitor's persistent caches once, for example after a poisoning bug. */
const CACHE_GENERATION = "2";
const CACHE_GENERATION_KEY = "minerender-site-cache-generation";
const listeners = new Set<() => void>();
let currentName: string | undefined;

function readFlag(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeFlag(key: string, value: string | null): void {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    } catch {
        // Storage can be unavailable; the caches are then cleared on every load anyway.
    }
}

/** Call once before any example loads: drops caches that may hold another session's pack. */
export async function recoverPersistentCaches(): Promise<void> {
    const packWasActive = readFlag(PACK_ACTIVE_FLAG) === "1";
    const staleGeneration = readFlag(CACHE_GENERATION_KEY) !== CACHE_GENERATION;
    if (!packWasActive && !staleGeneration) return;
    await clearCaches();
    writeFlag(PACK_ACTIVE_FLAG, null);
    writeFlag(CACHE_GENERATION_KEY, CACHE_GENERATION);
}

export function onResourcePackChange(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function resourcePackName(): string | undefined {
    return currentName;
}

async function clearCaches(): Promise<void> {
    Caching.clear();
    await Promise.all([Models.clearCache(), BlockStates.clearCache(), ModelTextures.clearCache()]);
}

export async function installResourcePack(file: File): Promise<void> {
    const proxy = new BrowserArchiveProxy(file);
    await proxy.getEntries();
    AssetLoader.removeSource(SOURCE_KEY);
    AssetLoader.addSource(SOURCE_KEY, new ArchiveAssetSource(proxy));
    await clearCaches();
    currentName = file.name;
    writeFlag(PACK_ACTIVE_FLAG, "1");
    listeners.forEach(listener => listener());
}

export async function removeResourcePack(): Promise<void> {
    if (!AssetLoader.removeSource(SOURCE_KEY)) return;
    await clearCaches();
    currentName = undefined;
    writeFlag(PACK_ACTIVE_FLAG, null);
    listeners.forEach(listener => listener());
}

/** Wires a file input and a remove button to the shared pack. */
export function bindResourcePackControls(input: HTMLInputElement, remove: HTMLButtonElement, status: HTMLElement): void {
    const render = () => {
        status.textContent = currentName ? `${currentName} is active for every preview.` : "";
        remove.classList.toggle("is-hidden", !currentName);
    };
    input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) return;
        status.textContent = `Reading ${file.name}…`;
        try {
            await installResourcePack(file);
        } catch (error) {
            console.error(error);
            status.textContent = `Could not read ${file.name}. Is it a resource pack ZIP?`;
            return;
        }
        render();
    });
    remove.addEventListener("click", async () => {
        input.value = "";
        await removeResourcePack();
        render();
    });
    onResourcePackChange(render);
    render();
}
