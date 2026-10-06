import { ArchiveAssetSource, AssetLoader, BlockStates, BrowserArchiveProxy, Caching, ModelTextures, Models } from "minerender";

/**
 * One resource pack for the whole page. Installing it puts the ZIP ahead of the vanilla
 * assets for every example; listeners (the viewports) rebuild their scenes afterwards.
 *
 * The library keeps persisted blockstates and models from a pack apart from the vanilla
 * entries, so only the in-memory caches need clearing when the pack changes. The one-time
 * generation clear below removes entries that older builds persisted under vanilla keys.
 */
const SOURCE_KEY = "site-resourcepack";
/** Bump to clear every visitor's persistent caches once. */
const CACHE_GENERATION = "3";
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

/** Call once before any example loads: drops persisted entries written by older builds. */
export async function recoverPersistentCaches(): Promise<void> {
    if (readFlag(CACHE_GENERATION_KEY) === CACHE_GENERATION) return;
    await clearPersistentCaches();
    writeFlag(CACHE_GENERATION_KEY, CACHE_GENERATION);
}

export function onResourcePackChange(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function resourcePackName(): string | undefined {
    return currentName;
}

async function clearPersistentCaches(): Promise<void> {
    Caching.clear();
    await Promise.all([Models.clearCache(), BlockStates.clearCache(), ModelTextures.clearCache()]);
}

export async function installResourcePack(file: File): Promise<void> {
    const proxy = new BrowserArchiveProxy(file);
    await proxy.getEntries();
    AssetLoader.removeSource(SOURCE_KEY);
    AssetLoader.addSource(SOURCE_KEY, new ArchiveAssetSource(proxy));
    // Persistent entries are scoped by source; only the in-memory caches hold vanilla results.
    Caching.clear();
    currentName = file.name;
    listeners.forEach(listener => listener());
}

export async function removeResourcePack(): Promise<void> {
    if (!AssetLoader.removeSource(SOURCE_KEY)) return;
    Caching.clear();
    currentName = undefined;
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
