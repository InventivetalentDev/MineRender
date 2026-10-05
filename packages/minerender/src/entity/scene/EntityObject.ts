import { SceneObject } from "../../renderer/SceneObject";
import { SceneObjectOptions } from "../../renderer/SceneObjectOptions";
import { Caching } from "../../cache/Caching";
import merge from "ts-deepmerge";
import { Object3D } from "three";
import type { Material } from "three";
import { addWireframeToMesh } from "../../util/model";
import { ModelTextures } from "../../assets/ModelTextures";
import { AssetKey, isAssetKey } from "../../assets/AssetKey";
import { ExtractableImageData } from "../../ExtractableImageData";
import { Materials } from "../../Materials";
import { MinecraftCubeTexture } from "../../MinecraftCubeTexture";
import { EntityModel, EntityModelPart } from "../EntityModel";
import type { DoubleArray } from "../../model/Model";

export class EntityObject extends SceneObject {

    public readonly isEntityObject: true = true;

    public static readonly DEFAULT_OPTIONS: EntityObjectOptions = merge({}, SceneObject.DEFAULT_OPTIONS, <EntityObjectOptions>{ flip: true });
    public readonly options: EntityObjectOptions;

    private imageData?: ExtractableImageData;

    private meshesCreated: boolean = false;

    constructor(readonly entity: EntityModel, options?: Partial<EntityObjectOptions>) {
        super();
        this.options = merge({}, EntityObject.DEFAULT_OPTIONS, options ?? {});
        //TODO
    }

    async init(): Promise<void> {
        this.createMeshes();
        await this.applyTextures();
    }

    dispose() {
        super.dispose();
    }

    private get textureKey(): AssetKey {
        if (this.entity.texture) return this.entity.texture;
        const key = this.entity.key;
        return new AssetKey(
            key.namespace,
            isAssetKey(key) ? key.getFullPath() : key.path,
            "textures",
            "entity",
            "assets",
            ".png"
        );
    }

    protected async loadTextures(): Promise<void> {
        this.imageData = await ModelTextures.get(this.textureKey);
    }

    protected createMeshes(force: boolean = false) {
        if (this.meshesCreated && !force) return;

        const modelRoot = new Object3D();
        // Keep Minecraft's model coordinates separate from caller placement and scale.
        if (this.options.flip) modelRoot.scale.set(-1, -1, 1);
        this.add(modelRoot);
        this.createPart("root", this.entity.layer.root, modelRoot, this.entity.layer.texture, Materials.MISSING_TEXTURE);
        this.meshesCreated = true;
    }

    private createPart(name: string, part: EntityModelPart, parent: Object3D, textureSize: DoubleArray, material: Material) {
        const anchor = this.createGroup(name);
        anchor.position.fromArray(part.pose.offset);
        anchor.rotation.set(...part.pose.rotation, "ZYX");
        anchor.scale.fromArray(part.pose.scale ?? [1, 1, 1]);
        parent.add(anchor);
        const size = part.texture ?? textureSize;

        for (const cube of part.cubes) {
            const [width, height, depth] = cube.size;
            const [growX, growY, growZ] = cube.grow ?? [0, 0, 0];
            const texture = new MinecraftCubeTexture(...cube.uv, ...size);
            const uv = size[0] === 0 || size[1] === 0 ? new Array<number>(48).fill(0) : texture.toUvArray(width, height, depth, cube.mirror);
            const geometry = this._getBoxGeometryForDimensionsAndUv(
                width + growX * 2, height + growY * 2, depth + growZ * 2, uv
            ).clone();
            geometry.translate(cube.origin[0] + width / 2, cube.origin[1] + height / 2, cube.origin[2] + depth / 2);
            const mesh = this.createMesh(name, geometry, material);
            anchor.add(mesh);
            if (this.options.wireframe) addWireframeToMesh(geometry, mesh);
        }
        for (const [childName, child] of Object.entries(part.children)) {
            this.createPart(childName, child, anchor, size, material);
        }
    }

    protected async applyTextures() {
        const assetKeyStr = this.textureKey.serialize();
        const keyStr = `entity:${ assetKeyStr }`;
        let mat = Caching.materialCache.getIfPresent(keyStr);
        if (!mat) {
            const pending = this.loadTextures();
            const cachedAsset = Caching.textureAssetCache.getIfPresent(assetKeyStr);
            await pending;
            if (!this.imageData) return;
            const canvas = (this.imageData.data as CanvasRenderingContext2D).canvas;
            //TODO: transparency
            const createMaterial = () => Materials.createBasicCanvasMaterial(canvas);
            // A cache clear during decoding must not restore an older source's material.
            mat = cachedAsset && Caching.textureAssetCache.getIfPresent(assetKeyStr) === cachedAsset
                ? Caching.materialCache.get(keyStr, createMaterial)!
                : createMaterial();
            this.imageData = undefined;
        }
        this.iterateAllMeshes(mesh => {
            mesh.material = mat!;
        });
        this.notifyDirty();
    }


}

export interface EntityObjectOptions extends SceneObjectOptions {
    flip?: boolean;
}

export function isEntityObject(obj: any): obj is EntityObject {
    return (<EntityObject>obj).isEntityObject;
}
