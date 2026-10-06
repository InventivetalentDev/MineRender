import type { AssetKey, BasicAssetKey } from "../assets/AssetKey";
import type { MinecraftAsset } from "../MinecraftAsset";

export interface EntityLayer {
    key: BasicAssetKey;
    texture?: AssetKey;
    layer: EntityModelLayer;
}

export interface EntityModel extends EntityLayer {
    id: string;
    /** Root transform from the dataset; see {@link EntityTransformOp}. */
    transform?: EntityTransformOp[];
    /** Selected layers; the top-level fields describe the first selection. */
    layers?: Record<string, EntityLayer>;
}

export interface EntityModelFile extends MinecraftAsset {
    id: string;
    transform?: EntityTransformOp[];
    layers: Record<string, EntityModelLayer>;
}

/**
 * One operation vanilla's renderer applies before drawing a model, in call order:
 * each one is applied on top of the previous, so the last reaches the vertices first.
 * Translations use model units and rotations use radians, like part poses.
 */
export type EntityTransformOp =
    { scale: [number, number, number] } | { translate: [number, number, number] } | { rotate: [number, number, number] };

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
