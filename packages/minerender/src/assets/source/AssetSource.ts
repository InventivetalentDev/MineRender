import { MinecraftAsset } from "../../MinecraftAsset";
import { AssetKey } from "../AssetKey";
import { Maybe } from "../../util";
import { AssetParser } from "./parser/AssetParsers";

export abstract class AssetSource {

    protected constructor() {
    }

    public abstract get<T extends MinecraftAsset>(key: AssetKey, parser: AssetParser | string): Promise<Maybe<T>>;

}

/** A source failed to load or parse an asset; cause retains the original failure. */
export class AssetLoadError extends Error {

    constructor(readonly source: AssetSource, readonly key: AssetKey, readonly path: string, readonly cause: unknown) {
        super(`Failed to load ${key.toNamespacedString()} from ${path}${cause instanceof Error ? `: ${cause.message}` : ""}`);
        this.name = "AssetLoadError";
    }

}
