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

//TODO: maybe make this an Object3D to add children
export class MineRenderWorld {

    public readonly scene: MineRenderScene;

    private readonly _chunks: Map<string, Chunk> = new Map<string, Chunk>();

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
        this.validatePosBounds(posOrX);
        const value = yOrBlock as Maybe<Block>;
        const chunk = Chunk.isAir(value) ? this.getChunkAt(posOrX) : this.getOrCreateChunkAt(posOrX);
        return chunk?.setBlockAt(posOrX, value);
    }


    public async placeMultiBlock(multiblock: MultiBlockStructure, useBatches: boolean = true, executor?: BatchedExecutor): Promise<void> {
        const keys = new Map<string, AssetKey>();
        for (const block of multiblock.blocks) {
            if (Chunk.isAir(block)) continue;
            const key = AssetKey.parse("blockstates", block.type);
            keys.set(key.serialize(), key);
        }
        await BlockStates.getAll(keys.values());

        if (!useBatches) {
            for (const block of multiblock.blocks) await this.setBlockAt(block.position, block);
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
                        for (const block of blocks) await this.setBlockAt(block.position, block);
                    })
                ));
                const failure = results.find(result => result.status === "rejected");
                if (failure?.status === "rejected") throw failure.reason;
            }
        } finally {
            if (!executor) queue.stop();
        }
    }


    public async clear(): Promise<void> {
        for (const chunk of this._chunks.values()) {
            await chunk.dispose();
        }
        this._chunks.clear();
    }

    private getOrCreateChunkAt(pos: Vector3): Chunk {
        const key = this.worldPosToChunkKey(pos);
        let chunk = this._chunks.get(key);
        if (typeof chunk === "undefined") {
            chunk = new Chunk(this.scene, Math.floor(pos.x / 16), Math.floor(pos.y / 16), Math.floor(pos.z / 16));
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
