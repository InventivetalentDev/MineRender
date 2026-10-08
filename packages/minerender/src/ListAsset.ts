import { MinecraftAsset } from "./MinecraftAsset";

/** A hosted `_list.json` directory index used by asset-listing APIs. */
export interface ListAsset extends MinecraftAsset {
    directories: string[];
    files: string[];
}
