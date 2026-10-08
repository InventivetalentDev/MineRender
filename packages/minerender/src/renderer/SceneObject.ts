import { BoxGeometry, Color, EdgesGeometry, Euler, InstancedBufferAttribute, InstancedMesh, LineBasicMaterial, LineSegments, Matrix4, Mesh, Object3D, Quaternion, Scene, Vector3 } from "three";
import { ModelElement, ModelFaces } from "../model/ModelElement";
import { Geometries } from "../Geometries";
import { UVMapper } from "../UVMapper";
import { DoubleArray, TripleArray } from "../model/Model";
import { Axis, axisToVec3 } from "../Axis";
import type { BufferGeometry, Material, Object3DEventMap } from "three";
import { SkinPart } from "../skin/SkinPart";
import { changeEvent, Maybe } from "../util/util";
import { InstanceReference } from "../instance/InstanceReference";
import { MineRenderError } from "../error/MineRenderError";
import { isMesh } from "../util/three";
import { Disposable, isDisposable } from "../Disposable";
import { mergeAssetOptions } from "./mergeAssetOptions";
import { SceneObjectOptions } from "./SceneObjectOptions";
import merge from "ts-deepmerge";
import { Instanceable } from "../instance/Instanceable";
import type { MineRenderScene } from "./MineRenderScene";
import { Transformable } from "../Transformable";
import { AssetContext } from "../assets/AssetContext";
import { prefix } from "../util/log";

const p = prefix("SceneObject");

/**
 * Base for renderable Minecraft objects, with named parts and optional shared instances.
 * Use {@link notifyDirty} after changing a part directly so the renderer redraws it.
 */
export class SceneObject extends Object3D<Object3DEventMap & { change: {} }> implements Disposable, Instanceable, Transformable {

    public readonly isSceneObject: true = true;

    public static readonly DEFAULT_OPTIONS: SceneObjectOptions = merge({}, <SceneObjectOptions>{
        instanceMeshes: true,
        maxInstanceCount: 50,
        mergeMeshes: true,
        wireframe: false
    });
    public readonly options: SceneObjectOptions;

    private _scene: Maybe<MineRenderScene>;
    private _assets?: AssetContext;

    private materialCallbacks: { [key: string]: Array<(mat: Material, key: string) => void>; } = {};

    protected _isInstanced: boolean = false;
    _instanceCounter: number = 0;
    protected instanceMesh?: InstancedMesh;
    private readonly instanceReferences = new Map<number, InstanceReference<SceneObject>>();
    private readonly freeInstanceIndices: number[] = [];
    private readonly hiddenInstanceMatrices = new Map<number, Matrix4>();

    constructor(options?: Partial<SceneObjectOptions>) {
        super();
        this.options = mergeAssetOptions(SceneObject.DEFAULT_OPTIONS, options);
        this._assets = this.options.assets;
        this._assets?.bind(this);
        console.log("SceneObject options", this.options);
    }

    public set scene(scene: MineRenderScene) {
        if (!!this._scene) throw new MineRenderError("Scene already set");
        this._scene = scene;
        this._assets ??= AssetContext.for(this, scene.assets);
        this._assets.bind(this);
    }

    public get assets(): AssetContext {
        if (!this._assets) {
            this._assets = AssetContext.for(this, this._scene?.assets);
            this._assets.bind(this);
        }
        return this._assets;
    }

    public get scene(): MineRenderScene {
        if (!this._scene) throw new MineRenderError("Scene not set");
        return this._scene;
    }

    async init(): Promise<void> {
    }

    /** Marks ancestor scenes for redraw and emits a `change` event. */
    public notifyDirty() {
        this.traverseAncestors(parent => {
            const scene = parent as MineRenderScene;
            if (scene.isMineRenderScene) scene.dirty = true;
        });
        this.dispatchEvent(changeEvent);
    }

    //<editor-fold desc="GROUPS">

    protected createAndAddGroup(name?: string, x: number = 0, y: number = 0, z: number = 0, offsetAxis?: Axis, offset: number = 0): Object3D {
        const group = this.createGroup(name, x, y, z, offsetAxis, offset);

        if (name) {
            let existing = this.getObjectByName(group.name);
            if (existing) {
                this.remove(existing);
            }
        }

        console.log("add", group, group.name);
        this.add(group);
        this.notifyDirty();
        return group;
    }

    protected createGroup(name?: string, x: number = 0, y: number = 0, z: number = 0, offsetAxis?: Axis, offset: number = 0): Object3D {
        const obj = new Object3D();
        if (name) {
            obj.name = `group:${name}`;
        }
        if (x > 0 || y > 0 || z > 0) {
            obj.position.set(x, y, z);
        }
        if (offsetAxis) {
            obj.translateOnAxis(axisToVec3(offsetAxis), offset);
        }
        return obj;
    }

    /**
     * Finds a named part, such as `head`, without the internal `group:` prefix.
     * Returns `undefined` when the group does not exist.
     */
    public getGroupByName(name: string): Maybe<Object3D> {
        return this.getObjectByName(`group:${name}`) as Object3D;
    }

    /**
     * Changes a named group's visibility and requests a redraw.
     * @param name - Part name without the `group:` prefix.
     * @param visible - Visibility to assign. Omit it to toggle the current value.
     * @returns The resulting visibility, or `false` if the group does not exist.
     */
    public toggleGroupVisibility(name: string, visible?: boolean): boolean {
        return this.toggleObjectVisibility(this.getGroupByName(name), visible);
    }

    //</editor-fold>

    //<editor-fold desc="MESHES">

    protected addOrReplaceMesh(mesh: Mesh, parent: Object3D, name?: string) {
        if (name) {
            const existing = parent.getObjectByName(mesh.name);
            if (existing) {
                console.log("remove", existing.name, existing);
                parent.remove(existing);
            }
        }
        console.log("add", mesh, mesh.name);
        parent.add(mesh);
    }

    protected createAndAddMesh(name?: string, group?: Object3D, geometry?: BufferGeometry, material?: Material | Material[], offsetAxis?: Axis, offset: number = 0): Mesh {
        const mesh = this.createMesh(name, geometry, material, offsetAxis, offset);
        if (group) {
            this.addOrReplaceMesh(mesh, group, name);
        } else {
            this.addOrReplaceMesh(mesh, this, name);
        }
        this.notifyDirty();
        return mesh;
    }

    protected createMesh(name?: string, geometry?: BufferGeometry, material?: Material | Material[], offsetAxis?: Axis, offset: number = 0): Mesh {
        const mesh = new Mesh(geometry, material);
        if (name) {
            mesh.name = `mesh:${name}`;
        }

        //TODO
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        if (offsetAxis) {
            mesh.translateOnAxis(axisToVec3(offsetAxis), offset);
        }
        return mesh;
    }

    protected createInstancedMesh(name: Maybe<string>, geometry: BufferGeometry, material: Material | Material[], count: number): InstancedMesh {
        const mesh = new InstancedMesh(geometry, material, count);
        mesh.count = 0;
        this.instanceMesh = mesh;
        this._isInstanced = true;
        if (name) {
            mesh.name = `mesh:${name}`;
        }
        return mesh;
    }

    /**
     * Finds a named mesh without the internal `mesh:` prefix, or returns `undefined`.
     */
    public getMeshByName(name: string): Maybe<Mesh> {
        return this.getObjectByName(`mesh:${name}`) as Mesh;
    }

    /**
     * Changes a named mesh's visibility and requests a redraw.
     * @param name - Mesh name without the `mesh:` prefix.
     * @param visible - Visibility to assign. Omit it to toggle the current value.
     * @returns The resulting visibility, or `false` if the mesh does not exist.
     */
    public toggleMeshVisibility(name: string, visible?: boolean): boolean {
        return this.toggleObjectVisibility(this.getMeshByName(name), visible);
    }

    public iterateAllMeshes(cb: (mesh: Mesh) => void) {
        this.traverse(obj => {
            if (isMesh(obj)) cb(obj);
        });
    }

    //</editor-fold>

    //<editor-fold desc="GEOMETRIES">

    protected _getBoxGeometryFromDimensions([width, height, depth]: TripleArray, faces: ModelFaces, originalTextureSize: DoubleArray, actualTextureSize: DoubleArray): BoxGeometry {
        const uv = UVMapper.facesToUvArray(faces, originalTextureSize, actualTextureSize);
        return Geometries.getBox({
            width,
            height,
            depth,
            uv
        });
    }

    protected _getBoxGeometryFromElement(element: ModelElement): BoxGeometry {
        const width = element.to[0] - element.from[0];
        const height = element.to[1] - element.from[1];
        const depth = element.to[2] - element.from[2];

        const uv = element.mappedUv;

        return Geometries.getBox({
            width,
            height,
            depth,
            uv
        });
    }

    protected _getBoxGeometryForDimensionsAndUv(width: number, height: number, depth: number, uv: number[]): BoxGeometry {
        return Geometries.getBox({
            width,
            height,
            depth,
            uv
        });
    }

    //</editor-fold>

    //<editor-fold desc="INSTANCING">

    get isInstanced(): boolean {
        return this._isInstanced;
    }

    /** Number of live placements, excluding released instance slots. */
    get instanceCounter(): number {
        return this._instanceCounter;
    }

    protected constructInstanceReference(i: number): InstanceReference<SceneObject> {
        return new InstanceReference<this>(this, i);
    }

    /** Allocates a placement of this instanced object, reusing a released slot when available. */
    nextInstance(): InstanceReference<SceneObject> {
        const mesh = this.instanceMesh;
        if (!mesh) throw new MineRenderError("Object is not instanced");
        const index = this.freeInstanceIndices.pop() ?? mesh.count;
        if (index >= mesh.instanceMatrix.count) this.growInstances(index + 1);
        const reference = this.constructInstanceReference(index);
        this.instanceReferences.set(index, reference);
        this._instanceCounter = this.instanceReferences.size;
        mesh.count = Math.max(mesh.count, index + 1);
        if (mesh.instanceColor) {
            mesh.setColorAt(index, new Color(0xffffff));
            mesh.instanceColor.needsUpdate = true;
        }
        if (this._scene) this._scene.stats.instanceCount++;
        this.setMatrixAt(index, new Matrix4());
        return reference;
    }

    /** Returns the live reference for a raycast hit on this object's instance mesh. */
    public getInstanceReference(mesh: Object3D, index: number): Maybe<InstanceReference<SceneObject>> {
        return mesh === this.instanceMesh ? this.instanceReferences.get(index) : undefined;
    }

    isInstanceActive(index: number, reference: InstanceReference<Instanceable>): boolean {
        return this.instanceReferences.get(index) === reference;
    }

    removeInstanceAt(index: number): void {
        if (!this.instanceReferences.has(index)) return;
        const mesh = this.instanceMesh!;
        this.hiddenInstanceMatrices.delete(index);
        this.setMatrixAt(index, new Matrix4().makeScale(0, 0, 0));
        this.instanceReferences.delete(index);
        this.freeInstanceIndices.push(index);
        this._instanceCounter = this.instanceReferences.size;
        while (mesh.count > 0 && !this.instanceReferences.has(mesh.count - 1)) mesh.count--;
        if (this._scene) this._scene.stats.instanceCount--;
    }

    private growInstances(required: number): void {
        const mesh = this.instanceMesh!;
        const capacity = Math.max(required, mesh.instanceMatrix.count * 2);
        const grow = (attribute: InstancedBufferAttribute, fill: number) => {
            const array = new Float32Array(capacity * attribute.itemSize).fill(fill);
            array.set(attribute.array);
            return new InstancedBufferAttribute(array, attribute.itemSize, attribute.normalized, attribute.meshPerAttribute)
                .setUsage(attribute.usage);
        };
        const matrix = grow(mesh.instanceMatrix, 0);
        const color = mesh.instanceColor ? grow(mesh.instanceColor, 1) : null;
        // Release uploaded instance buffers before replacing their attributes.
        mesh.dispose();
        mesh.instanceMatrix = matrix;
        mesh.instanceColor = color;
    }

    protected *activeInstanceIndices(): Iterable<number> {
        if (this.instanceMesh) {
            yield* this.instanceReferences.keys();
        } else {
            for (let i = 0; i < this.instanceCounter; i++) yield i;
        }
    }

    //</editor-fold>

    //<editor-fold desc="TRANSFORMATION">

    getMatrixAt(index: number, matrix: Matrix4 = new Matrix4()): Matrix4 {
        if (!this.instanceReferences.has(index)) throw new MineRenderError("Instance is not active");
        const hidden = this.hiddenInstanceMatrices.get(index);
        if (hidden) {
            return matrix.copy(hidden);
        }
        this.instanceMesh!.getMatrixAt(index, matrix);
        return matrix;
    }

    setMatrixAt(index: number, matrix: Matrix4) {
        if (!this.instanceReferences.has(index)) throw new MineRenderError("Instance is not active");
        const mesh = this.instanceMesh!;
        const hidden = this.hiddenInstanceMatrices.get(index);
        if (hidden) {
            hidden.copy(matrix);
        }
        mesh.setMatrixAt(index, hidden ? new Matrix4().makeScale(0, 0, 0) : matrix);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.boundingBox = null;
        mesh.boundingSphere = null;
        this.notifyDirty();
    }

    setInstanceVisibleAt(index: number, visible: boolean): void {
        if (!this.instanceReferences.has(index)) {
            throw new MineRenderError("Instance is not active");
        }
        const hidden = this.hiddenInstanceMatrices.get(index);
        if (visible) {
            if (!hidden) {
                return;
            }
            this.hiddenInstanceMatrices.delete(index);
            this.setMatrixAt(index, hidden);
        } else {
            if (hidden) {
                return;
            }
            const matrix = this.getMatrixAt(index);
            this.hiddenInstanceMatrices.set(index, matrix);
            this.setMatrixAt(index, matrix);
        }
    }

    setPositionRotationScaleAt(index: number, position?: Vector3, rotation?: Euler, scale?: Vector3) {
        if (!this.isInstanced) throw new MineRenderError("Object is not instanced");

        const oldPosition = new Vector3();
        const oldRotation = new Quaternion();
        const oldScale = new Vector3();

        const matrix = new Matrix4();
        if (!scale || !rotation || !position) {
            this.getMatrixAt(index, matrix).decompose(oldPosition, oldRotation, oldScale);
        }

        matrix.compose(
            position ? position : oldPosition,
            rotation ? new Quaternion().setFromEuler(rotation) : oldRotation,
            scale ? scale : oldScale
        );

        this.setMatrixAt(index, matrix);
    }

    setPositionAt(index: number, position: Vector3) {
        if (!this.isInstanced) throw new MineRenderError("Object is not instanced");
        this.setPositionRotationScaleAt(index, position);
    }

    getPositionAt(index: number, vector: Vector3 = new Vector3()): Vector3 {
        if (!this.isInstanced) throw new MineRenderError("Object is not instanced");
        const matrix = this.getMatrixAt(index)
        vector.setFromMatrixPosition(matrix);
        return vector;
    }

    setRotationAt(index: number, rotation: Euler) {
        if (!this.isInstanced) throw new MineRenderError("Object is not instanced");
        this.setPositionRotationScaleAt(index, undefined, rotation, undefined);
    }

    getRotationAt(index: number, euler: Euler = new Euler()): Euler {
        if (!this.isInstanced) throw new MineRenderError("Object is not instanced");
        const rotation = new Quaternion();
        this.getMatrixAt(index).decompose(new Vector3(), rotation, new Vector3());
        return euler.setFromQuaternion(rotation);
    }

    setScaleAt(index: number, scale: Vector3) {
        if (!this.isInstanced) throw new MineRenderError("Object is not instanced");
        this.setPositionRotationScaleAt(index, undefined, undefined, scale);
    }

    getScaleAt(index: number, vector: Vector3 = new Vector3()): Vector3 {
        if (!this.isInstanced) throw new MineRenderError("Object is not instanced");
        const matrix = this.getMatrixAt(index)
        vector.setFromMatrixScale(matrix);
        return vector;
    }

    /** Updates supplied transform components. For a shared model, affects every live instance. */
    setPositionRotationScale(position?: Vector3, rotation?: Euler, scale?: Vector3): void {
        if (this.isInstanced) {
            for (const i of this.activeInstanceIndices()) {
                this.setPositionRotationScaleAt(i, position, rotation, scale);
            }
        } else {
            if (position) {
                this.position.set(position.x, position.y, position.z);
            }
            if (rotation) {
                this.rotation.set(rotation.x, rotation.y, rotation.z);
            }
            if (scale) {
                this.scale.set(scale.x, scale.y, scale.z);
            }
        }
        this.notifyDirty();
    }

    /** Sets position in scene units. For a shared model, updates every live instance. */
    setPosition(position: Vector3) {
        if (this.isInstanced) {
            for (const i of this.activeInstanceIndices()) {
                this.setPositionRotationScaleAt(i, position);
            }
        } else {
            this.position.set(position.x, position.y, position.z);
        }
        this.notifyDirty();
    }

    getPosition(): Vector3 {
        if (this.isInstanced) {
            return this.getPositionAt(this.instanceReferences.keys().next().value ?? 0);
        } else {
            return this.position;
        }
    }

    /** Sets rotation in radians. For a shared model, updates every live instance. */
    setRotation(rotation: Euler) {
        if (this.isInstanced) {
            for (const i of this.activeInstanceIndices()) {
                this.setPositionRotationScaleAt(i, undefined, rotation);
            }
        } else {
            this.rotation.set(rotation.x, rotation.y, rotation.z);
        }
        this.notifyDirty();
    }

    getRotation(): Euler {
        if (this.isInstanced) {
            return this.getRotationAt(this.instanceReferences.keys().next().value ?? 0);
        } else {
            return this.rotation;
        }
    }

    /** Sets scale factors. For a shared model, updates every live instance. */
    setScale(scale: Vector3) {
        if (this.isInstanced) {
            for (const i of this.activeInstanceIndices()) {
                this.setPositionRotationScaleAt(i, undefined, undefined, scale);
            }
        } else {
            this.scale.set(scale.x, scale.y, scale.z);
        }
        this.notifyDirty();
    }

    getScale(): Vector3 {
        if (this.isInstanced) {
            return this.getScaleAt(this.instanceReferences.keys().next().value ?? 0);
        } else {
            return this.scale;
        }
    }

    //</editor-fold>

    protected toggleObjectVisibility(object?: Object3D, visible?: boolean): boolean {
        if (object) {
            if (typeof visible !== "undefined") {
                object.visible = visible;
            } else {
                object.visible = !object.visible;
            }
            this.notifyDirty();
            return object.visible;
        }
        this.notifyDirty();
        return false;
    }

    //<editor-fold desc="CLEANUP">

    public dispose() {
        this.disposeAndRemoveAllChildren();
        this.notifyDirty();
        super.dispose();
    }

    /** Releases instance slots and removes children, disposing children that implement Disposable. */
    public disposeAndRemoveAllChildren() {
        if (this.instanceMesh) {
            if (this._scene) this._scene.stats.instanceCount -= this.instanceReferences.size;
            this.instanceReferences.clear();
            this.freeInstanceIndices.length = 0;
            this.hiddenInstanceMatrices.clear();
            this._instanceCounter = 0;
            this.instanceMesh.count = 0;
            this.instanceMesh.dispose();
            this.instanceMesh.removeFromParent();
            this.instanceMesh = undefined;
            this._isInstanced = false;
        }
        while (this.children.length > 0) {
            let c = this.children[0];
            if (isDisposable(c)) {
                c.dispose();
            }
            this.remove(c);
        }
        this.notifyDirty();
    }

    /** Detaches the object from its parent and requests a redraw. */
    public removeFromScene() {
        this.notifyDirty();
        this.removeFromParent();
    }

    //</editor-fold>

}

export function isSceneObject(obj: any): obj is SceneObject {
    return (<SceneObject>obj).isSceneObject;
}
