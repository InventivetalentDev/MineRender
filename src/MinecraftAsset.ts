import { AssetKey } from "./cache/CacheKey";

export interface MinecraftAsset {
    key?: AssetKey;
    name?: string;
    names?: string[];
}
