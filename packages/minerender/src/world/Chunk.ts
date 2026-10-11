import { Block } from "../model/block/Block";
import { BlockObject } from "../model/block/scene/BlockObject";
import { Color, Vector3 } from "three";
import { Maybe } from "../util/util";
import { BlockInfo } from "./BlockInfo";
import { ChunkData } from "./ChunkData";
import { MineRenderScene } from "../renderer/MineRenderScene";
import { BlockStates } from "../assets/BlockStates";
import { AssetKey } from "../assets/AssetKey";
import { MineRenderWorld } from "./MineRenderWorld";
import { isTripleArray, TripleArray } from "../model/Model";
import { SectionModels } from "./SectionModels";
import { BlockEntities } from "../assets/BlockEntities";
import { SectionFluids, SectionMesh, SectionMeshEntry } from "./SectionMesh";
import { FluidKind, getBlockFluidState } from "../model/fluid/FluidGeometry";
import { fluidKindOf } from "../model/fluid/FluidQuads";
import { BlockState } from "../model/block/BlockState";
import { CUBE_FACE_OFFSETS } from "../CubeFace";
import { BlockTints } from "../model/block/BlockTints";
import { Biomes } from "../assets/Biomes";

const WATER_TINT = new Color(0x3f76e4).toArray() as TripleArray;

/**
 * A 16×16×16 block section and its render objects.
 * Constructor coordinates identify the section. Block accessors use world block coordinates
 * unless their name explicitly refers to positions within the chunk.
 */
export class Chunk<SectionMeshing extends boolean = false> {

    public readonly scene: MineRenderScene; //TODO: should probably be the world

    public readonly x: number;
    public readonly y: number;
    public readonly z: number;

    private readonly data = new ChunkData();
    private readonly renderedBlocks = new Map<number, BlockInfo<SectionMeshing>>();
    private readonly sectionBlocks = new Map<number, SectionMeshEntry[]>();
    private readonly hiddenBlocks = new Set<number>();
    private readonly fluidCells = new Uint8Array(4096);
    private readonly blockPosition = new Vector3();
    private waterTints?: Float32Array;
    private biomes?: readonly string[];
    private sectionMesh?: SectionMesh;
    private meshDirty = false;
    private meshGeneration = 0;

    constructor(scene: MineRenderScene, x: number, y: number, z: number,
                private readonly onBlocksChanged?: (positions: Vector3[]) => Promise<void>,
                private readonly sectionModels?: SectionModels,
                private readonly neighborCell?: (x: number, y: number, z: number) => number,
                private readonly biomeAt?: (x: number, y: number, z: number) => Maybe<string>,
                private readonly onBiomesChanged?: (biomes?: readonly string[]) => Promise<void>,
                private readonly lightAt?: (x: number, y: number, z: number) => number,
                private readonly onLightCleared?: () => Promise<void>,
                private readonly ambientLight = 0) {
        this.scene = scene;
        this.x = x;
        this.y = y;
        this.z = z;
    }

    public getBlockAt(x: number, y: number, z: number): Maybe<BlockInfo<SectionMeshing>>;
    public getBlockAt(pos: Vector3): Maybe<BlockInfo<SectionMeshing>>;
    public getBlockAt(pos: TripleArray): Maybe<BlockInfo<SectionMeshing>>;
    public getBlockAt(posOrX: number | Vector3 | TripleArray, y?: number, z?: number): Maybe<BlockInfo<SectionMeshing>> {
        if (typeof posOrX == "number") {
            return this.getBlockAt(new Vector3(posOrX, y, z));
        }
        if (isTripleArray(posOrX)) {
            return this.getBlockAt(new Vector3(posOrX[0], posOrX[1], posOrX[2]))
        }
        const pos = this.blockPosition.set(posOrX.x - this.x * 16, posOrX.y - this.y * 16, posOrX.z - this.z * 16);
        const index = Chunk.chunkPosToBlockIndex(pos);
        return this.renderedBlocks.get(index);
    }

    /** Returns the saved 4-block biome sample at integer world block coordinates, or `undefined` if absent. */
    public getBiomeAt(x: number, y: number, z: number): Maybe<string>;
    public getBiomeAt(pos: Vector3): Maybe<string>;
    public getBiomeAt(pos: TripleArray): Maybe<string>;
    public getBiomeAt(posOrX: number | Vector3 | TripleArray, y?: number, z?: number): Maybe<string> {
        if (typeof posOrX === "number") return this.getBiomeAt(new Vector3(posOrX, y, z));
        if (isTripleArray(posOrX)) return this.getBiomeAt(new Vector3(...posOrX));
        const pos = this.worldPosToChunkPos(posOrX);
        Chunk.chunkPosToBlockIndex(pos);
        return this.biomeAt ? this.biomeAt(posOrX.x, posOrX.y, posOrX.z)
            : this.biomes?.[Math.floor(pos.x / 4) + Math.floor(pos.z / 4) * 4 + Math.floor(pos.y / 4) * 16];
    }

    /** Copies 64 biome IDs in x + z * 4 + y * 16 order and refreshes placed blocks. Omit the array to clear biome data. */
    public setBiomes(biomes?: readonly string[]): Promise<void> {
        const copy = biomes ? [...biomes] : undefined;
        if (copy && (copy.length !== 64 || !copy.every(id => typeof id === "string" && id.length > 0))) {
            throw new RangeError("Section biomes must contain 64 nonempty biome IDs");
        }
        if (this.onBiomesChanged) return this.onBiomesChanged(copy);
        this.biomes = copy;
        return this.refreshBiomes();
    }

    /** Rebuilds biome-tinted blocks while preserving hidden blocks and unrelated render objects. */
    public async refreshBiomes(): Promise<void> {
        const affected = new Map<string, Promise<boolean>>();
        const blocks: { index: number; block: Block }[] = [];
        for (const index of this.renderedBlocks.keys()) {
            const block = this.data.get(index)!;
            const stateKey = ChunkData.paletteKey(block);
            let matches = affected.get(stateKey);
            if (!matches) {
                const key = AssetKey.parse("blockstates", block.type);
                matches = BlockStates.get(key).then(async state => {
                    const origin = state?.key ?? key;
                    const [source, fluid] = await Promise.all([BlockTints.biomeSource(origin), getBlockFluidState(origin, block.properties)]);
                    return !!source || fluid?.kind === "water";
                });
                affected.set(stateKey, matches);
            }
            if (await matches) blocks.push({ index, block });
        }
        if (!blocks.length) return;
        const hidden = new Set(this.hiddenBlocks);
        try {
            await this.placeBlocks(blocks);
        } finally {
            for (const index of hidden) {
                this.hiddenBlocks.add(index);
                this.renderedBlocks.get(index)?.object?.setVisible(false);
            }
            const positions = blocks.map(({ index }) => new Vector3(...this.positionAt(index)));
            if (this.onBlocksChanged) await this.onBlocksChanged(positions);
            else await this.rebuildSectionMesh();
        }
    }

    /**
     * Places a block at integer world block coordinates. Pass `undefined` to remove it.
     */
    public async setBlockAt(x: number, y: number, z: number, block: Maybe<Block>): Promise<Maybe<BlockInfo<SectionMeshing>>>;
    public async setBlockAt(pos: Vector3, block: Maybe<Block>): Promise<Maybe<BlockInfo<SectionMeshing>>>;
    public async setBlockAt(pos: TripleArray, block: Maybe<Block>): Promise<Maybe<BlockInfo<SectionMeshing>>>;
    public async setBlockAt(posOrX: number | Vector3 | TripleArray, yOrBlock?: number | Block, z?: number, block?: Block): Promise<Maybe<BlockInfo<SectionMeshing>>> {
        if (typeof posOrX == "number") {
            return this.setBlockAt(new Vector3(posOrX, yOrBlock as number, z), block as Block);
        }
        if (isTripleArray(posOrX)) {
            return this.setBlockAt(new Vector3(posOrX[0], posOrX[1], posOrX[2]), yOrBlock as Block);
        }
        const worldPos: Vector3 = posOrX;
        const pos: Vector3 = this.worldPosToChunkPos(worldPos);
        block = yOrBlock as Block;

        return this.setBlockInChunkAt(pos, block, worldPos);
    }

    /**
     * Places a block at integer chunk-local coordinates from 0 to 15.
     */
    public async setBlockInChunkAt(pos: Vector3, block?: Block, worldPos?: Vector3,
                                   onBlocksChanged = this.onBlocksChanged): Promise<Maybe<BlockInfo<SectionMeshing>>> {
        if (typeof worldPos === "undefined") {
            worldPos = this.chunkPosToWorldPos(pos);
        }

        const index = Chunk.chunkPosToBlockIndex(pos);
        try {
            await this.placeBlocks([{ index, block }]);
            return this.renderedBlocks.get(index);
        } finally {
            await onBlocksChanged?.([worldPos]);
        }
    }

    /** Places cells in input order and returns changed world positions without refreshing neighbors. */
    public async placeBlocks(blocks: readonly { index: number; block: Maybe<Block> }[]): Promise<Vector3[]> {
        const placements = blocks.map(({ index, block }) => ({
            index,
            key: block && !ChunkData.isAir(block) ? ChunkData.paletteKey(block) : undefined,
            block: block ? {
                type: block.type,
                properties: block.properties ? { ...block.properties } : undefined,
                nbt: block.nbt === undefined ? undefined : structuredClone(block.nbt)
            } : undefined
        }));
        const states = new Map<string, { stored: Block; indices: number[] }>();
        for (const { index, key, block } of placements) {
            if (key === undefined) continue;
            let state = states.get(key);
            if (!state) states.set(key, state = { stored: block!, indices: [] });
            state.indices.push(index);
        }
        const biomes = new Map<string, Promise<boolean>>();
        const settled = await Promise.allSettled([...states.values()].map(({ stored, indices }) =>
            this.resolveState(stored, indices, biomes)));
        const resolutions = new Map([...states.keys()].map((key, i) => [key, settled[i]]));
        const positions: Vector3[] = [];
        let failed = false, failure: unknown;
        for (const { index, key, block } of placements) {
            this.hiddenBlocks.delete(index);
            this.data.assign(index, this.data.intern(block), block?.nbt);
            const readBlock = this.data.snapshot(index);
            this.renderedBlocks.get(index)?.object?.removeFromScene();
            if (this.sectionBlocks.delete(index)) this.meshDirty = true;
            if (this.fluidCells[index]) this.meshDirty = true;
            this.fluidCells[index] = 0;
            this.renderedBlocks.delete(index);
            const worldPos = new Vector3(this.x * 16 + index % 16, this.y * 16 + Math.floor(index / 256),
                this.z * 16 + Math.floor(index / 16) % 16);
            positions.push(worldPos);
            let object: BlockObject | undefined;
            try {
                if (!readBlock) continue;
                const resolved = resolutions.get(key!)!;
                if (resolved.status === "rejected") throw resolved.reason;
                const { blockState, perBlock, fluid, prepared, contexts, stored } = resolved.value;
                const context = contexts.get(index);
                if (!blockState) {
                    this.data.assign(index, 0);
                    continue;
                }
                const variantPosition = worldPos.toArray();
                if (fluid) {
                    this.fluidCells[index] = (fluid.kind === "water" ? 16 : 32) | Math.min(fluid.level, 8);
                    if (fluid.kind === "water") this.setWaterTint(index, context?.waterTint);
                    this.meshDirty = true;
                }
                const templates = perBlock ? undefined : fluid?.renderModel === false ? [] : (context?.prepared ?? prepared)?.pick(variantPosition);
                if (templates) {
                    this.sectionBlocks.set(index, templates.map(template => ({ index, template, cullMask: 0 })));
                    this.meshDirty = true;
                } else {
                    object = await this.scene.addBlock(blockState, {
                        mergeMeshes: true,
                        instanceMeshes: true,
                        maxInstanceCount: 2000,
                        initialState: stored.properties,
                        variantPosition, biome: context?.biome,
                        biomePosition: this.biomePosition(index, blockState, stored)
                    }) as BlockObject;
                    object.setPosition(MineRenderWorld.worldToScenePosition(worldPos));
                }
                this.renderedBlocks.set(index, { get block() { return readBlock(); }, object } as BlockInfo<SectionMeshing>);
            } catch (error) {
                this.data.assign(index, 0);
                this.fluidCells[index] = 0;
                object?.removeFromScene();
                if (!failed) failure = error;
                failed = true;
            }
        }
        if (failed) throw failure;
        return positions;
    }

    /** Replaces every cell from parsed section data. The caller refreshes neighbor culling. */
    public async placeSection(data: ChunkData): Promise<void> {
        for (const info of this.renderedBlocks.values()) info.object?.removeFromScene();
        this.sectionBlocks.clear();
        this.fluidCells.fill(0);
        this.waterTints = undefined;
        this.renderedBlocks.clear();
        this.hiddenBlocks.clear();
        this.meshDirty = true;
        this.data.copyFrom(data);

        const ids = new Map<number, number[]>();
        for (let index = 0; index < 4096; index++) {
            const id = this.data.idAt(index);
            if (!id) continue;
            let indices = ids.get(id);
            if (!indices) ids.set(id, indices = []);
            indices.push(index);
        }
        const palette = [...ids.keys()], biomes = new Map<string, Promise<boolean>>();
        const settled = await Promise.allSettled(palette.map(id =>
            this.resolveState(this.data.stateAt(id)!, ids.get(id)!, biomes)));
        const resolutions = new Map(palette.map((id, i) => [id, settled[i]]));
        const perBlocks: { index: number; blockState: BlockState; biome?: string }[] = [];
        let failed = false, failure: unknown;
        for (let index = 0; index < 4096; index++) {
            const id = this.data.idAt(index);
            if (!id) continue;
            try {
                const resolved = resolutions.get(id)!;
                if (resolved.status === "rejected") throw resolved.reason;
                const { blockState, perBlock, fluid, prepared, contexts } = resolved.value;
                const context = contexts.get(index);
                if (!blockState) {
                    this.data.assign(index, 0);
                    this.fluidCells[index] = 0;
                    continue;
                }
                if (fluid) {
                    this.fluidCells[index] = (fluid.kind === "water" ? 16 : 32) | Math.min(fluid.level, 8);
                    if (fluid.kind === "water") this.setWaterTint(index, context?.waterTint);
                }
                const variantPosition: TripleArray = [this.x * 16 + index % 16,
                    this.y * 16 + Math.floor(index / 256), this.z * 16 + Math.floor(index / 16) % 16];
                const templates = perBlock ? undefined : fluid?.renderModel === false ? [] : (context?.prepared ?? prepared)?.pick(variantPosition);
                if (templates) {
                    this.sectionBlocks.set(index, templates.map(template => ({ index, template, cullMask: 0 })));
                    this.meshDirty = true;
                } else {
                    perBlocks.push({ index, blockState, biome: context?.biome });
                }
                const readBlock = this.data.snapshot(index)!;
                this.renderedBlocks.set(index, { get block() { return readBlock(); }, object: undefined } as BlockInfo<SectionMeshing>);
            } catch (error) {
                this.data.assign(index, 0);
                this.fluidCells[index] = 0;
                if (!failed) failure = error;
                failed = true;
            }
        }
        for (const { index, blockState, biome } of perBlocks) {
            let object: BlockObject | undefined;
            try {
                object = await this.scene.addBlock(blockState, {
                    mergeMeshes: true,
                    instanceMeshes: true,
                    maxInstanceCount: 2000,
                    initialState: this.data.stateAt(this.data.idAt(index))!.properties,
                    variantPosition: this.positionAt(index), biome,
                    biomePosition: this.biomePosition(index, blockState, this.data.stateAt(this.data.idAt(index))!)
                }) as BlockObject;
                object.setPosition(new Vector3(this.x * 256 + index % 16 * 16,
                    this.y * 256 + Math.floor(index / 256) * 16, this.z * 256 + Math.floor(index / 16) % 16 * 16));
                this.renderedBlocks.get(index)!.object = object;
            } catch (error) {
                this.data.assign(index, 0);
                this.fluidCells[index] = 0;
                this.renderedBlocks.delete(index);
                object?.removeFromScene();
                if (!failed) failure = error;
                failed = true;
            }
        }
        if (failed) throw failure;
    }

    private positionAt(index: number): TripleArray {
        return [this.x * 16 + index % 16, this.y * 16 + Math.floor(index / 256), this.z * 16 + Math.floor(index / 16) % 16];
    }

    /** Refreshes saved lighting after adjacent columns load or unload, including columns with only light data. */
    public async refreshLight(indices?: Iterable<number>): Promise<void> {
        if (!this.lightAt) return;
        for (const index of indices ?? this.renderedBlocks.keys()) {
            if (this.renderedBlocks.has(index)) this.meshDirty = true;
        }
    }

    private biomePosition(index: number, blockState: BlockState, stored: Block): TripleArray {
        const position = this.positionAt(index), name = blockState.key?.toNamespacedString();
        if (stored.properties?.half === "upper" && (name === "minecraft:tall_grass" || name === "minecraft:large_fern")) position[1]--;
        return position;
    }

    private async resolveState(stored: Block, indices: readonly number[], biomes: Map<string, Promise<boolean>>) {
        const blockState = await BlockStates.get(AssetKey.parse("blockstates", stored.type));
        const perBlock = !blockState || !this.sectionModels
            || !!(blockState.key && BlockEntities.entry(await BlockEntities.getIndex(blockState.key.root), blockState.key.toNamespacedString()));
        const fluid = await getBlockFluidState(blockState?.key, stored.properties);
        const hasBiomes = this.getBiomeAt(this.x * 16, this.y * 16, this.z * 16) !== undefined
            || this.biomeAt?.(this.x * 16, this.y * 16 - 1, this.z * 16) !== undefined;
        const source = hasBiomes && blockState ? await BlockTints.biomeSource(blockState.key) : undefined;
        const prepare = (color?: () => Promise<number | undefined>) => perBlock || fluid?.renderModel === false ? undefined
            : this.sectionModels!.prepareState(blockState!, stored.properties, color);
        type Context = { biome?: string; prepared?: Awaited<ReturnType<SectionModels["prepareState"]>>; waterTint?: TripleArray };
        const contexts = new Map<number, Context>();
        const groups = new Map<string, { biome: string; position: TripleArray; indices: number[] }>();
        if (blockState && (source || fluid?.kind === "water")) {
            for (const index of indices) {
                const position = this.biomePosition(index, blockState, stored);
                const biome = this.biomeAt ? this.biomeAt(...position)
                    : position[1] >= this.y * 16 ? this.getBiomeAt(position) : undefined;
                if (!biome) continue;
                const key = JSON.stringify(source === "grass" ? [biome, position[0], position[2]] : [biome]);
                let group = groups.get(key);
                if (!group) groups.set(key, group = { biome, position, indices: [] });
                group.indices.push(index);
            }
        }
        const groupedCount = [...groups.values()].reduce((sum, group) => sum + group.indices.length, 0);
        const prepared = groupedCount < indices.length ? await prepare() : undefined;
        await Promise.all([...groups.values()].map(async ({ biome, position, indices }) => {
            const available = () => {
                const key = JSON.stringify([biome, blockState?.key?.root]);
                let found = biomes.get(key);
                if (!found) {
                    found = Biomes.get(biome, blockState?.key).then(value => value !== undefined);
                    biomes.set(key, found);
                }
                return found;
            };
            const context: Context = { biome };
            if (perBlock) {
                if (!await available()) context.biome = undefined;
            } else {
                context.prepared = await prepare(async () => await available()
                    ? BlockTints.getBiomeColor(blockState?.key, biome, position) : undefined);
                if (fluid?.kind === "water" && await available()) {
                    const color = await Biomes.getColor(biome, "water", blockState?.key);
                    if (color !== undefined && color !== 0x3f76e4) context.waterTint = new Color(color).toArray() as TripleArray;
                }
            }
            for (const index of indices) contexts.set(index, context);
        }));
        return { blockState, perBlock, fluid, prepared, contexts, stored };
    }

    private setWaterTint(index: number, tint?: TripleArray): void {
        if (!this.sectionModels || (!this.waterTints && tint === undefined)) return;
        if (!this.waterTints) {
            this.waterTints = new Float32Array(4096 * 3);
            for (let cell = 0; cell < 4096; cell++) this.waterTints.set(WATER_TINT, cell * 3);
        }
        this.waterTints.set(tint ?? WATER_TINT, index * 3);
    }

    /** Changes visibility at world block coordinates while preserving the block's data. */
    public async setBlockVisibleAt(pos: Vector3, visible: boolean): Promise<void> {
        const index = Chunk.chunkPosToBlockIndex(this.worldPosToChunkPos(pos));
        const block = this.renderedBlocks.get(index);
        if (!block || visible === !this.hiddenBlocks.has(index)) {
            return;
        }
        if (visible) {
            this.hiddenBlocks.delete(index);
        } else {
            this.hiddenBlocks.add(index);
        }
        block.object?.setVisible(visible);
        if (this.sectionBlocks.has(index) || this.fluidCells[index]) {
            this.meshDirty = true;
        }
        this.scene.dirty = true;
        await this.onBlocksChanged?.([pos]);
    }

    public isBlockVisibleAt(pos: Vector3): boolean {
        return this.isBlockVisibleIndex(Chunk.chunkPosToBlockIndex(this.worldPosToChunkPos(pos)));
    }

    /** Reports whether a cell has a visible render object or section entry. */
    public isBlockVisibleIndex(index: number): boolean {
        return this.renderedBlocks.has(index) && !this.hiddenBlocks.has(index);
    }

    /** Fluid kind bits and level of a cell, or 0. Hidden cells report 0. */
    public fluidByteIndex(index: number): number {
        return this.hiddenBlocks.has(index) ? 0 : this.fluidCells[index];
    }

    /** Whether the cell holds a fluid, merged or per-block. */
    public isFluidIndex(index: number): boolean {
        return this.fluidCells[index] !== 0;
    }

    public isOccludingAt(pos: Vector3): boolean {
        return this.isOccludingIndex(Chunk.chunkPosToBlockIndex(this.worldPosToChunkPos(pos)));
    }

    /** Reports whether a visible cell hides neighboring cube faces. */
    public isOccludingIndex(index: number): boolean {
        return !this.hiddenBlocks.has(index)
            && (this.sectionBlocks.get(index)?.some(entry => entry.template.occludes)
                ?? this.renderedBlocks.get(index)?.object?.isOccluding ?? false);
    }

    public async setCullMaskAt(pos: Vector3, mask: number): Promise<void> {
        await this.setCullMaskIndex(Chunk.chunkPosToBlockIndex(this.worldPosToChunkPos(pos)), mask);
    }

    /** Recomputes section masks and returns changed per-block masks. Omit indices to visit every cell. */
    public updateCullMasks(indices: Iterable<number> | undefined, occludes: (x: number, y: number, z: number) => boolean): [number, number][] {
        const changed: [number, number][] = [];
        for (const index of indices ?? this.fluidCells.keys()) {
            if (!this.isBlockVisibleIndex(index)) continue;
            const x = index % 16, y = Math.floor(index / 256), z = Math.floor(index / 16) % 16;
            let mask = 0;
            for (let face = 0; face < CUBE_FACE_OFFSETS.length; face++) {
                const [dx, dy, dz] = CUBE_FACE_OFFSETS[face];
                const nx = x + dx, ny = y + dy, nz = z + dz;
                const inner = nx >= 0 && nx < 16 && ny >= 0 && ny < 16 && nz >= 0 && nz < 16;
                if (inner ? this.isOccludingIndex(ny * 256 + nz * 16 + nx)
                    : occludes(this.x * 16 + nx, this.y * 16 + ny, this.z * 16 + nz)) mask |= 1 << face;
            }
            if (this.fluidCells[index]) this.meshDirty = true;
            const entries = this.sectionBlocks.get(index);
            if (entries) {
                for (const entry of entries) {
                    if (entry.cullMask !== mask) {
                        entry.cullMask = mask;
                        this.meshDirty = true;
                    }
                }
            } else {
                const object = this.renderedBlocks.get(index)?.object;
                if (object && object.cullMask !== mask) changed.push([index, mask]);
            }
        }
        return changed;
    }

    /** Updates hidden faces for a cell's section entry or individual render object. */
    public async setCullMaskIndex(index: number, mask: number): Promise<void> {
        if (this.fluidCells[index]) this.meshDirty = true;
        const entries = this.sectionBlocks.get(index);
        if (entries) {
            for (const entry of entries) {
                if (entry.cullMask !== mask) {
                    entry.cullMask = mask;
                    this.meshDirty = true;
                }
            }
        } else {
            await this.renderedBlocks.get(index)?.object?.setCullMask(mask);
        }
    }

    /** Rebuilds visible section geometry and discards results superseded by another rebuild or clear. */
    public async rebuildSectionMesh(): Promise<void> {
        if (!this.sectionModels || !this.meshDirty) return;
        this.meshDirty = false;
        const generation = ++this.meshGeneration;
        const entries = [...this.sectionBlocks.entries()].flatMap(([index, entries]) => this.hiddenBlocks.has(index) ? [] : entries);
        let fluids: SectionFluids | undefined;
        const origins = new Map<FluidKind, string>();
        for (let index = 0; index < this.fluidCells.length; index++) {
            const kind = fluidKindOf(this.fluidCells[index]);
            if (!kind || origins.has(kind) || this.hiddenBlocks.has(index)) continue;
            const block = this.renderedBlocks.get(index);
            if (block && !block.object) origins.set(kind, block.block.type);
        }
        if (origins.size) {
            fluids = { cells: new Uint8Array(18 * 18 * 18), waterTints: this.waterTints?.slice() };
            for (let y = -1; y <= 16; y++) {
                for (let z = -1; z <= 16; z++) {
                    for (let x = -1; x <= 16; x++) {
                        const index = y * 256 + z * 16 + x;
                        const inner = x >= 0 && x < 16 && y >= 0 && y < 16 && z >= 0 && z < 16;
                        fluids.cells[(y + 1) * 324 + (z + 1) * 18 + x + 1] = inner
                            ? this.fluidByteIndex(index) | (this.renderedBlocks.get(index)?.object ? 128 : 0)
                                | (this.isOccludingIndex(index) ? 64 : 0)
                            : this.neighborCell?.(this.x * 16 + x, this.y * 16 + y, this.z * 16 + z) ?? 0;
                    }
                }
            }
            for (const [kind, type] of origins) {
                const state = await BlockStates.get(AssetKey.parse("blockstates", type));
                fluids[kind] = await this.sectionModels.fluidAtlas(kind, state?.key?.root);
            }
        }
        let light: Uint8Array | undefined;
        if (this.lightAt) {
            light = new Uint8Array(18 * 18 * 18);
            for (let y = -1; y <= 16; y++) {
                for (let z = -1; z <= 16; z++) {
                    for (let x = -1; x <= 16; x++) {
                        light[(y + 1) * 324 + (z + 1) * 18 + x + 1] = this.lightAt(this.x * 16 + x, this.y * 16 + y, this.z * 16 + z);
                    }
                }
            }
        }
        const next = entries.length || fluids ? await SectionMesh.buildAsync(entries, this.sectionModels.maxAtlasSize, fluids,
            light ? { light, ambientLight: this.ambientLight } : undefined) : undefined;
        if (generation !== this.meshGeneration) {
            next?.dispose();
            return;
        }
        this.sectionMesh?.dispose();
        this.sectionMesh = next;
        if (next) {
            next.position.set(this.x * 256, this.y * 256, this.z * 256);
            this.scene.add(next);
        }
        this.scene.dirty = true;
    }

    /** Removes stored blocks and render objects. Set `notify` to false to skip the owning world's update. */
    public async clear(notify = true): Promise<void> {
        const positions = notify && this.onBlocksChanged ? [...this.renderedBlocks.keys()].map(index => this.chunkPosToWorldPos(
            new Vector3(index % 16, Math.floor(index / 256), Math.floor(index / 16) % 16)
        )) : [];
        for (const info of this.renderedBlocks.values()) info.object?.removeFromScene();
        this.sectionBlocks.clear();
        this.meshGeneration++;
        this.sectionMesh?.dispose();
        this.sectionMesh = undefined;
        this.meshDirty = false;
        this.renderedBlocks.clear();
        this.hiddenBlocks.clear();
        this.fluidCells.fill(0);
        this.waterTints = undefined;
        this.data.clear();
        this.biomes = undefined;
        if (notify) {
            await this.onBiomesChanged?.(undefined);
            await this.onLightCleared?.();
            await this.onBlocksChanged?.(positions);
        }
    }

    public async dispose(): Promise<void> {
        await this.clear();
    }

    static isAir(block: Maybe<Block>): boolean {
        return ChunkData.isAir(block);
    }

    /** Maps chunk-local coordinates from 0 to 15 to a storage index, with x varying fastest, then z, then y. */
    static chunkPosToBlockIndex(pos: Vector3): number {
        if ([pos.x, pos.y, pos.z].some(value => !Number.isInteger(value) || value < 0 || value >= 16)) {
            throw new RangeError("Block coordinates must be integers from 0 to 15 within a chunk");
        }
        return (pos.y * 16 * 16) + (pos.z * 16) + pos.x;
    }

    worldPosToChunkPos(pos: Vector3): Vector3 {
        return new Vector3(
            pos.x - (this.x * 16),
            pos.y - (this.y * 16),
            pos.z - (this.z * 16)
        )
    }

    chunkPosToWorldPos(pos: Vector3): Vector3 {
        return new Vector3(
            (this.x * 16) + pos.x,
            (this.y * 16) + pos.y,
            (this.z * 16) + pos.z
        );
    }

}
