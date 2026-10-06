import { Box2, Mesh, MeshBasicMaterial, PlaneGeometry, Vector2 } from "three";
import { AssetKey } from "../../assets/AssetKey";
import { ModelTextures } from "../../assets/ModelTextures";
import { Caching } from "../../cache/Caching";
import { SceneObject } from "../../renderer/SceneObject";
import { SceneObjectOptions } from "../../renderer/SceneObjectOptions";
import { Materials } from "../../Materials";
import { GuiLayer } from "../GuiLayer";

export class GuiObject extends SceneObject {

    public readonly isGuiObject: true = true;
    /** Local bounds in GUI pixels, with y growing down from the origin. */
    public readonly bounds = new Box2();
    private readonly geometries = new Set<PlaneGeometry>();
    private readonly ownedMaterials = new Set<MeshBasicMaterial>();
    private initialized = false;

    constructor(readonly textureLayers: readonly GuiLayer[], options?: Partial<GuiObjectOptions>) {
        super({ ...options, instanceMeshes: false, mergeMeshes: false });
    }

    public async init(): Promise<void> {
        if (this.initialized) return;
        try {
            for (const [index, layer] of this.textureLayers.entries()) {
                const key = typeof layer.texture === "string" ? AssetKey.parse("textures", layer.texture) : layer.texture;
                const material = await this.loadMaterial(key);
                const image = material.map!.image as HTMLCanvasElement;
                const [cropX, cropY, cropWidth, cropHeight] = layer.crop ?? [0, 0, image.width, image.height];
                const [width, height] = layer.size ?? [cropWidth, cropHeight];
                const [x, y] = layer.position ?? [0, 0];
                const geometry = new PlaneGeometry(width, height);
                this.geometries.add(geometry);
                const uv = geometry.getAttribute("uv");
                for (let i = 0; i < uv.count; i++) {
                    uv.setXY(i, (cropX + uv.getX(i) * cropWidth) / image.width,
                        1 - (cropY + (1 - uv.getY(i)) * cropHeight) / image.height);
                }
                const mesh = new Mesh(geometry, material);
                mesh.name = `mesh:${layer.name ?? index}`;
                mesh.position.set(x + width / 2, -y - height / 2, 0);
                mesh.renderOrder = index;
                this.add(mesh);
                this.bounds.expandByPoint(new Vector2(x, y));
                this.bounds.expandByPoint(new Vector2(x + width, y + height));
            }
            this.initialized = true;
            this.notifyDirty();
        } catch (error) {
            this.disposeAndRemoveAllChildren();
            throw error;
        }
    }

    private async loadMaterial(key: AssetKey): Promise<MeshBasicMaterial> {
        const assetKey = key.serialize();
        const materialKey = `gui:${assetKey}`;
        const cached = Caching.materialCache.getIfPresent(materialKey);
        if (cached) return cached as MeshBasicMaterial;

        const pending = ModelTextures.get(key);
        const cachedAsset = Caching.textureAssetCache.getIfPresent(assetKey);
        const image = await pending;
        if (!image) throw new Error(`Could not load GUI texture ${key.toNamespacedString()}`);
        const create = () => Materials.createGuiCanvasMaterial((image.data as CanvasRenderingContext2D).canvas);
        // A cache clear during decoding must not restore an older source's material.
        if (cachedAsset && Caching.textureAssetCache.getIfPresent(assetKey) === cachedAsset) {
            return Caching.materialCache.get(materialKey, create) as MeshBasicMaterial;
        }
        const material = create();
        this.ownedMaterials.add(material);
        return material;
    }

    public disposeAndRemoveAllChildren() {
        for (const geometry of this.geometries) geometry.dispose();
        this.geometries.clear();
        for (const material of this.ownedMaterials) {
            material.map!.dispose();
            material.dispose();
        }
        this.ownedMaterials.clear();
        this.bounds.makeEmpty();
        this.initialized = false;
        super.disposeAndRemoveAllChildren();
    }

}

export interface GuiObjectOptions extends SceneObjectOptions {

}

export function isGuiObject(obj: any): obj is GuiObject {
    return (<GuiObject>obj).isGuiObject;
}
