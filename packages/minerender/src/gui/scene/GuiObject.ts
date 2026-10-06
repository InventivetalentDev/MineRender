import { Box2, Box3, BufferGeometry, Mesh, MeshBasicMaterial, PlaneGeometry, ShaderMaterial, Vector2 } from "three";
import { AssetKey } from "../../assets/AssetKey";
import { ModelTextures } from "../../assets/ModelTextures";
import { Models } from "../../assets/Models";
import { Caching } from "../../cache/Caching";
import { SceneObject } from "../../renderer/SceneObject";
import { SceneObjectOptions } from "../../renderer/SceneObjectOptions";
import { Materials } from "../../Materials";
import { GuiItemLayer, GuiLayer } from "../GuiLayer";
import { ModelObject } from "../../model/scene/ModelObject";
import { DisplayPosition } from "../../model/DisplayPosition";
import { GuiLight } from "../../model/GuiLight";
import type { ItemModel } from "../../model/Model";

export class GuiObject extends SceneObject {

    public readonly isGuiObject: true = true;
    /** Local bounds in GUI pixels, with y growing down from the origin. */
    public readonly bounds = new Box2();
    private readonly geometries = new Set<BufferGeometry>();
    private readonly ownedMaterials = new Set<MeshBasicMaterial>();
    private initialized = false;

    constructor(readonly textureLayers: readonly GuiLayer[], options?: Partial<GuiObjectOptions>) {
        super({ ...options, instanceMeshes: false, mergeMeshes: false });
    }

    public async init(): Promise<void> {
        if (this.initialized) return;
        try {
            let depth = 0;
            for (const [index, layer] of this.textureLayers.entries()) {
                const [x, y] = layer.position ?? [0, 0];
                if ("item" in layer) {
                    const [width, height] = layer.size ?? [16, 16];
                    const item = await this.createItem(layer, index);
                    item.position.set(x + width / 2, -y - height / 2, 0);
                    item.scale.set(width / 16, height / 16, width / 16);
                    item.updateMatrix();
                    const bounds = new Box3();
                    item.iterateAllMeshes(mesh => {
                        mesh.geometry.computeBoundingBox();
                        bounds.union(mesh.geometry.boundingBox!);
                    });
                    bounds.applyMatrix4(item.matrix);
                    item.position.z = depth - bounds.min.z;
                    depth += bounds.max.z - bounds.min.z + 0.01;
                    this.bounds.expandByPoint(new Vector2(x, y));
                    this.bounds.expandByPoint(new Vector2(x + width, y + height));
                    this.bounds.expandByPoint(new Vector2(bounds.min.x, -bounds.max.y));
                    this.bounds.expandByPoint(new Vector2(bounds.max.x, -bounds.min.y));
                    continue;
                }
                const key = typeof layer.texture === "string" ? AssetKey.parse("textures", layer.texture) : layer.texture;
                const material = await this.loadMaterial(key);
                const image = material.map!.image as HTMLCanvasElement;
                const [cropX, cropY, cropWidth, cropHeight] = layer.crop ?? [0, 0, image.width, image.height];
                const [width, height] = layer.size ?? [cropWidth, cropHeight];
                const geometry = new PlaneGeometry(width, height);
                this.geometries.add(geometry);
                const uv = geometry.getAttribute("uv");
                for (let i = 0; i < uv.count; i++) {
                    uv.setXY(i, (cropX + uv.getX(i) * cropWidth) / image.width,
                        1 - (cropY + (1 - uv.getY(i)) * cropHeight) / image.height);
                }
                const mesh = new Mesh(geometry, material);
                mesh.name = `mesh:${layer.name ?? index}`;
                mesh.position.set(x + width / 2, -y - height / 2, depth);
                mesh.renderOrder = index;
                this.add(mesh);
                this.bounds.expandByPoint(new Vector2(x, y));
                this.bounds.expandByPoint(new Vector2(x + width, y + height));
                depth += 0.01;
            }
            // Separate layer depths retain item self-occlusion; the frontmost layer stays at z=0.
            for (const child of this.children) child.position.z -= depth - 0.01;
            this.initialized = true;
            this.notifyDirty();
        } catch (error) {
            this.disposeAndRemoveAllChildren();
            throw error;
        }
    }

    private async createItem(layer: GuiItemLayer, index: number): Promise<ModelObject> {
        const key = typeof layer.item === "string" ? AssetKey.parse("models", layer.item) : layer.item;
        const model = await Models.getMerged(key);
        if (!model) throw new Error(`Could not load GUI item ${key.toNamespacedString()}`);
        const item = new ModelObject(model, {
            displayPosition: DisplayPosition.GUI, tints: layer.tints, instanceMeshes: false, mergeMeshes: true
        });
        item.name = `group:${layer.name ?? index}`;
        this.add(item);
        await item.init();
        item.iterateAllMeshes(mesh => {
            this.geometries.add(mesh.geometry);
            mesh.name = `mesh:${layer.name ?? index}`;
            mesh.renderOrder = index;
            for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
                // GUI textures and items share the transparent pass so renderOrder applies to both.
                material.transparent = true;
                if ((model as ItemModel).gui_light === GuiLight.FRONT && (material as ShaderMaterial).uniforms?.SHADE) {
                    (material as ShaderMaterial).uniforms.SHADE.value = false;
                }
            }
        });
        return item;
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
