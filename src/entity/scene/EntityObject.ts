import { SceneObject } from "../../renderer/SceneObject";
import { BlockState, BlockStateVariant, BlockStateVariants, MultipartCondition } from "../../model/block/BlockState";
import { SceneObjectOptions } from "../../renderer/SceneObjectOptions";
import { Caching } from "../../cache/Caching";
import { Models } from "../../assets/Models";
import { Assets, DEFAULT_NAMESPACE } from "../../assets/Assets";
import merge from "ts-deepmerge";
import { AxesHelper, Euler, Matrix4, Object3D, Vector3 } from "three";
import { Maybe, toRadians } from "../../util/util";
import { addWireframeToMesh, addWireframeToObject, applyElementRotation, applyGenericRotation, applyModelPartRotation } from "../../util/model";
import { ModelTextures } from "../../assets/ModelTextures";
import { AssetKey } from "../../assets/AssetKey";
import { ExtractableImageData } from "../../ExtractableImageData";
import { Materials } from "../../Materials";
import { MinecraftCubeTexture } from "../../MinecraftCubeTexture";
import * as THREE from "three";
import { Ticker } from "../../Ticker";
import { EntityModel } from "../EntityModel";

export class EntityObject extends SceneObject {

    public readonly isEntityObject: true = true;

    public static readonly DEFAULT_OPTIONS: EntityObjectOptions = merge({}, SceneObject.DEFAULT_OPTIONS, <EntityObjectOptions>{});
    public readonly options: EntityObjectOptions;

    private imageData?: ExtractableImageData;

    private meshesCreated: boolean = false;

    constructor(readonly entity: EntityModel, options?: Partial<EntityObjectOptions>) {
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
            this.entity.key?.namespace ?? DEFAULT_NAMESPACE,
            this.entity.key!.path,
            "textures",
            "entity",
            "assets",
            ".png"
        ))
    }

    //TODO: abstract this, since extracted model data can be used for entities, blocks, players
    protected createMeshes(force: boolean = false) {
        if (this.meshesCreated && !force) return;

        const mat = Materials.MISSING_TEXTURE;

        //TODO: don't know which parts are actually meant to be rendered atm
        for (let partName in this.entity.parts) {
            const part = this.entity.parts[partName];
            const texture = new MinecraftCubeTexture(part.textureOffsetU, part.textureOffsetV, part.textureWidth, part.textureHeight);
            const partAnchor = new Object3D();
            partAnchor.position.x = part.pivotX;
            partAnchor.position.y = part.pivotY;
            partAnchor.position.z = part.pivotZ;
            for (let cube of part.cubes) {
                const w = cube.maxX - cube.minX;
                const h = cube.maxY - cube.minY;
                const l = cube.maxZ - cube.minZ;
                const uv = texture.toUvArray(w, h, l);

                //TODO: mirror
                // MC does it by flipping min and max X; might be easier than moving around all face UVs

                const cubeGeo = this._getBoxGeometryForDimensionsAndUv(w, h, l, uv).clone();

                cubeGeo.applyMatrix4(new THREE.Matrix4().makeTranslation(w / 2, h / 2, l / 2));
                cubeGeo.applyMatrix4(new THREE.Matrix4().makeTranslation(cube.minX, cube.minY, cube.minZ));

                applyModelPartRotation(part, cubeGeo);


                // TODO: merge parts
                // const mesh = this.createAndAddMesh(partName, undefined, cubeGeo, mat);
                const mesh = this.createMesh(partName, cubeGeo, mat);
                partAnchor.add(mesh);
                if (this.options.wireframe) {
                    addWireframeToMesh(cubeGeo, mesh);
                }
            }
            this.add(partAnchor);
        }

        //TODO

        this.meshesCreated = true;
    }

    protected async applyTextures() {

        const textureAsset = await ModelTextures.preload(new AssetKey(
            this.entity.key?.namespace ?? DEFAULT_NAMESPACE,
            this.entity.key!.path,
            "textures",
            "entity",
            "assets",
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

export interface EntityObjectOptions extends SceneObjectOptions {
}

export function isEntityObject(obj: any): obj is EntityObject {
    return (<EntityObject>obj).isEntityObject;
}
