import { MineRenderScene } from "../renderer/MineRenderScene";
import { Block } from "../model/block/Block";
import { Vector3 } from "three";
import { isTripleArray, TripleArray } from "../model/Model";
import { Maybe, yieldToEventLoop } from "../util/util";
import { Chunk } from "./Chunk";
import { BlockInfo } from "./BlockInfo";
import { MultiBlockBlock, MultiBlockStructure } from "../model/multiblock/MultiBlockStructure";
import { BatchedExecutor } from "../util/BatchedExecutor";
import { AssetKey } from "../assets/AssetKey";
import { BlockStates } from "../assets/BlockStates";
import { CUBE_FACE_OFFSETS } from "../CubeFace";
import type { AnvilChunk } from "./AnvilParser";
import { SectionModels } from "./SectionModels";
import { WorldEntities } from "./_entities/WorldEntities";

//TODO: maybe make this an Object3D to add children
/**
 * Stores and renders blocks in sparse 16×16×16 chunks.
 * Positions use integer block coordinates, including negatives. One block is 16 scene units.
 * Set `options.sectionMeshing` in `new MineRenderWorld(scene, options)` to merge compatible terrain.
 */
export class MineRenderWorld<SectionMeshing extends boolean = false> {

    public readonly scene: MineRenderScene;

    private readonly _chunks: Map<string, Chunk<SectionMeshing>> = new Map();
    private readonly sectionModels?: SectionModels;
    private readonly entities?: WorldEntities;
    private readonly pendingCulling = new Map<Chunk<SectionMeshing>, Set<number>>();
    private culling?: Promise<void>;

    constructor(scene: MineRenderScene, options: MineRenderWorldOptions<SectionMeshing> = {}) {
        this.scene = scene;
        if (options.sectionMeshing) this.sectionModels = new SectionModels(options.maxAtlasSize);
        if (options.renderEntities) this.entities = new WorldEntities(scene);
    }

    /** Returns a placed block at world block coordinates, or `undefined` for an empty position. */
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
        this.validatePosBounds(posOrX);
        return this.getChunkAt(posOrX)?.getBlockAt(posOrX);
    }

    /**
     * Places or replaces a block and refreshes neighboring faces.
     * Pass `undefined` or an air block to remove the block at these world block coordinates.
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
        return this.placeBlock(posOrX, yOrBlock as Maybe<Block>);
    }

    private async placeBlock(pos: Vector3, value: Maybe<Block>, onBlocksChanged?: (positions: Vector3[]) => Promise<void>): Promise<Maybe<BlockInfo<SectionMeshing>>> {
        this.validatePosBounds(pos);
        const chunk = Chunk.isAir(value) ? this.getChunkAt(pos) : this.getOrCreateChunkAt(pos);
        return chunk?.setBlockInChunkAt(chunk.worldPosToChunkPos(pos), value, pos, onBlocksChanged);
    }

    /**
     * Shows or hides a placed block without changing its data. Hidden blocks do not occlude neighbors.
     * Missing blocks are ignored; replacing or removing a block resets its visibility.
     */
    public async setBlockVisibleAt(x: number, y: number, z: number, visible: boolean): Promise<void>;
    public async setBlockVisibleAt(pos: Vector3, visible: boolean): Promise<void>;
    public async setBlockVisibleAt(pos: TripleArray, visible: boolean): Promise<void>;
    public async setBlockVisibleAt(posOrX: number | Vector3 | TripleArray, yOrVisible: number | boolean,
                                   z?: number, visible?: boolean): Promise<void> {
        if (typeof posOrX === "number") {
            return this.setBlockVisibleAt(new Vector3(posOrX, yOrVisible as number, z), visible!);
        }
        if (isTripleArray(posOrX)) {
            return this.setBlockVisibleAt(new Vector3(...posOrX), yOrVisible as boolean);
        }
        this.validatePosBounds(posOrX);
        await this.getChunkAt(posOrX)?.setBlockVisibleAt(posOrX, yOrVisible as boolean);
    }


    /**
     * Places a structure's blocks at their stored positions, then refreshes neighboring faces.
     * With `renderEntities`, also places supported saved mobs and applies supported appearance fields.
     *
     * @param useBatches - Yields between chunks by default. Set to `false` for sequential placement.
     * @param executor - Optional queue for batched placement. The caller remains responsible for stopping it.
     */
    public async placeMultiBlock(multiblock: MultiBlockStructure, useBatches: boolean = true, executor?: BatchedExecutor): Promise<void> {
        const placeEntities = this.entities?.prepare(multiblock.entities);
        const changes = new Map<string, Vector3>();
        try {
            await this.placeBlocks(multiblock, useBatches, executor, changes);
            await placeEntities?.();
        } finally {
            await this.updateCulling([...changes.values()]);
        }
    }

    private async placeBlocks(multiblock: MultiBlockStructure, useBatches: boolean, executor: BatchedExecutor | undefined,
                              changes: Map<string, Vector3>): Promise<void> {
        const collect = async (positions: Vector3[]) => {
            for (const pos of positions) changes.set(pos.toArray().join(","), pos);
        };
        const place = (block: MultiBlockBlock) => this.placeBlock(new Vector3(...block.position), block, collect);
        const keys = new Map<string, AssetKey>();
        const types = new Set<string>();
        for (const block of multiblock.blocks) {
            if (Chunk.isAir(block) || types.has(block.type)) continue;
            types.add(block.type);
            const key = AssetKey.parse("blockstates", block.type);
            keys.set(key.serialize(), key);
        }
        await BlockStates.getAll(keys.values());

        if (!useBatches) {
            for (const block of multiblock.blocks) await place(block);
            return;
        }

        if (!executor) {
            const groups = new Map<Chunk<SectionMeshing>, { index: number; block: Maybe<Block> }[]>();
            const position = new Vector3();
            for (const block of multiblock.blocks) {
                const [x, y, z] = block.position;
                this.validatePosBounds(position.set(x, y, z));
                const cx = Math.floor(x / 16), cy = Math.floor(y / 16), cz = Math.floor(z / 16);
                const key = `${cx}_${cy}_${cz}`;
                const chunk = this._chunks.get(key) ?? (Chunk.isAir(block) ? undefined : this.getOrCreateChunkAt(position));
                if (!chunk) continue;
                let group = groups.get(chunk);
                if (!group) groups.set(chunk, group = []);
                group.push({ index: (y - cy * 16) * 256 + (z - cz * 16) * 16 + x - cx * 16, block });
            }
            await this.placeChunkGroups(groups, changes);
            return;
        }

        // Writes to the same position retain their input order.
        const positions = new Map<string, MultiBlockBlock[]>();
        for (const block of multiblock.blocks) {
            const key = block.position.join(",");
            const group = positions.get(key);
            if (group) group.push(block);
            else positions.set(key, [block]);
        }
        const groups = [...positions.values()];
        for (let i = 0; i < groups.length; i += executor.batch) {
            const results = await Promise.allSettled(groups.slice(i, i + executor.batch).map(blocks =>
                executor.submit(async () => {
                    for (const block of blocks) await place(block);
                })
            ));
            const failure = results.find(result => result.status === "rejected");
            if (failure?.status === "rejected") throw failure.reason;
        }
    }

    private async placeChunkGroups(groups: Map<Chunk<SectionMeshing>, { index: number; block: Maybe<Block> }[]>,
                                   changes: Map<string, Vector3>): Promise<void> {
        let sliceStart = performance.now();
        for (const [chunk, blocks] of groups) {
            let positions: Vector3[] | undefined;
            try {
                positions = await chunk.placeBlocks(blocks);
            } finally {
                // Failed groups still clear cells and place their remaining blocks.
                positions ??= blocks.map(({ index }) => new Vector3(chunk.x * 16 + index % 16,
                    chunk.y * 16 + Math.floor(index / 256), chunk.z * 16 + Math.floor(index / 16) % 16));
                for (const pos of positions) changes.set(`${pos.x},${pos.y},${pos.z}`, pos);
            }
            if (performance.now() - sliceStart > 8) {
                await yieldToEventLoop();
                sliceStart = performance.now();
            }
        }
    }


    /** Replaces a chunk column's blocks and, with `renderEntities`, its supported saved mobs. */
    public async placeChunk(chunk: AnvilChunk, executor?: BatchedExecutor): Promise<void> {
        this.entities?.clearColumn(chunk.x, chunk.z);
        const placeEntities = this.entities?.prepare(chunk.entities, [chunk.x, chunk.z]);
        const changes = new Map<string, Vector3>();
        try {
            await this.clearChunkColumn(chunk.x, chunk.z, changes);
            const groups = new Map<Chunk<SectionMeshing>, { index: number; block: Maybe<Block> }[]>();
            for (const section of chunk.sections) {
                if (!executor) {
                    const blocks: { index: number; block: Maybe<Block> }[] = [];
                    for (let index = 0; index < 4096; index++) {
                        const block = section.data.get(index);
                        if (block) blocks.push({ index, block });
                    }
                    if (blocks.length) {
                        const position = new Vector3(chunk.x * 16, section.y * 16, chunk.z * 16);
                        this.validatePosBounds(position);
                        const target = this.getOrCreateChunkAt(position);
                        const previous = groups.get(target);
                        if (previous) previous.push(...blocks);
                        else groups.set(target, blocks);
                    }
                    continue;
                }
                const blocks: MultiBlockBlock[] = [];
                for (let index = 0; index < 4096; index++) {
                    const block = section.data.get(index);
                    if (block) blocks.push({
                        ...block,
                        position: [chunk.x * 16 + index % 16,
                            section.y * 16 + Math.floor(index / 256),
                            chunk.z * 16 + Math.floor(index / 16) % 16]
                    });
                }
                await this.placeBlocks({ size: [16, 16, 16], blocks }, true, executor, changes);
            }
            if (!executor) await this.placeChunkGroups(groups, changes);
            await placeEntities?.();
        } finally {
            await this.updateCulling([...changes.values()]);
        }
    }

    /**
     * Removes blocks and owned entities at chunk-column coordinates, then refreshes neighboring faces and fluids.
     * Coordinates match AnvilChunk.x/z, not block positions. Missing columns are ignored.
     */
    public async unloadChunkColumn(x: number, z: number): Promise<void> {
        if (!Number.isInteger(x) || !Number.isInteger(z)) {
            throw new RangeError("Chunk column coordinates must be integers");
        }
        this.entities?.clearColumn(x, z);
        await this.culling;
        const changes = new Map<string, Vector3>();
        try {
            await this.clearChunkColumn(x, z, changes);
        } finally {
            await this.updateCulling([...changes.values()]);
        }
    }

    private async clearChunkColumn(x: number, z: number, changes: Map<string, Vector3>): Promise<void> {
        const previous = [...this._chunks.entries()].filter(([, section]) => section.x === x && section.z === z);
        for (const [key, section] of previous) {
            this._chunks.delete(key);
            await section.clear(async positions => {
                for (const pos of positions) changes.set(pos.toArray().join(","), pos);
            });
        }
    }

    /** Removes all chunks and releases their blocks, section meshes, and owned entities. */
    public async clear(): Promise<void> {
        this.entities?.clear();
        await this.culling;
        const chunks = [...this._chunks.values()];
        this._chunks.clear();
        for (const chunk of chunks) {
            await chunk.dispose();
        }
        this.sectionModels?.clear();
    }

    private updateCulling(positions: Vector3[]): Promise<void> {
        const neighbor = new Vector3();
        for (const pos of positions) {
            const cx = Math.floor(pos.x / 16), cy = Math.floor(pos.y / 16), cz = Math.floor(pos.z / 16);
            const chunk = this._chunks.get(`${cx}_${cy}_${cz}`);
            const lx = pos.x - cx * 16, ly = pos.y - cy * 16, lz = pos.z - cz * 16;
            // Fluid corner heights and flow also depend on diagonal neighbors and their vertical neighbors.
            for (let y = -1; y <= 1; y++) {
                for (let z = -1; z <= 1; z++) {
                    for (let x = -1; x <= 1; x++) {
                        const nx = lx + x, ny = ly + y, nz = lz + z;
                        const section = nx >= 0 && nx < 16 && ny >= 0 && ny < 16 && nz >= 0 && nz < 16 ? chunk
                            : this._chunks.get(`${cx + Math.floor(nx / 16)}_${cy + Math.floor(ny / 16)}_${cz + Math.floor(nz / 16)}`);
                        if (!section) continue;
                        const index = (ny & 15) * 256 + (nz & 15) * 16 + (nx & 15);
                        let pending = this.pendingCulling.get(section);
                        if (pending?.has(index)) continue;
                        if (Math.abs(x) + Math.abs(y) + Math.abs(z) > 1
                            && !section.getBlockAt(neighbor.set(pos.x + x, pos.y + y, pos.z + z))?.object?.fluidKind) continue;
                        if (!pending) this.pendingCulling.set(section, pending = new Set());
                        pending.add(index);
                    }
                }
            }
        }
        // Adjacent batched placements share one drain so they cannot replace the same model concurrently.
        return this.culling ??= Promise.resolve().then(async () => {
            try {
                while (this.pendingCulling.size) {
                    const batch = [...this.pendingCulling];
                    this.pendingCulling.clear();
                    for (const [chunk, indices] of batch) {
                        for (const index of indices) {
                            if (!chunk.isBlockVisibleIndex(index)) continue;
                            const lx = index % 16, ly = Math.floor(index / 256), lz = Math.floor(index / 16) % 16;
                            const wx = chunk.x * 16 + lx, wy = chunk.y * 16 + ly, wz = chunk.z * 16 + lz;
                            const block = chunk.getBlockAt(neighbor.set(wx, wy, wz))!;
                            if (block.object?.fluidKind) {
                                await block.object.updateFluid((x, y, z) => {
                                    const nx = lx + x, ny = ly + y, nz = lz + z;
                                    const section = nx >= 0 && nx < 16 && ny >= 0 && ny < 16 && nz >= 0 && nz < 16 ? chunk
                                        : this._chunks.get(`${chunk.x + Math.floor(nx / 16)}_${chunk.y + Math.floor(ny / 16)}_${chunk.z + Math.floor(nz / 16)}`);
                                    const neighborIndex = (ny & 15) * 256 + (nz & 15) * 16 + (nx & 15);
                                    const object = section?.isBlockVisibleIndex(neighborIndex)
                                        ? section.getBlockAt(neighbor.set(wx + x, wy + y, wz + z))?.object : undefined;
                                    return { fluid: object?.fluidKind, level: object?.fluidLevel,
                                        solid: section?.isOccludingIndex(neighborIndex) ?? false };
                                });
                            }
                            let mask = 0;
                            for (let face = 0; face < CUBE_FACE_OFFSETS.length; face++) {
                                const offset = CUBE_FACE_OFFSETS[face];
                                const nx = lx + offset[0], ny = ly + offset[1], nz = lz + offset[2];
                                const section = nx >= 0 && nx < 16 && ny >= 0 && ny < 16 && nz >= 0 && nz < 16 ? chunk
                                    : this._chunks.get(`${chunk.x + Math.floor(nx / 16)}_${chunk.y + Math.floor(ny / 16)}_${chunk.z + Math.floor(nz / 16)}`);
                                if (section?.isOccludingIndex((ny & 15) * 256 + (nz & 15) * 16 + (nx & 15))) mask |= 1 << face;
                            }
                            await chunk.setCullMaskIndex(index, mask);
                        }
                    }
                    await Promise.all(batch.map(([chunk]) => chunk.rebuildSectionMesh()));
                }
            } finally {
                this.culling = undefined;
            }
        });
    }

    private getOrCreateChunkAt(pos: Vector3): Chunk<SectionMeshing> {
        const key = this.worldPosToChunkKey(pos);
        let chunk = this._chunks.get(key);
        if (typeof chunk === "undefined") {
            chunk = new Chunk<SectionMeshing>(this.scene, Math.floor(pos.x / 16), Math.floor(pos.y / 16), Math.floor(pos.z / 16),
                positions => this.updateCulling(positions), this.sectionModels);
            this._chunks.set(key, chunk);
        }
        return chunk;
    }

    /** Returns the loaded chunk containing a world block position, without creating a chunk. */
    public getChunkAt(pos: Vector3): Maybe<Chunk<SectionMeshing>> {
        return this._chunks.get(this.worldPosToChunkKey(pos));
    }


    /** Converts block coordinates to scene units by multiplying each component by 16. */
    static worldToScenePosition(pos: Vector3): Vector3 {
        return new Vector3(
            pos.x * 16.0,
            pos.y * 16.0,
            pos.z * 16.0
        );
    }

    /** Converts scene units to block coordinates without rounding to an integer block. */
    static sceneToWorldPosition(pos: Vector3): Vector3 {
        return new Vector3(
            pos.x / 16.0,
            pos.y / 16.0,
            pos.z / 16.0
        );
    }

    worldPosToChunkKey(pos: Vector3): string {
        const chunkX = Math.floor(pos.x / 16);
        const chunkY = Math.floor(pos.y / 16);
        const chunkZ = Math.floor(pos.z / 16);
        return `${chunkX}_${chunkY}_${chunkZ}`;
    }

    validatePosBounds(pos: Vector3): void {
        if (![pos.x, pos.y, pos.z].every(Number.isInteger)) {
            throw new RangeError("Block coordinates must be integers");
        }
    }

}


/** Settings passed as the second argument to `new MineRenderWorld(scene, options)`. */
export interface MineRenderWorldOptions<SectionMeshing extends boolean = boolean> {
    /** Render supported saved mobs at their position and yaw, including supported appearance fields. Defaults to false. */
    renderEntities?: boolean;
    /** Merge static opaque cubes into section meshes. Merged blocks have no individual object. */
    sectionMeshing?: SectionMeshing;
    /** Maximum width and height of each section atlas page, in pixels. */
    maxAtlasSize?: number;
}
