import { Block } from "../model/block/Block";
import { BlockObject, isBlockObject } from "../model/block/scene/BlockObject";
import { Vector3 } from "three";
import { Maybe } from "../util/util";
import { BlockInfo } from "./BlockInfo";
import { del } from "node-persist";
import { MineRenderScene } from "../renderer/MineRenderScene";
import { BlockStates } from "../assets/BlockStates";
import { AssetKey } from "../assets/AssetKey";
import { MineRenderWorld } from "./MineRenderWorld";

export class Chunk {

    public readonly scene: MineRenderScene; //TODO: should probably be the world
    public readonly x: number;
    public readonly z: number;

    private readonly _blocks: BlockInfo[] = [];

    constructor(scene: MineRenderScene, x: number, z: number) {
        this.scene = scene;
        this.x = x;
        this.z = z;
    }

    public getBlockAt(x: number, y: number, z: number): Maybe<BlockInfo>;
    public getBlockAt(pos: Vector3): Maybe<BlockInfo>;
    public getBlockAt(posOrX: number | Vector3, y?: number, z?: number): Maybe<BlockInfo> {
        if (typeof posOrX == "number") {
            return this.getBlockAt(new Vector3(posOrX, y, z));
        }
        const index = Chunk.chunkPosToBlockIndex(posOrX);
        return this._blocks[index];
    }

    public async setBlockAt(x: number, y: number, z: number, block: Block): Promise<Maybe<BlockInfo>>;
    public async setBlockAt(pos: Vector3, block: Block): Promise<Maybe<BlockInfo>>;
    public async setBlockAt(posOrX: number | Vector3, yOrBlock?: number | Block, z?: number, block?: Block): Promise<Maybe<BlockInfo>> {
        if (typeof posOrX == "number") {
            return this.setBlockAt(new Vector3(posOrX, yOrBlock as number, z), block as Block);
        }
        const worldPos: Vector3 = posOrX;
        const pos: Vector3 = this.worldPosToChunkPos(worldPos);
        block = yOrBlock as Block;

        const index = Chunk.chunkPosToBlockIndex(pos);
        const current = this._blocks[index];
        if (typeof current !== "undefined") {
            console.log("deleting existing block at", pos, worldPos, index);
            current.object.setScale(new Vector3(0, 0, 0));//TODO
            delete this._blocks[index];
        }

        if (typeof block === "undefined" || typeof block.type === "undefined" || block.type === "air") return undefined; // only delete block

        const blockState = await BlockStates.get(AssetKey.parse("blockstates", block.type));
        if (blockState) {
            const blockObject: BlockObject = await this.scene.addBlock(blockState, {
                mergeMeshes: true,
                instanceMeshes: true,
                wireframe: true,
                maxInstanceCount: 100000 //TODO
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


    static chunkPosToBlockIndex(pos: Vector3): number {
        return (pos.y * 16 * 16) + (pos.z * 16) + pos.x;
    }

    worldPosToChunkPos(pos: Vector3): Vector3 {
        return new Vector3(
            pos.x - (this.x * 16),
            pos.y,
            pos.z - (this.z * 16)
        )
    }

    chunkPosToWorldPos(pos: Vector3): Vector3 { //TODO: should probably just use x,y,z
        return new Vector3(
            (this.x * 16) + pos.x,
            pos.y,
            (this.z * 16) + pos.z
        );
    }

}
