import { MinecraftAsset } from "../../MinecraftAsset";
import { AssetKey } from "../AssetKey";
import { Maybe } from "../../util";
import { AssetParser } from "./parser/AssetParsers";

/** An asset provider registered with {@link AssetLoader.addSource}. */
export abstract class AssetSource {

    protected constructor() {
    }

    /** Returns a parsed asset, or `undefined` to allow fallback. Load and parse failures should reject. */
    public abstract get<T extends MinecraftAsset>(key: AssetKey, parser: AssetParser | string): Promise<Maybe<T>>;

    /**
     * Identifies this source's content across sessions for persistent caching. Sources that
     * cannot tell whether their content changed (an unnamed archive, for example) return
     * undefined, which keeps their results out of long-lived caches.
     */
    public get cacheId(): Maybe<string> {
        return undefined;
    }

}

/** A source failed to load or parse an asset; cause retains the original failure. */
export class AssetLoadError extends Error {

    constructor(readonly source: AssetSource, readonly key: AssetKey, readonly path: string, readonly cause: unknown) {
        super(`Failed to load ${key.toNamespacedString()} from ${path}${cause instanceof Error ? `: ${cause.message}` : ""}`);
        this.name = "AssetLoadError";
    }

}
