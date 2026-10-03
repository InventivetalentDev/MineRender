import { Block } from "../model/block/Block";
import { BlockObject, isBlockObject } from "../model/block/scene/BlockObject";
import { Box3, Object3D, Vector3 } from "three";
import { Maybe } from "../util/util";
import { BlockInfo } from "./BlockInfo";
import { MineRenderScene } from "../renderer/MineRenderScene";
import { BlockStates } from "../assets/BlockStates";
import { AssetKey } from "../assets/AssetKey";
import { MineRenderWorld } from "./MineRenderWorld";
import { isTripleArray, TripleArray } from "../model/Model";
import { addBox3WireframeToObject } from "../util/model";
import { prefix } from "../util/log";

const p = prefix("Chunk");

export class Chunk {

    public readonly scene: MineRenderScene; //TODO: should probably be the world

    public readonly x: number;
    public readonly y: number;
    public readonly z: number;

    private readonly _blocks: BlockInfo[] = [];

    private readonly _anchor: Object3D;

    constructor(scene: MineRenderScene, x: number, y: number, z: number) {
        this.scene = scene;
        this.x = x;
        this.y = y;
        this.z = z;

        //TODO: option to visualize chunks
        let anchor = new Object3D();
        this._anchor = anchor;
        scene.add(anchor)
        anchor.position.set((this.x * 256) + 128 - 8, (this.y * 256) + 128 - 8, (this.z * 256) + 128 - 8);
        addBox3WireframeToObject(
            new Box3(new Vector3(0, 0, 0), new Vector3(256, 256, 256)),
            anchor,
            0xffff00,
            4);
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
        const pos: Vector3 = this.worldPosToChunkPos(posOrX);
        const index = Chunk.chunkPosToBlockIndex(pos);
        return this._blocks[index];
    }

    /**
     * Set block at a _world_ position
     */
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
        const worldPos: Vector3 = posOrX;
        const pos: Vector3 = this.worldPosToChunkPos(worldPos);
        block = yOrBlock as Block;

        return this.setBlockInChunkAt(pos, block, worldPos);
    }

    /**
     * Set block at a _chunk_ position (0-16)
     */
    public async setBlockInChunkAt(pos: Vector3, block?: Block,  worldPos?: Vector3): Promise<Maybe<BlockInfo>> {
        if (typeof worldPos === "undefined") {
            worldPos = this.chunkPosToWorldPos(pos);
        }

        const index = Chunk.chunkPosToBlockIndex(pos);
        const current = this._blocks[index];
        if (typeof current !== "undefined") {
            console.debug(p, "deleting existing block at", pos, worldPos, index);
            // current.object.setScale(new Vector3(0, 0, 0));//TODO
            current.object.removeFromScene();
            delete this._blocks[index];
        }

        if (typeof block === "undefined" || typeof block.type === "undefined" || block.type === "air") return undefined; // only delete block

        const blockState = await BlockStates.get(AssetKey.parse("blockstates", block.type));
        if (blockState) {
            const blockObject: BlockObject = await this.scene.addBlock(blockState, {
                mergeMeshes: true,
                instanceMeshes: true,
                wireframe: true,
                maxInstanceCount: 2000 //TODO: setting this to high kills FPS; increase on demand somehow?
            }) as BlockObject;//TODO
            if (block.properties) {
                await blockObject.setState(block.properties);
            }

            const scenePos = MineRenderWorld.worldToScenePosition(worldPos);
            blockObject.setPosition(scenePos);

            this._blocks[index] = {
                block: block,
                object: blockObject as BlockObject
            }
            return this._blocks[index];
        }
        return undefined;
    }

    public async clear(): Promise<void> {
        let promises: Promise<any>[] = [];
        let pos = new Vector3();
        for (let x = 0; x < 16; x++) {
            for (let z = 0; z < 16; z++) {
                for (let y = 0; y < 16; y++) {
                    promises.push(this.setBlockInChunkAt(pos.set(x,y,z), undefined));
                }
            }
        }
        return Promise.all(promises).then(ignored => {
        });
    }

    public async dispose(): Promise<void> {
        await this.clear();
        this.scene.remove(this._anchor);
    }

    static chunkPosToBlockIndex(pos: Vector3): number {
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
