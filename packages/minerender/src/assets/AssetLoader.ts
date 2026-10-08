import { Model, TextureAsset } from "../model/Model";
import { Maybe } from "../util/util";
import { Requests } from "../request/Requests";
import { MinecraftAsset } from "../MinecraftAsset";
import { ImageInfo, ImageLoader } from "../image/ImageLoader";
import { MinecraftTextureMeta } from "../MinecraftTextureMeta";
import { BlockState } from "../model/block/BlockState";
import { DEFAULT_NAMESPACE, DEFAULT_ROOT } from "./Assets";
import { ListAsset } from "../ListAsset";
import { AssetKey } from "./AssetKey";
import { NBTAsset, NBTHelper } from "../nbt/NBTHelper";
import { prefix } from "../util/log";
import { AssetSource } from "./source/AssetSource";
import { AssetParser } from "./source/parser/AssetParsers";
import { HostedAssetSource } from "./source";
import { Caching } from "../cache/Caching";

const p = prefix("AssetLoader");


const FALLBACK_ROOT = "https://raw.githubusercontent.com/InventivetalentDev/minerender-fallback-assets/master";

/** Loads assets from a shared, ordered registry of hosted sources and resource packs. */
export class AssetLoader {

    /** Default asset base URL. Use {@link setVersion} to select a Minecraft version. */
    static ROOT: string = DEFAULT_ROOT;

    private static _SOURCES: AssetSourceReference[] = [];

    /** Used when a registered source cannot identify its content, so nothing persists past this session. */
    private static readonly SESSION_SCOPE = `session:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;

    public static get version(): string {
        return this.ROOT.substring(this.ROOT.lastIndexOf("/") + 1);
    }

    /** Selects an mcasset.cloud version, updates the vanilla source, and clears in-memory caches. */
    public static setVersion(version: string): void {
        this.ROOT = `https://assets.mcasset.cloud/${version}`;
        const source = new HostedAssetSource(this.ROOT, { retryDefaults: false });
        const index = this._SOURCES.findIndex(s => s.key === "mcassets");
        if (index !== -1) {
            this._SOURCES[index] = { key: "mcassets", source };
        } else {
            this.addSource("mcassets", source);
        }
        Caching.clear();
    }

    /**
     * Scope for persistent cache keys. Empty with only the default vanilla sources, so their
     * entries stay valid across sessions; otherwise it names every added source (resource packs,
     * mirrors) so their results never masquerade as vanilla assets after a reload.
     */
    public static get persistentScope(): string {
        const parts: string[] = [];
        for (const { key, source } of this._SOURCES) {
            const id = source.cacheId;
            if (key === "mcassets" && id === `hosted:${this.ROOT}`) continue;
            if (key === "mcassets-fallback" && id === `hosted:${FALLBACK_ROOT}`) continue;
            if (id === undefined) return this.SESSION_SCOPE;
            parts.push(`${key}=${id}`);
        }
        return parts.join("|");
    }

    /** Prefixes a persistent cache key with the current source scope. */
    public static persistentKey(key: string): string {
        const scope = this.persistentScope;
        return scope ? `${scope}\n${key}` : key;
    }

    /**
     * Registers a source at the highest priority.
     * Call {@link Caching.clear} after changing sources to discard previously loaded assets.
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

        this._SOURCES.unshift({key, source});
        console.log(p, "Added AssetSource", key);
    }

    /** Removes and returns the first source with this name. Call {@link Caching.clear} to reload assets. */
    public static removeSource(key: string): Maybe<AssetSource> {
        const index = this._SOURCES.findIndex(s => s.key === key);
        if (index != -1) {
            const spliced = this._SOURCES.splice(index, 1);
            if (spliced.length > 0) {
                return spliced[0].source;
            }
        }
        return undefined;
    }

    static {
        this.addSource("mcassets-fallback", new HostedAssetSource(FALLBACK_ROOT, { retryDefaults: false }));
        this.addSource("mcassets", new HostedAssetSource(this.ROOT, { retryDefaults: false }));
    }

    /** Loads from all sources and returns defined results in priority order. Any source failure rejects the call. */
    public static async getAll<T extends MinecraftAsset>(key: AssetKey, parser: AssetParser | string): Promise<T[]> {
        const sources = [...this._SOURCES];
        const results: T[] = [];
        for (const { source } of sources) {
            const asset = await source.get<T>(key, parser);
            if (asset != undefined) results.push(asset);
            if (await source.blocks(key)) break;
        }
        return results;
    }

    /** Returns the first defined result in source-priority order, without merging assets. */
    public static async get<T extends MinecraftAsset>(key: AssetKey, parser: AssetParser | string): Promise<Maybe<T>> {
        const keys = [key];
        if (key.rootType === "data" && (key.assetType === "structure" || key.assetType === "structures")) {
            keys.push(new AssetKey(key.namespace, key.path,
                key.assetType === "structure" ? "structures" : "structure",
                key.type, key.rootType, key.extension, key.root));
        }
        return (await this.getFirst<T>(keys, parser))?.asset;
    }

    /** Tries each path within a source before considering lower-priority sources. */
    public static async getFirst<T extends MinecraftAsset>(keys: readonly AssetKey[], parser: AssetParser | string): Promise<Maybe<{ key: AssetKey; asset: T }>> {
        // Source changes affect later lookups, not the priority of an in-flight lookup.
        const sources = [...this._SOURCES];
        let remaining = [...keys];
        for (const source of sources) {
            for (const key of remaining) {
                const result = await source.source.get<T>(key, parser);
                if (result !== undefined) {
                    return { key, asset: result };
                }
            }
            const blocked = await Promise.all(remaining.map(key => source.source.blocks(key)));
            remaining = remaining.filter((_, index) => !blocked[index]);
            if (!remaining.length) break;
        }
        return undefined;
    }

}

interface AssetSourceReference {
    key: string;
    source: AssetSource;
}
