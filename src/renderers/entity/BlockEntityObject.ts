import { SceneObject } from "../SceneObject";
import { BlockState, BlockStateVariant, BlockStateVariants, MultipartCondition } from "../../model/BlockState";
import { SceneObjectOptions } from "../SceneObjectOptions";
import { Caching } from "../../cache/Caching";
import { Models } from "../../assets/Models";
import { Assets, DEFAULT_NAMESPACE } from "../../assets/Assets";
import merge from "ts-deepmerge";
import { Euler, Matrix4, Vector3 } from "three";
import { Maybe, toRadians } from "../../util/util";
import { addWireframeToMesh, addWireframeToObject, applyElementRotation, applyGenericRotation } from "../../util/model";
import { Axis } from "../../Axis";
import { MineRenderError } from "../../error/MineRenderError";
import { isInstancedMesh } from "../../util/three";
import { dbg } from "../../util/debug";
import { types } from "util";
import { BlockStateProperties, BlockStatePropertyDefaults } from "../../model/BlockStateProperties";
import { BlockStates } from "../../assets/BlockStates";
import { InstanceReference } from "../../instance/InstanceReference";
import { EntityObject } from "./EntityObject";
import { BlockEntityModel } from "../../entity/BlockEntityModel";
import { ModelTextures } from "../../assets/ModelTextures";
import { AssetKey } from "../../assets/AssetKey";
import { ExtractableImageData } from "../../ExtractableImageData";
import { Materials } from "../../Materials";
import { MinecraftCubeTexture } from "../../MinecraftCubeTexture";
import * as THREE from "three";
import { Ticker } from "../../Ticker";

export class BlockEntityObject extends SceneObject {

    public readonly isBlockEntityObject: true = true;

    public static readonly DEFAULT_OPTIONS: BlockEntityObjectOptions = merge({}, SceneObject.DEFAULT_OPTIONS, <BlockEntityObjectOptions>{});
    public readonly options: BlockEntityObjectOptions;

    private imageData?: ExtractableImageData;

    private meshesCreated: boolean = false;

    constructor(readonly blockEntity: BlockEntityModel, options?: Partial<BlockEntityObjectOptions>) {
        super();
        this.options = merge({}, SceneObject.DEFAULT_OPTIONS, options ?? {});
        //TODO
    }

    async init(): Promise<void> {
        this.createMeshes();
        await this.applyTextures();
    }

    dispose() {
        super.dispose();
    }

    protected async loadTextures(): Promise<void> {
        this.imageData = await ModelTextures.get(new AssetKey(
            this.blockEntity.key?.namespace ?? DEFAULT_NAMESPACE,
            this.blockEntity.key!.path,
            "textures",
            "entity",
            ".png"
        ))
    }

    protected createMeshes(force: boolean = false) {
        console.log("createMeshes")
        if (this.meshesCreated && !force) return;

        const mat = Materials.MISSING_TEXTURE;

        //TODO: don't know which parts are actually meant to be rendered atm
        for (let partName in this.blockEntity.parts) {
            const part = this.blockEntity.parts[partName];
            const texture = new MinecraftCubeTexture(part.textureOffsetU, part.textureOffsetV, part.textureWidth, part.textureHeight);
            for (let cube of part.cubes) {
                const w = cube.maxX - cube.minX;
                const h = cube.maxY - cube.minY;
                const l = cube.maxZ - cube.minZ;
                const uv = texture.toUvArray(w, h, l);

                const cubeGeo = this._getBoxGeometryForDimensionsAndUv(w, h, l, uv).clone();

                cubeGeo.applyMatrix4(new THREE.Matrix4().makeTranslation(w / 2, h / 2, l / 2));
                cubeGeo.applyMatrix4(new THREE.Matrix4().makeTranslation(cube.minX, cube.minY, cube.minZ));
                cubeGeo.applyMatrix4(new THREE.Matrix4().makeTranslation(part.pivotX, part.pivotY, part.pivotZ));

                //TODO: rotation
                // if (el.rotation) {
                //     applyElementRotation(el.rotation, elGeo);
                // }

                // TODO: merge parts
                const mesh = this.createAndAddMesh(partName, undefined, cubeGeo, mat);
                if (this.options.wireframe) {
                    addWireframeToMesh(cubeGeo, mesh);
                }
            }
        }

        //TODO

        this.meshesCreated = true;
    }

    protected async applyTextures() {

        const textureAsset = await ModelTextures.preload(new AssetKey(
            this.blockEntity.key?.namespace ?? DEFAULT_NAMESPACE,
            this.blockEntity.key!.path,
            "textures",
            "entity",
            ".png"
        ));
        // if (this.atlas!.model.textures) {
        //     for (let textureKey in this.atlas!.model.textures) {
        //         let asset = this.textureMap[textureKey];
        //         if (asset) {
        //TODO: transparency
        if (textureAsset) {
            let mat = Materials.getImage({ texture: { src: textureAsset.src! } })
            this.iterateAllMeshes(mesh => {
                mesh.material = mat;
            });
        }
        //         }
        //     }
        // }
    }


}

export interface BlockEntityObjectOptions extends SceneObjectOptions {
}

export function isBlockEntityObject(obj: any): obj is BlockEntityObject {
    return (<BlockEntityObject>obj).isBlockEntityObject;
}
