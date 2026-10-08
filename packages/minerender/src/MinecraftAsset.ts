import { AssetKey, BasicAssetKey } from "./assets/AssetKey";

/** Loaded data with an optional namespace-and-path identity. */
export interface BasicMinecraftAsset {
    key?: BasicAssetKey;
}

/** Loaded data that can retain its full source key for related asset lookups. */
export interface MinecraftAsset extends BasicMinecraftAsset {
    key?: AssetKey;
}
