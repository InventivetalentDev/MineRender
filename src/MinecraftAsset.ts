import { AssetKey, BasicAssetKey } from "./assets/AssetKey";

export interface BasicMinecraftAsset {
    key?: BasicAssetKey;
}

export interface MinecraftAsset extends BasicMinecraftAsset {
    key?: AssetKey;
}
