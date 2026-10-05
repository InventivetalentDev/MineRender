import { ArchiveAssetSource, AssetLoader, BlockStates, BrowserArchiveProxy, Caching, Models } from "minerender";

/**
 * One resource pack for the whole page. Installing it puts the ZIP ahead of the vanilla
 * assets for every example; listeners (the viewports) rebuild their scenes afterwards.
 */
const SOURCE_KEY = "site-resourcepack";
const listeners = new Set<() => void>();
let currentName: string | undefined;

export function onResourcePackChange(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function resourcePackName(): string | undefined {
    return currentName;
}

async function clearCaches(): Promise<void> {
    Caching.clear();
    await Models.clearCache();
    await BlockStates.clearCache();
}

export async function installResourcePack(file: File): Promise<void> {
    const proxy = new BrowserArchiveProxy(file);
    await proxy.getEntries();
    AssetLoader.removeSource(SOURCE_KEY);
    AssetLoader.addSource(SOURCE_KEY, new ArchiveAssetSource(proxy));
    await clearCaches();
    currentName = file.name;
    listeners.forEach(listener => listener());
}

export async function removeResourcePack(): Promise<void> {
    if (!AssetLoader.removeSource(SOURCE_KEY)) return;
    await clearCaches();
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
