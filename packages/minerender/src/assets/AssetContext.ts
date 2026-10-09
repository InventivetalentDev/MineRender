import { AssetKey } from "./AssetKey";
import { AssetLoader } from "./AssetLoader";
import { DEFAULT_ROOT } from "./AssetDefaults";
import { Models } from "./Models";
import { BlockStates } from "./BlockStates";
import { ModelTextures } from "./ModelTextures";
import { Entities } from "./Entities";
import { Fonts } from "./Fonts";
import { BlockEntities } from "./BlockEntities";
import { HostedAssetSource } from "./source/HostedAssetSource";
import type { AssetSource } from "./source/AssetSource";
import { AssetParser } from "./source/parser/AssetParsers";
import type { MinecraftAsset } from "../MinecraftAsset";
import { Caching } from "../cache/Caching";

export interface AssetContextSource {
    key: string;
    source: AssetSource;
}

export interface AssetContextOptions {
    /** Minecraft version on assets.mcasset.cloud. Defaults to the library's default version. */
    version?: string;
    /** Overrides the vanilla asset URL. */
    root?: string;
    /** Additional sources, highest priority first, before vanilla assets. */
    sources?: readonly AssetContextSource[];
}

/** A fixed asset configuration shared by loaders, scenes, and their dependent resources. */
export class AssetContext {
    private static nextId = 0;
    private static readonly session = `${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
    private static readonly origins = new WeakMap<object, AssetContext>();

    readonly root: string;
    readonly version: string;
    private readonly id = `${AssetContext.session}:${AssetContext.nextId++}`;
    private _sources: readonly AssetContextSource[];
    private _persistentScope?: string;

    constructor(options: AssetContextOptions = {}) {
        this.root = options.root ?? (options.version === undefined ? DEFAULT_ROOT : `https://assets.mcasset.cloud/${options.version}`);
        this.version = options.version ?? this.root.substring(this.root.lastIndexOf("/") + 1);
        this._sources = this.copySources([
            ...options.sources ?? [],
            { key: "mcassets", source: new HostedAssetSource(this.root, { retryDefaults: false }) }
        ]);
    }

    /** @internal Captures the legacy registry, including deliberately removed default sources. */
    static capture(root: string, sources: readonly AssetContextSource[]): AssetContext {
        const context = new AssetContext({ root });
        context._sources = context.copySources(sources);
        return context;
    }

    private copySources(sources: readonly AssetContextSource[]): readonly AssetContextSource[] {
        return Object.freeze(sources.map(({ key, source }) => Object.freeze({ key, source })));
    }

    get sources(): readonly AssetContextSource[] { return this._sources; }

    /** Returns the configuration attached to loaded data or its asset key. */
    static origin(value?: object): AssetContext | undefined {
        if (value) {
            const origin = this.origins.get(value);
            if (origin) return origin;
            const key = (value as MinecraftAsset).key;
            if (key) {
                const keyOrigin = this.origins.get(key);
                if (keyOrigin) return keyOrigin;
            }
        }
        return undefined;
    }

    /** Uses loaded data's configuration, then the supplied scene context or global default. */
    static for(value?: object, fallback?: AssetContext): AssetContext {
        return this.origin(value) ?? fallback ?? AssetLoader.context;
    }

    /** Retains an asset's configuration without including it in serialized asset data. */
    bind<T extends object>(asset: T): T {
        AssetContext.origins.set(asset, this);
        return asset;
    }

    /** @internal Copies known provenance without binding unconfigured keys to the global default. */
    static inherit<T extends object>(value: T, origin?: object): T {
        const assets = origin && this.origins.get(origin);
        return assets ? assets.bind(value) : value;
    }

    private serializeKey(key: AssetKey): string {
        return [key.root ?? this.root, key.rootType ?? "__rootType__", key.assetType ?? "__assetType__",
            key.type ?? "__type__", key.namespace, key.path].join("/");
    }

    /** Separates in-memory assets and derived render resources from other contexts. */
    cacheKey(key: AssetKey): string {
        return `${this.id}\n${this.serializeKey(key)}\n${key.extension}`;
    }

    get persistentScope(): string {
        if (this._persistentScope !== undefined) return this._persistentScope;
        const sources = this.sources.map(({ key, source }) => [key, source.getCacheId(this)] as const);
        if (sources.some(([, id]) => id === undefined)) return this._persistentScope = `session:${this.id}`;
        if (sources.length === 1 && sources[0][0] === "mcassets" && sources[0][1] === `hosted:${this.root}`) {
            return this._persistentScope = "";
        }
        return this._persistentScope = `sources:${JSON.stringify(sources)}`;
    }

    /** Uses stable source identities for persistent storage and isolates unidentified sources. */
    persistentKey(key: AssetKey | string): string {
        const serialized = typeof key === "string" ? key : this.serializeKey(key);
        const scope = this.persistentScope;
        return scope ? `${scope}\n${serialized}` : serialized;
    }

    private copy<T>(asset: T): T {
        if (asset === null || typeof asset !== "object") return asset;
        return this.bind(Object.assign(Array.isArray(asset) ? [] : Object.create(Object.getPrototypeOf(asset)), asset));
    }

    /** Returns the first defined result in source-priority order. */
    async get<T extends MinecraftAsset>(key: AssetKey, parser: AssetParser | string): Promise<T | undefined> {
        const keys = [key];
        if (key.rootType === "data" && (key.assetType === "structure" || key.assetType === "structures")) {
            keys.push(new AssetKey(key.namespace, key.path,
                key.assetType === "structure" ? "structures" : "structure",
                key.type, key.rootType, key.extension, key.root));
        }
        return (await this.getFirst<T>(keys, parser))?.asset;
    }

    /** Tries each path within a source before considering lower-priority sources. */
    async getFirst<T extends MinecraftAsset>(keys: readonly AssetKey[], parser: AssetParser | string): Promise<{ key: AssetKey; asset: T } | undefined> {
        let remaining = keys.map(key => this.copy(key));
        for (const { source } of this.sources) {
            for (const key of remaining) {
                const asset = await source.get<T>(key, parser, this);
                if (asset !== undefined) return { key, asset: this.copy(asset) };
            }
            const blocked = await Promise.all(remaining.map(key => source.blocks(key, this)));
            remaining = remaining.filter((_, index) => !blocked[index]);
            if (!remaining.length) break;
        }
        return undefined;
    }

    /** Loads defined results in source-priority order, stopping at a resource-pack filter. */
    async getAll<T extends MinecraftAsset>(key: AssetKey, parser: AssetParser | string): Promise<T[]> {
        key = this.copy(key);
        const results: T[] = [];
        for (const { source } of this.sources) {
            const asset = await source.get<T>(key, parser, this);
            if (asset !== undefined) results.push(this.copy(asset));
            if (await source.blocks(key, this)) break;
        }
        return results;
    }

    /** Invalidates this context's in-memory entries. Existing objects and persistent data are retained. */
    clearCache(): void {
        Caching.clearContext(`${this.id}\n`);
    }

    readonly models = new Models(this);
    readonly blockStates = new BlockStates(this);
    readonly modelTextures = new ModelTextures(this);
    readonly entities = new Entities(this);
    readonly fonts = new Fonts(this);
    readonly blockEntities = new BlockEntities(this);
}
