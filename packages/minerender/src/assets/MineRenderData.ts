import { AssetKey } from "./AssetKey";
import { AssetLoader } from "./AssetLoader";
import { AssetParser } from "./source/parser/AssetParsers";
import { Caching } from "../cache/Caching";
import type { BlockStatePropertyDefaults } from "../model/block/BlockStateProperties";

export interface MineRenderDatasets {
    itemDefaults: Record<string, Record<string, unknown>>;
    potionColors: {
        effects: Record<string, number>;
        potions: Record<string, { id: string; amplifier: number }[]>;
    };
    blockStates: Record<string, BlockStatePropertyDefaults>;
    blockTints: Record<string, ({ source: "constant"; color: number } | { source: "grass" | "stem" | "redstone" }) & { untinted?: number[] }>;
    fluids: Record<string, { kind: "water" | "lava"; renderModel: boolean; levelProperty?: string }>;
    dyes: Record<string, { id: number; textureDiffuseColor: number; fireworkColor: number; textColor: number }>;
    legacyBlocks: { blocks: Record<string, string> };
}

export interface MineRenderDataManifest {
    schemaVersion: 1;
    minecraftVersion: string;
    dataVersion: number;
    datasets: Partial<Record<keyof MineRenderDatasets, { file: string; sha256: string; bytes: number; provenance: Record<string, unknown> }>>;
    unavailable: Record<string, string>;
    extractor: { repository: string; revision: string; sha256: string };
}

/** The requested asset version and the published data version used for its registries. */
export interface ResolvedMineRenderData {
    requestedVersion: string;
    version: string;
    root: string;
    manifest: MineRenderDataManifest;
}

const object = (value: unknown): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value);
const release = (value: string): number[] | undefined => /^\d+\.\d+(?:\.\d+)?$/.test(value) ? value.split(".").map(Number) : undefined;
const compare = (left: number[], right: number[]): number => {
    for (let i = 0; i < 3; i++) {
        const difference = (left[i] ?? 0) - (right[i] ?? 0);
        if (difference) return difference;
    }
    return 0;
};

/** Loads extracted Minecraft registries from the active asset sources and version. */
export class MineRenderData {
    /** Loads one registry. Missing files and invalid data reject the request. */
    public static async get<K extends keyof MineRenderDatasets>(dataset: K, root?: string): Promise<MineRenderDatasets[K]> {
        root = root?.replace(/\/+$/, "");
        const scope = AssetLoader.persistentScope;
        const defaultRoot = AssetLoader.ROOT;
        const resolved = await this.resolve(root);
        const entry = resolved.manifest.datasets[dataset];
        if (!entry) throw new Error(`MineRender ${dataset} data is unavailable for ${resolved.version}: ${resolved.manifest.unavailable[dataset] ?? "not listed in the manifest"}`);
        const file = entry.file;
        const requestRoot = resolved.root === (root ?? defaultRoot).replace(/\/+$/, "") ? root : resolved.root;
        return await this.cached(`${requestRoot === undefined ? "sources" : "explicit"}:${resolved.root}/${file}:${entry.sha256}`, scope, defaultRoot, async () => {
            const data = await this.load(file.slice(0, -5), requestRoot);
            if (!this.validDataset(dataset, data)) throw new Error(`Invalid MineRender ${dataset} data at ${resolved.root}/minerender-data/${file}`);
            return data as MineRenderDatasets[K];
        });
    }

    /**
     * Uses the exact version when published. Otherwise, selects the nearest patch in the same
     * release line (older on ties), then the latest earlier release. Unpublished snapshots reject.
     */
    public static async resolve(root?: string): Promise<ResolvedMineRenderData> {
        const requestRoot = root?.replace(/\/+$/, "");
        const defaultRoot = AssetLoader.ROOT;
        root = (root ?? defaultRoot).replace(/\/+$/, "");
        const scope = AssetLoader.persistentScope;
        return this.cached(`resolve:${requestRoot === undefined ? "sources" : "explicit"}:${root}`, scope, defaultRoot, async () => {
            const requestedVersion = root.slice(root.lastIndexOf("/") + 1);
            let manifest = await this.manifest(root, release(requestedVersion) ? requestedVersion : undefined, requestRoot);
            if (manifest) return { requestedVersion, version: manifest.minecraftVersion, root, manifest };
            const requested = release(requestedVersion);
            if (!requested || compare(requested, [1, 16, 5]) < 0) {
                throw new Error(`No MineRender data is published for ${requestedVersion}; automatic fallback requires a release from 1.16.5 onward`);
            }
            const base = root.slice(0, root.lastIndexOf("/"));
            const index = await this.cached(`versions:${base}`, scope, defaultRoot, async () => {
                const value = await this.load("versions", base);
                if (!object(value) || !Array.isArray(value.versions)
                    || !value.versions.every(entry => object(entry) && typeof entry.name === "string")) {
                    throw new Error(`Invalid MineRender version index at ${base}/minerender-data/versions.json`);
                }
                return value.versions as { name: string }[];
            });
            const versions = index.map(entry => ({ name: entry.name, number: release(entry.name) }))
                .filter((entry): entry is { name: string; number: number[] } => !!entry.number && compare(entry.number, [1, 16, 5]) >= 0)
                .sort((left, right) => compare(left.number, right.number));
            const sameLine = versions.filter(entry => entry.number[0] === requested[0] && entry.number[1] === requested[1]);
            const selected = sameLine.sort((left, right) => Math.abs((left.number[2] ?? 0) - (requested[2] ?? 0))
                - Math.abs((right.number[2] ?? 0) - (requested[2] ?? 0)) || compare(left.number, right.number))[0]
                ?? versions.filter(entry => compare(entry.number, requested) <= 0).pop();
            if (!selected) throw new Error(`No compatible MineRender data is published for ${requestedVersion}`);
            const resolvedRoot = `${base}/${selected.name}`;
            manifest = await this.manifest(resolvedRoot, selected.name, resolvedRoot);
            if (!manifest) throw new Error(`Missing MineRender manifest for published version ${selected.name}`);
            return { requestedVersion, version: selected.name, root: resolvedRoot, manifest };
        });
    }

    private static async manifest(root: string, expectedVersion: string | undefined, requestRoot?: string): Promise<MineRenderDataManifest | undefined> {
        const data = await this.load("manifest", requestRoot);
        if (data === undefined) return undefined;
        if (!object(data) || data.schemaVersion !== 1 || typeof data.minecraftVersion !== "string" || !Number.isInteger(data.dataVersion)
            || !object(data.unavailable) || !Object.values(data.unavailable).every(value => typeof value === "string")
            || !object(data.datasets) || !Object.values(data.datasets).every(entry => {
                return object(entry) && typeof entry.file === "string" && /^[a-z0-9][a-z0-9._-]*\.json$/.test(entry.file)
                    && typeof entry.sha256 === "string" && /^[0-9a-f]{64}$/.test(entry.sha256);
            }) || (expectedVersion !== undefined && data.minecraftVersion !== expectedVersion)) {
            throw new Error(`Invalid MineRender manifest at ${root}/minerender-data/manifest.json`);
        }
        return data as unknown as MineRenderDataManifest;
    }

    private static load(file: string, root?: string): Promise<unknown> {
        const key = new AssetKey("minerender-data", file, undefined, undefined, undefined, ".json", root);
        key.rootType = undefined!;
        return AssetLoader.get(key, AssetParser.JSON);
    }

    private static async cached<T>(key: string, scope: string, defaultRoot: string, loader: () => Promise<T>): Promise<T> {
        const checkSources = () => {
            if (AssetLoader.persistentScope !== scope || AssetLoader.ROOT !== defaultRoot) throw new Error("Asset sources changed while loading MineRender data; retry the request");
        };
        checkSources();
        return await Caching.mineRenderDataCache.get(scope ? `${scope}\n${key}` : key, async () => {
            const value = await loader();
            checkSources();
            return value;
        }) as T;
    }

    private static validDataset(dataset: keyof MineRenderDatasets, data: unknown): boolean {
        if (!object(data)) return false;
        if (dataset === "potionColors") return object(data.effects) && Object.values(data.effects).every(Number.isInteger)
            && object(data.potions) && Object.values(data.potions).every(effects => Array.isArray(effects)
                && effects.every(effect => object(effect) && typeof effect.id === "string" && Number.isInteger(effect.amplifier)));
        if (dataset === "legacyBlocks") return object(data.blocks) && Object.values(data.blocks).every(value => typeof value === "string");
        return Object.values(data).every(value => {
            if (!object(value)) return false;
            switch (dataset) {
                case "itemDefaults": return true;
                case "blockStates": return Object.values(value).every(property => object(property) && "default" in property && Array.isArray(property.values));
                case "blockTints": return ["constant", "grass", "stem", "redstone"].includes(value.source)
                    && (value.source !== "constant" || Number.isInteger(value.color));
                case "fluids": return ["water", "lava"].includes(value.kind) && typeof value.renderModel === "boolean"
                    && (value.levelProperty === undefined || typeof value.levelProperty === "string");
                case "dyes": return [value.id, value.textureDiffuseColor, value.fireworkColor, value.textColor].every(Number.isInteger);
                default: return false;
            }
        });
    }
}
