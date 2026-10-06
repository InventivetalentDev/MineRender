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
import { SectionMesh, SectionMeshEntry } from "./SectionMesh";
import { getFluidKind } from "../model/fluid/FluidGeometry";

export class Chunk<SectionMeshing extends boolean = false> {

    public readonly scene: MineRenderScene; //TODO: should probably be the world

    public readonly x: number;
    public readonly y: number;
    public readonly z: number;

    private readonly data = new ChunkData();
    private readonly renderedBlocks = new Map<number, BlockInfo<SectionMeshing>>();
    private readonly sectionBlocks = new Map<number, SectionMeshEntry>();
    private sectionMesh?: SectionMesh;
    private meshDirty = false;

    constructor(scene: MineRenderScene, x: number, y: number, z: number,
                private readonly onBlocksChanged?: (positions: Vector3[]) => Promise<void>,
                private readonly sectionModels?: SectionModels) {
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
        const pos: Vector3 = this.worldPosToChunkPos(posOrX);
        const index = Chunk.chunkPosToBlockIndex(pos);
        return this.renderedBlocks.get(index);
    }

    /**
     * Set block at a _world_ position
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
     * Set a block at integer chunk-local coordinates from 0 to 15.
     */
    public async setBlockInChunkAt(pos: Vector3, block?: Block, worldPos?: Vector3,
                                   onBlocksChanged = this.onBlocksChanged): Promise<Maybe<BlockInfo<SectionMeshing>>> {
        if (typeof worldPos === "undefined") {
            worldPos = this.chunkPosToWorldPos(pos);
        }

        const index = Chunk.chunkPosToBlockIndex(pos);
        this.data.set(index, block);
        const readBlock = this.data.snapshot(index);
        this.renderedBlocks.get(index)?.object?.removeFromScene();
        if (this.sectionBlocks.delete(index)) this.meshDirty = true;
        this.renderedBlocks.delete(index);
        let object: BlockObject | undefined;
        try {
            if (!readBlock) return undefined;
            const stored = readBlock();
            const blockState = await BlockStates.get(AssetKey.parse("blockstates", stored.type));
            if (!blockState) {
                this.data.set(index, undefined);
                return undefined;
            }
            // Fluids and block entities are drawn per block, not through the section mesh.
            const perBlock = !this.sectionModels || getFluidKind(blockState.key, stored.properties)
                || (blockState.key && BlockEntities.entry(await BlockEntities.getIndex(blockState.key.root), blockState.key.toNamespacedString()));
            const template = perBlock ? undefined : await this.sectionModels!.get(blockState, stored.properties);
            if (template) {
                this.sectionBlocks.set(index, { index, template, cullMask: 0 });
                this.meshDirty = true;
            } else {
                object = await this.scene.addBlock(blockState, {
                    mergeMeshes: true,
                    instanceMeshes: true,
                    maxInstanceCount: 2000,
                    initialState: stored.properties
                }) as BlockObject;
                object.setPosition(MineRenderWorld.worldToScenePosition(worldPos));
            }

            const info = { get block() { return readBlock(); }, object } as BlockInfo<SectionMeshing>;
            this.renderedBlocks.set(index, info);
            return info;
        } catch (error) {
            this.data.set(index, undefined);
            object?.removeFromScene();
            throw error;
        } finally {
            await onBlocksChanged?.([worldPos]);
        }
    }

    public isOccludingAt(pos: Vector3): boolean {
        const index = Chunk.chunkPosToBlockIndex(this.worldPosToChunkPos(pos));
        return this.sectionBlocks.has(index) || (this.renderedBlocks.get(index)?.object?.isOccluding ?? false);
    }

    public async setCullMaskAt(pos: Vector3, mask: number): Promise<void> {
        const index = Chunk.chunkPosToBlockIndex(this.worldPosToChunkPos(pos));
        const entry = this.sectionBlocks.get(index);
        if (entry) {
            if (entry.cullMask !== mask) {
                entry.cullMask = mask;
                this.meshDirty = true;
            }
        } else {
            await this.renderedBlocks.get(index)?.object?.setCullMask(mask);
        }
    }

    public rebuildSectionMesh(): void {
        if (!this.meshDirty) return;
        const next = this.sectionBlocks.size
            ? SectionMesh.build([...this.sectionBlocks.values()], this.sectionModels!.maxAtlasSize) : undefined;
        this.sectionMesh?.dispose();
        this.sectionMesh = next;
        if (next) {
            next.position.set(this.x * 256, this.y * 256, this.z * 256);
            this.scene.add(next);
        }
        this.scene.dirty = true;
        this.meshDirty = false;
    }

    public async clear(onBlocksChanged = this.onBlocksChanged): Promise<void> {
        const positions = [...this.renderedBlocks.keys()].map(index => this.chunkPosToWorldPos(
            new Vector3(index % 16, Math.floor(index / 256), Math.floor(index / 16) % 16)
        ));
        for (const info of this.renderedBlocks.values()) info.object?.removeFromScene();
        this.sectionBlocks.clear();
        this.sectionMesh?.dispose();
        this.sectionMesh = undefined;
        this.meshDirty = false;
        this.renderedBlocks.clear();
        this.data.clear();
        await onBlocksChanged?.(positions);
    }

    public async dispose(): Promise<void> {
        await this.clear();
    }

    static isAir(block: Maybe<Block>): boolean {
        return ChunkData.isAir(block);
    }

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
