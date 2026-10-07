import { MinecraftAsset } from "./MinecraftAsset";

export interface MinecraftTextureMeta extends MinecraftAsset {
    animation?: AnimationMeta;
    gui?: { scaling?: GuiSpriteScaling };
}

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
