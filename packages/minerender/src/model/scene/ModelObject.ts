import { SceneObject } from "../../renderer/SceneObject";
import { ItemModel, Model, TextureAsset, TripleArray } from "../Model";
import { Materials } from "../../Materials";
import { Maybe, toRadians } from "../../util/util";
import { UVMapper } from "../../UVMapper";
import { TextureAtlas } from "../../texture/TextureAtlas";
import { BoxGeometry, BoxHelper, BufferAttribute, Color, DoubleSide, EdgesGeometry, Euler, FrontSide, InstancedMesh, LineBasicMaterial, LineSegments, Material, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, ShaderMaterial } from "three";
import { mergeBufferGeometries } from "../../three/BufferGeometryUtils";
import { SceneObjectOptions } from "../../renderer/SceneObjectOptions";
import { addBox3WireframeToObject, addWireframeToMesh, addWireframeToObject, applyElementRotation } from "../../util/model";
import merge from "ts-deepmerge";
import type { BufferGeometry, Texture } from "three";
import { BlockObject } from "../block/scene/BlockObject";
import { prefix } from "../../util/log";
import { CUBE_FACES } from "../../CubeFace";
import { DisplayPosition } from "../DisplayPosition";
import { DisplayTransforms } from "../DisplayTransforms";
import { ModelCulling } from "../ModelCulling";
import type { MineRenderScene } from "../../renderer/MineRenderScene";
import { SpecialItems } from "../SpecialItems";
import { EntityObject } from "../../entity/scene/EntityObject";
import { GuiLight } from "../GuiLight";
import { ItemTints } from "../ItemTints";


const p = prefix("ModelObject");

//TODO: might want to abstract this out into a generic model, and create a separate class for Block models
/** Builds render geometry from a merged Java model. Create it through {@link MineRenderScene.addModel}. */
export class ModelObject extends SceneObject {

    public readonly isModelObject: true = true;

    public static readonly DEFAULT_OPTIONS: ModelObjectOptions = merge({}, SceneObject.DEFAULT_OPTIONS, <ModelObjectOptions>{});
    public readonly options: ModelObjectOptions;

    protected atlas?: TextureAtlas;
    private atlasMaterial?: Material;
    private atlasTexture?: Texture;
    private unsubscribeAtlas?: () => void;
    private readonly specialMaterials = new Map<Material, Material>();
    private readonly geometries = new Set<BufferGeometry>();

    public blockParent: Maybe<BlockObject>;

    private meshesCreated: boolean = false;

    constructor(readonly originalModel: Model, options?: Partial<ModelObjectOptions>) {
        super(options);
        this.options = merge({}, ModelObject.DEFAULT_OPTIONS, options ?? {});
        if ((originalModel as ItemModel).special || (originalModel as ItemModel).parts) this.options.instanceMeshes = false;
        if (this.options.tints) this.options.tints = { ...this.options.tints };
        this.addEventListener("added", () => this.updateAnimationSubscription());
        this.addEventListener("removed", () => this.updateAnimationSubscription());
    }

    async init(): Promise<void> {
        const parts = (this.originalModel as ItemModel).parts;
        if (parts) {
            try {
                for (const part of parts) {
                    const object = new ModelObject(part, { ...this.options, instanceMeshes: false });
                    this.add(object);
                    await object.init();
                }
                let order = 0;
                this.iterateAllMeshes(mesh => {
                    mesh.renderOrder = order++;
                    // Keep composite children in one render pass so their declared order is retained.
                    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
                        material.transparent = true;
                    }
                });
            } catch (error) {
                this.disposeAndRemoveAllChildren();
                throw error;
            }
            this.notifyDirty();
            return;
        }
        this.options.tints = await ItemTints.get(this.originalModel, this.options.tints);
        const special = (this.originalModel as ItemModel).special;
        if (special) {
            const parts = await SpecialItems.getParts(special, this.originalModel.key?.root, (this.originalModel as ItemModel).components);
            const transform = this.options.displayPosition
                ? DisplayTransforms.getMatrix(this.originalModel.display, this.options.displayPosition) : new Matrix4();
            transform.multiply(new Matrix4().makeTranslation(-8, -8, -8));
            try {
                for (const part of parts) {
                    const object = new EntityObject(part.model, { flip: false, wireframe: this.options.wireframe, tints: part.tints, faces: part.faces });
                    object.matrix.copy(transform).multiply(part.transform);
                    object.matrixWorldNeedsUpdate = true;
                    object.matrixAutoUpdate = false;
                    this.add(object);
                    await object.init();
                    object.iterateAllMeshes(mesh => {
                        const source = mesh.material as MeshBasicMaterial;
                        let material = this.specialMaterials.get(source);
                        if (!material) {
                            const front = this.options.displayPosition === DisplayPosition.GUI &&
                                (this.originalModel as ItemModel).gui_light === GuiLight.FRONT;
                            material = SpecialItems.createMaterial(source, !front);
                            this.specialMaterials.set(source, material);
                        }
                        mesh.material = material;
                    });
                    for (const [name, rotation] of Object.entries(part.rotations)) {
                        object.getGroupByName(name)?.rotation.set(...rotation, "ZYX");
                    }
                    for (const [name, position] of Object.entries(part.positions ?? {})) {
                        object.getGroupByName(name)?.position.set(...position);
                    }
                }
            } catch (error) {
                this.disposeAndRemoveAllChildren();
                throw error;
            }
            this.notifyDirty();
            return;
        }
        // load textures first so we have the updated UV coordinates from the atlas
        await this.loadTextures();
        this.createMeshes();
        this.applyTextures();
    }

    public get textureAtlas(): Maybe<TextureAtlas> {
        return this.atlas;
    }

    public get isOpaqueFullCube(): boolean {
        return !this.options.displayPosition && ModelCulling.isOpaqueFullCube(this.atlas);
    }

    //TODO: support for replacing textures

    protected async loadTextures(): Promise<void> {
        this.atlas = await UVMapper.getAtlas(this.originalModel);
    }


    protected createMeshes(force: boolean = false) {
        if (this.meshesCreated && !force) return;

        const mat = Materials.MISSING_TEXTURE;
        const displayTransform = this.options.displayPosition
            ? DisplayTransforms.getMatrix(this.originalModel.display, this.options.displayPosition) : undefined;

        let allGeos: BufferGeometry[] = [];

        if (this.atlas) {
            if (this.atlas.model.elements) {
                this.atlas.model.elements?.forEach(el => {
                    const elGeo = this._getBoxGeometryFromElement(el).clone();
                    this.geometries.add(elGeo);
                    if (this.options.cullMask) {
                        const indices = Array.from(elGeo.getIndex()!.array);
                        elGeo.setIndex(indices.filter((_, index) => {
                            const face = CUBE_FACES[Math.floor(index / 6)];
                            const direction = CUBE_FACES.findIndex(name => name === el.faces[face]?.cullface);
                            return direction < 0 || !(this.options.cullMask! & (1 << direction));
                        }));
                        elGeo.clearGroups();
                    }
                    if (this.options.uvLockRotation) {
                        UVMapper.lockUvs(elGeo, el.faces, this.atlas!, new Euler(...this.options.uvLockRotation));
                    }
                    UVMapper.setAtlasUvBounds(elGeo, el.faces, this.atlas!);
                    if (this.options.tints) {
                        const colors = new Float32Array(elGeo.getAttribute("position").count * 3).fill(1);
                        for (const [faceIndex, faceName] of CUBE_FACES.entries()) {
                            const tintIndex = el.faces[faceName]?.tintindex;
                            if (tintIndex === undefined || tintIndex < 0) continue;
                            const tint = this.options.tints[tintIndex];
                            if (tint === undefined) continue;
                            const color = new Color(tint);
                            for (let vertex = 0; vertex < 4; vertex++) {
                                color.toArray(colors, (faceIndex * 4 + vertex) * 3);
                            }
                        }
                        elGeo.setAttribute("color", new BufferAttribute(colors, 3));
                    }

                    // elGeo.applyMatrix4(new THREE.Matrix4().makeTranslation(-8,-8,-8));


                    elGeo.applyMatrix4(new Matrix4().makeTranslation((el.to[0] - el.from[0]) / 2, (el.to[1] - el.from[1]) / 2, (el.to[2] - el.from[2]) / 2));
                    elGeo.applyMatrix4(new Matrix4().makeTranslation(el.from[0], el.from[1], el.from[2]));

                    if (el.rotation) {
                        applyElementRotation(el.rotation, elGeo);
                    }


                    elGeo.applyMatrix4(new Matrix4().makeTranslation(-8, -8, -8));
                    if (displayTransform) DisplayTransforms.apply(elGeo, displayTransform);

                    if (this.options.mergeMeshes) {
                        allGeos.push(elGeo);
                    } else {
                        const mesh = this.createAndAddMesh(undefined, undefined, elGeo, mat);
                        if (this.options.wireframe) {
                            addWireframeToMesh(elGeo, mesh);
                        }
                    }
                });
            } else {
                console.debug(p, this.atlas.model, "has no elements")
            }
        } else {
            console.debug(p, "Missing atlas for", this);
        }

        if (this.options.mergeMeshes) {
            let combinedGeo: BufferGeometry;
            if (allGeos.length > 0) {
                // if (this.options.wireframe) {
                //     allGeos.push(new BoxGeometry(16, 16, 16, 1, 1, 1))
                // }

                combinedGeo = mergeBufferGeometries(allGeos);
                for (const geometry of allGeos) {
                    this.geometries.delete(geometry);
                }
            } else {
                combinedGeo = new BoxGeometry(16, 16, 16);
                if (displayTransform) DisplayTransforms.apply(combinedGeo, displayTransform);
            }
            this.geometries.add(combinedGeo);
            combinedGeo.computeBoundingBox();
            // combinedGeo.translate(-8, -8, -8);
            // TODO: cache the combined geometry
            let mesh: Mesh;
            if (this.options.instanceMeshes) {
                mesh = this.createInstancedMesh(undefined, combinedGeo, mat, this.options.maxInstanceCount || 50);
                this.add(mesh);
                this._isInstanced = true;
                //TODO
            } else {
                mesh = this.createAndAddMesh(undefined, undefined, combinedGeo, mat)
            }
            if (this.options.wireframe) {
                addWireframeToMesh(combinedGeo, mesh, 0x0000ff, 4);
                addBox3WireframeToObject(combinedGeo.boundingBox!, mesh, 0x00ffff, 3);
            }
        }

        if (this.options.wireframe) {
            addWireframeToObject(this, 0x00ff00, 3)
        }

        this.meshesCreated = true;
    }


    protected applyTextures() {
        if (this.atlas) {
            const mat = Materials.createShadedCanvasMaterial(this.atlas.image.canvas as HTMLCanvasElement, this.atlas.hasTranslucency, false, true);
            mat.side = this.atlas.hasTransparency ? DoubleSide : FrontSide;
            this.atlasMaterial = mat;
            this.atlasTexture = (mat as ShaderMaterial).uniforms?.map?.value ?? (mat as MeshBasicMaterial).map;
            if (this.options.displayPosition === DisplayPosition.GUI &&
                (this.originalModel as ItemModel).gui_light === GuiLight.FRONT && (mat as ShaderMaterial).uniforms?.SHADE) {
                (mat as ShaderMaterial).uniforms.SHADE.value = false;
            }
            this.iterateAllMeshes(mesh => {
                if (mesh.geometry.hasAttribute("color")) mat.vertexColors = true;
                mesh.material = mat;
            });
            this.updateAnimationSubscription();
        }
    }

    private updateAnimationSubscription(): void {
        let root: ModelObject = this;
        while (root.parent && isModelObject(root.parent)) root = root.parent;
        const active = !!root.parent && (!this.isInstanced || this.instanceCounter > 0);
        if (active && this.atlas?.hasAnimation && this.atlasTexture) {
            if (!this.unsubscribeAtlas) {
                this.atlasTexture.needsUpdate = true;
                this.unsubscribeAtlas = this.atlas.subscribe(() => {
                    this.atlasTexture!.needsUpdate = true;
                    this.traverseAncestors(parent => {
                        if ((parent as MineRenderScene).isMineRenderScene) (parent as MineRenderScene).dirty = true;
                    });
                    this.notifyDirty();
                });
            }
        } else {
            this.unsubscribeAtlas?.();
            this.unsubscribeAtlas = undefined;
        }
        for (const child of this.children) {
            if (isModelObject(child)) child.updateAnimationSubscription();
        }
    }

    nextInstance() {
        const reference = super.nextInstance();
        this.updateAnimationSubscription();
        return reference;
    }

    removeInstanceAt(index: number): void {
        super.removeInstanceAt(index);
        this.updateAnimationSubscription();
    }

    public disposeAndRemoveAllChildren(): void {
        this.unsubscribeAtlas?.();
        this.unsubscribeAtlas = undefined;
        this.atlasTexture?.dispose();
        this.atlasMaterial?.dispose();
        this.atlasTexture = undefined;
        this.atlasMaterial = undefined;
        for (const material of this.specialMaterials.values()) material.dispose();
        this.specialMaterials.clear();
        for (const geometry of this.geometries) geometry.dispose();
        this.geometries.clear();
        super.disposeAndRemoveAllChildren();
    }

}

/** Model settings passed to `scene.addModel(model, options)` or the ModelObject constructor. */
export interface ModelObjectOptions extends SceneObjectOptions {
    /** Minecraft display pose applied around the model center, before scene transforms. */
    displayPosition?: DisplayPosition;
    /** Quarter-turn block rotation in radians to compensate when locking UVs. */
    uvLockRotation?: TripleArray;
    /** sRGB 0xRRGGBB colors by face tint index, overriding automatic item or block preview colors. */
    tints?: Record<number, number>;
    /** Hidden neighbor directions in CUBE_FACES order, before the model's block rotation. */
    cullMask?: number;
}

export function isModelObject(obj: any): obj is ModelObject {
    return (<ModelObject>obj).isModelObject;
}
