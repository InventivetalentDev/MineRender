import { MineRenderScene } from "../renderer/MineRenderScene";
import { Block } from "../model/block/Block";
import { Vector3 } from "three";
import { isTripleArray, TripleArray } from "../model/Model";
import { Maybe } from "../util/util";
import { Chunk } from "./Chunk";
import { BlockInfo } from "./BlockInfo";
import { MultiBlockBlock, MultiBlockStructure } from "../model/multiblock/MultiBlockStructure";
import { BatchedExecutor } from "../util/BatchedExecutor";
import { AssetKey } from "../assets/AssetKey";
import { BlockStates } from "../assets/BlockStates";
import { CUBE_FACE_OFFSETS } from "../CubeFace";
import type { AnvilChunk } from "./AnvilParser";

//TODO: maybe make this an Object3D to add children
export class MineRenderWorld {

    public readonly scene: MineRenderScene;

    private readonly _chunks: Map<string, Chunk> = new Map<string, Chunk>();
    private readonly pendingCulling = new Map<string, Vector3>();
    private culling?: Promise<void>;

    constructor(scene: MineRenderScene) {
        this.scene = scene;
    }

    public getBlockAt(x: number, y: number, z: number): Maybe<BlockInfo>;
    public getBlockAt(pos: Vector3): Maybe<BlockInfo>;
    public getBlockAt(pos: TripleArray): Maybe<BlockInfo>;
    public getBlockAt(posOrX: number | Vector3 | TripleArray, y?: number, z?: number): Maybe<BlockInfo> {
        if (typeof posOrX == "number") {
            return this.getBlockAt(new Vector3(posOrX, y, z));
        }
        if (isTripleArray(posOrX)) {
            return this.getBlockAt(new Vector3(posOrX[0], posOrX[1], posOrX[2]))
        }
        this.validatePosBounds(posOrX);
        return this.getChunkAt(posOrX)?.getBlockAt(posOrX);
    }

    public async setBlockAt(x: number, y: number, z: number, block: Maybe<Block>): Promise<Maybe<BlockInfo>>;
    public async setBlockAt(pos: Vector3, block: Maybe<Block>): Promise<Maybe<BlockInfo>>;
    public async setBlockAt(pos: TripleArray, block: Maybe<Block>): Promise<Maybe<BlockInfo>>;
    public async setBlockAt(posOrX: number | Vector3 | TripleArray, yOrBlock?: number | Block, z?: number, block?: Block): Promise<Maybe<BlockInfo>> {
        if (typeof posOrX == "number") {
            return this.setBlockAt(new Vector3(posOrX, yOrBlock as number, z), block as Block);
        }
        if (isTripleArray(posOrX)) {
            return this.setBlockAt(new Vector3(posOrX[0], posOrX[1], posOrX[2]), yOrBlock as Block);
        }
        return this.placeBlock(posOrX, yOrBlock as Maybe<Block>);
    }

    private async placeBlock(pos: Vector3, value: Maybe<Block>, onBlocksChanged?: (positions: Vector3[]) => Promise<void>): Promise<Maybe<BlockInfo>> {
        this.validatePosBounds(pos);
        const chunk = Chunk.isAir(value) ? this.getChunkAt(pos) : this.getOrCreateChunkAt(pos);
        return chunk?.setBlockInChunkAt(chunk.worldPosToChunkPos(pos), value, pos, onBlocksChanged);
    }


    public async placeMultiBlock(multiblock: MultiBlockStructure, useBatches: boolean = true, executor?: BatchedExecutor): Promise<void> {
        const changes = new Map<string, Vector3>();
        try {
            await this.placeBlocks(multiblock, useBatches, executor, changes);
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
        for (const block of multiblock.blocks) {
            if (Chunk.isAir(block)) continue;
            const key = AssetKey.parse("blockstates", block.type);
            keys.set(key.serialize(), key);
        }
        await BlockStates.getAll(keys.values());

        if (!useBatches) {
            for (const block of multiblock.blocks) await place(block);
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
        const queue = executor ?? new BatchedExecutor();
        try {
            for (let i = 0; i < groups.length; i += queue.batch) {
                const results = await Promise.allSettled(groups.slice(i, i + queue.batch).map(blocks =>
                    queue.submit(async () => {
                        for (const block of blocks) await place(block);
                    })
                ));
                const failure = results.find(result => result.status === "rejected");
                if (failure?.status === "rejected") throw failure.reason;
            }
        } finally {
            if (!executor) queue.stop();
        }
    }


    /** Replaces one chunk column's blocks. Entity NBT remains available on the parsed chunk. */
    public async placeChunk(chunk: AnvilChunk, executor?: BatchedExecutor): Promise<void> {
        const changes = new Map<string, Vector3>();
        try {
            const previous = [...this._chunks.entries()].filter(([, section]) => section.x === chunk.x && section.z === chunk.z);
            for (const [key, section] of previous) {
                this._chunks.delete(key);
                await section.clear(async positions => {
                    for (const pos of positions) changes.set(pos.toArray().join(","), pos);
                });
            }
            for (const section of chunk.sections) {
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
        } finally {
            await this.updateCulling([...changes.values()]);
        }
    }

    public async clear(): Promise<void> {
        await this.culling;
        const chunks = [...this._chunks.values()];
        this._chunks.clear();
        for (const chunk of chunks) {
            await chunk.dispose();
        }
    }

    private updateCulling(positions: Vector3[]): Promise<void> {
        for (const pos of positions) {
            this.pendingCulling.set(pos.toArray().join(","), pos.clone());
            for (const offset of CUBE_FACE_OFFSETS) {
                const neighbor = pos.clone().add(new Vector3(...offset));
                this.pendingCulling.set(neighbor.toArray().join(","), neighbor);
            }
        }
        // Adjacent batched placements share one drain so they cannot replace the same model concurrently.
        return this.culling ??= Promise.resolve().then(async () => {
            try {
                while (this.pendingCulling.size) {
                    const batch = [...this.pendingCulling.values()];
                    this.pendingCulling.clear();
                    for (const pos of batch) {
                        const block = this.getBlockAt(pos)?.object;
                        if (!block) continue;
                        let mask = 0;
                        for (const [face, offset] of CUBE_FACE_OFFSETS.entries()) {
                            if (this.getBlockAt(pos.clone().add(new Vector3(...offset)))?.object.isOccluding) {
                                mask |= 1 << face;
                            }
                        }
                        await block.setCullMask(mask);
                    }
                }
            } finally {
                this.culling = undefined;
            }
        });
    }

    private getOrCreateChunkAt(pos: Vector3): Chunk {
        const key = this.worldPosToChunkKey(pos);
        let chunk = this._chunks.get(key);
        if (typeof chunk === "undefined") {
            chunk = new Chunk(this.scene, Math.floor(pos.x / 16), Math.floor(pos.y / 16), Math.floor(pos.z / 16),
                positions => this.updateCulling(positions));
            this._chunks.set(key, chunk);
        }
        return chunk;
    }

    public getChunkAt(pos: Vector3): Maybe<Chunk> {
        return this._chunks.get(this.worldPosToChunkKey(pos));
    }


    static worldToScenePosition(pos: Vector3): Vector3 {
        return new Vector3(
            pos.x * 16.0,
            pos.y * 16.0,
            pos.z * 16.0
        );
    }

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
