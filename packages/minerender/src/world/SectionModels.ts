import { Matrix4, Mesh, Vector3 } from "three";
import { AssetKey } from "../assets/AssetKey";
import { AssetContext } from "../assets/AssetContext";
import { CUBE_FACES, CUBE_FACE_OFFSETS } from "../CubeFace";
import { BlockState, BlockStateVariant } from "../model/block/BlockState";
import { BlockStateProperties } from "../model/block/BlockStateProperties";
import { BlockStateResolver } from "../model/block/BlockStateResolver";
import { BlockTints } from "../model/block/BlockTints";
import { Model } from "../model/Model";
import { ModelCulling } from "../model/ModelCulling";
import { ModelObject } from "../model/scene/ModelObject";
import { UVMapper } from "../UVMapper";
import { SectionMeshTemplate } from "./SectionMesh";

interface PreparedState {
    variants: BlockStateVariant | BlockStateVariant[];
    templates: Map<BlockStateVariant, SectionMeshTemplate>;
}

// Section meshes supply the material; templates only need the existing model geometry pipeline.
class SectionModel extends ModelObject {
    protected applyTextures() {}
}

function cached<T>(map: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
    let value = map.get(key);
    if (!value) {
        value = load().catch(error => { map.delete(key); throw error; });
        map.set(key, value);
    }
    return value;
}

/** Prepares and caches static opaque cube geometry for merged world sections. */
export class SectionModels {
    private states = new WeakMap<AssetContext, WeakMap<BlockState, Map<string, Promise<PreparedState | undefined>>>>();
    private models = new WeakMap<Model, Map<string, Promise<SectionMeshTemplate>>>();
    private readonly templates = new Set<SectionMeshTemplate>();

    constructor(readonly maxAtlasSize = 2048) {
        if (!Number.isInteger(maxAtlasSize) || maxAtlasSize < 1) throw new RangeError("maxAtlasSize must be a positive integer");
    }

    /** Returns a cube template, or `undefined` when the block requires an individual render object. */
    public async get(blockState: BlockState, properties: BlockStateProperties = {}, assets?: AssetContext): Promise<SectionMeshTemplate | undefined> {
        const context = AssetContext.for(blockState, assets);
        if (!blockState.variants || blockState.multipart) return undefined;
        let contextStates = this.states.get(context);
        if (!contextStates) this.states.set(context, contextStates = new WeakMap());
        let states = contextStates.get(blockState);
        if (!states) contextStates.set(blockState, states = new Map());
        const key = JSON.stringify(Object.entries(properties).sort(([a], [b]) => a.localeCompare(b)));
        const prepared = await cached(states, key, () => this.prepare(blockState, properties, context));
        if (!prepared) return undefined;
        return prepared.templates.get(BlockStateResolver.choose(prepared.variants));
    }

    private async prepare(blockState: BlockState, properties: BlockStateProperties, assets: AssetContext): Promise<PreparedState | undefined> {
        const state = { ...await BlockStateResolver.defaults(assets.bind({ ...blockState })), ...properties };
        const groups = BlockStateResolver.matching(blockState, state);
        if (groups.length !== 1) return undefined;
        const variants = groups[0];
        const choices = Array.isArray(variants) ? variants : [variants];
        if (!choices.length) return undefined;
        const templates = new Map<BlockStateVariant, SectionMeshTemplate>();
        for (const variant of choices) {
            const modelKey = AssetKey.parse("models", variant.model!, blockState.key);
            const model = await assets.models.getMerged(modelKey);
            if (!model) return undefined;
            const atlas = await UVMapper.getAtlas(model);
            const rotation = BlockStateResolver.rotation(variant);
            if (!atlas || atlas.hasAnimation || !ModelCulling.isOpaqueFullCube(atlas)
                || atlas.image.width > this.maxAtlasSize || atlas.image.height > this.maxAtlasSize
                || ModelCulling.toLocalMask(63, rotation) !== 63) return undefined;
            const tints = await BlockTints.get(blockState.key, state, model);
            let models = this.models.get(model);
            if (!models) this.models.set(model, models = new Map());
            const key = JSON.stringify([rotation.x, rotation.y, rotation.z, variant.uvlock, tints]);
            const template = await cached(models, key, async () => {
                const object = new SectionModel(model, {
                    assets,
                    instanceMeshes: false, mergeMeshes: false, tints,
                    uvLockRotation: variant.uvlock && (rotation.x !== 0 || rotation.y !== 0)
                        ? [rotation.x, rotation.y, rotation.z] : undefined
                });
                await object.init();
                const geometry = (object.children[0] as Mesh).geometry;
                geometry.applyMatrix4(new Matrix4().makeRotationFromEuler(rotation));
                object.clear();
                const cullFaces = CUBE_FACES.map(face => {
                    const local = CUBE_FACES.findIndex(name => name === atlas.model.elements![0].faces[face]?.cullface);
                    if (local < 0) return 0;
                    const normal = new Vector3(...CUBE_FACE_OFFSETS[local]).applyEuler(rotation);
                    const world = CUBE_FACE_OFFSETS.findIndex(([x, y, z]) =>
                        Math.abs(normal.x - x) < 1e-6 && Math.abs(normal.y - y) < 1e-6 && Math.abs(normal.z - z) < 1e-6);
                    return 1 << world;
                });
                const template = { geometry, atlas, cullFaces };
                this.templates.add(template);
                return template;
            });
            templates.set(variant, template);
        }
        return { variants, templates };
    }

    /** Disposes prepared geometry and clears this world's template caches. */
    public clear(): void {
        for (const template of this.templates) template.geometry.dispose();
        this.templates.clear();
        this.states = new WeakMap();
        this.models = new WeakMap();
    }
}
