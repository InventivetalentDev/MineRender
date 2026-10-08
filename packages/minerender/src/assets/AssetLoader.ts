import { Maybe } from "../util/util";
import { MinecraftAsset } from "../MinecraftAsset";
import { DEFAULT_ROOT } from "./AssetDefaults";
import { AssetKey } from "./AssetKey";
import { prefix } from "../util/log";
import { AssetSource } from "./source/AssetSource";
import { AssetParser } from "./source/parser/AssetParsers";
import { HostedAssetSource } from "./source";
import { AssetContext } from "./AssetContext";

const p = prefix("AssetLoader");


/** Loads assets from a shared, ordered registry of hosted sources and resource packs. */
export class AssetLoader {

    /** Default asset base URL. Use {@link setVersion} to select a Minecraft version. */
    static ROOT: string = DEFAULT_ROOT;

    private static _SOURCES: AssetSourceReference[] = [];

    private static _context?: AssetContext;

    /** Fixed configuration for the current global registry. Existing contexts retain their sources. */
    public static get context(): AssetContext {
        const previous = this._context;
        if (!previous || previous.root !== this.ROOT || previous.sources.length !== this._SOURCES.length
            || previous.sources.some((entry, i) => entry.key !== this._SOURCES[i].key || entry.source !== this._SOURCES[i].source)) {
            previous?.clearCache();
            this._context = AssetContext.capture(this.ROOT, this._SOURCES);
        }
        return this._context!;
    }

    public static get version(): string {
        return this.ROOT.substring(this.ROOT.lastIndexOf("/") + 1);
    }

    /** Selects an mcasset.cloud version and invalidates the previous global context's in-memory entries. */
    public static setVersion(version: string): void {
        this.invalidateContext();
        this.ROOT = `https://assets.mcasset.cloud/${version}`;
        const source = new HostedAssetSource(this.ROOT, { retryDefaults: false });
        const index = this._SOURCES.findIndex(s => s.key === "mcassets");
        if (index !== -1) {
            this._SOURCES[index] = { key: "mcassets", source };
        } else {
            this.addSource("mcassets", source);
        }
    }

    /**
     * Scope for persistent cache keys. Empty for the default vanilla source order; otherwise
     * includes the complete source order and content identities, or a session-only identity
     * when a source cannot identify its content.
     */
    public static get persistentScope(): string {
        return this.context.persistentScope;
    }

    /** Prefixes a persistent cache key with the current source scope. */
    public static persistentKey(key: string): string {
        return this.context.persistentKey(key);
    }

    /**
     * Registers a source at the highest priority for subsequent global loads.
     *
     * @param key - Name used to replace or remove this source.
     * @param override - Removes the first source with this name before adding the new one.
     */
    public static addSource(key: string, source: AssetSource, override: boolean = true) {
        if (override) {
            const existing = this.removeSource(key);
            if (existing) {
                console.log(p, "Removed existing AssetSource", key);
            }
        }

        this.invalidateContext();
        this._SOURCES.unshift({key, source});
        console.log(p, "Added AssetSource", key);
    }

    /** Removes and returns the first source with this name for subsequent global loads. */
    public static removeSource(key: string): Maybe<AssetSource> {
        const index = this._SOURCES.findIndex(s => s.key === key);
        if (index != -1) {
            this.invalidateContext();
            const spliced = this._SOURCES.splice(index, 1);
            if (spliced.length > 0) {
                return spliced[0].source;
            }
        }
        return undefined;
    }

    static {
        this.addSource("mcassets", new HostedAssetSource(this.ROOT, { retryDefaults: false }));
    }

    private static invalidateContext(): void {
        this._context?.clearCache();
        this._context = undefined;
    }

    /** Loads defined results from the global context in source-priority order. */
    public static getAll<T extends MinecraftAsset>(key: AssetKey, parser: AssetParser | string): Promise<T[]> {
        return this.context.getAll<T>(key, parser);
    }

    /** Returns the first defined result from the global context, without merging assets. */
    public static get<T extends MinecraftAsset>(key: AssetKey, parser: AssetParser | string): Promise<Maybe<T>> {
        return this.context.get<T>(key, parser);
    }

    /** Tries each path within a source before considering lower-priority sources. */
    public static getFirst<T extends MinecraftAsset>(keys: readonly AssetKey[], parser: AssetParser | string): Promise<Maybe<{ key: AssetKey; asset: T }>> {
        return this.context.getFirst<T>(keys, parser);
    }

}

interface AssetSourceReference {
    key: string;
    source: AssetSource;
}
