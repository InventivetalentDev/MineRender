import type { AssetKey, BasicAssetKey } from "../assets/AssetKey";
import type { MinecraftAsset } from "../MinecraftAsset";

/** One selected draw, combining geometry, texture, and material settings. */
export interface EntityLayer {
    key: BasicAssetKey;
    texture?: AssetKey;
    layer: EntityModelLayer;
    /** How this draw is rendered; defaults to the geometry layer's own mode, then `cutout`. */
    render?: EntityRenderMode;
    /** Label of the state colour that multiplies the texture, from the pass that selected this draw. */
    tint?: string;
}

/** Selected entity data returned by {@link Entities.getEntity} for rendering. */
export interface EntityModel extends EntityLayer {
    id: string;
    /** Root transform from the dataset; see {@link EntityTransformOp}. */
    transform?: EntityTransformOp[];
    /**
     * Selected draws in draw order; the top-level fields describe the first selection.
     * A key is the geometry layer's name; a further draw of the same geometry (a pass with another texture) is keyed `<layer>#<n>`, from 2.
     */
    layers?: Record<string, EntityLayer>;
}

/** Dataset file containing all geometry layers and optional extra render passes. */
export interface EntityModelFile extends MinecraftAsset {
    id: string;
    transform?: EntityTransformOp[];
    layers: Record<string, EntityModelLayer>;
    /** Extra draws vanilla adds on top of `main`, in draw order. */
    passes?: EntityModelPass[];
}

/** Vanilla render type of a draw; see the dataset README for the mode table. */
export type EntityRenderMode = "cutout" | "cutout_cull" | "cutout_z_offset" | "solid" | "translucent" | "translucent_emissive"
    | "eyes" | "energy_swirl" | "breeze_wind" | "water_mask" | "no_outline";

/** An extra draw of a geometry layer, optionally enabled by an entity-state label. */
export interface EntityModelPass {
    /** Geometry layer of the same file; a pass on `main` draws that geometry again. */
    layer: string;
    /** Present only when it differs from the layer's own. */
    textureLocation?: string;
    /** Present only when it differs from the layer's own. */
    render?: EntityRenderMode;
    /** Entity state that enables the draw, e.g. `powered`; without it the pass is always drawn. */
    when?: string;
    /** State colour that multiplies the texture, e.g. `wool_color`. */
    tint?: string;
}

/**
 * One operation vanilla's renderer applies before drawing a model, in call order:
 * each one is applied on top of the previous, so the last reaches the vertices first.
 * Translations use model units and rotations use radians, like part poses.
 */
export type EntityTransformOp =
    { scale: [number, number, number] } | { translate: [number, number, number] } | { rotate: [number, number, number] };

/** A named geometry tree with texture dimensions in pixels and an optional default texture path. */
export interface EntityModelLayer {
    texture: [number, number];
    textureLocation?: string;
    /** Omitted for `cutout`. */
    render?: EntityRenderMode;
    root: EntityModelPart;
}

/** A named part's baked pose and children. Offsets use model units and rotations use radians. */
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

/** A part's cuboid in model units, with a texture origin in pixels and optional per-axis growth. */
export interface EntityModelCube {
    origin: [number, number, number];
    size: [number, number, number];
    uv: [number, number];
    grow?: [number, number, number];
    mirror?: boolean;
}
