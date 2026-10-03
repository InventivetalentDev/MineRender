import { MinecraftAsset } from "./MinecraftAsset";

export interface ListAsset extends MinecraftAsset {
    directories: string[];
    files: string[];
}
