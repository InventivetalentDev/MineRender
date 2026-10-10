import { Box2, Box3, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Vector2 } from "three";
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
import { createGuiTextureGeometry } from "../GuiTextureGeometry";
import { createGuiTextGeometry, layoutGuiText, type GuiTextLayout } from "../GuiText";
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
        super({ ...options, instanceMeshes: false, mergeMeshes: false });
    }

    public async init(): Promise<void> {
        if (this.initialized) return;
        try {
            let depth = 0;
            for (const [index, layer] of this.textureLayers.entries()) {
                const [x, y] = layer.position ?? [0, 0];
                if ("text" in layer) {
                    const layout = await layoutGuiText(layer.text, layer);
                    const { group, bounds } = this.createText(layout, layer.shadow, `${layer.name ?? index}`, index);
                    group.position.set(x, -y, depth);
                    const [width, height] = layer.size ?? [layout.width, layout.height];
                    group.scale.set(layout.width ? width / layout.width : 1, height / layout.height, 1);
                    this.add(group);
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
                    const overlay = this.itemOverlay(layer.context);
                    this.bounds.expandByPoint(new Vector2(x, y));
                    this.bounds.expandByPoint(new Vector2(x + width, y + height));
                    if (overlay.count === 0) {
                        const empty = new Group();
                        empty.name = `group:${layer.name ?? index}`;
                        empty.position.set(x + width / 2, -y - height / 2, depth);
                        empty.scale.set(width / 16, height / 16, width / 16);
                        this.add(empty);
                        depth += 0.01;
                        continue;
                    }
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
                    if (layer.decorations !== false && (overlay.bar || overlay.count > 1)) {
                        await this.createItemOverlay(overlay, `${layer.name ?? index}`, index, [x, y], [width, height], depth);
                        depth += 0.01;
                    }
                    continue;
                }
                const key = typeof layer.texture === "string" ? AssetKey.parse("textures", layer.texture) : layer.texture;
                const material = await this.loadMaterial(key);
                const image = material.map!.image as HTMLCanvasElement;
                const scaling = layer.crop ? undefined : (await ModelTextures.getMeta(key))?.gui?.scaling;
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

    private createText(layout: GuiTextLayout, shadow: boolean | undefined, name: string, order: number, orderSpan = 0.5): { group: Group; bounds: Box3 } {
        const group = new Group();
        group.name = `group:${name}`;
        const bounds = new Box3();
        const parts = createGuiTextGeometry(layout, shadow);
        for (const [index, { image, geometry }] of parts.entries()) {
            this.geometries.add(geometry);
            geometry.computeBoundingBox();
            bounds.union(geometry.boundingBox!);
            const mesh = new Mesh(geometry, this.textMaterial(image));
            mesh.name = `mesh:${name}:${index}`;
            mesh.renderOrder = order + index / (parts.length + 1) * orderSpan;
            group.add(mesh);
        }
        return { group, bounds };
    }

    private textMaterial(image?: CompatCanvas): MeshBasicMaterial {
        let material = this.textMaterials.get(image);
        if (!material) {
            material = image ? Materials.createGuiCanvasMaterial(image as HTMLCanvasElement)
                : new MeshBasicMaterial({ transparent: true, depthWrite: false, side: DoubleSide, toneMapped: false });
            material.vertexColors = true;
            this.textMaterials.set(image, material);
            this.ownedMaterials.add(material);
        }
        return material;
    }

    private itemOverlay(context: GuiItemLayer["context"]): GuiItemOverlay {
        const count = context?.count === undefined ? 1 : context.count;
        if (!Number.isSafeInteger(count) || count < 0) throw new Error("Item-preview count must be a nonnegative safe integer");
        const components = context?.components ?? {};
        const maximum = Models.componentValue(components, "max_damage"), suppliedDamage = Models.componentValue(components, "damage");
        const unbreakable = Models.componentValue(components, "unbreakable");
        if (count === 0 || maximum === undefined || suppliedDamage === undefined
            || unbreakable !== undefined) return { count };
        if (typeof maximum !== "number" || !Number.isFinite(maximum) || maximum < 0
            || typeof suppliedDamage !== "number" || !Number.isFinite(suppliedDamage)) throw new Error("GUI item durability requires finite damage and a nonnegative max_damage");
        const damage = Math.max(0, Math.min(maximum, suppliedDamage));
        if (!damage) return { count };
        // Match the float arithmetic in Minecraft's Item.getBarColor.
        let width = Math.fround(13 - Math.fround(Math.fround(Math.fround(damage) * 13) / Math.fround(maximum)));
        let remaining = Math.fround(Math.fround(Math.fround(maximum) - Math.fround(damage)) / Math.fround(maximum));
        if (!Number.isFinite(width) || !Number.isFinite(remaining)) {
            remaining = Math.max(0, 1 - damage / maximum);
            width = remaining * 13;
        }
        const hue = Math.fround(Math.fround(Math.max(0, remaining) / 3) * 6);
        const red = hue < 1 ? 1 : Math.fround(1 - Math.fround(hue - 1));
        const green = hue < 1 ? Math.fround(1 - Math.fround(1 - hue)) : 1;
        const color = Math.floor(Math.fround(red * 255)) << 16 | Math.floor(Math.fround(green * 255)) << 8;
        return { count, bar: { width: Math.max(0, Math.min(13, Math.round(width))), color } };
    }

    private async createItemOverlay(overlay: GuiItemOverlay, name: string, index: number,
                                    position: [number, number], size: [number, number], depth: number): Promise<void> {
        const group = new Group();
        group.name = `group:${name}:overlays`;
        group.position.set(position[0], -position[1], depth);
        group.scale.set(size[0] / 16, size[1] / 16, 1);
        this.add(group);
        if (overlay.bar) {
            for (const [part, width, height, color, order] of [
                ["background", 13, 2, 0x000000, index + 0.5], ["fill", overlay.bar.width, 1, overlay.bar.color, index + 0.6]
            ] as const) {
                if (!width) continue;
                const geometry = new PlaneGeometry(width, height);
                geometry.setAttribute("color", new Float32BufferAttribute(Array(4).fill(new Color(color).toArray()).flat(), 3));
                this.geometries.add(geometry);
                const mesh = new Mesh(geometry, this.textMaterial());
                mesh.name = `mesh:${name}:durability-${part}`;
                mesh.position.set(2 + width / 2, -13 - height / 2, 0);
                mesh.renderOrder = order;
                group.add(mesh);
            }
        }
        if (overlay.count > 1) {
            const layout = await layoutGuiText(`${overlay.count}`);
            const { group: text, bounds } = this.createText(layout, true, `${name}:count`, index + 0.75, 0.25);
            text.position.set(17 - Math.ceil(layout.width), -9, 0);
            group.add(text);
            text.updateMatrix();
            group.updateMatrix();
            bounds.applyMatrix4(text.matrix).applyMatrix4(group.matrix);
            if (!bounds.isEmpty()) {
                this.bounds.expandByPoint(new Vector2(bounds.min.x, -bounds.max.y));
                this.bounds.expandByPoint(new Vector2(bounds.max.x, -bounds.min.y));
            }
        }
    }

    private async createItem(layer: GuiItemLayer, index: number): Promise<ModelObject> {
        const key = typeof layer.item === "string" ? AssetKey.parse("models", layer.item) : layer.item;
        const model = await Models.getMerged(key, { ...layer.context, displayContext: DisplayPosition.GUI });
        if (!model) throw new Error(`Could not load GUI item ${key.toNamespacedString()}`);
        const item = new ModelObject(model, {
            displayPosition: DisplayPosition.GUI, tints: layer.tints, instanceMeshes: false, mergeMeshes: true
        });
        item.name = `group:${layer.name ?? index}`;
        this.add(item);
        await item.init();
        const meshes: Mesh[] = [];
        item.iterateAllMeshes(mesh => meshes.push(mesh));
        meshes.forEach((mesh, partIndex) => {
            if (!mesh.userData.minerenderItemGlint) mesh.name = `mesh:${layer.name ?? index}`;
            mesh.renderOrder = index + partIndex / (meshes.length + 1) * 0.5;
            for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
                // GUI textures and items share the transparent pass so renderOrder applies to both.
                material.transparent = true;
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

interface GuiItemOverlay {
    count: number;
    bar?: { width: number; color: number };
}

/** Scene-object settings for `scene.addGui(layers, options)`. GUI objects disable instancing and mesh merging. */
export interface GuiObjectOptions extends SceneObjectOptions {

}

export function isGuiObject(obj: any): obj is GuiObject {
    return (<GuiObject>obj).isGuiObject;
}
