import { SceneObject } from "../../renderer/SceneObject";
import { SceneObjectOptions } from "../../renderer/SceneObjectOptions";
import { Caching } from "../../cache/Caching";
import { DEFAULT_NAMESPACE } from "../../assets/Assets";
import merge from "ts-deepmerge";
import { Mesh, Object3D } from "three";
import type { Material } from "three";
import { addWireframeToMesh } from "../../util/model";
import { ModelTextures } from "../../assets/ModelTextures";
import { AssetKey } from "../../assets/AssetKey";
import { ExtractableImageData } from "../../ExtractableImageData";
import { Materials } from "../../Materials";
import { MinecraftCubeTexture } from "../../MinecraftCubeTexture";
import { EntityModel, EntityModelPart } from "../EntityModel";
import type { DoubleArray } from "../../model/Model";

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

    private get textureKey(): AssetKey {
        return new AssetKey(
            this.entity.key?.namespace ?? DEFAULT_NAMESPACE,
            this.entity.key!.path, //TODO: texture may differ from entity name; most of them are in subdirectories for multiple variants etc.
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
        modelRoot.scale.set(-1, -1, 1);
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
            const uv = size[0] === 0 || size[1] === 0 ? new Array<number>(48).fill(0) : texture.toUvArray(width, height, depth);
            // The box helper mirrors the side faces and reverses the down face's V coordinates.
            if (!cube.mirror) uv.splice(0, 16, ...uv.slice(8, 16), ...uv.slice(0, 8));
            for (const face of cube.mirror ? [2, 3] : [0, 1, 4, 5]) {
                const start = face * 8;
                [uv[start], uv[start + 2]] = [uv[start + 2], uv[start]];
                [uv[start + 4], uv[start + 6]] = [uv[start + 6], uv[start + 4]];
            }
            [uv[25], uv[29]] = [uv[29], uv[25]];
            [uv[27], uv[31]] = [uv[31], uv[27]];
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

    public iterateAllMeshes(callback: (mesh: Mesh) => void) {
        this.traverse(object => {
            if ((object as Mesh).isMesh) callback(object as Mesh);
        });
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
}

export function isEntityObject(obj: any): obj is EntityObject {
    return (<EntityObject>obj).isEntityObject;
}
