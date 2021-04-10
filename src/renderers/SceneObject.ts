import { BoxGeometry, Color, EdgesGeometry, Euler, InstancedMesh, LineBasicMaterial, LineSegments, Matrix4, Mesh, Object3D, Quaternion, Vector3 } from "three";
import { ModelElement, ModelFaces } from "../model/ModelElement";
import { Geometries } from "../Geometries";
import { UVMapper } from "../UVMapper";
import { DoubleArray, TripleArray } from "../model/Model";
import { Axis, axisToVec3 } from "../Axis";
import { BufferGeometry } from "three/src/core/BufferGeometry";
import { Material } from "three/src/materials/Material";
import { SkinPart } from "./skin/SkinPart";
import { Maybe } from "../util/util";
import { InstanceReference } from "../InstanceReference";
import { MineRenderError } from "../error/MineRenderError";
import { isInstancedMesh, isMesh } from "../util/three";
import { Disposable, isDisposable } from "../Disposable";
import { SceneObjectOptions } from "./SceneObjectOptions";
import merge from "ts-deepmerge";

export class SceneObject extends Object3D implements Disposable {

    public readonly isSceneObject: true = true;

    public static readonly DEFAULT_OPTIONS: SceneObjectOptions = merge({}, <SceneObjectOptions>{
        instanceMeshes: true,
        maxInstanceCount: 50,
        mergeMeshes: true,
        wireframe: false
    });
    public readonly options: SceneObjectOptions;

    private materialCallbacks: { [key: string]: Array<(mat: Material, key: string) => void>; } = {};

    protected _isInstanced: boolean = false;
     _instanceCounter: number = 0;

    constructor(options?: Partial<SceneObjectOptions>) {
        super();
        this.options = merge({}, SceneObject.DEFAULT_OPTIONS, options ?? {});
    }

    async init(): Promise<void> {
    }

    //<editor-fold desc="GROUPS">

    protected createAndAddGroup(name?: string, x: number = 0, y: number = 0, z: number = 0, offsetAxis?: Axis, offset: number = 0): Object3D {
        const group = this.createGroup(name, x, y, z, offsetAxis, offset);
        this.add(group);
        return group;
    }

    protected createGroup(name?: string, x: number = 0, y: number = 0, z: number = 0, offsetAxis?: Axis, offset: number = 0): Object3D {
        const obj = new Object3D();
        if (name) {
            obj.name = `group:${ name }`;
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
     * Get a group by its name
     */
    public getGroupByName(name: string): Maybe<Object3D> {
        return this.getObjectByName(`group:${ name }`) as Object3D;
    }

    /**
     * Toggle visibility of a group
     * @param name name of the group
     * @param visible set the visibility directly, if not set toggles it
     */
    public toggleGroupVisibility(name: string, visible?: boolean): boolean {
        return this.toggleObjectVisibility(this.getGroupByName(name), visible);
    }

    //</editor-fold>

    //<editor-fold desc="MESHES">

    protected createAndAddMesh(name?: string, group?: Object3D, geometry?: BufferGeometry, material?: Material | Material[], offsetAxis?: Axis, offset: number = 0): Mesh {
        const mesh = this.createMesh(name, geometry, material, offsetAxis, offset);
        if (group) {
            group.add(mesh);
        } else {
            this.add(mesh);
        }
        return mesh;
    }

    protected createMesh(name?: string, geometry?: BufferGeometry, material?: Material | Material[], offsetAxis?: Axis, offset: number = 0): Mesh {
        const mesh = new Mesh(geometry, material);
        if (name) {
            mesh.name = `mesh:${ name }`;
        }
        if (offsetAxis) {
            mesh.translateOnAxis(axisToVec3(offsetAxis), offset);
        }
        return mesh;
    }

    protected createInstancedMesh(name: Maybe<string>, geometry: BufferGeometry, material: Material | Material[], count: number): InstancedMesh {
        const mesh = new InstancedMesh(geometry, material, count);
        if (name) {
            mesh.name = `mesh:${ name }`;
        }
        return mesh;
    }

    /**
     * Get a mesh by its name
     */
    public getMeshByName(name: string): Maybe<Mesh> {
        return this.getObjectByName(`mesh:${ name }`) as Mesh;
    }

    /**
     * Toggle visibility of a mesh
     * @param name name of the mesh
     * @param visible set the visibility directly, if not set toggles it
     */
    public toggleMeshVisibility(name: string, visible?: boolean): boolean {
        return this.toggleObjectVisibility(this.getMeshByName(name), visible);
    }

    public iterateAllMeshes(cb: (mesh: Mesh) => void) {
        this.children.forEach(obj => {
            if ((<Mesh>obj).isMesh) {
                cb(obj as Mesh);
            }
            obj.children.forEach(obj1 => {
                if ((<Mesh>obj1).isMesh) {
                    cb(obj1 as Mesh);
                }
            })
        })
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

    //</editor-fold>

    //<editor-fold desc="INSTANCING">

    get isInstanced(): boolean {
        return this._isInstanced;
    }

    get instanceCounter(): number {
        return this._instanceCounter;
    }

    nextInstance(): InstanceReference<SceneObject> {
        if (!this.isInstanced) throw new MineRenderError("Object is not instanced");
        const i = this._instanceCounter++;
        this.setMatrixAt(i, new Matrix4());
        console.log("nextInstance "+i)
        return new InstanceReference<SceneObject>(this, i);
    }

    getMatrixAt(index: number, matrix: Matrix4 = new Matrix4()): Matrix4 {
        console.log("getMatrixAt")
        if (!this.isInstanced) throw new MineRenderError("Object is not instanced");
        const child = this.children[0];
        console.log(child)
        if (isInstancedMesh(child)) {
            child.getMatrixAt(index, matrix);
        }
        return matrix;
    }

    setMatrixAt(index: number, matrix: Matrix4) {
        console.log("setMatrixAt")
        if (!this.isInstanced) throw new MineRenderError("Object is not instanced");
        const child = this.children[0];
        if (isInstancedMesh(child)) {
            child.setMatrixAt(index, matrix);
            child.instanceMatrix.needsUpdate = true;
        }
    }

    setPositionRotationScaleAt(index: number, position?: Vector3, rotation?: Euler, scale?: Vector3) {
        console.log("setPositionRotationScaleAt")
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

    setRotationAt(index: number, rotation: Euler) {
        if (!this.isInstanced) throw new MineRenderError("Object is not instanced");
        this.setPositionRotationScaleAt(index, undefined, rotation, undefined);
    }

    setScaleAt(index: number, scale: Vector3) {
        if (!this.isInstanced) throw new MineRenderError("Object is not instanced");
        this.setPositionRotationScaleAt(index, undefined, undefined, scale);
    }

    setPosition(position: Vector3) {
        if (this.isInstanced) {
            for (let i = 0; i < this.instanceCounter; i++) {
                this.setPositionRotationScaleAt(i, position);
            }
        } else {
            this.position.set(position.x, position.y, position.z);
        }
    }

    setRotation(rotation: Euler) {
        console.log("setRotation")
        console.log(this.instanceCounter)
        if (this.isInstanced) {
            for (let i = 0; i < 1/*todo*/; i++) {
                this.setPositionRotationScaleAt(i, undefined, rotation);
            }
        } else {
            this.rotation.set(rotation.x, rotation.y, rotation.z);
        }
    }

    setScale(scale: Vector3) {
        if (this.isInstanced) {
            for (let i = 0; i < this.instanceCounter; i++) {
                this.setPositionRotationScaleAt(i, undefined, undefined, scale);
            }
        } else {
            this.scale.set(scale.x, scale.y, scale.z);
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
            return object.visible;
        }
        return false;
    }

    //<editor-fold desc="CLEANUP">

    public dispose() {
        this.disposeAndRemoveAllChildren();
    }

    public disposeAndRemoveAllChildren() {
        while (this.children.length > 0) {
            let c = this.children[0];
            if (isDisposable(c)) {
                c.dispose();
            }
            this.remove(c);
        }
    }

    //</editor-fold>

}

export function isSceneObject(obj: any): obj is SceneObject {
    return (<SceneObject>obj).isSceneObject;
}
