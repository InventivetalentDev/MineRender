import { MinecraftAsset } from "./MinecraftAsset";

export interface MinecraftTextureMeta extends MinecraftAsset {
    animation: AnimationMeta;
}

export interface AnimationMeta {
    interpolate: boolean;
    width: number;
    height: number;
    frametime: number;
    frames: Array<number | AnimationFrame>;
}

export interface AnimationFrame {
    index: number;
    time: number;
}
