import { MinecraftAsset } from "./MinecraftAsset";

/** Texture animation and GUI scaling metadata read from a `.png.mcmeta` file. */
export interface MinecraftTextureMeta extends MinecraftAsset {
    animation?: AnimationMeta;
    gui?: { scaling?: GuiSpriteScaling };
}

/** GUI sprite scaling rules. Dimensions and borders use logical GUI pixels, independent of PNG resolution. */
export type GuiSpriteScaling = { type: "stretch" } | {
    type: "tile";
    width: number;
    height: number;
} | {
    type: "nine_slice";
    width: number;
    height: number;
    border: number | { left: number; top: number; right: number; bottom: number };
    stretch_inner?: boolean;
};

/** Texture frame-grid and playback settings. Frame durations use ticks at 20 ticks per second. */
export interface AnimationMeta {
    interpolate: boolean;
    width: number;
    height: number;
    frametime: number;
    frames: Array<number | AnimationFrame>;
}

/** A zero-based frame index and its duration in ticks, overriding the animation's default frame time. */
export interface AnimationFrame {
    index: number;
    time: number;
}
