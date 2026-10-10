import { Block } from "../model/block/Block";
import { BlockObject } from "../model/block/scene/BlockObject";
import { Vector3 } from "three";
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
    private sectionMesh?: SectionMesh;
    private meshDirty = false;
    private meshGeneration = 0;

    constructor(scene: MineRenderScene, x: number, y: number, z: number,
                private readonly onBlocksChanged?: (positions: Vector3[]) => Promise<void>,
                private readonly sectionModels?: SectionModels,
                private readonly neighborCell?: (x: number, y: number, z: number) => number) {
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
        const states = new Map(placements.filter(({ key }) => key !== undefined).map(({ key, block }) => [key!, block!]));
        const settled = await Promise.allSettled([...states.values()].map(async stored => {
            const blockState = await BlockStates.get(AssetKey.parse("blockstates", stored.type));
            const perBlock = !blockState || !this.sectionModels
                || !!(blockState.key && BlockEntities.entry(await BlockEntities.getIndex(blockState.key.root), blockState.key.toNamespacedString()));
            const fluid = getBlockFluidState(blockState?.key, stored.properties);
            const prepared = perBlock || fluid?.renderModel === false ? undefined
                : await this.sectionModels!.prepareState(blockState!, stored.properties);
            return { blockState, perBlock, fluid, prepared, stored };
        }));
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
                const { blockState, perBlock, fluid, prepared, stored } = resolved.value;
                if (!blockState) {
                    this.data.assign(index, 0);
                    continue;
                }
                const variantPosition = worldPos.toArray();
                if (fluid) {
                    this.fluidCells[index] = (fluid.kind === "water" ? 16 : 32) | Math.min(fluid.level, 8);
                    this.meshDirty = true;
                }
                const templates = perBlock ? undefined : fluid?.renderModel === false ? [] : prepared?.pick(variantPosition);
                if (templates) {
                    this.sectionBlocks.set(index, templates.map(template => ({ index, template, cullMask: 0 })));
                    this.meshDirty = true;
                } else {
                    object = await this.scene.addBlock(blockState, {
                        mergeMeshes: true,
                        instanceMeshes: true,
                        maxInstanceCount: 2000,
                        initialState: stored.properties,
                        variantPosition
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
        this.renderedBlocks.clear();
        this.hiddenBlocks.clear();
        this.meshDirty = true;
        this.data.copyFrom(data);

        const ids = new Set<number>();
        for (let index = 0; index < 4096; index++) {
            const id = this.data.idAt(index);
            if (id) ids.add(id);
        }
        const palette = [...ids];
        const settled = await Promise.allSettled(palette.map(async id => {
            const state = this.data.stateAt(id)!;
            const blockState = await BlockStates.get(AssetKey.parse("blockstates", state.type));
            const perBlock = !blockState || !this.sectionModels
                || !!(blockState.key && BlockEntities.entry(await BlockEntities.getIndex(blockState.key.root), blockState.key.toNamespacedString()));
            const fluid = getBlockFluidState(blockState?.key, state.properties);
            const prepared = perBlock || fluid?.renderModel === false ? undefined
                : await this.sectionModels!.prepareState(blockState!, state.properties);
            return { blockState, perBlock, fluid, prepared };
        }));
        const resolutions = new Map(palette.map((id, i) => [id, settled[i]]));
        const perBlocks: { index: number; blockState: BlockState }[] = [];
        let failed = false, failure: unknown;
        for (let index = 0; index < 4096; index++) {
            const id = this.data.idAt(index);
            if (!id) continue;
            try {
                const resolved = resolutions.get(id)!;
                if (resolved.status === "rejected") throw resolved.reason;
                const { blockState, perBlock, fluid, prepared } = resolved.value;
                if (!blockState) throw new Error(`Missing block state ${this.data.stateAt(id)!.type}`);
                if (fluid) this.fluidCells[index] = (fluid.kind === "water" ? 16 : 32) | Math.min(fluid.level, 8);
                const variantPosition: TripleArray = [this.x * 16 + index % 16,
                    this.y * 16 + Math.floor(index / 256), this.z * 16 + Math.floor(index / 16) % 16];
                const templates = perBlock ? undefined : fluid?.renderModel === false ? [] : prepared?.pick(variantPosition);
                if (templates) {
                    this.sectionBlocks.set(index, templates.map(template => ({ index, template, cullMask: 0 })));
                } else {
                    perBlocks.push({ index, blockState });
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
        for (const { index, blockState } of perBlocks) {
            let object: BlockObject | undefined;
            try {
                object = await this.scene.addBlock(blockState, {
                    mergeMeshes: true,
                    instanceMeshes: true,
                    maxInstanceCount: 2000,
                    initialState: this.data.stateAt(this.data.idAt(index))!.properties,
                    variantPosition: [this.x * 16 + index % 16,
                        this.y * 16 + Math.floor(index / 256), this.z * 16 + Math.floor(index / 16) % 16]
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
                if (object && object["_cullMask"] !== mask) changed.push([index, mask]);
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
            fluids = { cells: new Uint8Array(18 * 18 * 18) };
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
        const next = entries.length || fluids ? await SectionMesh.buildAsync(entries, this.sectionModels.maxAtlasSize, fluids) : undefined;
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

    /** Removes stored blocks and their render objects, then notifies the owning world of changed positions. */
    public async clear(onBlocksChanged?: (positions: Vector3[]) => Promise<void>): Promise<void> {
        if (!arguments.length) onBlocksChanged = this.onBlocksChanged;
        const positions = onBlocksChanged ? [...this.renderedBlocks.keys()].map(index => this.chunkPosToWorldPos(
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
        this.data.clear();
        await onBlocksChanged?.(positions);
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
