import { Box2, Box3, BufferGeometry, DoubleSide, Group, Matrix4, Mesh, MeshBasicMaterial, Vector2 } from "three";
import { AssetKey } from "../../assets/AssetKey";
import { AssetContext } from "../../assets/AssetContext";
import { Caching } from "../../cache/Caching";
import { SceneObject } from "../../renderer/SceneObject";
import { SceneObjectOptions } from "../../renderer/SceneObjectOptions";
import { Materials } from "../../Materials";
import { GuiItemLayer, GuiLayer } from "../GuiLayer";
import { ModelObject } from "../../model/scene/ModelObject";
import { DisplayPosition } from "../../model/DisplayPosition";
import { createGuiTextureGeometry } from "../GuiTextureGeometry";
import { createGuiTextGeometry, layoutGuiText } from "../GuiText";
import type { CompatCanvas } from "../../canvas/CanvasCompat";

/**
 * Renders ordered texture, item, and text layers. Create it through {@link MineRenderScene.addGui}.
 * GUI coordinates grow right and down, with one pixel equal to one scene unit.
 */
export class GuiObject extends SceneObject {

    public readonly isGuiObject: true = true;
    /** Local bounds in GUI pixels, with y growing down from the origin. */
    public readonly bounds = new Box2();
    private readonly geometries = new Set<BufferGeometry>();
    private readonly ownedMaterials = new Set<MeshBasicMaterial>();
    private readonly textMaterials = new Map<CompatCanvas | undefined, MeshBasicMaterial>();
    private initialized = false;

    constructor(readonly textureLayers: readonly GuiLayer[], options?: Partial<GuiObjectOptions>) {
        super({ ...options, assets: options?.assets ?? AssetContext.origin(textureLayers), instanceMeshes: false, mergeMeshes: false });
    }

    public async init(): Promise<void> {
        if (this.initialized) return;
        try {
            let depth = 0;
            for (const [index, layer] of this.textureLayers.entries()) {
                const [x, y] = layer.position ?? [0, 0];
                if ("text" in layer) {
                    const layout = await layoutGuiText(layer.text, { ...layer, assets: this.assets });
                    const group = new Group();
                    group.name = `group:${layer.name ?? index}`;
                    group.position.set(x, -y, depth);
                    const [width, height] = layer.size ?? [layout.width, layout.height];
                    group.scale.set(layout.width ? width / layout.width : 1, height / layout.height, 1);
                    this.add(group);
                    const parts = createGuiTextGeometry(layout, layer.shadow);
                    const bounds = new Box3();
                    for (const [partIndex, { image, geometry }] of parts.entries()) {
                        this.geometries.add(geometry);
                        geometry.computeBoundingBox();
                        bounds.union(geometry.boundingBox!);
                        let material = this.textMaterials.get(image);
                        if (!material) {
                            material = image ? Materials.createGuiCanvasMaterial(image as HTMLCanvasElement)
                                : new MeshBasicMaterial({ transparent: true, depthWrite: false, side: DoubleSide, toneMapped: false });
                            material.vertexColors = true;
                            this.textMaterials.set(image, material);
                            this.ownedMaterials.add(material);
                        }
                        const mesh = new Mesh(geometry, material);
                        mesh.name = `mesh:${layer.name ?? index}:${partIndex}`;
                        mesh.renderOrder = index + partIndex / (parts.length + 1) * 0.5;
                        group.add(mesh);
                    }
                    group.updateMatrix();
                    bounds.applyMatrix4(group.matrix);
                    this.bounds.expandByPoint(new Vector2(x, y));
                    this.bounds.expandByPoint(new Vector2(x + width, y + height));
                    if (!bounds.isEmpty()) {
                        this.bounds.expandByPoint(new Vector2(bounds.min.x, -bounds.max.y));
                        this.bounds.expandByPoint(new Vector2(bounds.max.x, -bounds.min.y));
                    }
                    depth += 0.01;
                    continue;
                }
                if ("item" in layer) {
                    const [width, height] = layer.size ?? [16, 16];
                    const item = await this.createItem(layer, index);
                    item.position.set(x + width / 2, -y - height / 2, 0);
                    item.scale.set(width / 16, height / 16, width / 16);
                    item.updateWorldMatrix(true, true);
                    const inverse = this.matrixWorld.clone().invert();
                    const bounds = new Box3();
                    item.iterateAllMeshes(mesh => {
                        mesh.geometry.computeBoundingBox();
                        bounds.union(mesh.geometry.boundingBox!.clone().applyMatrix4(new Matrix4().multiplyMatrices(inverse, mesh.matrixWorld)));
                    });
                    item.position.z = depth;
                    if (!bounds.isEmpty()) {
                        item.position.z -= bounds.min.z;
                        depth += bounds.max.z - bounds.min.z;
                        this.bounds.expandByPoint(new Vector2(bounds.min.x, -bounds.max.y));
                        this.bounds.expandByPoint(new Vector2(bounds.max.x, -bounds.min.y));
                    }
                    depth += 0.01;
                    this.bounds.expandByPoint(new Vector2(x, y));
                    this.bounds.expandByPoint(new Vector2(x + width, y + height));
                    continue;
                }
                const key = typeof layer.texture === "string" ? AssetKey.parse("textures", layer.texture) : layer.texture;
                const material = await this.loadMaterial(key);
                const image = material.map!.image as HTMLCanvasElement;
                const scaling = layer.crop ? undefined : (await this.assets.modelTextures.getMeta(key))?.gui?.scaling;
                const [width, height] = layer.size ?? (layer.crop ? layer.crop.slice(2)
                    : scaling && scaling.type !== "stretch" ? [scaling.width, scaling.height] : [image.width, image.height]);
                const geometry = createGuiTextureGeometry(width, height, image.width, image.height, layer.crop, scaling);
                this.geometries.add(geometry);
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
        const model = await this.assets.models.getMerged(key, { ...layer.context, displayContext: DisplayPosition.GUI });
        if (!model) throw new Error(`Could not load GUI item ${key.toNamespacedString()}`);
        const item = new ModelObject(model, {
            assets: this.assets, displayPosition: DisplayPosition.GUI, tints: layer.tints, instanceMeshes: false, mergeMeshes: true
        });
        item.name = `group:${layer.name ?? index}`;
        this.add(item);
        await item.init();
        const meshes: Mesh[] = [];
        item.iterateAllMeshes(mesh => meshes.push(mesh));
        meshes.forEach((mesh, partIndex) => {
            mesh.name = `mesh:${layer.name ?? index}`;
            mesh.renderOrder = index + partIndex / (meshes.length + 1) * 0.5;
            for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
                // GUI textures and items share the transparent pass so renderOrder applies to both.
                material.transparent = true;
            }
        });
        return item;
    }

    private async loadMaterial(key: AssetKey): Promise<MeshBasicMaterial> {
        const assetKey = this.assets.cacheKey(key);
        const materialKey = `gui:${assetKey}`;
        const cached = Caching.materialCache.getIfPresent(materialKey);
        if (cached) return cached as MeshBasicMaterial;

        const pending = this.assets.modelTextures.get(key);
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
            material.map?.dispose();
            material.dispose();
        }
        this.ownedMaterials.clear();
        this.textMaterials.clear();
        this.bounds.makeEmpty();
        this.initialized = false;
        super.disposeAndRemoveAllChildren();
    }

}

/** Scene-object settings for `scene.addGui(layers, options)`. GUI objects disable instancing and mesh merging. */
export interface GuiObjectOptions extends SceneObjectOptions {

}

export function isGuiObject(obj: any): obj is GuiObject {
    return (<GuiObject>obj).isGuiObject;
}
