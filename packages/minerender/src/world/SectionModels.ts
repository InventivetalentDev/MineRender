import { BufferAttribute, BufferGeometry, Euler, Matrix4, Mesh, Vector3 } from "three";
import { AssetKey } from "../assets/AssetKey";
import { Models } from "../assets/Models";
import { CUBE_FACES, CUBE_FACE_OFFSETS } from "../CubeFace";
import { BlockState, BlockStateVariant } from "../model/block/BlockState";
import { BlockStateProperties } from "../model/block/BlockStateProperties";
import { BlockStateResolver } from "../model/block/BlockStateResolver";
import { BlockTints } from "../model/block/BlockTints";
import { FluidKind } from "../model/fluid/FluidGeometry";
import { BlockModel, Model, TripleArray } from "../model/Model";
import { ModelCulling } from "../model/ModelCulling";
import { ModelObject } from "../model/scene/ModelObject";
import { TextureAtlas } from "../texture/TextureAtlas";
import { UVMapper } from "../UVMapper";
import { SectionMeshTemplate } from "./SectionMesh";

interface PreparedVariant {
    model: Model;
    atlas: TextureAtlas;
    rotation: Euler;
}

interface PreparedState {
    state: BlockStateProperties;
    groups: (BlockStateVariant | BlockStateVariant[])[];
    choices: Map<BlockStateVariant, PreparedVariant>;
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

function compactQuads(geometry: BufferGeometry, keep: boolean[]): BufferGeometry {
    const quads = keep.flatMap((kept, index) => kept ? [index] : []);
    const compact = new BufferGeometry();
    for (const [name, size] of Object.entries({ position: 3, normal: 3, uv: 2, uvBounds: 4, color: 3, shade: 1 })) {
        const source = geometry.getAttribute(name);
        const defaults = name === "uvBounds" ? [0, 0, 1, 1] : name === "color" ? [1, 1, 1] : name === "shade" ? [1] : undefined;
        const values = new Float32Array(quads.length * 4 * size);
        for (let q = 0; q < quads.length; q++) {
            for (let vertex = 0; vertex < 4; vertex++) {
                for (let component = 0; component < size; component++) {
                    values[(q * 4 + vertex) * size + component] = source
                        ? source.getComponent(quads[q] * 4 + vertex, component) : defaults![component];
                }
            }
        }
        compact.setAttribute(name, new BufferAttribute(values, size));
    }
    const source = geometry.getIndex()!;
    const indices: number[] = [];
    for (let q = 0; q < quads.length; q++) {
        for (let k = 0; k < 6; k++) indices.push(source.getX(quads[q] * 6 + k) - quads[q] * 4 + q * 4);
    }
    compact.setIndex(indices);
    geometry.dispose();
    return compact;
}

/** Prepares and caches model geometry and fluid atlases for merged world sections. */
export class SectionModels {
    private states = new WeakMap<BlockState, Map<string, Promise<PreparedState | undefined>>>();
    private models = new WeakMap<Model, Map<string, Promise<SectionMeshTemplate>>>();
    private readonly templates = new Set<SectionMeshTemplate>();
    private readonly fluidAtlases = new Map<string, Promise<TextureAtlas>>();

    constructor(readonly maxAtlasSize = 2048) {
        if (!Number.isInteger(maxAtlasSize) || maxAtlasSize < 1) throw new RangeError("maxAtlasSize must be a positive integer");
    }

    /** Returns templates for the matched parts, or `undefined` when the block needs an individual render object. */
    public async get(blockState: BlockState, properties: BlockStateProperties = {},
                     position?: Readonly<TripleArray>, biome?: string): Promise<SectionMeshTemplate[] | undefined> {
        const biomePosition: TripleArray | undefined = position ? [...position] : undefined;
        const prepared = await this.state(blockState, properties);
        if (!prepared) return undefined;
        return Promise.all(prepared.groups.map(async group => {
            const variant = BlockStateResolver.choose(group, biomePosition);
            const choice = prepared.choices.get(variant)!;
            const tints = await BlockTints.get(blockState.key, prepared.state, choice.model, undefined,
                () => BlockTints.getBiomeColor(blockState.key, biome, biomePosition));
            return this.template(variant, choice, tints);
        }));
    }

    /** Resolves shared templates; dynamic biome tints are supplied on section placements instead of cached geometry. */
    public async prepareState(blockState: BlockState, properties: BlockStateProperties = {},
                              biomeColor?: number | (() => Promise<number | undefined>), dynamicBiomeTint = false):
        Promise<{ pick(position?: Readonly<TripleArray>): SectionMeshTemplate[]; biomeTint?: boolean } | undefined> {
        const prepared = await this.state(blockState, properties);
        if (!prepared) return undefined;
        let color: Promise<number | undefined> | undefined;
        const resolveColor = typeof biomeColor === "function" ? () => color ??= biomeColor() : biomeColor;
        const templates = new Map<BlockStateVariant, SectionMeshTemplate>();
        const source = dynamicBiomeTint && await BlockTints.biomeSource(blockState.key);
        await Promise.all([...prepared.choices].map(async ([variant, choice]) => {
            const tints = await BlockTints.get(blockState.key, prepared.state, choice.model, undefined, resolveColor);
            const biomeTints = source ? await BlockTints.get(blockState.key, prepared.state, choice.model, undefined, 0xffffff) : undefined;
            templates.set(variant, await this.template(variant, choice, tints, biomeTints));
        }));
        return {
            pick: (position?: Readonly<TripleArray>) => prepared.groups.map(group => templates.get(BlockStateResolver.choose(group, position))!),
            biomeTint: source ? [...templates.values()].some(template => template.biomeTint?.some(value => value === 1)) || undefined : undefined
        };
    }

    /** Starts loading the state's models and atlases so a later `prepareState` with the same properties finds them loaded. */
    public async preload(blockState: BlockState, properties: BlockStateProperties = {}): Promise<void> {
        await this.state(blockState, properties);
    }

    private async state(blockState: BlockState, properties: BlockStateProperties): Promise<PreparedState | undefined> {
        let states = this.states.get(blockState);
        if (!states) this.states.set(blockState, states = new Map());
        const key = JSON.stringify(Object.entries(properties).sort(([a], [b]) => a.localeCompare(b)));
        return cached(states, key, () => this.prepare(blockState, properties));
    }

    /** Returns the shared still/flow atlas used by per-block fluid objects. */
    public fluidAtlas(kind: FluidKind, root?: string): Promise<TextureAtlas> {
        const key = new AssetKey("minecraft", kind, "models", "fluid", "assets", ".json", root);
        return cached(this.fluidAtlases, key.serialize(), async () => {
            const atlas = await UVMapper.getAtlas({
                key,
                textures: { still: `minecraft:block/${kind}_still`, flow: `minecraft:block/${kind}_flow` },
                elements: []
            });
            if (!atlas) throw new Error(`Missing ${kind} fluid atlas`);
            return atlas;
        });
    }

    private async prepare(blockState: BlockState, properties: BlockStateProperties): Promise<PreparedState | undefined> {
        const state = { ...await BlockStateResolver.defaults(blockState), ...properties };
        const groups = BlockStateResolver.matching(blockState, state);
        if (!groups.length || groups.some(group => Array.isArray(group) && !group.length)) return undefined;
        const variants = groups.flatMap(group => Array.isArray(group) ? group : [group]);
        if (variants.some(variant => !variant.model)) return undefined;
        const settled = await Promise.allSettled(variants.map(async variant => {
            const modelKey = AssetKey.parse("models", variant.model!);
            modelKey.root = blockState.key?.root;
            const model = await Models.getMerged(modelKey);
            if (!model?.elements?.length) return undefined;
            const atlas = await UVMapper.getAtlas(model);
            const rotation = BlockStateResolver.rotation(variant);
            if (!atlas
                || atlas.image.width > this.maxAtlasSize || atlas.image.height > this.maxAtlasSize) return undefined;
            return { model, atlas, rotation };
        }));
        const prepared = new Map<BlockStateVariant, PreparedVariant>();
        for (const [i, result] of settled.entries()) {
            if (result.status === "rejected") throw result.reason;
            if (!result.value) return undefined;
            prepared.set(variants[i], result.value);
        }
        return { state, groups, choices: prepared };
    }

    private async template(variant: BlockStateVariant, { model, atlas, rotation }: PreparedVariant,
                           tints?: Record<number, number>, biomeTints?: Record<number, number>): Promise<SectionMeshTemplate> {
        let models = this.models.get(model);
        if (!models) this.models.set(model, models = new Map());
        const key = JSON.stringify([rotation.x, rotation.y, rotation.z, variant.uvlock, tints, biomeTints]);
        return cached(models, key, async () => {
            const object = new SectionModel(model, {
                instanceMeshes: false, mergeMeshes: true, tints,
                uvLockRotation: variant.uvlock && (rotation.x !== 0 || rotation.y !== 0)
                    ? [rotation.x, rotation.y, rotation.z] : undefined
            });
            await object.init();
            let geometry = (object.children[0] as Mesh).geometry;
            geometry.applyMatrix4(new Matrix4().makeRotationFromEuler(rotation));
            object.clear();
            const keep: boolean[] = [];
            const cullFaces: number[] = [];
            const biomeTint: number[] | undefined = biomeTints ? [] : undefined;
            for (const element of atlas.model.elements!) {
                for (const face of CUBE_FACES) {
                    const data = element.faces[face];
                    keep.push(data !== undefined);
                    if (!data) continue;
                    biomeTint?.push(Number(data.tintindex !== undefined && biomeTints?.[data.tintindex] !== undefined));
                    const local = CUBE_FACES.findIndex(name => name === data.cullface);
                    if (local < 0) {
                        cullFaces.push(0);
                        continue;
                    }
                    const normal = new Vector3(...CUBE_FACE_OFFSETS[local]).applyEuler(rotation);
                    const world = CUBE_FACE_OFFSETS.findIndex(([x, y, z]) =>
                        Math.abs(normal.x - x) < 1e-6 && Math.abs(normal.y - y) < 1e-6 && Math.abs(normal.z - z) < 1e-6);
                    cullFaces.push(world < 0 ? 0 : 1 << world);
                }
            }
            geometry = compactQuads(geometry, keep);
            const template: SectionMeshTemplate = {
                geometry, atlas, cullFaces: new Uint8Array(cullFaces),
                biomeTint: biomeTint?.some(Boolean) ? new Uint8Array(biomeTint) : undefined,
                occludes: ModelCulling.isOpaqueFullCube(atlas) && ModelCulling.toLocalMask(63, rotation) === 63,
                layer: atlas.hasTranslucency ? 1 : 0, ambientOcclusion: (model as BlockModel).ambientocclusion !== false
            };
            this.templates.add(template);
            return template;
        });
    }

    /** Disposes prepared geometry and clears this world's template caches. */
    public clear(): void {
        for (const template of this.templates) template.geometry.dispose();
        this.templates.clear();
        this.states = new WeakMap();
        this.models = new WeakMap();
        this.fluidAtlases.clear();
    }
}
