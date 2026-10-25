import { SceneObject } from "../../renderer/SceneObject";
import { SceneObjectOptions } from "../../renderer/SceneObjectOptions";
import { Caching } from "../../cache/Caching";
import { merge } from "../../util/_internal/merge";
import { Color, Object3D } from "three";
import type { BufferGeometry, ColorRepresentation, Material, Mesh, MeshBasicMaterial } from "three";
import { Ticker } from "../../Ticker";
import { addWireframeToMesh } from "../../util/model";
import { ModelTextures } from "../../assets/ModelTextures";
import { AssetKey, isAssetKey } from "../../assets/AssetKey";
import { ExtractableImageData } from "../../ExtractableImageData";
import { Materials } from "../../Materials";
import { MinecraftCubeTexture } from "../../MinecraftCubeTexture";
import { CUBE_FACES, CubeFace } from "../../CubeFace";
import { EntityLayer, EntityModel, EntityModelPart } from "../EntityModel";
import type { DoubleArray } from "../../model/Model";
import type { Maybe } from "../../util/util";
import { isMesh } from "../../util/three";
import type { EntityAnimation } from "../EntityAnimation";
import { EntityAnimationOptions, EntityAnimationPlayer, validateAnimationWeights } from "./EntityAnimationPlayer";
import type { PalettedTextures } from "../../texture/PalettedTextures";
import type { ItemGlint } from "../../model/ItemGlint";

let ItemGlintClass: typeof ItemGlint | undefined;
let PalettedTexturesClass: typeof PalettedTextures | undefined;

/** Renders selected entity layers as named part groups. Create it through {@link MineRenderScene.addEntity}. */
export class EntityObject extends SceneObject {

    public readonly isEntityObject: true = true;

    public static readonly DEFAULT_OPTIONS: EntityObjectOptions = merge({}, SceneObject.DEFAULT_OPTIONS);
    public readonly options: EntityObjectOptions;

    private meshesCreated: boolean = false;
    private readonly geometries = new Set<BufferGeometry>();
    private readonly disposeWireframes: (() => void)[] = [];
    /** Scrolling materials are owned: their texture offset follows this entity's age. */
    private readonly scrollMaterials: { material: Material, offset: { set(x: number, y: number): unknown }, speed: [number, number] }[] = [];
    private scrollTicker: Maybe<number>;
    /** Entity age in ticks, as vanilla's `ageInTicks`; drives the scrolling render modes. */
    public age: number = 0;
    private readonly animationPlayers: { player: EntityAnimationPlayer, indices: number[] }[] = [];
    private readonly partPoses = new Map<Object3D, EntityModelPart["pose"]>();
    private glint?: ItemGlint;

    constructor(readonly entity: EntityModel, options?: Partial<EntityObjectOptions>) {
        super();
        this.options = merge({}, EntityObject.DEFAULT_OPTIONS, options ?? {});
        this.addEventListener("added", () => { this.updateScrollSubscription(); this.glint?.updateSubscription(!!this.parent); });
        this.addEventListener("removed", () => { this.updateScrollSubscription(); this.glint?.updateSubscription(!!this.parent); });
    }

    /** An optional shared material replaces texture loading for every selected draw; its owner retains disposal. */
    async init(material?: Material): Promise<void> {
        this.createMeshes();
        if (material) {
            this.clearScrollMaterials();
            this.iterateAllMeshes(mesh => { mesh.material = material; });
            this.notifyDirty();
        } else {
            await this.applyTextures();
            const layers = Object.entries(this.entityLayers).filter(([, layer]) => layer.glint);
            const meshes: Mesh[] = [];
            for (const [name] of layers) this.getLayerGroup(name)?.traverse(object => { if (isMesh(object)) meshes.push(object); });
            if (meshes.length) {
                const ItemGlint = ItemGlintClass ??= (await import("../../model/ItemGlint")).ItemGlint;
                this.glint = await ItemGlint.create(this, undefined, this.getTextureKey(layers[0][1]).root, meshes.map(mesh => ({ mesh })), "armor");
                this.glint.updateSubscription(!!this.parent);
            }
        }
    }

    dispose() {
        super.dispose();
    }

    public disposeAndRemoveAllChildren() {
        this.glint?.dispose();
        this.glint = undefined;
        this.clearScrollMaterials();
        for (const geometry of this.geometries) geometry.dispose();
        this.geometries.clear();
        for (const dispose of this.disposeWireframes.splice(0)) dispose();
        // The animated part groups are removed with the children.
        for (const { player } of this.animationPlayers.splice(0)) player.clear();
        this.partPoses.clear();
        super.disposeAndRemoveAllChildren();
    }

    private clearScrollMaterials() {
        Ticker.remove(this.scrollTicker);
        this.scrollTicker = undefined;
        for (const { material } of this.scrollMaterials.splice(0)) {
            (material as { map?: { dispose(): void } }).map?.dispose();
            material.dispose();
        }
    }

    private updateScrollSubscription() {
        if (this.parent && this.scrollMaterials.length) {
            if (this.scrollTicker === undefined) {
                this.scrollTicker = Ticker.add(() => {
                    this.age++;
                    this.updateScroll();
                });
            }
        } else {
            Ticker.remove(this.scrollTicker);
            this.scrollTicker = undefined;
        }
    }

    /** Applies the entity age to the scrolling materials; the ticker calls this 20 times per second. */
    private updateScroll() {
        for (const { offset, speed } of this.scrollMaterials) {
            // Texture V points up here and down in vanilla.
            offset.set((this.age * speed[0]) % 1, 0 - (this.age * speed[1]) % 1);
        }
        this.notifyDirty();
    }

    //<editor-fold desc="ANIMATION">

    /** The first active clip, until playback is stopped or the object is disposed. */
    public get animation(): Maybe<EntityAnimation> {
        return this.animationPlayers[0]?.player.animation;
    }

    /** Clips playing together, in the order passed to {@link playAnimations}. */
    public get activeAnimations(): readonly EntityAnimation[] {
        const animations: EntityAnimation[] = [];
        for (const { player, indices } of this.animationPlayers) {
            player.animations.forEach((animation, i) => { animations[indices[i]] = animation; });
        }
        return animations;
    }

    /** Weights of the active clips, in the same order as {@link activeAnimations}. */
    public get animationWeights(): readonly number[] {
        const weights: number[] = [];
        for (const { player, indices } of this.animationPlayers) {
            player.weights.forEach((weight, i) => { weights[indices[i]] = weight; });
        }
        return weights;
    }

    /** Seconds since the animation started, before looping. */
    public get animationTime(): number {
        return this.animationPlayers[0]?.player.time ?? 0;
    }

    /**
     * Plays a clip from {@link Entities.getAnimations}, replacing all active clips.
     * Offsets apply to the baked pose in the clip's layer (`main` by default) and its repeated draws.
     * A `main` clip also poses every selected layer without a clip of its own.
     * The object owns no clock: call {@link advanceAnimation} per frame, or {@link setAnimationTime}.
     */
    public playAnimation(animation: EntityAnimation, options?: EntityAnimationOptions): void {
        this.playAnimations([animation], options);
    }

    /**
     * Plays clips with a shared clock, adding their weighted offsets within each geometry layer.
     * Weights default to 1 and are not normalized. Selected layers without their own clip follow `main`.
     */
    public playAnimations(animations: readonly EntityAnimation[], options?: EntityAnimationOptions): void {
        const weights = validateAnimationWeights(options?.weights ?? animations.map(() => 1), animations.length);
        const selections = new Map<string, { animations: EntityAnimation[], names: string[], indices: number[] }>();
        animations.forEach((animation, index) => {
            const layer = animation.layer ?? "main";
            const names = Object.keys(this.entityLayers).filter(name => name.split("#")[0] === layer);
            if (!names.length) throw new Error(`Entity ${this.entity.id} has no selected animation layer "${layer}"`);
            let selection = selections.get(layer);
            if (!selection) selections.set(layer, selection = { animations: [], names, indices: [] });
            selection.animations.push(animation);
            selection.indices.push(index);
        });
        const main = selections.get("main");
        if (main) main.names.push(...Object.keys(this.entityLayers).filter(name => !selections.has(name.split("#")[0])));
        this.createMeshes();
        this.stopAnimation();
        for (const { animations: clips, names, indices } of selections.values()) {
            const player = new EntityAnimationPlayer();
            player.playAnimations(names.map(name => this.getLayerGroup(name)!), clips,
                { ...options, weights: indices.map(index => weights[index]) }, this.partPoses);
            this.animationPlayers.push({ player, indices });
        }
        this.notifyDirty();
    }

    /** Changes weights in active clip order, notifying the scene without restarting the shared clock. Has no effect without an animation. */
    public setAnimationWeights(weights: readonly number[]): void {
        if (!this.animationPlayers.length) return;
        const values = validateAnimationWeights(weights, this.activeAnimations.length);
        for (const { player, indices } of this.animationPlayers) player.setWeights(indices.map(index => values[index]));
        this.notifyDirty();
    }

    /** Stops all clips and restores the poses from before playback. */
    public stopAnimation(): void {
        const players = this.animationPlayers.splice(0);
        for (const { player } of players) player.stop();
        if (players.length) this.notifyDirty();
    }

    /** Poses the object at an explicit time in seconds. Has no effect without an animation. */
    public setAnimationTime(seconds: number): void {
        for (const { player } of this.animationPlayers) player.setTime(seconds);
        if (this.animationPlayers.length) this.notifyDirty();
    }

    /** Advances the animation by a frame delta in seconds, scaled by its speed. Has no effect without an animation. */
    public advanceAnimation(deltaSeconds: number): void {
        for (const { player } of this.animationPlayers) player.advance(deltaSeconds);
        if (this.animationPlayers.length) this.notifyDirty();
    }

    //</editor-fold>

    /** Finds a selected draw by its layer key, such as `main` or `main#2`, or returns `undefined`. */
    public getLayerGroup(name: string): Maybe<Object3D> {
        return super.getGroupByName(`layer:${name}`);
    }

    /** Finds a part name without `group:`. Supply `layerName` to restrict the search to one draw. */
    public getGroupByName(name: string, layerName?: string): Maybe<Object3D> {
        return layerName === undefined ? super.getGroupByName(name)
            : this.getLayerGroup(layerName)?.getObjectByName(`group:${name}`);
    }

    /** Finds a mesh name without `mesh:`. Supply `layerName` to restrict the search to one draw. */
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
        if (layer.palette) {
            const PalettedTextures = PalettedTexturesClass ??= (await import("../../texture/PalettedTextures")).PalettedTextures;
            return PalettedTextures.get(this.getTextureKey(layer), layer.palette.key, layer.palette.permutation);
        }
        return ModelTextures.get(this.getTextureKey(layer));
    }

    protected createMeshes(force: boolean = false) {
        if (this.meshesCreated && !force) return;

        const modelRoot = new Object3D();
        let transformNode = modelRoot;
        // Keep Minecraft's model coordinates separate from caller placement and scale.
        const transform = this.options.flip === undefined ? this.entity.transform : undefined;
        if (transform) {
            // One position, rotation and scale cannot express nonuniform scale followed by rotation.
            // Nested nodes preserve each operation and avoid manual matrices, which leave bounds stale.
            for (const [index, op] of transform.entries()) {
                if (index > 0) {
                    const child = new Object3D();
                    transformNode.add(child);
                    transformNode = child;
                }
                if ("scale" in op) transformNode.scale.set(...op.scale);
                else if ("translate" in op) transformNode.position.set(...op.translate);
                else transformNode.rotation.set(...op.rotate, "ZYX");
            }
        } else if (this.options.flip ?? true) {
            modelRoot.scale.set(-1, -1, 1);
        }
        this.add(modelRoot);
        Object.entries(this.entityLayers).forEach(([name, layer], index) => {
            const group = this.createGroup(`layer:${name}`);
            transformNode.add(group);
            const inward = !Materials.entityModeCulls(layer.render ?? layer.layer.render);
            this.createPart("root", layer.layer.root, group, layer.layer.texture, Materials.MISSING_TEXTURE, index, inward, this.options.faces?.[name]);
        });
        this.meshesCreated = true;
    }

    private createPart(name: string, part: EntityModelPart, parent: Object3D, textureSize: DoubleArray, material: Material, renderOrder: number, inward: boolean = true, faces?: CubeFace[]) {
        const anchor = this.createGroup(name);
        anchor.position.fromArray(part.pose.offset);
        anchor.rotation.set(...part.pose.rotation, "ZYX");
        anchor.scale.fromArray(part.pose.scale ?? [1, 1, 1]);
        this.partPoses.set(anchor, part.pose);
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
            this.geometries.add(geometry);
            geometry.translate(cube.origin[0] + width / 2, cube.origin[1] + height / 2, cube.origin[2] + depth / 2);
            if (faces) {
                geometry.setIndex(Array.from(geometry.getIndex()!.array).filter((_, index) => faces.includes(CUBE_FACES[Math.floor(index / 6)])));
                geometry.clearGroups();
            }
            // Vanilla draws most entity render types without backface culling, e.g. chicken legs are only painted on faces seen from inside.
            // Zero-thickness cubes keep one face per side, as their coplanar faces would z-fight.
            if (inward && Math.min(width + growX * 2, height + growY * 2, depth + growZ * 2) > 0) {
                const index = Array.from(geometry.getIndex()!.array);
                geometry.setIndex(index.concat(index.slice().reverse()));
            }
            const mesh = this.createMesh(name, geometry, material);
            mesh.renderOrder = renderOrder;
            anchor.add(mesh);
            if (this.options.wireframe) this.disposeWireframes.push(addWireframeToMesh(geometry, mesh));
        }
        for (const [childName, child] of Object.entries(part.children)) {
            this.createPart(childName, child, anchor, size, material, renderOrder, inward, faces);
        }
    }

    protected async applyTextures() {
        this.clearScrollMaterials();
        const results = await Promise.allSettled(Object.entries(this.entityLayers).map(async ([name, layer]) => {
            const mode = layer.render ?? layer.layer.render ?? "cutout";
            const tint = (layer.tint === undefined ? undefined : this.options.tints?.[layer.tint]) ?? layer.color;
            const scroll = Materials.entityModeScroll(mode);
            const assetKeyStr = this.getTextureKey(layer).serialize();
            const keyStr = `entity:${ mode }:${ tint === undefined ? "" : new Color(tint).getHexString() }:${ assetKeyStr }`
                + (layer.palette ? `:${layer.palette.key.serialize()}:${layer.palette.permutation.serialize()}` : "");
            let mat = scroll ? undefined : Caching.materialCache.getIfPresent(keyStr);
            if (!mat) {
                const cachedAsset = Caching.textureAssetCache.getIfPresent(assetKeyStr);
                const imageData = await this.loadTextures(layer);
                if (!imageData) return;
                const canvas = (imageData.data as CanvasRenderingContext2D).canvas;
                const createMaterial = () => Materials.createEntityCanvasMaterial(canvas, mode, tint);
                // A cache clear during decoding must not restore an older source's material.
                // Scrolling materials stay out of the cache, as their texture offset belongs to this entity.
                mat = !scroll && cachedAsset && Caching.textureAssetCache.getIfPresent(assetKeyStr) === cachedAsset
                    ? Caching.materialCache.get(keyStr, createMaterial)
                    : createMaterial();
                if (scroll) {
                    this.scrollMaterials.push({ material: mat!, offset: (mat as MeshBasicMaterial).map!.offset, speed: scroll });
                }
            }
            this.getLayerGroup(name)?.traverse(object => {
                if (isMesh(object)) object.material = mat!;
            });
        }));
        if (!this.children.length) {
            // Disposed while the textures were loading: nothing is left to scroll.
            this.clearScrollMaterials();
        } else if (this.scrollMaterials.length) {
            this.updateScroll();
        }
        this.updateScrollSubscription();
        this.notifyDirty();
        const failure = results.find(result => result.status === "rejected");
        if (failure?.status === "rejected") throw failure.reason;
    }


}

/** Render settings passed to `scene.addEntity(entity, options)` or the EntityObject constructor. */
export interface EntityObjectOptions extends SceneObjectOptions {
    /**
     * `true` applies only vanilla's entity flip, scale (-1, -1, 1); `false` keeps raw model space.
     * By default the model's dataset transform is used, or the flip for models without one.
     */
    flip?: boolean;
    /** Colours for the dataset's tint labels, e.g. `{ wool_color: 0xf9801d }`; an absent label uses the draw's fixed colour, if any. */
    tints?: Record<string, ColorRepresentation>;
    /** Cube faces by layer key; omitted layers draw all six faces. */
    faces?: Record<string, CubeFace[]>;
}

export function isEntityObject(obj: any): obj is EntityObject {
    return (<EntityObject>obj).isEntityObject;
}
