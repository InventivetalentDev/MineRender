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
        type Resolved = { blockState: Maybe<BlockState>; perBlock: boolean };
        const resolutions = new Map<string, Promise<Resolved>>();
        for (const { block } of blocks) {
            if (!block || ChunkData.isAir(block)) continue;
            const key = ChunkData.paletteKey(block);
            if (resolutions.has(key)) continue;
            const stored = { type: block.type, properties: block.properties ? { ...block.properties } : undefined };
            const resolved = (async () => {
                const blockState = await BlockStates.get(AssetKey.parse("blockstates", stored.type));
                const perBlock = !blockState || !this.sectionModels
                    || !!(blockState.key && BlockEntities.entry(await BlockEntities.getIndex(blockState.key.root), blockState.key.toNamespacedString()));
                if (!perBlock && getBlockFluidState(blockState!.key, stored.properties)?.renderModel !== false) {
                    await this.sectionModels!.get(blockState!, stored.properties);
                }
                return { blockState, perBlock };
            })();
            resolutions.set(key, resolved);
            // Later states can reject while placement awaits an earlier state.
            void resolved.catch(() => undefined);
        }
        const positions: Vector3[] = [];
        let failed = false, failure: unknown;
        for (const { index, block } of blocks) {
            this.hiddenBlocks.delete(index);
            this.data.set(index, block);
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
                const stored = readBlock();
                const key = ChunkData.paletteKey(stored);
                const { blockState, perBlock } = await resolutions.get(key)!;
                if (!blockState) {
                    this.data.set(index, undefined);
                    continue;
                }
                const variantPosition = worldPos.toArray();
                const fluid = getBlockFluidState(blockState.key, stored.properties);
                if (fluid) {
                    this.fluidCells[index] = (fluid.kind === "water" ? 16 : 32) | Math.min(fluid.level, 8);
                    this.meshDirty = true;
                }
                const templates = perBlock ? undefined : fluid?.renderModel === false ? []
                    : await this.sectionModels!.get(blockState, stored.properties, variantPosition);
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
                this.data.set(index, undefined);
                this.fluidCells[index] = 0;
                object?.removeFromScene();
                if (!failed) failure = error;
                failed = true;
            }
        }
        if (failed) throw failure;
        return positions;
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
                            ? (this.renderedBlocks.get(index)?.object ? 0 : this.fluidByteIndex(index))
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
    public async clear(onBlocksChanged = this.onBlocksChanged): Promise<void> {
        const positions = [...this.renderedBlocks.keys()].map(index => this.chunkPosToWorldPos(
            new Vector3(index % 16, Math.floor(index / 256), Math.floor(index / 16) % 16)
        ));
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
