import { SceneObject } from "../../renderer/SceneObject";
import { SceneObjectOptions } from "../../renderer/SceneObjectOptions";
import { Caching } from "../../cache/Caching";
import merge from "ts-deepmerge";
import { Object3D } from "three";
import type { Material, Mesh } from "three";
import { addWireframeToMesh } from "../../util/model";
import { ModelTextures } from "../../assets/ModelTextures";
import { AssetKey, isAssetKey } from "../../assets/AssetKey";
import { ExtractableImageData } from "../../ExtractableImageData";
import { Materials } from "../../Materials";
import { MinecraftCubeTexture } from "../../MinecraftCubeTexture";
import { EntityLayer, EntityModel, EntityModelPart } from "../EntityModel";
import type { DoubleArray } from "../../model/Model";
import type { Maybe } from "../../util/util";
import { isMesh } from "../../util/three";

export class EntityObject extends SceneObject {

    public readonly isEntityObject: true = true;

    public static readonly DEFAULT_OPTIONS: EntityObjectOptions = merge({}, SceneObject.DEFAULT_OPTIONS);
    public readonly options: EntityObjectOptions;

    private meshesCreated: boolean = false;

    constructor(readonly entity: EntityModel, options?: Partial<EntityObjectOptions>) {
        super();
        this.options = merge({}, EntityObject.DEFAULT_OPTIONS, options ?? {});
        this.options.flip ??= !entity.yUp;
    }

    async init(): Promise<void> {
        this.createMeshes();
        await this.applyTextures();
    }

    dispose() {
        super.dispose();
    }

    public getLayerGroup(name: string): Maybe<Object3D> {
        return super.getGroupByName(`layer:${name}`);
    }

    public getGroupByName(name: string, layerName?: string): Maybe<Object3D> {
        return layerName === undefined ? super.getGroupByName(name)
            : this.getLayerGroup(layerName)?.getObjectByName(`group:${name}`);
    }

    public getMeshByName(name: string, layerName?: string): Maybe<Mesh> {
        return layerName === undefined ? super.getMeshByName(name)
            : this.getLayerGroup(layerName)?.getObjectByName(`mesh:${name}`) as Maybe<Mesh>;
    }

    private get entityLayers(): Record<string, EntityLayer> {
        return this.entity.layers ?? { main: this.entity };
    }

    private getTextureKey(layer: EntityLayer): AssetKey {
        if (layer.texture) return layer.texture;
        const key = layer.key;
        return new AssetKey(
            key.namespace,
            isAssetKey(key) ? key.getFullPath() : key.path,
            "textures",
            "entity",
            "assets",
            ".png"
        );
    }

    protected async loadTextures(layer: EntityLayer = this.entity): Promise<Maybe<ExtractableImageData>> {
        return ModelTextures.get(this.getTextureKey(layer));
    }

    protected createMeshes(force: boolean = false) {
        if (this.meshesCreated && !force) return;

        const modelRoot = new Object3D();
        // Keep Minecraft's model coordinates separate from caller placement and scale.
        if (this.options.flip) modelRoot.scale.set(-1, -1, 1);
        this.add(modelRoot);
        Object.entries(this.entityLayers).forEach(([name, layer], index) => {
            const group = this.createGroup(`layer:${name}`);
            modelRoot.add(group);
            this.createPart("root", layer.layer.root, group, layer.layer.texture, Materials.MISSING_TEXTURE, index);
        });
        this.meshesCreated = true;
    }

    private createPart(name: string, part: EntityModelPart, parent: Object3D, textureSize: DoubleArray, material: Material, renderOrder: number) {
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
            // Vanilla draws entities without backface culling, e.g. chicken legs are only painted on faces seen from inside.
            // Zero-thickness cubes keep one face per side, as their coplanar faces would z-fight.
            if (Math.min(width + growX * 2, height + growY * 2, depth + growZ * 2) > 0) {
                const index = Array.from(geometry.getIndex()!.array);
                geometry.setIndex(index.concat(index.slice().reverse()));
            }
            const mesh = this.createMesh(name, geometry, material);
            mesh.renderOrder = renderOrder;
            anchor.add(mesh);
            if (this.options.wireframe) addWireframeToMesh(geometry, mesh);
        }
        for (const [childName, child] of Object.entries(part.children)) {
            this.createPart(childName, child, anchor, size, material, renderOrder);
        }
    }

    protected async applyTextures() {
        await Promise.all(Object.entries(this.entityLayers).map(async ([name, layer]) => {
            const assetKeyStr = this.getTextureKey(layer).serialize();
            const keyStr = `entity:${ assetKeyStr }`;
            let mat = Caching.materialCache.getIfPresent(keyStr);
            if (!mat) {
                const cachedAsset = Caching.textureAssetCache.getIfPresent(assetKeyStr);
                const imageData = await this.loadTextures(layer);
                if (!imageData) return;
                const canvas = (imageData.data as CanvasRenderingContext2D).canvas;
                const createMaterial = () => Materials.createBasicCanvasMaterial(canvas);
                // A cache clear during decoding must not restore an older source's material.
                mat = cachedAsset && Caching.textureAssetCache.getIfPresent(assetKeyStr) === cachedAsset
                    ? Caching.materialCache.get(keyStr, createMaterial)
                    : createMaterial();
            }
            this.getLayerGroup(name)?.traverse(object => {
                if (isMesh(object)) object.material = mat!;
            });
        }));
        this.notifyDirty();
    }


}

export interface EntityObjectOptions extends SceneObjectOptions {
    /** Apply vanilla's entity flip, scale (-1, -1, 1). Defaults to true unless the model is marked `yUp`. */
    flip?: boolean;
}

export function isEntityObject(obj: any): obj is EntityObject {
    return (<EntityObject>obj).isEntityObject;
}
