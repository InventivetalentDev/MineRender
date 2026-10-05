import type { AssetKey, BasicAssetKey } from "../assets/AssetKey";
import type { MinecraftAsset } from "../MinecraftAsset";

export interface EntityModel {
    key: BasicAssetKey;
    texture?: AssetKey;
    layer: EntityModelLayer;
    id: string;
}

export interface EntityModelFile extends MinecraftAsset {
    id: string;
    layers: Record<string, EntityModelLayer>;
}

export interface EntityModelLayer {
    texture: [number, number];
    textureLocation?: string;
    root: EntityModelPart;
}

export interface EntityModelPart {
    pose: {
        offset: [number, number, number];
        rotation: [number, number, number];
        scale?: [number, number, number];
    };
    texture?: [number, number];
    cubes: EntityModelCube[];
    children: Record<string, EntityModelPart>;
}

export interface EntityModelCube {
    origin: [number, number, number];
    size: [number, number, number];
    uv: [number, number];
    grow?: [number, number, number];
    mirror?: boolean;
}
